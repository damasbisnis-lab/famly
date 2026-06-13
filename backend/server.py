from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import json
import uuid
import asyncio
import logging
import bcrypt
import jwt
from datetime import datetime, timezone, timedelta
from typing import Optional, List
from zoneinfo import ZoneInfo

from pywebpush import webpush, WebPushException
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Header
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr, ConfigDict
from emergentintegrations.payments.stripe.checkout import (
    StripeCheckout, CheckoutSessionRequest, CheckoutSessionResponse, CheckoutStatusResponse
)


# ============================================================================
# CONFIG & DB
# ============================================================================
MONGO_URL = os.environ['MONGO_URL']
DB_NAME = os.environ['DB_NAME']
JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALGO = "HS256"
ADMIN_EMAIL = os.environ.get('ADMIN_EMAIL', 'admin@famly.id').lower()
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', 'admin123')
STRIPE_API_KEY = os.environ.get('STRIPE_API_KEY', 'sk_test_emergent')

FREE_LIMIT_MEMBERS = int(os.environ.get('FREE_LIMIT_MEMBERS', 2))
FREE_LIMIT_EXPENSES_MONTH = int(os.environ.get('FREE_LIMIT_EXPENSES_MONTH', 30))
FREE_LIMIT_TASKS_ACTIVE = int(os.environ.get('FREE_LIMIT_TASKS_ACTIVE', 50))
PREMIUM_PRICE_IDR = float(os.environ.get('PREMIUM_PRICE_IDR', 49000))

VAPID_PRIVATE_KEY = os.environ.get('VAPID_PRIVATE_KEY', '')
VAPID_PUBLIC_KEY = os.environ.get('VAPID_PUBLIC_KEY', '')
VAPID_SUB_EMAIL = os.environ.get('VAPID_SUB_EMAIL', 'mailto:admin@famly.id')

# 3 Indonesian timezones
TIMEZONES = {
    "WIB": "Asia/Jakarta",
    "WITA": "Asia/Makassar",
    "WIT": "Asia/Jayapura",
}

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title="Famly API")
api = APIRouter(prefix="/api")
bearer_scheme = HTTPBearer(auto_error=False)


