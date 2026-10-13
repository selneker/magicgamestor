# Magic Game Store — PRD

## Original problem statement
Phase 2 — Provider / FazerCards Abstraction. Make MGS domain provider-agnostic while keeping
FazerCards as the current provider. Target architecture:
MGS Core -> Provider abstraction -> FazerCards adapter -> FazerCards.
Prepare for Phase 3 (second game) with no PUBG code duplication. Do not start Phase 3 work.

## Repo / environment
- GitHub: https://github.com/selneker/magicgamestor.git — base branch: `phase-1-multigame`.
- Working branch for this phase: `phase-2-provider` (committed locally; push requires user credentials).
- Stack: FastAPI + MongoDB (motor) + React (CRA/craco, Neo-Brutalism). Backend routes under /api.
- Secrets (FazerCards API key / webhook secret) live only in deployment env; never in repo.
  Env var names used by code: FAZERCARDS_API_BASE, FAZERCARDS_API_KEY, FAZERCARDS_WEBHOOK_SECRET.

## Architecture — Provider boundary (Phase 2, implemented 2026-06)
- `backend/services/providers/` (NEW):
  - `base.py`: `Provider` ABC; normalized `OrderStatus` {created,processing,completed,failed,refund};
    dataclasses `IdentityValidation`, `ProviderOrder`, `ProviderWebhookEvent`.
  - `errors.py`: normalized `ProviderError` hierarchy (ProviderTimeout, ProviderOrderError,
    ProviderInsufficientBalanceError, ProviderUnavailableError, ProviderValidationError, ProviderUnknownError).
  - `fazercards_adapter.py`: `FazerCardsProvider` — wraps `services.fazercards`; holds all FazerCards
    specifics (endpoints, raw status strings, HMAC-SHA256 webhook signature over raw body, event parse).
  - `__init__.py`: `get_provider(game_id)` via config table `GAME_PROVIDER` ({"pubg-mobile":"fazercards"}).
- `services/fazercards.py`: low-level HTTP client (kept). Added generic `validate_identity(fields)`;
  `validate_pubg_id` delegates. Provider errors centralized in providers.errors (re-exported for compat).
- `services/fzr_fulfillment.py`: routes validate/create/get-order through `get_provider`; forwards
  `identity_snapshot.fields` dynamically (legacy fallback {player_id: pubg_id}); stable idempotency keys
  preserved; delivered/alert decisions use normalized status (raw status still stored).
- `routers/fazercards.py`: validate endpoint uses provider. `routers/fzr_orders.py`: `verify_fzr_signature`
  delegates to adapter; webhook event_id dedup preserved.

## Preserved (Phase 1 / 1.1)
Game, GameIdentity, Product.game_id, Order.game_id, Order.identity_snapshot, pubg_id, saved_pubg_ids.
No destructive migration, no frontend redesign.

## Tests
- NEW `backend/tests/test_phase2_provider.py` (8 tests): interface, status normalization, dynamic
  fields validation, create_order + idempotency passthrough, webhook signature + parse, error
  normalization, PUBG legacy fallback. All pass.
- Regression (localhost): Phase 1 `test_multigame_core` 8/8, Phase 1.1 `test_saved_identities` 5/5,
  fzr phase3/composite/catalog/validate/uc_audit/multiline — all green EXCEPT pre-existing failures
  (confirmed identical on original branch): quantity>1 assertions in test_fzr_phase3
  `test_multi_item_order_not_eligible` and test_fzr_multiline `test_qty_gt1_line_skipped_others_sent`
  (superseded by phase-4 composite quantity repetition). `TestLive*` require production FazerCards key.

## Phase 3 backlog (NOT implemented)
Game Admin, Provider Admin, Provider Mapping UI, catalog import UI, second game (Free Fire / Mobile
Legends) as user feature, enabling/disabling games via admin.
