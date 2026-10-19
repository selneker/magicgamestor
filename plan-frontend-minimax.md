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

**T3.2 Chat button keyboard-operable** — `FloatingChat.js` (~l.29-43): add `onClick` (the keyboard does not fire `pointerup`), keep the drag. `aria-label` via `t()`.

**T3.3 Focus in dialogs** — `GameSelector.js` (~l.41-54), `AdminBottomNav.js` (~l.90-101), `FloatingChat.js` (~l.53). Use the Radix `Dialog` already present (focus trap, initial focus, focus restore) instead of the hand-rolled `role="dialog"`.

**T3.4 Touch targets ≥ 44 px** — header cart button and account link (36), favourite heart (32), add-to-cart (40), quantity buttons (28), filter chips (35), search field (40), cart-drawer close (`ui/sheet.jsx` ~l.53-58). Enlarge the hit area (padding or `min-h`/`min-w`); the visual may stay small.

**T3.5 Page skeleton** — skip link "Aller au contenu", `<main id="main">`, focus moved to `<main>` on route change.

**T3.6 Local fonts** — `public/index.html` (~l.30) loads Google Fonts. Install `@fontsource-variable/bricolage-grotesque` and `@fontsource-variable/onest`, import them, drop the Google link, add a `size-adjust` fallback. Check that `public/sw.js` caches the fonts.

### Phase 4 — Content and states (1–2 days)

**T4.1 Missing translations** — `ProductCard.js` (~l.27-29, 58-59, 63, 110, 113, 116): "Prime+", "Évolutif", "UC", "mois", "Populaire", "Elite Pack", "Abonnement", "Indisponible", "Retirer du panier", "au panier". Then the 4 chat files (`Chat.js`, `ChatWorkspace.js`, `ChatThread.js`, `FloatingChat.js`, ~28 strings). FR and EN for every key.

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
