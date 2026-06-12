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
- [x] Auth endpoints: `/api/auth/register`, `/login`, `/me`, `/logout`
- [x] Idempotent admin seeding on startup (`admin@famly.id` / `admin123`)
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
