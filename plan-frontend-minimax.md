# Magic Game Store — Frontend Plan (agent-facing)

> Working plan for the frontend refactor. `AGENTS.md` holds the permanent rules; this file holds the phased work.
> **One phase per session.** Never hand the whole plan to the agent at once — hand it Part B for the current phase only.

---

## Part A — Permanent rules (already merged into `AGENTS.md`)

See `AGENTS.md` § "Working rules". They are the authority; this section is only a pointer.

---

## Part B — 5 phases, short tasks, one validation criterion each

Estimated 8–10 working days in short sessions. **One phase = one git branch** (`phase-1-paiement`, …).
Merge only after manual validation on a real phone.

### Progress

| Task | Status | Commit | Notes |
|---|---|---|---|
| T1.1 Mobile cart bar | **done** | `450af04` + `572bb11` | CTA coverage 89% → 0% (measured across the full button width). Follow-up commit fixed z-index, nav-less routes, product page and the virtual keyboard |
| T1.2 Step counter "Étape 4 / 3" | **done** | `2dfd7a6` | 4 named steps, total derived from `screens.length`, vertical layout. Walked 1/4 → 4/4 in FR and EN |
| T1.3 USSD instructions | **done** | `0131ea6` + `651dac8` | Code, amount and merchant number are all rendered. Verified in the 4 combinations FR/EN × MVola/Orange at 390px. Follow-up fixed the `tel:` encoding and the copy message |
| T1.4 Payment status | **done** | `8522e20` | Icon disc via opacity overlay (not `color-mix()`), locale-aware amount, single `role="status"` region that never re-announces on poll |
| T1.5 Build without backend URL | **done** | `8d70c0c` + `48a4e3d` + `6a87334` | Build fails without the var (production only); Error Boundary FR/EN; `Home.js` survives a non-array payload |
| T1.6 Mémoiser le contrat d'identité | **done** | `f50db6c` | Without the `useMemo`, a game with no `identity_fields` left the customer **blocked at checkout step 1**. Before/after measured on the same build |
| T1.7 Garde-fou global sur les réponses `/api` | todo | | described below, not implemented |
| T2 → T5 | todo | | |

### T1.5 implementation notes (2026-10-20)

Three commits, as agreed:

1. **`8d70c0c`** — `frontend/scripts/check-backend-url.mjs` + the `prebuild` / `prestart` hooks in `package.json`.
   - CRA replaces `process.env` with an object literal holding **only the `REACT_APP_*` keys present at build time**
     (`react-scripts/config/env.js:70-100`). **Absent** → the bundle gets `baseURL: "undefined/api"` → blank page.
   - **An empty value is legitimate** and is accepted: it produces `baseURL: "/api"`, a *relative* URL, which is the
     "front and API on the same domain" case. **Only the absence of the variable is a build defect.** The check
     therefore tests *presence*, not value. `yarn build` → exit 1 · `yarn start` → warning, still starts ·
     `yarn test` → no hook, never blocked.
2. **`48a4e3d`** — `frontend/src/components/ErrorBoundary.jsx`, mounted in `src/index.js` **outside every provider**,
   plus the `error.*` strings in `translations.js`. The boundary resolves the language itself from
   `localStorage["mgs_lang"]` (FR unless the stored value is exactly `"en"`) instead of using `useLang()`.
3. **`6a87334`** — `asList(endpoint, payload)` in `pages/Home.js`: a non-array payload becomes `[]` and logs a
   `console.warn` naming the endpoint. `subs === null` (loading) still yields `undefined` so the skeletons show
   instead of the "no offers" message.

Verified in the browser on the real defect (HTML payload on `/api/products`): the error screen appears in FR and EN,
light and dark; **no stack trace on screen**; the error and its stack in the console; the "Recharger" button reloads.

### T1.7 — Global guard on `/api` responses (to study, **not implemented**)

