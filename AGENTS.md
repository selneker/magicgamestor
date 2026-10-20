# Magic Game Store — Agent Guide

**My role in this project: frontend dev.** Backend, payment logic and API contracts are out of scope — see
§ Backend (reference only) if you need to read them, but do not change them.

`backend/` = FastAPI + MongoDB (motor) · `frontend/` = CRA 5 + craco 7, React 19, Tailwind 3.4, shadcn/Radix.
French is the default language, English secondary (dictionary in `src/i18n/translations.js`, read via `t()`).
Many customers are on a 390 px screen on a slow network.

`CLAUDE.md` holds the setup walkthrough. `plan-frontend-minimax.md` holds the phased work plan.
**This file holds the rules and the gotchas.**

---

## Working rules (permanent — these override anything else)

1. **One task at a time.** Finish it, validate it, commit it, then move on.
2. **Read the file before editing it.** Line numbers in the plan may have drifted — search by component or class name.
3. **Only touch the files listed in the task.** If another file seems to need a change, stop and say so.
4. **Forbidden:** refactoring beyond the task, renaming files, adding an unlisted dependency, touching the backend,
   payment logic, or API calls.
5. **Forbidden:** reading, printing or committing `.env` or any key/token. **Never invent a value** (USSD codes,
   merchant numbers, URLs). If a datum is missing, ask.
6. **Every user-visible string goes through `t()`** with both an FR and an EN key. No hardcoded text.
7. **Colours: use the existing CSS tokens.** No new hardcoded hex outside a token definition.
8. **Interactive touch targets: minimum 44×44 px on mobile.** (House rule from iOS HIG / Material — WCAG 2.2 AA's
   web floor is 24 CSS px, so 44 is a deliberate stricter choice, not a WCAG minimum.)
9. **After each task:** `cd frontend && yarn build` must pass, then `cd frontend && yarn test:ci`.
   There is **no `lint` script** — ESLint lives in `craco.config.js:96-105` and only enables `react-hooks` rules.
10. **One commit per task**, message format `fix(zone): short description` — matches the repo history exactly
    (`fix(cart): …`, `fix(boutique): …`, `fix(frontend): …`).
11. **If a spec is ambiguous, or you cannot find what is described, stop and ask.** Do not guess.

### End-of-task report (short)

- Files changed
- What changed (2–3 lines)
- How you verified it (command or test)
- Open points, if any

---

## The plan

`plan-frontend-minimax.md` — 5 phases, tasks T1.1 → T5.6, each with a validation criterion.

**One phase per session.** Hand the agent Part B for the current phase only, never the whole plan.
Phase 1 = money path (priority). One phase = one branch (`phase-1-paiement`, …), merged only after manual
validation on a real phone.

Two operational facts to check before starting:

- **The working tree is dirty** with in-flight auth work (backend + frontend, on `feat/all_fixing`). Commit or
  stash it **before** creating the phase branch, or the branch will carry it.
  *(Done 2026-10-19: the auth work is parked on `feat/auth-hardening`; `phase-1-paiement` branches from
  `feat/all_fixing` without it.)*
- **`yarn build` currently succeeds without `REACT_APP_BACKEND_URL`** and silently produces a broken bundle.
  Always export the var before building until T1.5 makes the build fail loudly.

### What can and cannot be verified here

- **Frontend: fully verifiable.** `yarn build` compiles and `yarn test:ci` runs green (8 suites / 37 tests).
- **Backend: NOT runnable in this environment.** `MONGO_URL` points at `mongodb://localhost:27017` and there is no
  local `mongod`, `mongosh`, `docker` or `podman`, and no passwordless sudo to install one. `pytest` therefore fails
  with `ConnectionError` on every DB-touching test (the pure-logic ones still pass). **Do not read those failures as
  a regression** — verify backend changes by reading, and ask the user to run the backend suite.


---

## Frontend gotchas

### Run

```bash
cd frontend && yarn start        # craco start
yarn test:ci                     # craco test --watchAll=false
yarn build                       # craco build
yarn audit:contrast              # audit WCAG du bundle (phase 2) — voir « Audit de contraste »
```

**Use yarn**, not npm: `yarn.lock` + `packageManager: yarn@1.22.22` are pinned, there is no `package-lock.json`.

### Audit de contraste (phase 2)

`yarn audit:contrast` (`frontend/scripts/audit-contrast.mjs`) mesure le contraste **réellement peint** de chaque
texte visible sur les pages clés, à 390 px et 1440 px, en clair et en sombre. Il sort en erreur tant qu'un échec
subsiste.

