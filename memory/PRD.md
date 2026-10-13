# MagicGameStore — PRD

## Original problem statement
Frontend UX/UI redesign (Neo-Brutalism, dark + lime green) of the existing MagicGameStore
(GitHub: selneker/magicgamestor, main branch). FRONTEND-ONLY. Do not touch backend logic,
payments processing, order delivery, API contracts, FazerCards mappings, game activation rules.

## Architecture
- React (CRACO) + FastAPI + MongoDB. Backend runs PAYMENT_MODE=simulation in preview.
- Multi-game: generic catalog reused per selected game (GameContext). PUBG Mobile is the only
  active/sellable game; Free Fire NOT enabled (left as-is).
- i18n FR/EN via src/i18n/translations.js.

## Work done (2026-06, this session)
- Header nav stabilized: Boutique / Événements / Commandes / Messages (+ Admin for admins).
  Removed per-game nav entries (no more nav-game-*). Kept cart + account icons.
- Home redesigned as a vitrine: kept hero/games/popular/steps; added "Pourquoi choisir
  MagicGameStore ?" (4 justifiable advantages) and a FAQ accordion. No invented claims.
- ProductCard: removed per-product game icon/thumbnail; fixed "Pack évolutif" title breaking
  (overflow-wrap, no break-all); hides subtitle that merely repeats the figure; consistent
  card heights; kept name/quantity/price/discount/badges/add-to-cart + filters/sort/search.
- Login redirect: successful login now goes to '/' (was /compte).
- Admin: unified "Paiements" page (/admin/paiements) grouping PAPI + FiveOne Pay (moved from
  dashboard) + Binance (reused AdminBinance). Old /admin/paiements/binance redirects there.
  Secrets never shown (only server-side "configured" booleans).
- Admin catalog (/admin/catalogue): reorganized per selected game (game tabs + search + empty
  state), form keeps the selected game. Catalog rules/mappings unchanged.

## Verified
- Production build: Compiled successfully.
- testing_agent iteration_4: 11/11 frontend flows pass, 0 bugs. Auth + /payments/admin/settings OK.

## Backlog / notes
- No evo (Pack évolutif) product in preview DB, so evo title wrapping verified by style only.
- Delivery as a GitHub PR requires the platform "Save to GitHub" (no push token available here).
  Local branch prepared: feat/frontend-neobrutalism-refonte.