`Home.js` is now guarded, but the same failure class exists elsewhere (see the list below). The proposed approach, for
a future task:

> An **axios response interceptor** in `src/lib/api.js` that rejects any response on `/api` whose `Content-Type` is
> not JSON (or whose body is not a JSON array/object when the caller expects a list). The rejection would be a normal
> `Promise` rejection, so every existing `.catch(() => setX([]))` would already handle it — no per-page change.
> The interceptor would also log the offending URL.

Open questions to settle before coding it: the interceptor must **not** touch the auth endpoints that legitimately
answer with 401 (those are already handled by the refresh interceptor), and it must decide between *rejecting* and
*normalising to `[]`* — rejecting is safer but would turn a partial outage into a full page error, normalising is
quieter but hides the problem. My inclination: **normalise to `[]` for list endpoints and log loudly**, and keep the
Error Boundary as the last resort. Needs a decision, and a test for each shape.

### Other unguarded API-array call sites (listed, **not modified** — this is the material for T1.7)

| File:line | Operation | Source |
|---|---|---|
| `pages/Catalog.js:116` → `183,185,191,194,195,196` | `setProducts(r.data)` then `visibleProducts.filter(...)` | `/api/products` |
| `pages/Catalog.js:129` | `products.filter(...)` (favourites) | `/api/products` |
| `pages/OrderTrack.js:77` → `160,168` | `setHistory(r.data)` then `history.slice().map()`, `o.items.map()` | `/api/orders/me` |
| `pages/Loyalty.js:97` → `13,16` | `setData(r.data)` then `data.ledger` → `entries.map()` | `/api/loyalty/me` |
| `pages/Loyalty.js:98,99` → `40,72` | `setRewards(r.data)`, `setTransfers(r.data)` then `.map()` | `/api/loyalty/rewards`, `/transfers` |
| `pages/Events.js:14` → `18,26,36` | `setEvents(r.data)` then `list.map()` | `/api/events` |
| `pages/Product.js:28` → `49` | `setProduct(r.data)` then `product.items.map()` | `/api/products/:slug` |
| `components/chat/ChatThread.js:31` | `data.messages.map(...)` inside a spread | `/api/chat/…` |
| `pages/admin/AdminOrders.js:33` | `data.products.filter(...)` | admin |
| `pages/admin/AdminFazercards.js:19,131,242,243,244,391,521` | `.filter(...)` on API payloads | admin |
| `pages/admin/AdminProducts.js:67,68`, `AdminGames.js:24` | `.filter(...)` on API payloads | admin |

`pages/Catalog.js` is the most exposed: the catalogue is the main storefront page and it has no guard at all.

**T1.4 implementation notes (2026-10-20):**
- **Icon disc:** an absolutely-positioned overlay with `background: var(--mvola)` and `opacity: 0.12`. `color-mix()`
  was ruled out: the resolved production browserslist (`npx browserslist --env=production`, 39 targets) still
  contains **`chrome 109`** and **`and_uc 15.5`**, and `color-mix()` needs Chrome 111+. `opacity` is CSS 1 and works
  everywhere, including UC 15.5.
- **Amount:** `Intl.NumberFormat(lang)` + " Ar" → "2 500 Ar" (FR) / "2,500 Ar" (EN). `formatAr()` in
  `src/lib/api.js` is still hardcoded `fr-FR` for its ~10 other call sites — **left untouched** because T1.4's file
  list is `PaymentStatus.js` only. Generalising `formatAr(n, locale)` is a one-line, backward-compatible change if
  you want the whole app locale-aware.
- **Status announcement:** the `role="status" aria-live="polite"` heading is rendered **outside** the state
  branches so it stays the same DOM node; its text is derived from `state`. Measured: 0 text mutations across
  3 polls (9 s), exactly 1 mutation on the pending → completed transition, on the same node. It is the only live
  region in the component.

