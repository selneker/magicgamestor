---
name: mgs-frontend-gotchas
description: Magic Game Store frontend traps — load when writing tests, adding data fetching or state, routing, i18n keys, or touching auth/API calls in frontend/.
---

# Magic Game Store — frontend gotchas

## Tests
- No `@testing-library`: tests use `react-dom/client` `createRoot` + `act` (React 19).
- `react-router-dom` v7 must be mocked (it does not resolve under Jest).
- No `setupTests.js`: each test file sets `global.IS_REACT_ACT_ENVIRONMENT` itself. `@/lib/api` is always mocked.
- Single file: `yarn test --watchAll=false <path>`.

## Data fetching and state
- Pattern in use: manual `useEffect` + `api.get(...)` inside contexts/components. `swr` is installed but unused;
  React Query has a provider but no `useQuery`. Don't add a third pattern; a cache goes through the existing React Query provider.
- The axios 401 interceptor silently refreshes and replays, except for its `NO_SILENT_REFRESH` regex.
  `/auth/me` is deliberately not excluded so returning visitors restore their session.
- No dev proxy: the app calls the backend cross-origin and relies on CORS.

## Routing
- Only `/compte`, `/compte/points` and `/admin` are protected.
- `/admin` renders inside the customer `Layout` (customer Header, Footer, BottomNav, CartDrawer wrap the admin UI).
- `GameProvider` is mounted inside `Layout`: `useGames()` is unavailable outside it.
- `Layout` renders `<PageTransition/>`, not `<Outlet/>`; the page comes from `useOutlet()`.

## i18n
- One `{ fr, en }` object; FR/EN parity is kept by hand (no automated test) — always add both keys.
- `t()` falls back to the key path on a miss, so a typo shows `checkout.foo` on screen.
- `localized(obj, field, lang)` is for API-supplied content.
- `document.documentElement.lang` is only set when the language changes, not on initial load.

## Preserve
- Reuse the evolutionary-pack offer/eligibility UI in both its page and the catalogue filter.
- Events: prefer the event's configured image; no fallback image.
- Keep game logic game-agnostic; no new `pubg_id`/UC assumptions.
