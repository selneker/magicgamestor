# Auth testing playbook — Magic Game Store

Credentials: see /app/memory/test_credentials.md

## Email/password (JWT cookies)
```
API=$(grep REACT_APP_BACKEND_URL /app/frontend/.env | cut -d '=' -f2)
curl -c c.txt -X POST $API/api/auth/login -H "Content-Type: application/json" -d '{"email":"admin@magicgame.store","password":"Admin@2026!"}'
curl -b c.txt $API/api/auth/me
```
Login sets `access_token` (15 min) + `refresh_token` (7 d) httpOnly cookies AND returns `access_token` usable as `Authorization: Bearer`.
Brute force: 5 failures per ip:email → 429 for 15 minutes (collection `login_attempts`).

## Google (Emergent-managed) — create a session manually
```
mongosh --eval "
use('test_database');
var userId = 'user_test' + Date.now();
var token = 'test_session_' + Date.now();
db.users.insertOne({user_id: userId, email: 'g.user.' + Date.now() + '@example.com', name: 'Google User', role: 'customer', auth_provider: 'google', saved_pubg_ids: [], created_at: new Date().toISOString()});
db.user_sessions.insertOne({user_id: userId, session_token: token, expires_at: new Date(Date.now()+7*24*3600*1000).toISOString(), created_at: new Date().toISOString()});
print(token);"
```
Then `curl -H "Authorization: Bearer <token>" $API/api/auth/me` or set cookie `session_token` in the browser (httpOnly, secure, SameSite=None).

## Protected UI routes
- /compte (any logged-in user), /admin (role=admin). Unauthenticated → redirect to /connexion.