**T1.3 implementation notes (2026-10-20):** the `tel:` link needs the USSD terminator encoded — a raw `#` opens
the fragment and the browser drops it from the path, so the dialled sequence lost its terminator. The code is now
`encodeURIComponent`-encoded and the transmitted string matches the displayed code exactly.

**T1.1 validation criterion (revised 2026-10-20):** measure the **coverage of the "Commander" button across its
whole width** (walk the button's x-axis and check that every point hits the button), **not** `elementFromPoint` at
the centre. On the broken layout the centre happened to fall in a 13 px gap between the nav glass and the FAB, so a
centre-point check would have passed a 89 %-covered button.

**T1.3 inventory (2026-10-20)** — everything needed is already available, nothing is missing:

| Value | Source | Evidence |
|---|---|---|
| Merchant number | API | `GET /api/payments/config` → `providers.{mvola,orange}.merchant` — `backend/routers/payments.py:176-177`. Read at `PaymentFlow.js:184`, `StepPay.js:34` |
| Amount | API (derived) | `summary.subtotal + summary.fee` — `StepPay.js:35`; subtotal from the order lines, fee from the same config (`payment_fees`) |
| USSD code | **Frontend template** | `PaymentFlow.js:16-19` — `USSD.mvola = (phone, amount) => \`#111*1*2*${phone}*${amount}*1*0#\``, `USSD.orange = (phone, amount) => \`#144*1*1*${phone}*${phone}*${amount}*1#\``. The **backend has no USSD template at all** — grep for `111*1*2` / `144*1*1` in `backend/**/*.py` returns nothing |

The code is already computed at `StepPay.js:36` and consumed by the `tel:` link at `StepPay.js:45` — it is
simply never displayed. **No value has to be invented.**

Translation keys currently **unused** (0 references): `ussdTitle`, `ussdAmount`, `ussdNumber`, `ussdCode`,
`ussdSteps`, `ussdNote`, `ussdNext`. Already used: `ussd`, `ussdName`, `ussdNumberShort`, `manualHowto`,
`manualPayTitle`, `manualPaid`, `manualSub`.
None of the unused keys expects a `{placeholder}` — they are labels and literal sentences. `ussdSteps` is an
**array of 5 strings**, so `t()` returns it as-is (`LanguageContext` only interpolates when the value is a string).

**T1.6 — Mémoiser le contrat d'identité.** `Checkout.js:63` does
`const identitySpec = game?.identity_fields || []`. When a game has no `identity_fields` this creates a **new
array on every render**, so `spec` changes identity, so `handleVerified` changes identity, so the reset effect in
`PubgIdVerify` (`useEffect(..., [pubgId, onVerified])`, `PubgIdVerify.js:14-15`) re-fires and wipes the
verification result. Not a live bug today — `GET /api/games` always injects the resolved contract
(`backend/routers/games.py:27`, backend `identity_spec()`) — but the frontend has no equivalent fallback to the
backend's `identity_spec()`. Fix with a `useMemo` on `identitySpec`, in its own commit, after T1.5.

**T1.1 deviation (approved by the user):** the plan listed only `CartDrawer.js`, `BottomNav.js` and
`GameButton.js`. `Layout.js` was needed to reserve the extra bottom space, otherwise the cart bar would
cover the footer's last row. `BottomNav.js` and `GameButton.js` turned out to need **no change** for the
overlap itself — but the route predicate they each duplicated was extracted to `src/lib/bottomChrome.js`
so the cart bar, the nav and the FAB can never disagree about which chrome is on screen.

**T1.1 follow-up (`572bb11`)** — found by review, all four fixed and measured in the browser:
- `z-[60]` was above the cart drawer (Sheet, z-50) and the chat panel (z-50) → now `z-[45]`, above the nav
  (z-40) but below every overlay.
- The bar floated 84 px above the bottom on routes with no nav (`/commande`, `/compte`, `/admin`).
- On a product page it collided with `Product.js`'s own sticky buy bar → the cart bar is hidden on `/produit`.
- With the on-screen keyboard the layout viewport shrinks and the bar rose over the field being typed into
  (catalogue search, login e-mail) → the bar is hidden while a text field has focus.

**T1.1 known follow-ups (not fixed here, they belong to later tasks):**
- The cart bar total uses `text-primary` on `bg-foreground` → invisible in dark mode (1.06:1). → **T2.2**
- `border-foreground` on the cart bar is remapped to a 15%-opacity hairline → **T5.5**

**Dead components found while testing:** `components/chat/FloatingChat.js` and `components/chat/ChatLink.js`
are never imported anywhere — the floating chat FAB does not exist in the running app. `ChatWorkspace` and
`ChatThread` are used (by `/chat` and the admin chat page). The `panelOpen` guard added to the cart bar is
correct but currently has nothing to hide.

**Latent fragility found while driving the checkout (fixed in T1.6):** `Checkout.js` did
`const identitySpec = game?.identity_fields || []` — when a game has no `identity_fields` this creates a
**new array on every render**, which makes `handleVerified` a new function, which re-triggers
`PubgIdVerify`'s reset effect (`useEffect(..., [pubgId, onVerified])`) and wipes the verification result.
Measured on the same build, with a game that has **no** `identity_fields`:

| | child state "valid" | "Continuer" button | screen reached |
|---|---|---|---|
| without the `useMemo` | **wiped** | **absent** | `checkout-screen-1` — **blocked** |
| with the `useMemo` | kept ("Pseudo: TestPlayer") | present | `checkout-screen-2` |

With `identity_fields` present, both builds pass — which is why the bug stayed latent: the backend always injects the
resolved contract (`backend/routers/games.py:27`), so only a game *without* fields would trigger it. The frontend has
no equivalent fallback to the backend's `identity_spec()`, so the reference is now memoised.

### Reconciliation notes (verified against the current tree)

| Plan said | Reality | Use |
|---|---|---|
| `cd frontend && npm run build` | Repo is **yarn 1.22.22** (`yarn.lock`, `packageManager` pinned, no `package-lock.json`) | `cd frontend && yarn build` |
| "run the lint if it exists" | **No `lint` script.** ESLint config lives in `craco.config.js:96-105` and enables only `react-hooks` rules | `yarn build` + `yarn test:ci` |
| — | `yarn build` currently **succeeds** without `REACT_APP_BACKEND_URL` and produces a broken bundle | always export the var before building (T1.5 makes it fail loudly) |
| Touch target ≥ 44×44 px | House rule from iOS HIG / Material. WCAG 2.2 AA web floor is 24 CSS px — 44 is a deliberate stricter choice, not a WCAG minimum | keep 44 px |
| — | The working tree is **dirty** with in-flight auth work (backend + frontend) on branch `feat/all_fixing` | commit or stash it **before** creating `phase-1-paiement` |

All file/line references below were verified against the current tree and match.

### Phase 1 — Money path (absolute priority, 2 days)

Goal: a customer can add to cart, pay, and track their order on mobile.

**T1.1 Mobile cart bar hidden behind the nav**
- Files: `CartDrawer.js` (~l.18), `BottomNav.js` (~l.51), `GameButton.js` (~l.19-20). Correct reference: `Product.js` (~l.96, `bottom-20`).
- Problem: three fixed elements overlap. Cart bar (`fixed bottom-3`, z-30) sits under the nav (`bottom-0`, z-40), and the 60×60 floating button lands on the "Commander" button.
- Do: raise the cart bar above the nav (offset = nav height + safe-area + margin) with a higher z-index. Hide or move the floating button while the cart bar is visible.
- Validate: at 390 px with one item in the cart, "Commander" is fully visible and clickable (`document.elementFromPoint` at the button centre returns the button).

**T1.2 Step counter reads "Étape 4 / 3"**
- Files: `Checkout.js` (~l.160), `translations.js` (~l.64), `CheckoutSteps.js` (~l.4-5).
- Problem: `n = step + 1` reaches 4 while "/ 3" is hardcoded, and 4 screens render across 3 stages.
- Do: 4 named steps using the existing `checkout.stepVerify`, `stepMethod`, `stepPay`, `stepConfirm` keys. The total comes from a parameter, not a hardcoded digit in the translation.
- Validate: walking the whole checkout, the counter goes 1/4 → 4/4 and the highlighted stage matches the screen.

**T1.3 USSD instructions never rendered**
- File: `StepPay.js` (~l.31-51). Keys already translated FR/EN: `checkout.ussdCode`, `ussdAmount`, `ussdSteps`, `ussdNote`, `ussdNext`.
- Problem: only the merchant number and a `tel:` link are shown. Without telephony (tablet, desktop) payment is impossible.
- Do: show the USSD code, the amount, the steps and the note. Add a copy button for the code. Keep `tel:` as a secondary action.
- **Do not invent a USSD code.** Use what the code or the backend already provides. If the datum does not exist, ask.
- Validate: the payment screen shows code, amount and steps in both languages, without depending on the `tel:` link.

**T1.4 Payment status**
- File: `PaymentStatus.js` (~l.43).
- Problems: `background: "${color}1a"` with `color = "var(--mvola)"` yields invalid CSS; `order.total.toLocaleString("fr-FR")` ignores the active language.
- Do: use `color-mix(in srgb, var(--mvola) 10%, transparent)`. Format per the active language. Add `aria-live="polite"` on the status message.
- Validate: the icon circle has a visible background; the amount format changes in English.

**T1.5 Build without a backend URL = white screen**
- Files: craco config or a `prebuild` script, `Home.js` (~l.243), app entry point.
- Problem: without `REACT_APP_BACKEND_URL`, axios calls `undefined/api` and `Home.js` crashes (`s.filter is not a function`) — a blank page with no message.
- Do: (1) fail the build with a clear message when the var is missing, (2) guard the `.filter` calls with `Array.isArray`, (3) add a global Error Boundary with a readable FR/EN message.
- Validate: `yarn build` without the var fails with an explicit message. With an API that errors, the page shows an error state, not a white screen.

### Phase 2 — Readable dark mode (1 day)

Goal: zero contrast failures, in light and dark.

**T2.1 Fixed foreground token for neon surfaces**
- Files: `index.css` (token definitions), `ProductCard.js` (~l.89 and every text on `bg-neo`).
- Problem: fixed neon background `#C5FE02` + `text-foreground`, which becomes cream in dark mode → 1.04:1.
- Do: create `--neo-card-fg` (fixed dark ink, identical in both themes) and use it for the title, the figure, the unit, the "Populaire" badge and the type badge.
- Validate: product cards readable in both themes, ≥ 4.5:1 for normal text.

**T2.2 Black panels turn cream**
- Files: `index.css` (`.panel-black`, `.text-primary`, remap block ~l.175-222), `Home.js` (~l.66, 69, 80, 85, 89, 293).
- Problem: `.panel-black` = `bg-foreground`, so it is cream in dark mode. `.dark .text-primary` becomes neon on cream → 1.06:1.
- Do: `.panel-black` becomes a **fixed** ink surface (black in both themes) with fixed cream text. Neon is used **only** on ink surfaces, via an explicit class (e.g. `text-neo-on-ink`).
- **Do not make `.text-primary` neon everywhere** — neon on a cream background is unreadable.
- Validate: "JEUX DISPONIBLES", "COMMENT ÇA MARCHE", "Ouvrir le chat" and the "02" card stay black in dark mode with readable text.

**T2.3 White logo plate**
- File: `GameButton.js` (~l.32, `backgroundColor: "#FFFFFF"`).
- Do: theme-dependent background via a token — no white box on the black nav in dark mode.

**T2.4 Automated contrast audit**
- New file: `frontend/scripts/audit-contrast.mjs` (Playwright or Puppeteer — add as a devDependency only after agreement).
- Do: load the key pages (home, catalogue, checkout) at 390 px and 1440 px, in light and dark themes; list text elements below 4.5:1 (3:1 for large text); exit non-zero if any are found.
- Validate: 0 failures across the 4 combinations. Add the command to the README.

### Phase 3 — Accessibility and fonts (2 days)

**T3.1 Accessible names** — `Header.js` (~l.94): the account link has no name; add `aria-label` via `t()`. Sweep every `size="icon"` button.

**T3.2 Chat button keyboard-operable** — **REMOVED (2026-10-20).** `components/chat/FloatingChat.js` is not imported anywhere: the floating chat button does not exist in the running app. The task is moot until the component is wired up. The dead code is scheduled for removal in Phase 5 (T5.7).

**T3.3 Focus in dialogs** — `GameSelector.js` (~l.41-54), `AdminBottomNav.js` (~l.90-101), `FloatingChat.js` (~l.53). Use the Radix `Dialog` already present (focus trap, initial focus, focus restore) instead of the hand-rolled `role="dialog"`.

**T3.4 Touch targets ≥ 44 px** — header cart button and account link (36), favourite heart (32), add-to-cart (40), quantity buttons (28), filter chips (35), search field (40), cart-drawer close (`ui/sheet.jsx` ~l.53-58). Enlarge the hit area (padding or `min-h`/`min-w`); the visual may stay small.

**T3.5 Page skeleton** — skip link "Aller au contenu", `<main id="main">`, focus moved to `<main>` on route change.

**T3.6 Local fonts** — `public/index.html` (~l.30) loads Google Fonts. Install `@fontsource-variable/bricolage-grotesque` and `@fontsource-variable/onest`, import them, drop the Google link, add a `size-adjust` fallback. Check that `public/sw.js` caches the fonts.

### Phase 4 — Content and states (1–2 days)

**T4.1 Missing translations** — `ProductCard.js` (~l.27-29, 58-59, 63, 110, 113, 116): "Prime+", "Évolutif", "UC", "mois", "Populaire", "Elite Pack", "Abonnement", "Indisponible", "Retirer du panier", "au panier". FR and EN for every key. **The chat files are out of scope for this task** (`Chat.js`, `ChatWorkspace.js`, `ChatThread.js`, ~28 strings) — the 4 chat files are still hardcoded French, but the floating chat they belong to is not mounted (see T5.7); revisit them only if the chat is actually wired into the app.

**T4.5 Locale-aware amounts** — `formatAr()` in `src/lib/api.js` is hardcoded `fr-FR`, so every amount in the app is
"2 500 Ar" even in English. Change it to `formatAr(n, locale = "fr-FR")` and pass the active language at the call
sites. **Known temporary inconsistency (introduced by T1.4, resolved here):** the payment-status screen
(`components/store/PaymentStatus.js`) formats its total with `Intl.NumberFormat(lang)` → "2,500 Ar" in EN, while the
cart and the order summary next to it still show "2 500 Ar" because they go through `formatAr`. The two disagree on the
same screen until this task is done. `formatAr` was deliberately left untouched during T1.4 because that task's file
list was `PaymentStatus.js` only.

**T4.2 Catalogue duplicate** — `Catalog.js` (~l.183, 191, 194): "Les plus choisis" and "Packs UC" show the same 3 cards. Apply the `popularIds` dedupe that is already computed.

**T4.3 Heading hierarchy** — `ProductCard.js` (~l.100): titles are `h2` inside `h2` sections → make them `h3`. `Account.js` (~l.82): section titles must be real `h2`.

**T4.4 Loading / empty / error** — `Events.js` (~l.34) shows "Aucun événement" while loading. `Loyalty.js` (~l.97, 105) turns an API error into a 0 balance. `Home.js` (~l.238) swallows the error. Create 3 distinct states (skeleton, empty, error with a "Réessayer" button).

### Phase 5 — Design-system coherence (2 days)

**T5.1 Dead code cleanup** — delete `src/styles/product-card.css` (duplicate), `rounded-neo`, `.neo-card-radius`, the unused `--neo-*` variables.

**T5.2 Radius scale** — reduce to 4 or 5 values (e.g. 6, 10, 16, 28, pill). Replace arbitrary px radii with those values.

**T5.3 Type scale** — remove 8 px and 9 px, raise 10 px to 11 px, route the 44 `text-[11px]` declarations through `.eyebrow`.

**T5.4 Remap table** — (`index.css` ~l.175-222, outside `@layer`). Remove it progressively (one class family per commit) and replace usages with tokens (`--warning`, `--success`, `--danger`, `--info`, elevations). Leaking families: `rose`, `amber`, `emerald`, `sky`, `slate`.

**T5.5 Borders** — the brutalist identity must NOT go everywhere. 2 px ink border only on actionable elements: product cards, primary buttons, one or two key panels. Other surfaces keep thin but **visible** rules (≥ 3:1). Replace the `border-foreground` remap (~15% opacity) with an explicit `--rule` token.

**T5.6 Hardcoded colours** — the 71 `text-[#0A0A0A]` → `text-primary-foreground`. Unify the 5 dark greys. Align the theme colour between `ThemeToggle.js` (~l.13) and `public/index.html` (~l.14).

**T5.7 Delete the confirmed dead chat components** — `components/chat/FloatingChat.js` and `components/chat/ChatLink.js`. **Confirmed dead (2026-10-20):** each is referenced only by its own definition, there is no `import()` and no `React.lazy` anywhere in `src/`, the `/chat` route renders `pages/Chat.js` → `ChatWorkspace` and `/admin/messages` → `pages/admin/AdminChat.js` → `ChatWorkspace`, and the built bundle contains 0 occurrences of their strings (CRA tree-shook them out). **Do not delete them before this task is picked up** — until then they stay untouched.

---

## Part C — Prompts to paste into opencode

### Session start (adapt per phase)

```
Read AGENTS.md, then plan-frontend-minimax.md (Part B, Phase 1 only).

Work on branch phase-1-paiement (create it if missing).

Do ONE task at a time, in order: T1.1, T1.2, T1.3, T1.4, T1.5.
For each task:
1. Read the files involved and summarise in 3 lines what you found (confirm the problem, or say what differs
   from the description).
2. Propose the change in a few lines and wait for my "ok".
3. Apply, run `cd frontend && yarn build`, commit.
4. Report in the AGENTS.md format.

Never move to the next task without my approval. If a datum is missing (USSD code, translation string), stop
and ask.
```

### Single task (use when the agent drifts)

```
Task: T1.1 (mobile cart bar hidden) only.
Allowed files: CartDrawer.js, BottomNav.js, GameButton.js.
Touch nothing else.
Success criterion: at 390 px wide, with one item in the cart, the "Commander" button is visible and clickable,
with no overlap against the bottom nav or the floating button.
Read the 3 files first, then explain your plan before editing.
```

### End-of-phase review (fresh session)

```
Re-read AGENTS.md and Phase N of plan-frontend-minimax.md.
Do a read-only review of the branch diff against main (git diff main).
For each task in the phase: say done, partial or missing, with file and line as evidence.
Also list any out-of-scope change. Do not modify any file.
```

---

## Operating notes

- Keep sessions short: one phase per session; restart from scratch if the agent starts repeating or drifting.
- Always ask for a summary of what it found before it writes code — that is where contradictions show up.
- Validate on a real phone after each phase, not just the build.
- If a task fails twice, split it into two smaller ones instead of re-explaining.
- A stronger model (Claude Code) can run the end-of-phase review — the author does not review their own work well.
