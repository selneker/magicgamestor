# Magic Game Store — PRD

## Original problem statement
Audit the existing Magic Game Store (https://github.com/selneker/magicgamestore.git — vanilla HTML/JS + Express, PUBG Mobile UC/Prime top-up shop for Madagascar) and rebuild it as a fast, modern, mobile-first, production-ready marketplace: homepage, catalog with filters, product pages, cart, checkout, accounts, admin. Integrations: email/password + Google auth, MVola & Orange Money payments, AI smart search/recommendations (Emergent LLM key), light clean theme.
Phase 1 audit: see `/app/memory/AUDIT.md` (delivered & approved).

## User decisions (June 2026)
- Catalog: **PUBG Mobile only** (14 UC packs + 8 Prime/Prime+ subscriptions, prices preserved from legacy site).
- Payments: **official MVola Merchant Pay + Orange Money WebPay APIs** (merchant MVola 0383905692 / Orange 0377519833, "Selneker Dino"). No sandbox credentials yet → `PAYMENT_MODE=simulation` (MOCKED auto-complete after 8 s). Manual USSD+reference kept as fallback method.
- Language: **French + English switch** (default FR).
- Theme: light, Outfit/Manrope fonts, blue #007aff, MVola green, Orange orange, PUBG yellow accents. Blueprint: `/app/design_guidelines.json`.

## Architecture
- Backend FastAPI (`/app/backend`): `server.py` (lifespan: indexes + seed), `core/{db,security,seed}.py`, `routers/{auth,products,orders,payments,events}.py`, `services/payments.py` (MVola/Orange adapters + simulation). MongoDB collections: users, user_sessions, login_attempts, products, orders, payments, events, reactions, settings. All ids are uuid strings; `_id` never exposed.
- Frontend React 19 + Tailwind + shadcn (`/app/frontend/src`): contexts (Language, Auth, Cart), `lib/api.js` (axios withCredentials + refresh interceptor), pages Home/Catalog/Product/Checkout/OrderTrack/Events/AuthPage/Account/admin/*, layout Header/BottomNav/Footer/CartDrawer.
- Auth: JWT access (15 min) + refresh (7 d) httpOnly cookies; Emergent Google session_token cookie; roles customer/admin; brute-force lockout per email (5 fails → 15 min).
- Env (backend/.env): JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD, FRONTEND_URL, PAYMENT_MODE, MVOLA_*, ORANGE_*, EMERGENT_LLM_KEY (empty, for Phase 5).

## Key API endpoints
- Auth: POST /api/auth/{register,login,logout,refresh,google/session}, GET/PATCH /api/auth/me
- Catalog: GET /api/products (type,q,min_price,max_price,popular,sort,include_inactive), GET /api/products/{slug}
- Orders: POST /api/orders (server-side pricing), GET /api/orders/me, GET /api/orders/track?order_number&pubg_id, GET /api/orders/{id}
- Payments: GET /api/payments/config, POST /api/payments/initiate, GET /api/payments/{order_id}/status, PUT /api/payments/mvola/callback, POST /api/payments/orange/notification, POST /api/payments/{order_id}/simulate (admin)
- Events: GET /api/events, POST /api/events/{id}/{like,share}; GET /api/settings/status
- Admin: /api/admin/{orders,stats,export,status,products,events}

## Implemented (2026-06)
- Phase 1 audit (AUDIT.md). Phase 2 foundation: DB catalog + seed, auth (email/pass + Google), roles.
- Phase 3 store: homepage, catalog filters/sort/search, product page + related, cart drawer, checkout (MVola/Orange API flow with polling status screen, manual USSD fallback), order tracking (order_number + pubg_id), FR/EN.
- Phase 4: customer account (profile, saved PUBG IDs, orders), admin (dashboard stats + chart, orders management with filters/status/delete/simulate, catalog CRUD, events CRUD, online toggle persisted, CSV export), events feed with like/share.
- Testing: iteration_1 — backend 39/40 (lockout bug fixed after), frontend all flows pass.

## Backlog
- P0: Obtain MVola developer-portal consumer key/secret + Orange Money client_id/secret/merchant_key → set `PAYMENT_MODE=sandbox`, test real callbacks, then `production`.
- P1: Phase 5 — AI smart search + "recommended for you" (Emergent LLM key, integration_expert playbook).
- P1: Phase 6 — SEO (JSON-LD Product/Offer, per-page meta, sitemap.xml, robots.txt), image optimisation, a11y pass, 404 page.
- P2: Order email/WhatsApp notifications, password reset flow, admin order detail drawer with history timeline, pagination for admin orders.
