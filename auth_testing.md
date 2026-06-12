# Famly Auth Testing Guide

## Test Credentials
- Admin: `admin@famly.id` / `admin123` (role=admin)
- Test users can be registered via `POST /api/auth/register`

## Endpoints
- `POST /api/auth/register` - body: `{email, password, name}`
- `POST /api/auth/login` - body: `{email, password}`
- `POST /api/auth/logout` - requires Bearer token
- `GET /api/auth/me` - requires Bearer token

## Quick API Test
```bash
API_URL=$(grep REACT_APP_BACKEND_URL /app/frontend/.env | cut -d '=' -f2)
TOKEN=$(curl -s -X POST "$API_URL/api/auth/login" -H "Content-Type: application/json" -d '{"email":"admin@famly.id","password":"admin123"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
curl -s -X GET "$API_URL/api/auth/me" -H "Authorization: Bearer $TOKEN"
```

## MongoDB Verification
```bash
mongosh famly_database --eval 'db.users.findOne({role:"admin"})'
```
Verify: bcrypt hash starts with `$2b$`, unique index on users.email.