- Il a besoin d'un **Chromium déjà installé** : `CHROMIUM_PATH=/chemin/vers/chromium yarn audit:contrast`. Sans la
  variable, le script s'arrête avec un message. Il ne télécharge rien.
- Il audite le **bundle compilé** : lancer `yarn build` avant.
- **Ne jamais l'assouplir pour atteindre 0.** Toutes les exclusions de mesure sont listées en tête du script, avec
  leur raison ; les limites de la mesure y sont également notées. Toute nouvelle exclusion doit y être ajoutée.
- `playwright-core` est une devDependency ; le script n'est **pas** branché sur `build`, `test` ou `prestart`.

Alias `@` → `src` (webpack alias `craco.config.js:106-108`, mirrored in `jsconfig.json` and jest `moduleNameMapper`).

### `REACT_APP_BACKEND_URL` is build-time and fails *silently*

CRA inlines `process.env.*` at build. **If it is missing the build still succeeds** and the bundle contains
`baseURL: "undefined/api"` — axios treats it as relative, the app calls `/undefined/api` on the current origin, and
the home page white-screens (`Home.js:243`, `s.filter is not a function`). No error boundary.

`craco.config.js` calls `dotenv.config()` but that only populates the *craco* process, not the app bundle. Set the
var before `yarn build` / `yarn start`. Only two consumers: `src/lib/api.js:4` and `src/components/AuthCallback.js:9`.

### No dev proxy

The app calls the backend cross-origin and relies on CORS. `server.py:75-85` builds allowed origins from
`CORS_ORIGINS` (a literal `"*"` is dropped) + `FRONTEND_URL`, and auto-adds each origin's apex/www twin.

### Data fetching

Manual `useEffect` + `api.get(...)` inside contexts and components. **`swr` is a dependency but is never imported.**
React Query has a `QueryClientProvider` (`src/index.js:3,8-23`) but **no `useQuery`/`useMutation` anywhere**. Don't
introduce a third pattern; if you add a cache, use the existing RQ provider. State lives in `AuthContext` /
`CartContext` / `ChatContext` / `GameContext` / `LanguageContext`, plus favourites in `src/lib/favorites.js`
(a `useSyncExternalStore` external store over `localStorage`, not a context).

The axios 401 interceptor (`src/lib/api.js:16-35`) silently refreshes and replays, **except** for the hardcoded
`NO_SILENT_REFRESH` regex at `src/lib/api.js:12` — `/auth/me` is deliberately *not* excluded so returning visitors
restore their session.

### Tests

No `@testing-library` — tests use raw `react-dom/client` `createRoot` + `act` from React 19.
**`react-router-dom` v7 must be mocked** (it does not resolve under jest — see the comment at
`src/components/layout/Header.test.js:9-10`).
There is **no `src/setupTests.js`**; each test file sets `global.IS_REACT_ACT_ENVIRONMENT` itself.
No test needs a running backend — `@/lib/api` is always mocked.

```bash
yarn test --watchAll=false src/lib/api.test.js
```

### Routing

- Only `/compte`, `/compte/points` and `/admin` are protected (`src/components/ProtectedRoute.js`).
- **`/admin` renders inside the customer `Layout`** (`src/App.js:143,164`) — customer Header, Footer, BottomNav and
  CartDrawer all wrap the admin UI. `AdminLayout` is a nested `<Outlet/>` layout.
- `GameProvider` is mounted **inside `Layout`**, not in `App.js` — `useGames()` is unavailable outside the layout.
- `Layout` renders `<PageTransition/>`, not `<Outlet/>`; the page comes from `useOutlet()`.

### i18n

`src/i18n/translations.js` = one `{ fr, en }` object, 20 namespaces. Currently **690/690 in parity, with no automated
parity test** — keep it that way by hand. `t(path, vars)` resolves a dot path and **falls back to the path string
itself** on a miss, so a typo renders `checkout.foo` on screen. `localized(obj, field, lang)` is for API-supplied
content. `document.documentElement.lang` is set only inside `setLang` (`LanguageContext.js:11`), **not on initial
load** — it stays `"fr"` even when `mgs_lang` is `en`.

`public/sw.js` is **push-only** — no `fetch` handler, no caching — and is registered only from the admin push page.
`public/manifest.json` has `start_url: "/admin"` and colours that do not match the app palette.

---

## Design system — read this before touching styles

`src/index.css` is three layers, and the third one is the trap.

