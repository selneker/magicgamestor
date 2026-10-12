# Backend CI — design notes & required status checks

This document accompanies `.github/workflows/backend-ci.yml`. It is CI
infrastructure only: **no application code is changed by this PR.**

## Why

Until now, backend verification depended on manually reported test results.
This workflow makes the deterministic backend suites run automatically on every
PR to `main` and every push to `main`, so a PR cannot be merged on a manual
claim alone.

## What the workflow does

| Job | Name (status check) | Needs | Runs |
|-----|---------------------|-------|------|
| 1 | `unit-tests` | disposable `mongo:7` service, mocked supplier HTTP | mocked unit suites |
| 2 | `integration-tests` | disposable `mongo:7` service + local `uvicorn` backend | deterministic multi-game regression |

Both jobs:

- install a **reproducible** dependency set from `backend/requirements.txt`
  (pinned versions) with pip caching;
- start a **disposable MongoDB** (`mongo:7` service container) — never a
  production database;
- use **dummy credentials only** (fake JWT secret, fake admin password, fake
  FazerCards key) written into `backend/.env` at runtime;
- point `FAZERCARDS_API_BASE` at an **unreachable local port**
  (`http://127.0.0.1:9/api/v2`) so any accidental real supplier call fails fast
  instead of reaching production;
- run with `PAYMENT_MODE=simulation` — **no real payment** is ever initiated;
- **upload failure diagnostics** (pytest log, backend log, `pip freeze`) as a
  build artifact **only on failure**, and never upload `.env` or any secret;
- include a guard step that fails the job if a real-looking secret
  (`mongodb+srv://`, a PEM key, an AWS key) is found in the test environment.

## Test tiers

### Tier 1 — `unit-tests` (mocked, no live backend)

Supplier HTTP is mocked with `httpx.MockTransport`; only a local MongoDB is
required. Files:

```
tests/test_binance_configured.py
tests/test_fazercards_catalog.py
tests/test_fazercards_validate.py
tests/test_fzr_phase3.py
tests/test_fzr_composite_fulfillment.py
tests/test_fzr_multiline.py
tests/test_fzr_uc_audit.py
tests/test_mailjet.py
tests/test_payment_fees.py
tests/test_phase2_provider.py
```

Deselected inside those files (they need a live backend or are known
pre-existing failures superseded by Phase 4 — see below):

- `test_fzr_phase3.py::TestWebhook::test_live_endpoint_rejects_unsigned` (live HTTP)
- `test_fzr_phase3.py::TestWebhook::test_webhook_event_completes_order` (live HTTP)
- `test_fzr_phase3.py::TestStatusSync::test_refresh_status_completed_delivers_mgs_order` (live HTTP)
- `test_fzr_phase3.py::TestFulfillPreconditions::test_multi_item_order_not_eligible` (pre-existing, Phase 4)
- `test_fzr_multiline.py::TestMultiLineFulfill::test_qty_gt1_line_skipped_others_sent` (pre-existing, Phase 4)

### Tier 2 — `integration-tests` (local backend + local MongoDB)

Starts the FastAPI app locally with dummy env, then runs the deterministic
multi-game regression suites:

```
tests/test_multigame_core.py
tests/test_saved_identities.py
tests/test_phase3_games.py
tests/test_phase3_game_isolation.py
```

These use the repo's own `pytest.ini` (`-n 2 --dist loadscope`). Do **not**
force serial mode (`-o addopts=""`): the shared motor event loop breaks under
serial execution (`RuntimeError: There is no current event loop`).

### Excluded — manual only (need real external credentials)

These are **not** run in CI and must never be reported as passing:

- `tests/backend_test.py`, `tests/test_auth_loyalty.py`,
  `tests/test_binance_crypto.py`, `tests/test_iter*.py`,
  `tests/test_new_features.py`, `tests/test_payment_lifecycle.py`,
  `tests/test_iter15_phase3_live.py` — they target external preview URLs
  (`*.preview.emergentagent.com`) or need a live backend + real admin creds.
- `TestLive*` classes — need a real `FAZERCARDS_API_KEY`.

## Known pre-existing failures (not caused by CI)

Two assertions are stale after Phase 4 (composite quantity repetition) and are
deselected so the tier is deterministic:

- `test_fzr_phase3.py::TestFulfillPreconditions::test_multi_item_order_not_eligible`
- `test_fzr_multiline.py::TestMultiLineFulfill::test_qty_gt1_line_skipped_others_sent`

They should be fixed or removed in a separate application PR — not here.

## Recommended required status checks (owner action)

Branch protection is **not** modified by this PR. To make these checks
mandatory on `main`, the owner should enable, in
**Settings → Branches → Branch protection rules → `main`**:

- ✅ Require status checks to pass before merging
- Required checks:
  - **`unit-tests`**
  - **`integration-tests`**
- ✅ Require branches to be up to date before merging (recommended)

Enable them deliberately, after this workflow has run green at least once on a
real PR.

## Local reproduction

```bash
# disposable MongoDB
mongod --dbpath /tmp/mgsdb --bind_ip 127.0.0.1 --port 27017 --fork --logpath /tmp/mongod.log

cd backend
python -m venv /tmp/venv && /tmp/venv/bin/pip install -r requirements.txt

# dummy env (same values as CI)
cat > .env <<'EOF'
MONGO_URL=mongodb://localhost:27017
DB_NAME=magicgamestore_ci
JWT_SECRET=ci-dummy-jwt-secret-not-real
ADMIN_EMAIL=admin@magicgame.store
ADMIN_PASSWORD=CiDummy12345!
PAYMENT_MODE=simulation
FAZERCARDS_API_BASE=http://127.0.0.1:9/api/v2
FAZERCARDS_API_KEY=fc_dummy_ci_key
FAZERCARDS_WEBHOOK_SECRET=whsec_ci_dummy
FRONTEND_URL=http://localhost:3000
CORS_ORIGINS=http://localhost:3000
EOF

# tier 1
/tmp/venv/bin/python -m pytest tests/test_phase2_provider.py tests/test_fzr_phase3.py \
  -k "not TestLive" -p no:cacheprovider -q

# tier 2
set -a; . ./.env; set +a
nohup /tmp/venv/bin/python -m uvicorn server:app --host 127.0.0.1 --port 8001 &
BACKEND_TEST_URL=http://127.0.0.1:8001 TEST_API_URL=http://127.0.0.1:8001 \
  /tmp/venv/bin/python -m pytest tests/test_multigame_core.py tests/test_saved_identities.py \
  tests/test_phase3_games.py tests/test_phase3_game_isolation.py -p no:cacheprovider -q
```

## Security notes

- `backend/.env` and `frontend/.env` are **tracked in git** and contain exposed
  values (known leak). This workflow overwrites `backend/.env` with dummy values
  at runtime and never reads the tracked values. Rotating and untracking those
  files remains a separate, outstanding task.
- No repository secret is referenced by this workflow.
- Artifacts are uploaded only on failure and contain logs only.
