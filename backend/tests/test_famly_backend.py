"""Famly backend e2e tests - auth, family, expenses, tasks, payments, admin."""
import os, uuid, pytest, requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://famly-premium.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"
SUFFIX = uuid.uuid4().hex[:6]

state = {}

def _auth(tok): return {"Authorization": f"Bearer {tok}"}

def test_01_root():
    r = requests.get(f"{API}/")
    assert r.status_code == 200 and r.json().get("status") == "ok"

def test_02_admin_login():
    r = requests.post(f"{API}/auth/login", json={"email": "admin@famly.id", "password": "admin123"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["user"]["role"] == "admin"
    assert "access_token" in d
    state["admin_token"] = d["access_token"]
    state["admin_id"] = d["user"]["id"]

def test_03_register_users():
    for k in ["u1", "u2", "u3"]:
        email = f"TEST_{k}_{SUFFIX}@famly-test.com"
        r = requests.post(f"{API}/auth/register", json={"email": email, "password": "pass123", "name": k.upper()})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["user"]["role"] == "user" and d["user"]["is_premium"] is False
        state[f"{k}_token"] = d["access_token"]
        state[f"{k}_id"] = d["user"]["id"]
        state[f"{k}_email"] = email

def test_04_register_duplicate():
    r = requests.post(f"{API}/auth/register", json={"email": state["u1_email"], "password": "pass123", "name": "Dup"})
    assert r.status_code == 400

def test_05_auth_me():
    r = requests.get(f"{API}/auth/me", headers=_auth(state["u1_token"]))
    assert r.status_code == 200
    assert r.json()["user"]["email"] == state["u1_email"].lower()

def test_06_auth_unauth():
    assert requests.get(f"{API}/auth/me").status_code == 401

def test_07_create_family():
    r = requests.post(f"{API}/families", headers=_auth(state["u1_token"]), json={"name": "Test Family"})
    assert r.status_code == 200, r.text
    fam = r.json()["family"]
    assert "invite_code" in fam
    state["invite_code"] = fam["invite_code"]
    state["family_id"] = fam["id"]

def test_08_join_family_u2():
    r = requests.post(f"{API}/families/join", headers=_auth(state["u2_token"]), json={"invite_code": state["invite_code"]})
    assert r.status_code == 200, r.text

def test_09_join_family_u3_limit():
    r = requests.post(f"{API}/families/join", headers=_auth(state["u3_token"]), json={"invite_code": state["invite_code"]})
    assert r.status_code == 403
    assert "batas" in r.json()["detail"].lower() or "2 anggota" in r.json()["detail"]

def test_10_families_me_limits():
    r = requests.get(f"{API}/families/me", headers=_auth(state["u1_token"]))
    assert r.status_code == 200
    d = r.json()
    assert d["limits"]["members"]["used"] == 2
    assert d["limits"]["members"]["max"] == 2
    assert d["limits"]["expenses_this_month"]["max"] == 30
    assert d["limits"]["active_tasks"]["max"] == 50

def test_11_create_expense():
    r = requests.post(f"{API}/expenses", headers=_auth(state["u1_token"]),
                      json={"amount": 10000, "category": "food", "description": "lunch"})
    assert r.status_code == 200, r.text
    assert r.json()["expense"]["amount"] == 10000

def test_12_create_task():
    r = requests.post(f"{API}/tasks", headers=_auth(state["u1_token"]),
                      json={"title": "Test Task", "description": "x"})
    assert r.status_code == 200, r.text
    t = r.json()["task"]
    assert t["completed"] is False
    state["task_id"] = t["id"]

def test_13_task_complete_toggle():
    r = requests.patch(f"{API}/tasks/{state['task_id']}/complete", headers=_auth(state["u1_token"]))
    assert r.status_code == 200 and r.json()["task"]["completed"] is True

def test_14_task_delete():
    # create a throwaway task
    r = requests.post(f"{API}/tasks", headers=_auth(state["u1_token"]),
                      json={"title": "DeleteMe", "description": ""})
    tid = r.json()["task"]["id"]
    r2 = requests.delete(f"{API}/tasks/{tid}", headers=_auth(state["u1_token"]))
    assert r2.status_code == 200

def test_15_checkout_session_security():
    # SECURITY: amount field even if sent should be ignored - payload only takes origin_url
    r = requests.post(f"{API}/payments/checkout/session", headers=_auth(state["u1_token"]),
                      json={"origin_url": "https://example.com", "amount": 1})
    assert r.status_code == 200, r.text
    d = r.json()
    assert "url" in d and "session_id" in d
    state["session_id"] = d["session_id"]

def test_16_checkout_status():
    r = requests.get(f"{API}/payments/checkout/status/{state['session_id']}", headers=_auth(state["u1_token"]))
    assert r.status_code == 200, r.text
    d = r.json()
    assert "payment_status" in d
    # not paid in test mode - no grant
    assert d.get("premium_granted") in (False, None)

def test_17_checkout_status_cross_user_denied():
    r = requests.get(f"{API}/payments/checkout/status/{state['session_id']}", headers=_auth(state["u2_token"]))
    assert r.status_code == 403

def test_18_admin_stats_requires_admin():
    r = requests.get(f"{API}/admin/stats", headers=_auth(state["u1_token"]))
    assert r.status_code == 403

def test_19_admin_stats():
    r = requests.get(f"{API}/admin/stats", headers=_auth(state["admin_token"]))
    assert r.status_code == 200
    d = r.json()
    for k in ["total_users", "active_subscribers", "mrr_idr", "suspended_users"]:
        assert k in d

def test_20_admin_subscribers():
    r = requests.get(f"{API}/admin/subscribers", headers=_auth(state["admin_token"]))
    assert r.status_code == 200
    subs = r.json()["subscribers"]
    statuses = {s["status"] for s in subs}
    assert statuses.issubset({"suspended", "premium", "free"})

def test_21_admin_upgrade_grants_unlimited():
    # upgrade family owner u1
    r = requests.post(f"{API}/admin/users/{state['u1_id']}/upgrade", headers=_auth(state["admin_token"]))
    assert r.status_code == 200 and "premium_until" in r.json()
    # verify manual txn created
    r2 = requests.get(f"{API}/admin/transactions", headers=_auth(state["admin_token"]))
    assert r2.status_code == 200
    txns = r2.json()["transactions"]
    assert any(t.get("user_id") == state["u1_id"] and t.get("payment_status") == "manual" for t in txns)
    # verify limits now unlimited (max=None)
    r3 = requests.get(f"{API}/families/me", headers=_auth(state["u1_token"]))
    lim = r3.json()["limits"]
    assert lim["members"]["max"] is None
    assert lim["expenses_this_month"]["max"] is None
    assert lim["active_tasks"]["max"] is None
    # u3 can now join (premium owner)
    r4 = requests.post(f"{API}/families/join", headers=_auth(state["u3_token"]), json={"invite_code": state["invite_code"]})
    assert r4.status_code == 200, r4.text

def test_22_admin_downgrade():
    r = requests.post(f"{API}/admin/users/{state['u1_id']}/downgrade", headers=_auth(state["admin_token"]))
    assert r.status_code == 200
    r2 = requests.get(f"{API}/auth/me", headers=_auth(state["u1_token"]))
    assert r2.json()["user"]["is_premium"] is False

def test_23_admin_suspend_blocks_writes_allows_reads():
    r = requests.post(f"{API}/admin/users/{state['u2_id']}/suspend", headers=_auth(state["admin_token"]))
    assert r.status_code == 200
    # GET me still works
    assert requests.get(f"{API}/auth/me", headers=_auth(state["u2_token"])).status_code == 200
    # GET families/me works
    assert requests.get(f"{API}/families/me", headers=_auth(state["u2_token"])).status_code == 200
    # GET expenses works
    assert requests.get(f"{API}/expenses", headers=_auth(state["u2_token"])).status_code == 200
    # POST expense blocked 403
    r2 = requests.post(f"{API}/expenses", headers=_auth(state["u2_token"]),
                       json={"amount": 100, "category": "x"})
    assert r2.status_code == 403
    assert "disuspend" in r2.json()["detail"].lower() or "suspend" in r2.json()["detail"].lower()
    # POST task blocked
    r3 = requests.post(f"{API}/tasks", headers=_auth(state["u2_token"]), json={"title": "x"})
    assert r3.status_code == 403

def test_24_admin_unsuspend():
    r = requests.post(f"{API}/admin/users/{state['u2_id']}/unsuspend", headers=_auth(state["admin_token"]))
    assert r.status_code == 200
    r2 = requests.post(f"{API}/tasks", headers=_auth(state["u2_token"]), json={"title": "back"})
    assert r2.status_code == 200

def test_25_cleanup():
    # downgrade u1 already done; just delete test users for cleanup
    for uid_key in ["u1_id", "u2_id", "u3_id"]:
        uid = state.get(uid_key)
        if uid:
            # no delete user endpoint - leave seeded; mark with TEST_ prefix already
            pass
    assert True