1. `@layer base` (:5-85) — the token layer. `:root` and `.dark` define the shadcn set as HSL triplets
   (`--background`, `--foreground`, `--card`, `--primary`, `--muted-foreground`, `--border`, `--ring`, `--radius:10px`,
   `--rule`, `--rule-strong`, `--shadow-brut`, `--mvola`/`--orange`/`--pubg`, `--neo-*`) plus
   `--font-display`/`--font-body`. Note `* { border-color: var(--rule) }` (:69) — every element inherits a soft border.
2. `@layer utilities` (:87-171) — custom utilities: `.panel`, `.eyebrow`, `.num`, `.card-lift`, `.liquid-nav`, `.grain`,
   `.panel-black`, `.panel-points`, `.eyebrow-invert`, `.no-scrollbar`, `.pb-safe`.
3. **An unlayered block at the end (:175-222) that globally remaps Tailwind utilities with `!important`.**

### The unlayered remap overrides Tailwind

Unlayered author CSS beats *all* layered rules regardless of specificity, so this table wins over every Tailwind
utility it names — and over all 46 shadcn primitives in `src/components/ui/*.jsx`, which know nothing about it.
Consequences an agent will otherwise get wrong:

| Written in markup | Actually renders as |
|---|---|
| `text-primary` | body-text colour, **not** neon (`.dark` → neon) — 19 uses |
| `border-foreground` / `border-slate-900` / `border-black` | `var(--rule)`, a soft ~1.4:1 hairline, **not black** — 77 uses |
| `rounded-full` | 10px — except `span.rounded-full` and `h-1/h-2/h-3/w-1..w-3` → 9999px |
| `rounded-none` | 8px · `rounded-2xl/3xl` → 14px · `rounded-xl/lg` → 12px |
| `bg-white*` | `hsl(var(--card))` · `bg-slate-50/100/200` → `hsl(var(--muted))` |
| `bg-amber-50`, `-orange-`, `-emerald-`, `-sky-`, `-blue-`, `-violet-`, `-rose-50` | all → one grey: warning/success/info/danger are indistinguishable |
| `bg-emerald-600/500`, `bg-orange-500` | foreground background — the "green success" button renders black |
| `hover:bg-slate-50/100/200` | a full neon flash |
| `bg-slate-900/950` | foreground background (+ `text-background`) |

**Not in the map, so they still ship raw** and clash with the cream+neon palette:
`text-rose-600/700`, `bg-rose-500/100`, `bg-amber-100`, `bg-slate-700/800`, `text-slate-100/200`, `bg-sky-100`,
`bg-emerald-100`, `bg-red-50`, `border-amber-200`. Half-mapping is the source of the visual inconsistency.

**Use `border-ink` (`#111111`, `tailwind.config.js:30`) for a real hard border** — that is what `ProductCard` does.
`.brutal-panel` and `.brutal-button` exist but have **0 usages**.

### Dead design code (safe to delete, or wire up deliberately)

`.brutal-card`, `.panel-soft`, `.panel-neon`, `.rule-t`, `.neon-shadow`, `.figure-highlight`, `.focus-ring`,
`.product-card-lift`, `.brutal-panel`, `.brutal-button`, `.neubrutal-rule`, `.marquee`, `.liquid-active`, `.neo-card`,
`.neo-card-radius`; `rounded-neo` (3rem) and `--neo-card-bg/text/border`; `src/styles/product-card.css` (verbatim
duplicate of `index.css:151-169`). `boxShadow.brut`/`brut-lg` hardcode `#111111` (not theme-aware).
`tailwind.config.js` `colors.chart.1..5` reference `--chart-1..5`, which are **not defined** in `index.css`.

### Fonts

`public/index.html:28-30` loads Onest + Bricolage Grotesque from Google Fonts; `index.css:7-8` defines
`--font-display` / `--font-body`; `index.css:73,79` apply them. `tailwind.config.js:12-18` maps `fontFamily` to the
vars, but `display` and `body` put the **literal family name first** (`['"Bricolage Grotesque"', 'var(--font-display)', …]`)
— keep that ordering or the fonts break. `font-mono` maps to `var(--font-body)` and is **not** monospace.
Adding a family = HTML head **and** `:root`.

### `ProductCard` is the one real brutalist surface — fixed in T2.1

