# Famly - Product Requirements Document

## Original Problem Statement
Lanjutkan Famly: (1) Stripe Checkout asli untuk upgrade premium Rp 49.000/bln + webhook konfirmasi pakai test key di pod, (2) enforce limit free tier (max 2 anggota keluarga, max 30 expense/bulan, max 50 tugas aktif) di endpoint families/join, expenses, tasks dengan pesan error yang jelas, (3) Super Admin Dashboard di /admin dengan role admin terpisah, daftar subscriber, statistik MRR, dan tombol upgrade/downgrade/suspend manual. Seed 1 akun admin: admin@famly.id / admin123.

## Architecture
- **Backend**: FastAPI + MongoDB (motor), JWT Bearer auth, bcrypt password hashing
- **Frontend**: React 19 + React Router 7 + Tailwind, axios
- **Payments**: Stripe Checkout via `emergentintegrations.payments.stripe.checkout` (test key `sk_test_emergent` in pod env)
- **Currency**: IDR (Rupiah), zero-decimal

## User Personas
1. **Family Owner** - registers, creates family, gets invite code, manages expenses & tasks
2. **Family Member** - joins via invite code, contributes expenses & tasks
3. **Super Admin** - manages subscribers via `/admin`, manual upgrade/downgrade/suspend

## Core Requirements (Static)
- Email/password auth with JWT (7-day access token, Bearer header)
- Role-based access: `user` vs `admin`. Admin auto-redirects to `/admin`, regular users to `/`
- Free tier limits enforced server-side at families/join, expenses, tasks endpoints with clear Indonesian error messages
- Premium = Rp 49.000/month, 30-day expiry on payment
- Stripe Checkout (real test) + polling status endpoint + webhook
- Suspended user: premium revoked + can read but not write

## Implemented (2026-06-12)
- [x] Auth endpoints: `/api/auth/register`, `/login`, `/me`, `/logout`- [x] Idempotent admin seeding on startup (`admin@famly.id` / `admin123`)
- [x] Family create/join with invite code, member limit enforcement (FREE_LIMIT_MEMBERS=1)
- [x] Expense CRUD with monthly limit enforcement (FREE_LIMIT_EXPENSES_MONTH=7)
- [x] Task CRUD + toggle complete with active-task limit (FREE_LIMIT_TASKS_ACTIVE=5)
- [x] Stripe Checkout Session endpoint + polling status + idempotent premium grant
- [x] Stripe webhook endpoint (`POST /api/webhook/stripe`)
- [x] Admin endpoints: stats, subscribers, upgrade, downgrade, suspend, unsuspend, transactions
- [x] Frontend: login/register, family dashboard with limit bars, expenses tab, tasks tab, upgrade modal
- [x] Frontend: payment success page (polls status), payment cancel page
- [x] Frontend: full admin dashboard with stats cards, subscribers table, transactions tab
- [x] Role-based routing in React Router (Protected component)
- [x] Indonesian UI throughout, IDR formatting (Rp 49.000)
- [x] Testing: 25/25 backend pass, 12/12 frontend pass

## Recurring Tasks + Delete Expense + Auto-TZ + Settings Relocated (2026-06-13)
- [x] **Tugas berulang**: task `recurrence` (none/daily/weekly). Rolling single-task model — `complete_task` reschedules recurring task to next occurrence (not permanent done); `list_tasks` & ticker auto-advance overdue recurring tasks via `advance_recurring_tasks()`. UI: recurrence select (shown when date set) + 🔁 badge + reschedule toast.
- [x] **Hapus transaksi**: `DELETE /api/expenses/{id}` + trash button on each expense row (so user can delete & re-input to "edit").
- [x] **Zona waktu otomatis**: PushToggle detects device tz via offset (+7 WIB/+8 WITA/+9 WIT), removed tz selector, auto-syncs to backend on mount if changed. Read-only display.
- [x] **Pengaturan pengingat dipindah ke card paling bawah** dashboard.
- Tested: recurrence roll-forward & reschedule via curl ✓; expense delete ✓; UI render all testids ✓; 8 pytest pass.

