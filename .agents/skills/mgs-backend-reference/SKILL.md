---
name: mgs-backend-reference
description: Magic Game Store backend facts (FastAPI + MongoDB) — load when reading or changing backend/, auth, providers or orders.
---

# Magic Game Store — backend reference

- Run from inside `backend/` (imports are flat: `from core.db import …`): `uvicorn server:app --reload --port 8000`.
  API under `/api`; `/health` at the root.
- Auth = HttpOnly cookies (`access_token` 15 min, `refresh_token` 30 d); the frontend sends `withCredentials: true`.
  Guards are FastAPI dependencies, not middleware.
- No repository layer, no migration framework: services hit `db.<collection>` with raw dicts; data migrations are
  idempotent functions called from the lifespan.
- Game-agnostic is only half true: `order.pubg_id` is a legacy column always filled with the primary identity;
  persisted fields are vendor-named (`order.fazercards*`, `product.fazercards_mapping`); the type keys
  `prime`, `prime_plus`, `evo` are reserved for PUBG. Don't add new `pubg_id`/UC assumptions.
- Provider calls go through `providers.get_provider(game_id)`, but some provider methods are implemented and bypassed —
  check the real call path before assuming.
- CORS origins come from `CORS_ORIGINS` (a literal `"*"` is dropped) + `FRONTEND_URL`, each with its apex/www twin.
- Tests touching the DB need a running MongoDB; without one they fail with `ConnectionError` — that is not a regression.
