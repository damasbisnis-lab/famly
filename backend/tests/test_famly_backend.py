"""Famly backend tests - regression + new WhatsApp manual upgrade flow."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@famly.id"
ADMIN_PASSWORD = "admin123"

SMALL_B64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="


def _h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def user_a():
    email = f"TEST_a_{uuid.uuid4().hex[:8]}@famlytest.com"
    r = requests.post(f"{API}/auth/register", json={"email": email, "password": "pass123", "name": "User A"})
    assert r.status_code == 200, r.text
    return {"email": email, "token": r.json()["access_token"], "id": r.json()["user"]["id"]}


@pytest.fixture(scope="session")
def user_b():
    email = f"TEST_b_{uuid.uuid4().hex[:8]}@famlytest.com"
    r = requests.post(f"{API}/auth/register", json={"email": email, "password": "pass123", "name": "User B"})
    assert r.status_code == 200
    return {"email": email, "token": r.json()["access_token"], "id": r.json()["user"]["id"]}


# ============== REGRESSION ==============
class TestAuthRegression:
    def test_admin_login(self, admin_token):
        assert admin_token

    def test_me(self, admin_token):
        r = requests.get(f"{API}/auth/me", headers=_h(admin_token))
        assert r.status_code == 200
        assert r.json()["user"]["role"] == "admin"

    def test_register_duplicate(self, user_a):
        r = requests.post(f"{API}/auth/register", json={"email": user_a["email"], "password": "x123456", "name": "dup"})
        assert r.status_code == 400


class TestFamilyRegression:
    def test_family_create_join_limit(self, user_a, user_b):
        # Create family as A
        r = requests.post(f"{API}/families", json={"name": "TEST Fam"}, headers=_h(user_a["token"]))
        assert r.status_code == 200, r.text
        code = r.json()["family"]["invite_code"]
        # B joins
        r = requests.post(f"{API}/families/join", json={"invite_code": code}, headers=_h(user_b["token"]))
        assert r.status_code == 200
        # /families/me limits structure
        r = requests.get(f"{API}/families/me", headers=_h(user_a["token"]))
        assert r.status_code == 200
        data = r.json()
        assert "limits" in data
        assert data["limits"]["members"]["max"] == 2
        assert data["limits"]["members"]["used"] == 2
        # Third user cannot join (free limit)
        email_c = f"TEST_c_{uuid.uuid4().hex[:6]}@famlytest.com"
        rc = requests.post(f"{API}/auth/register", json={"email": email_c, "password": "p123456", "name": "C"})
        token_c = rc.json()["access_token"]
        r = requests.post(f"{API}/families/join", json={"invite_code": code}, headers=_h(token_c))
        assert r.status_code == 403


class TestExpensesTasks:
    def test_create_expense_and_task(self, user_a):
        r = requests.post(f"{API}/expenses", json={"amount": 100.0, "category": "food", "description": "t"}, headers=_h(user_a["token"]))
        assert r.status_code == 200
        r = requests.post(f"{API}/tasks", json={"title": "task1", "description": "d"}, headers=_h(user_a["token"]))
        assert r.status_code == 200
        tid = r.json()["task"]["id"]
        # toggle
        r = requests.patch(f"{API}/tasks/{tid}/complete", headers=_h(user_a["token"]))
        assert r.status_code == 200 and r.json()["task"]["completed"] is True
        # delete
        r = requests.delete(f"{API}/tasks/{tid}", headers=_h(user_a["token"]))
        assert r.status_code == 200


class TestAdminRegression:
    def test_stats(self, admin_token):
        r = requests.get(f"{API}/admin/stats", headers=_h(admin_token))
        assert r.status_code == 200
        assert "total_users" in r.json()

    def test_subscribers(self, admin_token):
        r = requests.get(f"{API}/admin/subscribers", headers=_h(admin_token))
        assert r.status_code == 200

    def test_upgrade_downgrade_suspend(self, admin_token, user_b):
        uid = user_b["id"]
        r = requests.post(f"{API}/admin/users/{uid}/upgrade", headers=_h(admin_token))
        assert r.status_code == 200
        r = requests.post(f"{API}/admin/users/{uid}/suspend", headers=_h(admin_token))
        assert r.status_code == 200
        # Suspended user write -> 403
        r = requests.post(f"{API}/tasks", json={"title": "x"}, headers=_h(user_b["token"]))
        assert r.status_code == 403
        r = requests.post(f"{API}/admin/users/{uid}/unsuspend", headers=_h(admin_token))
        assert r.status_code == 200
        r = requests.post(f"{API}/admin/users/{uid}/downgrade", headers=_h(admin_token))
        assert r.status_code == 200


class TestAnalytics:
    def test_track_and_admin(self, admin_token):
        r = requests.post(f"{API}/track/event", json={"event": "share_clicked", "metadata": {"a": 1}})
        assert r.status_code == 200
        r = requests.get(f"{API}/admin/analytics", headers=_h(admin_token))
        assert r.status_code == 200
        assert "events" in r.json()


# ============== NEW: SETTINGS ==============
class TestSettings:
    def test_public_settings(self):
        r = requests.get(f"{API}/settings/public")
        assert r.status_code == 200
        assert "admin_whatsapp" in r.json() and "bank_info" in r.json()

    def test_admin_get_requires_admin(self, user_a):
        r = requests.get(f"{API}/admin/settings", headers=_h(user_a["token"]))
        assert r.status_code == 403

    def test_admin_put_normalization(self, admin_token):
        # 0812-3456-7890 -> 62812345677890? actually -> 6281234567890
        r = requests.put(f"{API}/admin/settings",
                         json={"admin_whatsapp": "0812-3456-7890", "bank_info": "BCA 123"},
                         headers=_h(admin_token))
        assert r.status_code == 200
        data = r.json()
        assert data["admin_whatsapp"] == "6281234567890"
        assert data["bank_info"] == "BCA 123"

    def test_admin_put_plus_prefix(self, admin_token):
        r = requests.put(f"{API}/admin/settings",
                         json={"admin_whatsapp": "+62 812 9999 8888", "bank_info": "BCA"},
                         headers=_h(admin_token))
        assert r.status_code == 200
        assert r.json()["admin_whatsapp"] == "6281299998888"

    def test_non_admin_put_forbidden(self, user_a):
        r = requests.put(f"{API}/admin/settings",
                         json={"admin_whatsapp": "08123", "bank_info": ""},
                         headers=_h(user_a["token"]))
        assert r.status_code == 403


# ============== NEW: UPGRADE REQUEST FLOW ==============
class TestUpgradeRequestFlow:
    def test_request_upgrade_503_when_empty(self, admin_token, user_a):
        # Clear setting
        requests.put(f"{API}/admin/settings", json={"admin_whatsapp": "", "bank_info": ""}, headers=_h(admin_token))
        r = requests.post(f"{API}/payments/request-upgrade", headers=_h(user_a["token"]))
        assert r.status_code == 503

    def test_request_upgrade_returns_wa_url(self, admin_token, user_a):
        requests.put(f"{API}/admin/settings",
                     json={"admin_whatsapp": "081234567890", "bank_info": "BCA 12345"},
                     headers=_h(admin_token))
        r = requests.post(f"{API}/payments/request-upgrade", headers=_h(user_a["token"]))
        assert r.status_code == 200, r.text
        data = r.json()
        assert "request" in data and "wa_url" in data
        assert data["wa_url"].startswith("https://wa.me/6281234567890?text=")
        assert data["admin_whatsapp"] == "6281234567890"
        assert data["bank_info"] == "BCA 12345"
        req = data["request"]
        assert req["status"] == "pending"
        assert len(req["code"]) == 8 and req["code"].isupper()
        assert "Rp 49.000" in r.text.replace("%20", " ").replace("+", " ") or "49.000" in r.text
        # idempotent: 2nd call returns same id
        r2 = requests.post(f"{API}/payments/request-upgrade", headers=_h(user_a["token"]))
        assert r2.status_code == 200
        assert r2.json()["request"]["id"] == req["id"]

    def test_upload_proof_and_admin_view(self, admin_token, user_a):
        # Ensure pending request exists
        requests.post(f"{API}/payments/request-upgrade", headers=_h(user_a["token"]))
        r = requests.post(f"{API}/payments/upload-proof",
                          json={"proof_image": SMALL_B64},
                          headers=_h(user_a["token"]))
        assert r.status_code == 200
        # Admin list -> find request
        r = requests.get(f"{API}/admin/upgrade-requests", headers=_h(admin_token))
        assert r.status_code == 200
        my_req = next((x for x in r.json()["requests"] if x["user_id"] == user_a["id"] and x["status"] == "pending"), None)
        assert my_req is not None
        rid = my_req["id"]
        r = requests.get(f"{API}/admin/upgrade-requests/{rid}/proof", headers=_h(admin_token))
        assert r.status_code == 200
        assert r.json()["proof_image"] == SMALL_B64
        assert r.json()["code"] == my_req["code"]

    def test_upload_proof_too_large(self, user_a):
        big = "data:image/png;base64," + ("A" * 2_900_000)
        r = requests.post(f"{API}/payments/upload-proof", json={"proof_image": big}, headers=_h(user_a["token"]))
        assert r.status_code == 413

    def test_my_request_no_proof(self, user_a):
        r = requests.get(f"{API}/payments/my-request", headers=_h(user_a["token"]))
        assert r.status_code == 200
        req = r.json()["request"]
        assert req is not None
        assert "proof_image" not in req

    def test_my_request_null(self, user_b):
        # user_b shouldn't have any request (from earlier admin upgrade flow)
        # cleanup any prior request via fresh user
        email = f"TEST_fresh_{uuid.uuid4().hex[:6]}@famlytest.com"
        rr = requests.post(f"{API}/auth/register", json={"email": email, "password": "p123456", "name": "F"})
        tok = rr.json()["access_token"]
        r = requests.get(f"{API}/payments/my-request", headers=_h(tok))
        assert r.status_code == 200
        assert r.json()["request"] is None

    def test_admin_list_non_admin_403(self, user_a):
        r = requests.get(f"{API}/admin/upgrade-requests", headers=_h(user_a["token"]))
        assert r.status_code == 403

    def test_admin_proof_non_admin_403(self, user_a):
        r = requests.get(f"{API}/admin/upgrade-requests/abc/proof", headers=_h(user_a["token"]))
        assert r.status_code == 403

    def test_approve_grants_premium(self, admin_token, user_a):
        r = requests.get(f"{API}/admin/upgrade-requests", headers=_h(admin_token))
        my_req = next(x for x in r.json()["requests"] if x["user_id"] == user_a["id"] and x["status"] == "pending")
        rid = my_req["id"]
        r = requests.post(f"{API}/admin/upgrade-requests/{rid}/approve", headers=_h(admin_token))
        assert r.status_code == 200, r.text
        assert "premium_until" in r.json()
        # user is now premium
        r = requests.get(f"{API}/auth/me", headers=_h(user_a["token"]))
        assert r.json()["user"]["is_premium"] is True
        # Double approve -> 400
        r = requests.post(f"{API}/admin/upgrade-requests/{rid}/approve", headers=_h(admin_token))
        assert r.status_code == 400
        # txn entry has payment_status=manual_wa
        r = requests.get(f"{API}/admin/transactions", headers=_h(admin_token))
        assert any(t.get("payment_status") == "manual_wa" and t.get("premium_granted") for t in r.json()["transactions"])

    def test_reject_does_not_grant(self, admin_token):
        # Create new user, make a request, reject it
        email = f"TEST_rej_{uuid.uuid4().hex[:6]}@famlytest.com"
        rr = requests.post(f"{API}/auth/register", json={"email": email, "password": "p123456", "name": "Rej"})
        tok = rr.json()["access_token"]
        uid = rr.json()["user"]["id"]
        r = requests.post(f"{API}/payments/request-upgrade", headers=_h(tok))
        assert r.status_code == 200
        rid = r.json()["request"]["id"]
        r = requests.post(f"{API}/admin/upgrade-requests/{rid}/reject", headers=_h(admin_token))
        assert r.status_code == 200
        r = requests.get(f"{API}/auth/me", headers=_h(tok))
        assert r.json()["user"]["is_premium"] is False