## Flexible Reminders + Task Time + Welcome Banner (2026-06-12)
- [x] Tasks now support optional `due_time` (HH:MM); shown in task list badge & form (time input appears when date set)
- [x] Per-user reminder preferences (`reminder_prefs` on user): task_reminder_enabled, task_summary_time, task_lead_minutes, finance_reminder_enabled, finance_reminder_time, tz_label. Endpoints `GET/PUT /api/push/preferences`
- [x] Scheduler replaced 6 fixed cron jobs with single per-minute ticker `reminder_tick`: daily task summary (all-day tasks at custom time), timed-task reminders (N minutes before due_time, dedup via task.notified_users), finance reminder (custom time, only if no expense logged that local day)
- [x] All times interpreted in each user's Indonesian tz (WIB/WITA/WIT)
- [x] Frontend: PushToggle expanded with reminder settings UI; WelcomeBanner (one-time, shown in standalone/installed mode)
- Tested: ticker fired at custom WIB time & dispatched push ✓; endpoints via curl ✓; 5 pytest regression tests pass (`tests/test_reminders.py`)

## PWA Installable Android/iOS (2026-06-12)
- [x] Square icons dibuat: `/brand/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`
- [x] manifest.json diperbaiki (icons 192/512 + maskable, start_url `/app`, display standalone, id)
- [x] sw.js + fetch handler (offline shell, network-first navigasi, cache-first static), ter-register global di index.js
- [x] index.html: meta apple-mobile-web-app-capable/title/status-bar + apple-touch-icon
- [x] Komponen `InstallPWA.jsx`: tombol prompt install (Android beforeinstallprompt) + modal instruksi iOS Safari. Dipasang di Landing & Dashboard
- Tested: SW active, manifest & semua ikon served ✓. Tombol install hanya muncul di device asli yang memenuhi syarat.

## Push Notifications - Web Push native (2026-06-12)
- [x] Native VAPID Web Push (pywebpush + APScheduler). Keys in backend/.env (VAPID_PRIVATE_KEY/PUBLIC_KEY/SUB_EMAIL)
- [x] Endpoints: `GET /api/push/vapid-public-key`, `POST /api/push/subscribe`, `POST /api/push/unsubscribe`, `GET /api/push/status`, `POST /api/push/test`
- [x] Scheduler per Indonesian timezone (WIB/WITA/WIT): task reminder 08:00 (tasks due today, not completed), finance reminder 20:00 (only if no expense logged that day)
- [x] Frontend: `public/sw.js` service worker, `components/PushToggle.jsx` (enable/disable, tz select, test button) wired into Dashboard
- [x] DB: `push_subscriptions` {user_id, endpoint, keys{p256dh,auth}, tz_label}
- Tested: backend subscribe/status/test/unsubscribe via curl ✓. Browser permission + real delivery needs user device test.

## Backlog (P1)
- Audit log collection for admin actions (admin_id + action + target + timestamp)
- Login brute force lockout (5 fail / 15 min) per playbook
- Refresh-token flow (currently 7-day access only)
- Pagination/search for admin subscribers table
- Expense delete/edit endpoints

## Backlog (P2)
- Native datetime storage for `premium_until` (currently ISO string, lex-sorted)
- Audit log UI in admin dashboard
- Email notifications on suspend/upgrade

## Key Files
- `/app/backend/server.py` - all endpoints (~800 lines, may split modules later)
- `/app/backend/.env` - all config
- `/app/frontend/src/App.js` - router + protected routes
- `/app/frontend/src/context/AuthContext.jsx` - auth state
- `/app/frontend/src/pages/{AuthPage,Dashboard,AdminDashboard,PaymentPages}.jsx`
- `/app/memory/test_credentials.md`
- `/app/auth_testing.md`