`src/components/store/ProductCard.js:89` = `bg-neo` (static hex `#D4FF00`) + `border-ink` + `rounded-[28px]`, the only
component still carrying the hard border. It used to pair that static background with a theme-relative
`text-foreground`, which flips to cream in dark mode → **product names and figures landed at 1.04:1**. Fixed on
2026-10-20 (`d5e7e78`): the card's content wrapper now pins `text-ink`, the price pill — the only child that paints
a *theme* surface (`bg-white` → `hsl(var(--card))`) — keeps `text-foreground`, and the discount badge (`bg-neo`) pins
`text-ink`. **Static colour + theme-relative token is the bug**: any colour change on a fixed surface must keep its
foreground static.
(The same inversion still hits `.panel-black` = `bg-foreground` + `text-background`, so "black accent panels" become
cream in dark mode, and the neon `text-primary` inside them disappears at 1.06:1 → **T2.2**.)

### Ink surfaces are ink in both themes (fixed in T2.2)

`.panel-black`, the cart bar, the « 02 » card and the game selector are **fixed ink** surfaces —
`bg-ink` (the Tailwind `ink` token, `#111111`) with **fixed cream** text (`--cream`, the light theme's
`48 20% 94%`, promoted to a token and never overridden in `.dark`). The neon is allowed **only** there,
via `.text-neo-on-ink`; neon on cream is unreadable.

The trap: `text-background/xx` means the **dark** theme's colour, so on an ink surface it must become
`text-[color:hsl(var(--cream)/.7)]` — and `text-primary` is the *body* colour in light and neon in dark,
so it must become `text-neo-on-ink` (on ink) or `text-foreground` (elsewhere, in **T5.4**). The other
inverted surfaces (`Header.js` points pill, `Account.js`, `AdminBottomNav.js`, `button.jsx`…) pair
`bg-foreground` with `text-background` and are self-consistent: their contrast does not depend on the
theme.

---

## Backend — reference only (out of scope for frontend work)

- `cd backend && uvicorn server:app --reload --port 8000` — cwd **must** be `backend/` (imports are flat:
  `from core.db import …`). API is mounted at `/api` plus 15 routers (`server.py:69-73`); `/health` is at the root.
- Auth is **HttpOnly cookies** (`access_token` 15 min, `refresh_token` 30 d), so the frontend must send
  `withCredentials: true` (already set). Guards are FastAPI dependencies (`core/security.py:220-260`), not middleware.
- There is **no repository layer and no migration framework**: services hit `db.<collection>` directly with raw dicts,
  and data migrations are idempotent functions called from the lifespan (`server.py:25-39`).
- **Game-agnostic is only half true.** `order.pubg_id` is a legacy compat column always filled with the primary
  identity value; persisted fields are vendor-named (`order.fazercards`, `order.fazercards_lines.*`,
  `product.fazercards_mapping`); `RESERVED_TYPE_KEYS = {"prime","prime_plus","evo"}` may only be used by PUBG
  (`core/games.py:287,313-315`). Do not introduce new `pubg_id`/UC assumptions.
- Provider calls go through `providers.get_provider(game_id)` (`backend/services/providers/`), but
  `get_categories` / `get_offers` / `parse_webhook_event` are implemented and **bypassed** by the domain — check the
  real call path before assuming.

---

## Rules to preserve

- **Typography stays centralised** in the CSS font variables, with Tailwind families mapped to those variables and
  web fonts loaded through the HTML head — so a font change needs no component rewrite.
- **Reuse the evolutionary-pack offer and eligibility UI** in both its dedicated page and the catalogue filter, so
  catalogue purchases keep the same eligibility flow. (`pages/Catalog.js:13,248` renders `<PackEvolutif embedded …/>`
  for the `evo` type tab; `pages/PackEvolutif.js` owns the eligibility check.)
- **Prefer an event's configured image over any fallback**, so adding artwork needs no backend change. Current state:
  `pages/Events.js:39` renders `ev.image_url` only when present, with no fallback image. The old carousel and its
  bundled `frontend/src/assets/carousel-uc.jpg` / `carousel-prime.jpg` are **unused**, as are the
  `hero.carouselLabel`, `hero.prev/next/goTo/rotate` translation keys and the `.marquee` utility — the hero was
  rewritten as a grid.
- Secrets (`MONGO_URL`, `JWT_SECRET`, `FAZERCARDS_API_KEY`, `FAZERCARDS_WEBHOOK_SECRET`, `BINANCE_API_SECRET`, …)
  come only from the deployment env or an ignored local `.env`. `.env*` is gitignored except `.env.example`.
- Keep game logic game-agnostic; route provider calls through `get_provider(game_id)`.