# ============================================================================
# MODELS
# ============================================================================
class RegisterReq(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str = Field(min_length=1, max_length=80)
    ref_code: Optional[str] = None


class LoginReq(BaseModel):
    email: EmailStr
    password: str


class FamilyCreateReq(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class FamilyJoinReq(BaseModel):
    invite_code: str = Field(min_length=4, max_length=20)


class ExpenseCreateReq(BaseModel):
    amount: float = Field(gt=0)
    category: str = Field(min_length=1, max_length=40)
    description: str = Field(default="", max_length=200)
    type: str = Field(default="expense")  # 'expense' or 'income'


class TaskCreateReq(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=400)
    assigned_to: Optional[str] = None  # user_id of family member
    due_date: Optional[str] = None  # ISO date YYYY-MM-DD
    due_time: Optional[str] = None  # HH:MM (24h), optional
    recurrence: str = Field(default="none")  # none | daily | weekly


class CheckoutReq(BaseModel):
    origin_url: str


class AdminActionReq(BaseModel):
    user_id: str


# ============================================================================
# HELPERS
# ============================================================================
def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_token(user_id: str, email: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
        "type": "access",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


def serialize_user(user: dict) -> dict:
    return {
        "id": user["id"],
        "email": user["email"],
        "name": user["name"],
        "role": user.get("role", "user"),
        "is_premium": is_user_premium(user),
        "premium_until": user.get("premium_until"),
        "suspended": user.get("suspended", False),
        "family_id": user.get("family_id"),
        "created_at": user.get("created_at"),
    }


def is_user_premium(user: dict) -> bool:
    if user.get("suspended"):
        return False
    if not user.get("is_premium"):
        return False
    until = user.get("premium_until")
    if not until:
        return False
    try:
        until_dt = datetime.fromisoformat(until)
        return until_dt > datetime.now(timezone.utc)
    except Exception:
        return False


async def get_current_user(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> dict:
    if not creds or not creds.credentials:
        raise HTTPException(status_code=401, detail="Tidak terautentikasi")
    try:
        payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=[JWT_ALGO])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token kadaluarsa")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token tidak valid")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User tidak ditemukan")
    return user


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Akses admin diperlukan")
    return user


async def require_active_user(user: dict = Depends(get_current_user)) -> dict:
    """Require non-suspended user for write operations."""
    if user.get("suspended"):
        raise HTTPException(
            status_code=403,
            detail="Akun Anda telah disuspend. Hubungi admin untuk informasi lebih lanjut.",
        )
    return user


async def get_family_owner_is_premium(family_id: str) -> bool:
    """Returns True if the family owner has active premium and is not suspended."""
    fam = await db.families.find_one({"id": family_id}, {"_id": 0})
    if not fam:
        return False
    owner = await db.users.find_one({"id": fam["owner_id"]}, {"_id": 0})
    if not owner:
        return False
    return is_user_premium(owner)


def gen_invite_code() -> str:
    return uuid.uuid4().hex[:8].upper()


def month_key(dt: Optional[datetime] = None) -> str:
    dt = dt or datetime.now(timezone.utc)
    return dt.strftime("%Y-%m")


# ============================================================================
# AUTH ENDPOINTS
# ============================================================================
@api.post("/auth/register")
async def register(req: RegisterReq):
    email = req.email.lower().strip()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Email sudah terdaftar")
    user_id = str(uuid.uuid4())

    # Referral attribution
    referred_by = None
    if req.ref_code:
        referrer = await db.users.find_one({"ref_code": req.ref_code.upper().strip()}, {"_id": 0})
        if referrer and referrer["id"] != user_id and referrer.get("role") != "admin":
            referred_by = referrer["id"]

    doc = {
        "id": user_id,
        "email": email,
        "name": req.name.strip(),
        "password_hash": hash_password(req.password),
        "role": "user",
        "is_premium": False,
        "premium_until": None,
        "suspended": False,
        "family_id": None,
        "ref_code": gen_invite_code(),
        "referred_by": referred_by,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.users.insert_one(doc)
    if referred_by:
        await db.referrals.insert_one({
            "id": str(uuid.uuid4()),
            "referrer_id": referred_by,
            "referred_id": user_id,
            "referred_email": email,
            "referred_name": req.name.strip(),
            "status": "registered",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "rewarded_at": None,
        })
    token = create_token(user_id, email, "user")
    return {"access_token": token, "user": serialize_user(doc)}


@api.post("/auth/login")
async def login(req: LoginReq):
    email = req.email.lower().strip()
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user or not verify_password(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Email atau password salah")
    token = create_token(user["id"], user["email"], user.get("role", "user"))
    return {"access_token": token, "user": serialize_user(user)}


@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return {"user": serialize_user(user)}


@api.post("/auth/logout")
async def logout(user: dict = Depends(get_current_user)):
    # Stateless JWT - frontend just discards the token.
    return {"ok": True}


# ============================================================================
# FAMILIES
# ============================================================================
@api.post("/families")
async def create_family(req: FamilyCreateReq, user: dict = Depends(require_active_user)):
    if user.get("family_id"):
        raise HTTPException(status_code=400, detail="Anda sudah tergabung dalam keluarga")
    family_id = str(uuid.uuid4())
    invite_code = gen_invite_code()
    fam = {
        "id": family_id,
        "name": req.name.strip(),
        "owner_id": user["id"],
        "invite_code": invite_code,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.families.insert_one(fam)
    await db.users.update_one({"id": user["id"]}, {"$set": {"family_id": family_id}})
    return {"family": {k: v for k, v in fam.items() if k != "_id"}}


@api.post("/families/join")
async def join_family(req: FamilyJoinReq, user: dict = Depends(require_active_user)):
    if user.get("family_id"):
        raise HTTPException(status_code=400, detail="Anda sudah tergabung dalam keluarga")
    fam = await db.families.find_one({"invite_code": req.invite_code.upper().strip()}, {"_id": 0})
    if not fam:
        raise HTTPException(status_code=404, detail="Kode undangan tidak ditemukan")

    # FREE TIER ENFORCEMENT: max members
    member_count = await db.users.count_documents({"family_id": fam["id"]})
    owner_premium = await get_family_owner_is_premium(fam["id"])
    if not owner_premium and member_count >= FREE_LIMIT_MEMBERS:
        raise HTTPException(
            status_code=403,
            detail=(
                f"Keluarga ini sudah mencapai batas {FREE_LIMIT_MEMBERS} anggota "
                f"untuk akun gratis. Minta pemilik keluarga upgrade ke Premium "
                f"untuk menambah anggota."
            ),
        )

    await db.users.update_one({"id": user["id"]}, {"$set": {"family_id": fam["id"]}})
    # Notify existing family members that someone joined
    members = await db.users.find(
        {"family_id": fam["id"], "id": {"$ne": user["id"]}}, {"_id": 0, "id": 1}
    ).to_list(100)
    for m in members:
        asyncio.create_task(notify_user_push(
            m["id"], "Anggota Baru Bergabung 👨‍👩‍👧",
            f"{user['name']} baru saja bergabung ke keluarga {fam['name']}.",
        ))
    return {"family": fam}


@api.get("/families/me")
async def my_family(user: dict = Depends(get_current_user)):
    if not user.get("family_id"):
        return {"family": None, "members": [], "limits": _get_default_limits()}
    fam = await db.families.find_one({"id": user["family_id"]}, {"_id": 0})
    if not fam:
        return {"family": None, "members": [], "limits": _get_default_limits()}
    members_raw = await db.users.find({"family_id": fam["id"]}, {"_id": 0, "password_hash": 0}).to_list(100)
    members = [serialize_user(m) for m in members_raw]
    owner_premium = await get_family_owner_is_premium(fam["id"])

    # Compute current usage
    member_count = len(members)
    mk = month_key()
    expense_count = await db.expenses.count_documents({"family_id": fam["id"], "month_key": mk})
    active_task_count = await db.tasks.count_documents({"family_id": fam["id"], "completed": False})

    return {
        "family": fam,
        "members": members,
        "is_premium": owner_premium,
        "limits": {
            "members": {"used": member_count, "max": None if owner_premium else FREE_LIMIT_MEMBERS},
            "expenses_this_month": {"used": expense_count, "max": None if owner_premium else FREE_LIMIT_EXPENSES_MONTH},
            "active_tasks": {"used": active_task_count, "max": None if owner_premium else FREE_LIMIT_TASKS_ACTIVE},
        },
    }


def _get_default_limits():
    return {
        "members": {"used": 0, "max": FREE_LIMIT_MEMBERS},
        "expenses_this_month": {"used": 0, "max": FREE_LIMIT_EXPENSES_MONTH},
        "active_tasks": {"used": 0, "max": FREE_LIMIT_TASKS_ACTIVE},
    }


# ============================================================================
# EXPENSES
# ============================================================================
@api.post("/expenses")
async def create_expense(req: ExpenseCreateReq, user: dict = Depends(require_active_user)):
    if not user.get("family_id"):
        raise HTTPException(status_code=400, detail="Anda belum bergabung dalam keluarga")
    family_id = user["family_id"]

    # FREE TIER ENFORCEMENT: max 30 expenses per calendar month
    owner_premium = await get_family_owner_is_premium(family_id)
    mk = month_key()
    if not owner_premium:
        count = await db.expenses.count_documents({"family_id": family_id, "month_key": mk})
        if count >= FREE_LIMIT_EXPENSES_MONTH:
            raise HTTPException(
                status_code=403,
                detail=(
                    f"Batas {FREE_LIMIT_EXPENSES_MONTH} pengeluaran per bulan untuk "
                    f"akun gratis tercapai. Upgrade ke Premium untuk pengeluaran tanpa batas."
                ),
            )

    exp_id = str(uuid.uuid4())
    txn_type = req.type if req.type in ("expense", "income") else "expense"
    doc = {
        "id": exp_id,
        "family_id": family_id,
        "user_id": user["id"],
        "user_name": user["name"],
        "amount": req.amount,
        "category": req.category.strip(),
        "description": req.description.strip(),
        "type": txn_type,
        "month_key": mk,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.expenses.insert_one(doc)
    doc.pop("_id", None)
    return {"expense": doc}


@api.get("/expenses")
async def list_expenses(user: dict = Depends(get_current_user)):
    if not user.get("family_id"):
        return {"expenses": []}
    items = (
        await db.expenses.find({"family_id": user["family_id"]}, {"_id": 0})
        .sort("created_at", -1)
        .to_list(500)
    )
    return {"expenses": items}


# ============================================================================
# TASKS
# ============================================================================
def _next_occurrence(due_date: str, recurrence: str, not_before: str) -> str:
    """Advance due_date by one recurrence step, then keep stepping until >= not_before."""
    step = 1 if recurrence == "daily" else 7
    d = datetime.strptime(due_date, "%Y-%m-%d").date() + timedelta(days=step)
    nb = datetime.strptime(not_before, "%Y-%m-%d").date()
    while d < nb:
        d = d + timedelta(days=step)
    return d.isoformat()


async def advance_recurring_tasks(family_id: str, tz_label: str):
    """Roll overdue recurring tasks forward to their next occurrence (idempotent)."""
    zone = TIMEZONES.get(tz_label, "Asia/Jakarta")
    today = datetime.now(ZoneInfo(zone)).strftime("%Y-%m-%d")
    tasks = await db.tasks.find(
        {"family_id": family_id, "recurrence": {"$in": ["daily", "weekly"]},
         "completed": False, "due_date": {"$ne": None, "$lt": today}},
        {"_id": 0, "id": 1, "due_date": 1, "recurrence": 1},
    ).to_list(500)
    for t in tasks:
        next_d = _next_occurrence(t["due_date"], t["recurrence"], today)
        await db.tasks.update_one(
            {"id": t["id"], "due_date": t["due_date"]},
            {"$set": {"due_date": next_d, "notified_users": []}},
        )


@api.post("/tasks")
async def create_task(req: TaskCreateReq, user: dict = Depends(require_active_user)):
    if not user.get("family_id"):
        raise HTTPException(status_code=400, detail="Anda belum bergabung dalam keluarga")
    family_id = user["family_id"]

    # FREE TIER ENFORCEMENT: max 50 active (incomplete) tasks
    owner_premium = await get_family_owner_is_premium(family_id)
    if not owner_premium:
        active = await db.tasks.count_documents({"family_id": family_id, "completed": False})
        if active >= FREE_LIMIT_TASKS_ACTIVE:
            raise HTTPException(
                status_code=403,
                detail=(
                    f"Batas {FREE_LIMIT_TASKS_ACTIVE} tugas aktif untuk akun gratis tercapai. "
                    f"Selesaikan tugas yang ada atau upgrade ke Premium."
                ),
            )

    task_id = str(uuid.uuid4())
    assignee_name = None
    if req.assigned_to:
        member = await db.users.find_one({"id": req.assigned_to, "family_id": family_id}, {"_id": 0, "name": 1, "id": 1})
        if member:
            assignee_name = member["name"]
    recurrence = req.recurrence if req.recurrence in ("none", "daily", "weekly") else "none"
    if not req.due_date:
        recurrence = "none"  # recurrence requires a due date
    doc = {
        "id": task_id,
        "family_id": family_id,
        "user_id": user["id"],
        "user_name": user["name"],
        "title": req.title.strip(),
        "description": req.description.strip(),
        "assigned_to": req.assigned_to if assignee_name else None,
        "assigned_to_name": assignee_name,
        "due_date": req.due_date or None,
        "due_time": (req.due_time or None) if req.due_date else None,
        "recurrence": recurrence,
        "last_done_date": None,
        "completed": False,
        "notified_users": [],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "completed_at": None,
    }
    await db.tasks.insert_one(doc)
    doc.pop("_id", None)
    return {"task": doc}


@api.get("/tasks")
async def list_tasks(user: dict = Depends(get_current_user)):
    if not user.get("family_id"):
        return {"tasks": []}
    # Roll any overdue recurring tasks forward before returning
    await advance_recurring_tasks(user["family_id"], get_reminder_prefs(user)["tz_label"])
    items = (
        await db.tasks.find({"family_id": user["family_id"]}, {"_id": 0})
        .sort("created_at", -1)
        .to_list(500)
    )
    return {"tasks": items}


@api.patch("/tasks/{task_id}/complete")
async def complete_task(task_id: str, user: dict = Depends(require_active_user)):
    task = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    if not task or task["family_id"] != user.get("family_id"):
        raise HTTPException(status_code=404, detail="Tugas tidak ditemukan")

    recurrence = task.get("recurrence", "none")
    # Recurring task: instead of completing permanently, roll to next occurrence
    if recurrence in ("daily", "weekly") and not task.get("completed", False):
        zone = TIMEZONES.get(get_reminder_prefs(user)["tz_label"], "Asia/Jakarta")
        today = datetime.now(ZoneInfo(zone)).strftime("%Y-%m-%d")
        base = task.get("due_date") or today
        next_d = _next_occurrence(base, recurrence, today)
        await db.tasks.update_one(
            {"id": task_id},
            {"$set": {"due_date": next_d, "completed": False, "completed_at": None,
                      "notified_users": [], "last_done_date": today}},
        )
        task["due_date"] = next_d
        return {"task": task, "rescheduled": True, "next_date": next_d}

    new_completed = not task.get("completed", False)
    await db.tasks.update_one(
        {"id": task_id},
        {"$set": {"completed": new_completed, "completed_at": datetime.now(timezone.utc).isoformat() if new_completed else None}},
    )
    task["completed"] = new_completed
    return {"task": task}


@api.delete("/expenses/{expense_id}")
async def delete_expense(expense_id: str, user: dict = Depends(require_active_user)):
    exp = await db.expenses.find_one({"id": expense_id})
    if not exp or exp.get("family_id") != user.get("family_id"):
        raise HTTPException(status_code=404, detail="Transaksi tidak ditemukan")
    await db.expenses.delete_one({"id": expense_id})
    return {"ok": True}


@api.put("/expenses/{expense_id}")
async def update_expense(expense_id: str, req: ExpenseCreateReq, user: dict = Depends(require_active_user)):
    exp = await db.expenses.find_one({"id": expense_id})
    if not exp or exp.get("family_id") != user.get("family_id"):
        raise HTTPException(status_code=404, detail="Transaksi tidak ditemukan")
    txn_type = req.type if req.type in ("expense", "income") else "expense"
    await db.expenses.update_one(
        {"id": expense_id},
        {"$set": {
            "amount": req.amount,
            "category": req.category.strip(),
            "description": req.description.strip(),
            "type": txn_type,
        }},
    )
    doc = await db.expenses.find_one({"id": expense_id}, {"_id": 0})
    return {"expense": doc}


@api.delete("/tasks/{task_id}")
async def delete_task(task_id: str, user: dict = Depends(require_active_user)):
    task = await db.tasks.find_one({"id": task_id})
    if not task or task["family_id"] != user.get("family_id"):
        raise HTTPException(status_code=404, detail="Tugas tidak ditemukan")
    await db.tasks.delete_one({"id": task_id})
    return {"ok": True}


# ============================================================================
# PAYMENTS - Stripe Checkout for Premium Upgrade
# ============================================================================
@api.post("/payments/checkout/session")
async def create_checkout_session(
    req: CheckoutReq,
    request: Request,
    user: dict = Depends(require_active_user),
):
    """Create a Stripe Checkout Session for Rp 49.000/month premium upgrade."""
    host_url = str(request.base_url).rstrip("/")
    webhook_url = f"{host_url}/api/webhook/stripe"
    stripe = StripeCheckout(api_key=STRIPE_API_KEY, webhook_url=webhook_url)

    origin = req.origin_url.rstrip("/")
    success_url = f"{origin}/payment/success?session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = f"{origin}/payment/cancel"

    # SECURITY: amount + currency set on server only
    amount = await get_premium_price()
    currency = "idr"
    metadata = {
        "user_id": user["id"],
        "user_email": user["email"],
        "package": "premium_monthly",
        "source": "famly_premium_upgrade",
    }
    checkout_req = CheckoutSessionRequest(
        amount=amount,
        currency=currency,
        success_url=success_url,
        cancel_url=cancel_url,
        metadata=metadata,
    )
    try:
        session: CheckoutSessionResponse = await stripe.create_checkout_session(checkout_req)
    except Exception as e:
        logging.exception("Stripe create_checkout_session failed")
        raise HTTPException(status_code=502, detail=f"Gagal membuat sesi pembayaran: {str(e)}")

    # Record transaction (PENDING / INITIATED) BEFORE redirect
    txn_doc = {
        "id": str(uuid.uuid4()),
        "session_id": session.session_id,
        "user_id": user["id"],
        "user_email": user["email"],
        "amount": amount,
        "currency": currency,
        "package": "premium_monthly",
        "metadata": metadata,
        "status": "initiated",
        "payment_status": "unpaid",
        "premium_granted": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.payment_transactions.insert_one(txn_doc)

    return {"url": session.url, "session_id": session.session_id}


async def _process_paid_session(session_id: str, payment_status: str, amount_total: int, currency: str):
    """Idempotently grant premium for a paid session."""
    txn = await db.payment_transactions.find_one({"session_id": session_id})
    if not txn:
        return None
    # Only act once
    if txn.get("premium_granted"):
        return txn

    update = {
        "status": "paid" if payment_status == "paid" else payment_status,
        "payment_status": payment_status,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if payment_status == "paid":
        # Grant 30 days premium
        until = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
        await db.users.update_one(
            {"id": txn["user_id"]},
            {"$set": {"is_premium": True, "premium_until": until, "suspended": False}},
        )
        update["premium_granted"] = True
        update["premium_until"] = until

    await db.payment_transactions.update_one({"session_id": session_id}, {"$set": update})
    if payment_status == "paid":
        await reward_referral_if_any(txn["user_id"])
    return await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})


@api.get("/payments/checkout/status/{session_id}")
async def checkout_status(session_id: str, request: Request, user: dict = Depends(get_current_user)):
    """Poll Stripe for payment status; idempotently grant premium on success."""
    txn = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
    if not txn:
        raise HTTPException(status_code=404, detail="Transaksi tidak ditemukan")
    if txn["user_id"] != user["id"] and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Akses ditolak")

    # If already finalized as paid, just return
    if txn.get("premium_granted"):
        return {
            "status": txn["status"],
            "payment_status": txn["payment_status"],
            "amount_total": int(txn["amount"]),
            "currency": txn["currency"],
            "premium_granted": True,
        }

    host_url = str(request.base_url).rstrip("/")
    webhook_url = f"{host_url}/api/webhook/stripe"
    stripe = StripeCheckout(api_key=STRIPE_API_KEY, webhook_url=webhook_url)
    try:
        status_resp: CheckoutStatusResponse = await stripe.get_checkout_status(session_id)
    except Exception as e:
        logging.exception("Stripe get_checkout_status failed")
        raise HTTPException(status_code=502, detail=f"Gagal mengambil status pembayaran: {str(e)}")

    await _process_paid_session(session_id, status_resp.payment_status, status_resp.amount_total, status_resp.currency)
    final_txn = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
    return {
        "status": status_resp.status,
        "payment_status": status_resp.payment_status,
        "amount_total": status_resp.amount_total,
        "currency": status_resp.currency,
        "premium_granted": final_txn.get("premium_granted", False),
    }


@api.post("/webhook/stripe")
async def stripe_webhook(request: Request):
    """Stripe webhook - signature is verified inside emergentintegrations.handle_webhook."""
    body = await request.body()
    sig = request.headers.get("Stripe-Signature", "")
    host_url = str(request.base_url).rstrip("/")
    webhook_url = f"{host_url}/api/webhook/stripe"
    stripe = StripeCheckout(api_key=STRIPE_API_KEY, webhook_url=webhook_url)
    try:
        event = await stripe.handle_webhook(body, sig)
    except Exception as e:
        logging.exception("Stripe webhook failed")
        raise HTTPException(status_code=400, detail=f"Webhook error: {str(e)}")

    if event and event.session_id:
        await _process_paid_session(event.session_id, event.payment_status, 0, "idr")
    return {"received": True}


# ============================================================================
# ADMIN ENDPOINTS
# ============================================================================
@api.get("/admin/stats")
async def admin_stats(user: dict = Depends(require_admin)):
    total_users = await db.users.count_documents({"role": "user"})
    total_families = await db.families.count_documents({})
    # Active premium = is_premium True + premium_until in future + not suspended
    now_iso = datetime.now(timezone.utc).isoformat()
    active_subs = await db.users.count_documents({
        "role": "user",
        "is_premium": True,
        "suspended": {"$ne": True},
        "premium_until": {"$gt": now_iso},
    })
    suspended = await db.users.count_documents({"suspended": True})
    price = await get_premium_price()
    mrr_idr = active_subs * price
    # Total revenue from paid transactions
    paid_txns = await db.payment_transactions.find({"premium_granted": True}, {"_id": 0}).to_list(10000)
    total_revenue = sum(t.get("amount", 0) for t in paid_txns)
    total_paid_count = len(paid_txns)
    return {
        "total_users": total_users,
        "total_families": total_families,
        "active_subscribers": active_subs,
        "suspended_users": suspended,
        "mrr_idr": mrr_idr,
        "total_revenue_idr": total_revenue,
        "total_paid_transactions": total_paid_count,
        "premium_price_idr": price,
    }


@api.get("/admin/subscribers")
async def admin_subscribers(user: dict = Depends(require_admin)):
    users = await db.users.find(
        {"role": "user"},
        {"_id": 0, "password_hash": 0},
    ).sort("created_at", -1).to_list(1000)

    out = []
    for u in users:
        premium_active = is_user_premium(u)
        out.append({
            "id": u["id"],
            "email": u["email"],
            "name": u["name"],
            "is_premium": u.get("is_premium", False),
            "premium_active": premium_active,
            "premium_until": u.get("premium_until"),
            "suspended": u.get("suspended", False),
            "family_id": u.get("family_id"),
            "created_at": u.get("created_at"),
            "status": (
                "suspended" if u.get("suspended")
                else "premium" if premium_active
                else "free"
            ),
        })
    return {"subscribers": out}


@api.post("/admin/users/{user_id}/upgrade")
async def admin_upgrade(user_id: str, admin: dict = Depends(require_admin)):
    target = await db.users.find_one({"id": user_id})
    if not target:
        raise HTTPException(status_code=404, detail="User tidak ditemukan")
    until = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
    await db.users.update_one(
        {"id": user_id},
        {"$set": {"is_premium": True, "premium_until": until, "suspended": False}},
    )
    price = await get_premium_price()
    # Log manual admin transaction
    await db.payment_transactions.insert_one({
        "id": str(uuid.uuid4()),
        "session_id": f"manual-{uuid.uuid4().hex[:12]}",
        "user_id": user_id,
        "user_email": target["email"],
        "amount": price,
        "currency": "idr",
        "package": "premium_monthly_manual",
        "metadata": {"granted_by_admin": admin["id"]},
        "status": "paid",
        "payment_status": "manual",
        "premium_granted": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })
    asyncio.create_task(notify_user_push(
        user_id, "Premium Aktif! 👑",
        "Akun Anda telah di-upgrade ke Premium oleh admin. Semua batasan kini terbuka.",
    ))
    return {"ok": True, "premium_until": until}


@api.post("/admin/users/{user_id}/downgrade")
async def admin_downgrade(user_id: str, admin: dict = Depends(require_admin)):
    target = await db.users.find_one({"id": user_id})
    if not target:
        raise HTTPException(status_code=404, detail="User tidak ditemukan")
    await db.users.update_one(
        {"id": user_id},
        {"$set": {"is_premium": False, "premium_until": None}},
    )
    return {"ok": True}


@api.post("/admin/users/{user_id}/suspend")
async def admin_suspend(user_id: str, admin: dict = Depends(require_admin)):
    target = await db.users.find_one({"id": user_id})
    if not target:
        raise HTTPException(status_code=404, detail="User tidak ditemukan")
    # Per user choice (c): revoke premium + flag suspended, read-only still allowed
    await db.users.update_one(
        {"id": user_id},
        {"$set": {"suspended": True, "is_premium": False, "premium_until": None}},
    )
    return {"ok": True}


@api.post("/admin/users/{user_id}/unsuspend")
async def admin_unsuspend(user_id: str, admin: dict = Depends(require_admin)):
    target = await db.users.find_one({"id": user_id})
    if not target:
        raise HTTPException(status_code=404, detail="User tidak ditemukan")
    await db.users.update_one({"id": user_id}, {"$set": {"suspended": False}})
    return {"ok": True}


class AdminMeUpdateReq(BaseModel):
    name: Optional[str] = None
    new_password: Optional[str] = None


class CreateAdminReq(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=6)


@api.put("/admin/me")
async def admin_update_me(req: AdminMeUpdateReq, admin: dict = Depends(require_admin)):
    update = {}
    if req.name and req.name.strip():
        update["name"] = req.name.strip()[:80]
    if req.new_password:
        if len(req.new_password) < 6:
            raise HTTPException(status_code=400, detail="Password minimal 6 karakter")
        update["password_hash"] = hash_password(req.new_password)
    if not update:
        raise HTTPException(status_code=400, detail="Tidak ada perubahan")
    await db.users.update_one({"id": admin["id"]}, {"$set": update})
    fresh = await db.users.find_one({"id": admin["id"]}, {"_id": 0})
    return {"user": serialize_user(fresh)}


@api.post("/admin/admins")
async def admin_create_admin(req: CreateAdminReq, admin: dict = Depends(require_admin)):
    email = req.email.lower().strip()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email sudah terdaftar")
    doc = {
        "id": str(uuid.uuid4()),
        "email": email,
        "name": req.name.strip(),
        "password_hash": hash_password(req.password),
        "role": "admin",
        "is_premium": True,
        "premium_until": (datetime.now(timezone.utc) + timedelta(days=3650)).isoformat(),
        "suspended": False, "family_id": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.users.insert_one(doc)
    doc.pop("_id", None); doc.pop("password_hash", None)
    return {"user": serialize_user(doc)}


@api.delete("/admin/users/{user_id}")
async def admin_delete_user(user_id: str, admin: dict = Depends(require_admin)):
    if user_id == admin["id"]:
        raise HTTPException(status_code=400, detail="Tidak bisa menghapus akun sendiri")
    target = await db.users.find_one({"id": user_id})
    if not target:
        raise HTTPException(status_code=404, detail="User tidak ditemukan")
    # Cascade: hapus expenses, tasks user di keluarganya tetap, tapi family kalau dia owner di-hapus dari users
    await db.users.delete_one({"id": user_id})
    await db.upgrade_requests.delete_many({"user_id": user_id})
    await db.expenses.delete_many({"user_id": user_id})
    await db.tasks.delete_many({"user_id": user_id})
    # Kalau owner family, family ikut hapus + lepas anggota lain
    fam = await db.families.find_one({"owner_id": user_id})
    if fam:
        await db.users.update_many({"family_id": fam["id"]}, {"$set": {"family_id": None}})
        await db.families.delete_one({"id": fam["id"]})
    return {"ok": True}


@api.get("/admin/admins")
async def admin_list_admins(user: dict = Depends(require_admin)):
    admins = await db.users.find({"role": "admin"}, {"_id": 0, "password_hash": 0}).to_list(100)
    return {"admins": [serialize_user(a) for a in admins]}


@api.get("/admin/transactions")
async def admin_transactions(user: dict = Depends(require_admin)):
    txns = await db.payment_transactions.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return {"transactions": txns}


# ============================================================================
# SETTINGS (admin WhatsApp number for manual payment confirmation)
# ============================================================================
async def _get_settings() -> dict:
    s = await db.settings.find_one({"id": "global"}, {"_id": 0})
    defaults = {
        "id": "global", "admin_whatsapp": "", "bank_info": "",
        "premium_price": PREMIUM_PRICE_IDR, "premium_original_price": 0, "show_strikethrough": False,
    }
    if not s:
        await db.settings.insert_one({**defaults})
        return defaults
    for k, v in defaults.items():
        s.setdefault(k, v)
    return s


async def get_premium_price() -> float:
    s = await _get_settings()
    try:
        p = float(s.get("premium_price") or 0)
        return p if p > 0 else PREMIUM_PRICE_IDR
    except Exception:
        return PREMIUM_PRICE_IDR


def _fmt_idr(n) -> str:
    return "Rp " + f"{int(n):,}".replace(",", ".")


class SettingsUpdateReq(BaseModel):
    admin_whatsapp: str = Field(default="", max_length=20)
    bank_info: str = Field(default="", max_length=300)
    premium_price: Optional[float] = None
    premium_original_price: Optional[float] = None
    show_strikethrough: Optional[bool] = None


@api.get("/settings/public")
async def public_settings():
    s = await _get_settings()
    return {
        "admin_whatsapp": s.get("admin_whatsapp", ""),
        "bank_info": s.get("bank_info", ""),
        "premium_price": s.get("premium_price", PREMIUM_PRICE_IDR),
        "premium_original_price": s.get("premium_original_price", 0),
        "show_strikethrough": s.get("show_strikethrough", False),
    }


@api.get("/admin/settings")
async def admin_get_settings(user: dict = Depends(require_admin)):
    return await _get_settings()


@api.put("/admin/settings")
async def admin_update_settings(req: SettingsUpdateReq, user: dict = Depends(require_admin)):
    wa = req.admin_whatsapp.strip().replace(" ", "").replace("-", "")
    if wa.startswith("+"):
        wa = wa[1:]
    if wa.startswith("0"):
        wa = "62" + wa[1:]  # Normalize Indonesian
    set_doc = {"admin_whatsapp": wa, "bank_info": req.bank_info.strip()}
    if req.premium_price is not None:
        if req.premium_price <= 0:
            raise HTTPException(status_code=400, detail="Harga langganan harus lebih dari 0")
        set_doc["premium_price"] = float(req.premium_price)
    if req.premium_original_price is not None:
        set_doc["premium_original_price"] = float(req.premium_original_price) if req.premium_original_price > 0 else 0
    if req.show_strikethrough is not None:
        set_doc["show_strikethrough"] = bool(req.show_strikethrough)
    await db.settings.update_one({"id": "global"}, {"$set": set_doc}, upsert=True)
    return await _get_settings()


# ============================================================================
# UPGRADE REQUESTS (manual confirmation via WhatsApp)
# ============================================================================
@api.post("/payments/request-upgrade")
async def request_upgrade(
    proof_image: Optional[str] = None,
    user: dict = Depends(require_active_user),
):
    """Create pending upgrade request with optional base64 proof image (max 2MB)."""
    if proof_image and len(proof_image) > 2_800_000:  # ~2MB base64
        raise HTTPException(status_code=413, detail="Bukti transfer terlalu besar (max 2MB)")
    settings = await _get_settings()
    wa = settings.get("admin_whatsapp", "")
    if not wa:
        raise HTTPException(status_code=503, detail="Nomor WhatsApp admin belum diatur. Hubungi tim Famly.")
    price = await get_premium_price()
    existing = await db.upgrade_requests.find_one({"user_id": user["id"], "status": "pending"}, {"_id": 0})
    if existing:
        if proof_image:
            await db.upgrade_requests.update_one({"id": existing["id"]}, {"$set": {"proof_image": proof_image}})
            existing["proof_image"] = proof_image
        req_doc = existing
    else:
        req_id = str(uuid.uuid4())
        req_doc = {
            "id": req_id, "code": req_id[:8].upper(),
            "user_id": user["id"], "user_email": user["email"], "user_name": user["name"],
            "amount": price, "currency": "idr", "status": "pending",
            "proof_image": proof_image or "",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "approved_at": None, "approved_by": None,
        }
        await db.upgrade_requests.insert_one(req_doc)
        req_doc.pop("_id", None)
    msg = (f"Halo Admin Famly,\nSaya ingin upgrade ke Premium.\n\nNama: {user['name']}\nEmail: {user['email']}\nKode: {req_doc['code']}\nNominal: {_fmt_idr(req_doc.get('amount', price))}\n\nMohon info cara pembayaran. Terima kasih!")
    import urllib.parse
    wa_url = f"https://wa.me/{wa}?text={urllib.parse.quote(msg)}"
    return {"request": {k:v for k,v in req_doc.items() if k!='proof_image'}, "wa_url": wa_url, "admin_whatsapp": wa, "bank_info": settings.get("bank_info", "")}


class UpgradeRequestReq(BaseModel):
    proof_image: Optional[str] = None


@api.post("/payments/upload-proof")
async def upload_proof(req: UpgradeRequestReq, user: dict = Depends(require_active_user)):
    """Attach proof image to user's pending upgrade request."""
    if not req.proof_image:
        raise HTTPException(status_code=400, detail="Bukti transfer kosong")
    if len(req.proof_image) > 2_800_000:
        raise HTTPException(status_code=413, detail="Bukti transfer terlalu besar (max 2MB)")
    existing = await db.upgrade_requests.find_one({"user_id": user["id"], "status": "pending"})
    if not existing:
        raise HTTPException(status_code=404, detail="Tidak ada request upgrade aktif")
    await db.upgrade_requests.update_one({"id": existing["id"]}, {"$set": {"proof_image": req.proof_image}})
    return {"ok": True}


@api.get("/admin/upgrade-requests/{req_id}/proof")
async def admin_get_proof(req_id: str, user: dict = Depends(require_admin)):
    req = await db.upgrade_requests.find_one({"id": req_id}, {"_id": 0})
    if not req:
        raise HTTPException(status_code=404, detail="Tidak ditemukan")
    return {"proof_image": req.get("proof_image", ""), "code": req.get("code")}


@api.get("/payments/my-request")
async def my_upgrade_request(user: dict = Depends(get_current_user)):
    """In-app notification: user checks their latest request status."""
    req = await db.upgrade_requests.find_one(
        {"user_id": user["id"]},
        {"_id": 0, "proof_image": 0},
        sort=[("created_at", -1)],
    )
    return {"request": req}


@api.get("/admin/upgrade-requests")
async def admin_list_requests(user: dict = Depends(require_admin)):
    items = await db.upgrade_requests.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return {"requests": items}


@api.post("/admin/upgrade-requests/{req_id}/approve")
async def admin_approve_request(req_id: str, admin: dict = Depends(require_admin)):
    req = await db.upgrade_requests.find_one({"id": req_id}, {"_id": 0})
    if not req:
        raise HTTPException(status_code=404, detail="Request tidak ditemukan")
    if req["status"] != "pending":
        raise HTTPException(status_code=400, detail=f"Request sudah {req['status']}")
    until = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
    await db.users.update_one(
        {"id": req["user_id"]},
        {"$set": {"is_premium": True, "premium_until": until, "suspended": False}},
    )
    await db.upgrade_requests.update_one(
        {"id": req_id},
        {"$set": {"status": "approved", "approved_at": datetime.now(timezone.utc).isoformat(), "approved_by": admin["id"]}},
    )
    await db.payment_transactions.insert_one({
        "id": str(uuid.uuid4()),
        "session_id": f"wa-{req_id[:12]}",
        "user_id": req["user_id"], "user_email": req["user_email"],
        "amount": req["amount"], "currency": "idr",
        "package": "premium_monthly_wa",
        "metadata": {"upgrade_request_id": req_id, "approved_by": admin["id"]},
        "status": "paid", "payment_status": "manual_wa", "premium_granted": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })
    asyncio.create_task(notify_user_push(
        req["user_id"], "Premium Aktif! 👑",
        "Selamat! Upgrade Premium Anda telah disetujui. Semua batasan kini terbuka.",
    ))
    # Reward referrer (+1 month) if this user was referred
    await reward_referral_if_any(req["user_id"])
    return {"ok": True, "premium_until": until}


@api.post("/admin/upgrade-requests/{req_id}/reject")
async def admin_reject_request(req_id: str, admin: dict = Depends(require_admin)):
    req = await db.upgrade_requests.find_one({"id": req_id})
    if not req:
        raise HTTPException(status_code=404, detail="Request tidak ditemukan")
    await db.upgrade_requests.update_one(
        {"id": req_id},
        {"$set": {"status": "rejected", "approved_at": datetime.now(timezone.utc).isoformat(), "approved_by": admin["id"]}},
    )
    return {"ok": True}


# ============================================================================
# ANALYTICS - viral loop tracking
# ============================================================================
class TrackEventReq(BaseModel):
    event: str = Field(min_length=1, max_length=50)
    metadata: Optional[dict] = None


@api.post("/track/event")
async def track_event(req: TrackEventReq, request: Request):
    """Public endpoint - logs analytics events (share clicks etc)."""
    doc = {
        "id": str(uuid.uuid4()),
        "event": req.event.strip(),
        "metadata": req.metadata or {},
        "user_agent": request.headers.get("user-agent", "")[:200],
        "referer": request.headers.get("referer", "")[:200],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.analytics_events.insert_one(doc)
    return {"ok": True}


@api.get("/admin/analytics")
async def admin_analytics(user: dict = Depends(require_admin)):
    """Aggregated event counts for admin."""
    pipeline = [
        {"$group": {"_id": "$event", "count": {"$sum": 1}, "last": {"$max": "$created_at"}}},
        {"$sort": {"count": -1}},
    ]
    rows = await db.analytics_events.aggregate(pipeline).to_list(100)
    events = [{"event": r["_id"], "count": r["count"], "last": r["last"]} for r in rows]
    total = sum(e["count"] for e in events)
    share_clicks = next((e["count"] for e in events if e["event"] == "share_clicked"), 0)
    return {"events": events, "total": total, "share_clicks": share_clicks}


# ============================================================================
# PUSH NOTIFICATIONS (native Web Push / VAPID)
# ============================================================================
class PushKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscribeReq(BaseModel):
    endpoint: str
    keys: PushKeys
    tz_label: str = "WIB"


class PushUnsubscribeReq(BaseModel):
    endpoint: str


DEFAULT_REMINDER_PREFS = {
    "task_reminder_enabled": True,
    "task_summary_time": "08:00",   # daily summary for all-day tasks (no specific time)
    "task_lead_minutes": 30,         # notify N minutes before a timed task
    "finance_reminder_enabled": True,
    "finance_reminder_time": "20:00",
    "tz_label": "WIB",
}


def _valid_hm(s: str) -> bool:
    try:
        h, m = s.split(":")
        return 0 <= int(h) <= 23 and 0 <= int(m) <= 59 and len(h) == 2 and len(m) == 2
    except Exception:
        return False


def get_reminder_prefs(user: dict) -> dict:
    prefs = dict(DEFAULT_REMINDER_PREFS)
    rp = user.get("reminder_prefs") or {}
    for k in DEFAULT_REMINDER_PREFS:
        if k in rp and rp[k] is not None:
            prefs[k] = rp[k]
    if user.get("tz_label") in TIMEZONES:
        prefs["tz_label"] = user["tz_label"]
    return prefs


class ReminderPrefsReq(BaseModel):
    task_reminder_enabled: Optional[bool] = None
    task_summary_time: Optional[str] = None
    task_lead_minutes: Optional[int] = None
    finance_reminder_enabled: Optional[bool] = None
    finance_reminder_time: Optional[str] = None
    tz_label: Optional[str] = None


@api.get("/push/preferences")
async def get_push_preferences(user: dict = Depends(get_current_user)):
    return {"preferences": get_reminder_prefs(user)}


@api.put("/push/preferences")
async def update_push_preferences(req: ReminderPrefsReq, user: dict = Depends(get_current_user)):
    rp = dict(user.get("reminder_prefs") or {})
    if req.task_reminder_enabled is not None:
        rp["task_reminder_enabled"] = req.task_reminder_enabled
    if req.finance_reminder_enabled is not None:
        rp["finance_reminder_enabled"] = req.finance_reminder_enabled
    if req.task_summary_time is not None:
        if not _valid_hm(req.task_summary_time):
            raise HTTPException(status_code=400, detail="Format waktu tugas tidak valid (HH:MM)")
        rp["task_summary_time"] = req.task_summary_time
    if req.finance_reminder_time is not None:
        if not _valid_hm(req.finance_reminder_time):
            raise HTTPException(status_code=400, detail="Format waktu keuangan tidak valid (HH:MM)")
        rp["finance_reminder_time"] = req.finance_reminder_time
    if req.task_lead_minutes is not None:
        if req.task_lead_minutes < 0 or req.task_lead_minutes > 1440:
            raise HTTPException(status_code=400, detail="Lead time harus antara 0-1440 menit")
        rp["task_lead_minutes"] = req.task_lead_minutes
    set_doc = {"reminder_prefs": rp}
    if req.tz_label is not None and req.tz_label in TIMEZONES:
        set_doc["tz_label"] = req.tz_label
    await db.users.update_one({"id": user["id"]}, {"$set": set_doc})
    fresh = await db.users.find_one({"id": user["id"]}, {"_id": 0})
    return {"preferences": get_reminder_prefs(fresh)}


@api.get("/push/vapid-public-key")
async def push_vapid_public_key():
    return {"public_key": VAPID_PUBLIC_KEY}


@api.post("/push/subscribe")
async def push_subscribe(req: PushSubscribeReq, user: dict = Depends(get_current_user)):
    tz_label = req.tz_label if req.tz_label in TIMEZONES else "WIB"
    doc = {
        "user_id": user["id"],
        "endpoint": req.endpoint,
        "keys": {"p256dh": req.keys.p256dh, "auth": req.keys.auth},
        "tz_label": tz_label,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.push_subscriptions.update_one(
        {"endpoint": req.endpoint},
        {"$set": doc, "$setOnInsert": {"id": str(uuid.uuid4()), "created_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    # Mirror timezone onto the user for reminder scheduling
    await db.users.update_one({"id": user["id"]}, {"$set": {"tz_label": tz_label}})
    return {"ok": True, "tz_label": tz_label}


@api.post("/push/unsubscribe")
async def push_unsubscribe(req: PushUnsubscribeReq, user: dict = Depends(get_current_user)):
    await db.push_subscriptions.delete_one({"endpoint": req.endpoint, "user_id": user["id"]})
    return {"ok": True}


@api.get("/push/status")
async def push_status(user: dict = Depends(get_current_user)):
    count = await db.push_subscriptions.count_documents({"user_id": user["id"]})
    sub = await db.push_subscriptions.find_one({"user_id": user["id"]}, {"_id": 0, "tz_label": 1})
    return {"subscribed": count > 0, "tz_label": sub.get("tz_label") if sub else "WIB"}


def _send_webpush_sync(sub: dict, payload: dict):
    """Blocking webpush call. Returns (ok, should_delete)."""
    try:
        webpush(
            subscription_info={"endpoint": sub["endpoint"], "keys": sub["keys"]},
            data=json.dumps(payload),
            vapid_private_key=VAPID_PRIVATE_KEY,
            vapid_claims={"sub": VAPID_SUB_EMAIL},
            ttl=86400,
        )
        return True, False
    except WebPushException as e:
        status = getattr(e.response, "status_code", None)
        if status in (404, 410):
            return False, True  # subscription expired/gone
        logging.warning("webpush failed: %s", str(e))
        return False, False
    except Exception as e:
        logging.warning("webpush error: %s", str(e))
        return False, False


async def _push_to_subs(subs: list, payload: dict):
    sent = 0
    for sub in subs:
        ok, gone = await asyncio.to_thread(_send_webpush_sync, sub, payload)
        if ok:
            sent += 1
        if gone:
            await db.push_subscriptions.delete_one({"endpoint": sub["endpoint"]})
    return sent


async def notify_user_push(user_id: str, title: str, body: str, url: str = "/"):
    """Send a push notification to all of a user's subscribed devices (best-effort)."""
    try:
        subs = await db.push_subscriptions.find({"user_id": user_id}, {"_id": 0}).to_list(20)
        if subs:
            await _push_to_subs(subs, {"title": title, "body": body, "url": url})
    except Exception as e:
        logging.warning("notify_user_push failed for %s: %s", user_id, str(e))


@api.post("/push/test")
async def push_test(user: dict = Depends(get_current_user)):
    subs = await db.push_subscriptions.find({"user_id": user["id"]}, {"_id": 0}).to_list(20)
    if not subs:
        raise HTTPException(status_code=404, detail="Belum ada perangkat yang berlangganan notifikasi")
    payload = {
        "title": "Famly 🔔",
        "body": "Notifikasi berhasil diaktifkan! Anda akan menerima pengingat tugas & keuangan.",
        "url": "/",
    }
    sent = await _push_to_subs(subs, payload)
    return {"ok": True, "sent": sent}


def _shift_hm(hhmm: str, minus_minutes: int) -> str:
    h, m = hhmm.split(":")
    total = (int(h) * 60 + int(m) - minus_minutes) % (24 * 60)
    return f"{total // 60:02d}:{total % 60:02d}"


async def reminder_tick():
    """Runs every minute. Sends per-user reminders based on their custom preferences,
    interpreting times in each user's Indonesian timezone (WIB/WITA/WIT)."""
    try:
        user_ids = await db.push_subscriptions.distinct("user_id")
    except Exception as e:
        logging.warning("reminder_tick distinct failed: %s", str(e))
        return
    advanced_families = set()
    for uid in user_ids:
        u = await db.users.find_one({"id": uid}, {"_id": 0})
        if not u or not u.get("family_id"):
            continue
        prefs = get_reminder_prefs(u)
        zone = TIMEZONES.get(prefs["tz_label"], "Asia/Jakarta")
        now_local = datetime.now(ZoneInfo(zone))
        today = now_local.strftime("%Y-%m-%d")
        cur = now_local.strftime("%H:%M")
        fam = u["family_id"]
        mine = {"$or": [{"assigned_to": uid}, {"assigned_to": None}]}

        # Roll overdue recurring tasks forward (idempotent, once per family per tick)
        if fam not in advanced_families:
            await advance_recurring_tasks(fam, prefs["tz_label"])
            advanced_families.add(fam)

        # 1) Daily task summary (all-day tasks due today, no specific time)
        if prefs["task_reminder_enabled"] and cur == prefs["task_summary_time"]:
            due_today = await db.tasks.count_documents({
                "family_id": fam, "due_date": today, "completed": False, **mine,
            })
            if due_today > 0:
                await notify_user_push(
                    uid, "Tugas Hari Ini 📋",
                    f"Kamu punya {due_today} tugas hari ini. Yuk cek di Famly!",
                )

        # 2) Timed task reminders (notify lead minutes before due_time)
        if prefs["task_reminder_enabled"]:
            lead = int(prefs["task_lead_minutes"])
            timed = await db.tasks.find({
                "family_id": fam, "due_date": today, "completed": False,
                "due_time": {"$ne": None}, **mine,
            }, {"_id": 0}).to_list(200)
            for t in timed:
                if not t.get("due_time"):
                    continue
                if uid in (t.get("notified_users") or []):
                    continue
                if _shift_hm(t["due_time"], lead) == cur:
                    lead_txt = "sekarang" if lead == 0 else f"dalam {lead} menit"
                    await notify_user_push(
                        uid, "Pengingat Tugas ⏰",
                        f"\"{t['title']}\" jatuh tempo {lead_txt} (pukul {t['due_time']}).",
                    )
                    await db.tasks.update_one({"id": t["id"]}, {"$addToSet": {"notified_users": uid}})

        # 3) Finance reminder (only if no expense logged today, in user's tz)
        if prefs["finance_reminder_enabled"] and cur == prefs["finance_reminder_time"]:
            start_local = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
            start_utc_iso = start_local.astimezone(timezone.utc).isoformat()
            logged = await db.expenses.count_documents({
                "family_id": fam, "created_at": {"$gte": start_utc_iso},
            })
            if logged == 0:
                await notify_user_push(
                    uid, "Catat Keuangan Hari Ini 💰",
                    "Jangan lupa catat pemasukan & pengeluaran keluarga hari ini.",
                )


# ============================================================================
# REFERRALS - share link; referrer gets +1 month when referee buys premium
# ============================================================================
async def reward_referral_if_any(referred_user_id: str):
    """If this user was referred and not yet rewarded, grant referrer +30 days premium."""
    rec = await db.referrals.find_one({"referred_id": referred_user_id})
    if not rec or rec.get("status") == "rewarded":
        return
    referrer = await db.users.find_one({"id": rec["referrer_id"]}, {"_id": 0})
    if not referrer:
        return
    now = datetime.now(timezone.utc)
    base = now
    cur = referrer.get("premium_until")
    if cur:
        try:
            cur_dt = datetime.fromisoformat(cur)
            if cur_dt > now:
                base = cur_dt
        except Exception:
            pass
    new_until = (base + timedelta(days=30)).isoformat()
    await db.users.update_one(
        {"id": referrer["id"]},
        {"$set": {"is_premium": True, "premium_until": new_until, "suspended": False}},
    )
    await db.referrals.update_one(
        {"id": rec["id"]},
        {"$set": {"status": "rewarded", "rewarded_at": now.isoformat()}},
    )
    asyncio.create_task(notify_user_push(
        referrer["id"], "Referral Berhasil! 🎁",
        "Teman yang kamu ajak baru saja upgrade ke Premium. Kamu dapat +1 bulan langganan gratis!",
    ))


@api.get("/referral/me")
async def referral_me(user: dict = Depends(get_current_user)):
    u = await db.users.find_one({"id": user["id"]}, {"_id": 0})
    ref_code = u.get("ref_code")
    if not ref_code:
        ref_code = gen_invite_code()
        await db.users.update_one({"id": user["id"]}, {"$set": {"ref_code": ref_code}})
    total = await db.referrals.count_documents({"referrer_id": user["id"]})
    converted = await db.referrals.count_documents({"referrer_id": user["id"], "status": "rewarded"})
    recent = await db.referrals.find(
        {"referrer_id": user["id"]}, {"_id": 0, "referred_name": 1, "status": 1, "created_at": 1}
    ).sort("created_at", -1).to_list(50)
    return {
        "ref_code": ref_code,
        "total_invited": total,
        "total_converted": converted,
        "months_earned": converted,
        "recent": recent,
    }


# ============================================================================
# HEALTH
# ============================================================================
@api.get("/")
async def root():
    return {"app": "Famly", "status": "ok"}


# ============================================================================
# APP WIRING
# ============================================================================
app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("famly")

scheduler: Optional[AsyncIOScheduler] = None


@app.on_event("startup")
async def on_startup():
    # Indexes
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    await db.families.create_index("id", unique=True)
    await db.families.create_index("invite_code", unique=True)
    await db.expenses.create_index([("family_id", 1), ("month_key", 1)])
    await db.tasks.create_index([("family_id", 1), ("completed", 1)])
    await db.payment_transactions.create_index("session_id", unique=True)
    await db.analytics_events.create_index([("event", 1), ("created_at", -1)])
    await db.upgrade_requests.create_index([("status", 1), ("created_at", -1)])
    await db.upgrade_requests.create_index("user_id")
    await db.push_subscriptions.create_index("endpoint", unique=True)
    await db.push_subscriptions.create_index("user_id")
    await db.push_subscriptions.create_index("tz_label")
    await db.users.create_index("ref_code")
    await db.referrals.create_index("referrer_id")
    await db.referrals.create_index("referred_id", unique=True)

    # Seed admin idempotently
    existing = await db.users.find_one({"email": ADMIN_EMAIL})
    if not existing:
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "email": ADMIN_EMAIL,
            "name": "Super Admin",
            "password_hash": hash_password(ADMIN_PASSWORD),
            "role": "admin",
            "is_premium": True,
            "premium_until": (datetime.now(timezone.utc) + timedelta(days=3650)).isoformat(),
            "suspended": False,
            "family_id": None,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        logger.info("Seeded admin user: %s", ADMIN_EMAIL)
    else:
        # Keep password in sync if .env changed
        if not verify_password(ADMIN_PASSWORD, existing.get("password_hash", "")):
            await db.users.update_one(
                {"email": ADMIN_EMAIL},
                {"$set": {"password_hash": hash_password(ADMIN_PASSWORD), "role": "admin"}},
            )
            logger.info("Updated admin password from .env")
        elif existing.get("role") != "admin":
            await db.users.update_one({"email": ADMIN_EMAIL}, {"$set": {"role": "admin"}})

    # Start push-notification scheduler (per-minute ticker, per-user custom times)
    if VAPID_PRIVATE_KEY and VAPID_PUBLIC_KEY:
        global scheduler
        scheduler = AsyncIOScheduler()
        scheduler.add_job(
            reminder_tick, CronTrigger(second=0),
            id="reminder_tick", replace_existing=True, max_instances=1, coalesce=True,
        )
        scheduler.start()
        logger.info("Push notification scheduler started (per-minute reminder ticker)")
    else:
        logger.warning("VAPID keys missing - push scheduler disabled")


@app.on_event("shutdown")
async def on_shutdown():
    if scheduler and scheduler.running:
        scheduler.shutdown(wait=False)
    client.close()
