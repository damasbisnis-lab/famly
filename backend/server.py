from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import uuid
import logging
import bcrypt
import jwt
from datetime import datetime, timezone, timedelta
from typing import Optional, List

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


class TaskCreateReq(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=400)


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
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.users.insert_one(doc)
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
    doc = {
        "id": exp_id,
        "family_id": family_id,
        "user_id": user["id"],
        "user_name": user["name"],
        "amount": req.amount,
        "category": req.category.strip(),
        "description": req.description.strip(),
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
    doc = {
        "id": task_id,
        "family_id": family_id,
        "user_id": user["id"],
        "user_name": user["name"],
        "title": req.title.strip(),
        "description": req.description.strip(),
        "completed": False,
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
    new_completed = not task.get("completed", False)
    await db.tasks.update_one(
        {"id": task_id},
        {"$set": {"completed": new_completed, "completed_at": datetime.now(timezone.utc).isoformat() if new_completed else None}},
    )
    task["completed"] = new_completed
    return {"task": task}


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
    amount = PREMIUM_PRICE_IDR
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
    mrr_idr = active_subs * PREMIUM_PRICE_IDR
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
        "premium_price_idr": PREMIUM_PRICE_IDR,
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
    # Log manual admin transaction
    await db.payment_transactions.insert_one({
        "id": str(uuid.uuid4()),
        "session_id": f"manual-{uuid.uuid4().hex[:12]}",
        "user_id": user_id,
        "user_email": target["email"],
        "amount": PREMIUM_PRICE_IDR,
        "currency": "idr",
        "package": "premium_monthly_manual",
        "metadata": {"granted_by_admin": admin["id"]},
        "status": "paid",
        "payment_status": "manual",
        "premium_granted": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })
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


@api.get("/admin/transactions")
async def admin_transactions(user: dict = Depends(require_admin)):
    txns = await db.payment_transactions.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return {"transactions": txns}


# ============================================================================
# SETTINGS (admin WhatsApp number for manual payment confirmation)
# ============================================================================
async def _get_settings() -> dict:
    s = await db.settings.find_one({"id": "global"}, {"_id": 0})
    if not s:
        s = {"id": "global", "admin_whatsapp": "", "bank_info": ""}
        await db.settings.insert_one(s)
    return s


class SettingsUpdateReq(BaseModel):
    admin_whatsapp: str = Field(default="", max_length=20)
    bank_info: str = Field(default="", max_length=300)


@api.get("/settings/public")
async def public_settings():
    s = await _get_settings()
    return {"admin_whatsapp": s.get("admin_whatsapp", ""), "bank_info": s.get("bank_info", "")}


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
    await db.settings.update_one(
        {"id": "global"},
        {"$set": {"admin_whatsapp": wa, "bank_info": req.bank_info.strip()}},
        upsert=True,
    )
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
            "amount": PREMIUM_PRICE_IDR, "currency": "idr", "status": "pending",
            "proof_image": proof_image or "",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "approved_at": None, "approved_by": None,
        }
        await db.upgrade_requests.insert_one(req_doc)
    msg = (f"Halo Admin Famly,\nSaya ingin upgrade ke Premium.\n\nNama: {user['name']}\nEmail: {user['email']}\nKode: {req_doc['code']}\nNominal: Rp 49.000\n\nMohon info cara pembayaran. Terima kasih!")
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
async def my_upgrade_request(user: dict = Depends(get_current_user)):
    """In-app notification: user checks their latest request status."""
    req = await db.upgrade_requests.find_one({"user_id": user["id"]}, {"_id": 0, "proof_image": 0}, sort=[("created_at", -1)])
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


@app.on_event("shutdown")
async def on_shutdown():
    client.close()
