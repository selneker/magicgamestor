# Magic Game Store — Phase 1 Audit (June 2026)

Source: https://github.com/selneker/magicgamestore.git (1 commit "Mongo DB fixation", 23 files, ~7,000 lines — 60% CSS)
Live: https://magicgame.store (Render + MongoDB Atlas)

## 1. What the product actually is
A **single-game top-up shop for PUBG Mobile in Madagascar**: 14 UC packs (30 → 16,200 UC) + 8 Prime/Prime+ subscriptions, paid by MVola / Orange Money, delivered manually by the admin.
Flow: pick pack → enter PUBG ID + pseudo → USSD deep-link `tel:#111*1*2*0383905692*PRICE*1*0#` (MVola) / `tel:#144*1*1*0377519833*...#` (Orange) → user pastes SMS reference → order saved "en attente" → admin marks "livré". No customer accounts; history is looked up by PUBG ID.

## 2. Architecture
| Layer | Current | Assessment |
|---|---|---|
| Frontend | 4 static HTML pages, vanilla JS, 2,600 lines of hand-written CSS, CDN fonts/icons | No build step, no components, heavy duplication (header/footer/modals copied per page), 62 `!important` |
| Backend | Express 4 (`server.js` 613 lines, monolith) | Routes, models, auth, file I/O all in one file; `models/` folder and `db.js` exist but are **never imported** (dead code); `server.js.save` committed |
| DB | Mongoose on Atlas | Products are **hard-coded in HTML**, not in DB → admin cannot change prices/packs |
| Hosting | Render (ephemeral disk) | Logs/backups written to local FS (`orders.log`, `backup-*.json`, `users.json`) → **lost on every redeploy** |

## 3. Security findings (P0)
1. `GET /api/create-admin` — unauthenticated, rewrites `users.json` with admin hash (legacy, but still exposed).
2. `GET /api/debug-auth` — leaks `ADMIN_EMAIL` publicly.
3. `POST /api/order` trusts **client-supplied `price` and `pack`** → anyone can post a 16,200 UC order at "1 Ar".
4. Order history `GET /api/orders/user/:pubgId` is public → anyone can enumerate any player's purchases (privacy leak).
5. `POST /api/admin/restore` does `deleteMany({})` then `insertMany` with no schema validation → full data wipe risk.
6. Order `id = Date.now()` → collisions under concurrent orders (unique index → 500 error).
7. JWT in `localStorage`, 24h, no refresh/rotation; no brute-force protection on `/api/login` beyond generic 100 req/15 min limiter (which also throttles normal shoppers).
8. `helmet({contentSecurityPolicy:false})`, inline `onclick=` handlers everywhere, `innerHTML` with user-derived text in admin table (XSS surface via pseudo/reference).
9. Admin "online" status held in process memory → resets to offline on every restart/sleep (Render free tier sleeps).

## 4. Functional bugs
- `initializeAdmin()` defined twice; 2nd call runs before Mongo connects (silent error).
- Duplicate `<title>` and favicon links; `/favicon.png`, `/og-image.jpg`, `/twitter-image.jpg`, `/images/image.png` (admin) → 404.
- Header "Abonnement" icon uses `material-symbols-outlined` class but only `Material+Icons` font is loaded → renders the literal word "subscriptions" on some browsers.
- `@font-face 'Nike'` points to missing `Nike Futura ND.ttf`; `format('ttf')` is invalid anyway.
- "Export CSV" button exports JSON. Promo badge literally says `HyperCar??`. "Popu" badge is an unfinished label.
- Revenue = regex-stripped strings (`"3,000 Ar"` → 3000) — fragile; status values are accented French strings used as enum.
- `sitemap.xml` lists `#tarifs` / `#abonnements` anchors (ignored by Google).
- Likes keyed on `sessionStorage` id → resets per tab; a user can like once per tab.
- `API_URL` hard-coded to `https://magicgame.store/api` → cannot run staging/preview.

## 5. UX / UI
- Dark, PUBG-yellow hero; bottom "liquid-glass" nav on mobile is nice but forced via JS inline styles + `!important`.
- No search, no filters, no product detail, no cart (1 item per order), no account, no order tracking/notifications, no FAQ/how-to-pay guide.
- Payment modal is decent (USSD button + copy number + reference), but no confirmation screen, no order-status page, no "what happens next".
- `prompt()`/`confirm()` dialogs in admin; no order detail view; auto-refresh polling every N s.
- Admin not usable for catalog management (products live in HTML).

## 6. Performance / SEO
- Hero background JPEG **3.97 MB (3840×2160)** served un-optimised on mobile-first audience (Madagascar 3G/4G).
- `lucide@latest`, cdnfonts, FontAwesome 6.4 loaded from 4 different CDNs, no preload, no lazy load.
- Good: meta/OG tags present, `robots.txt`, canonical, `lang="fr"`.
- Missing: structured data (Product/Offer JSON-LD), per-page meta on historique/evenements, image alt text, real 404 page.

## 7. Technical debt summary
No tests, no lint, no README, no env example, dead files (`db.js`, `models/*`, `server.js.save`, `image.png` duplicates), 4 MB asset in git, French/English mixed identifiers, business rules duplicated client+server (PUBG ID length 9–13 client vs 5–20 server).

## 8. What is worth keeping (domain knowledge)
- Full price list (UC + Prime + Prime+) and "Popu" flags.
- MVola / Orange Money numbers + USSD templates (owner: Selneker Dino, 0383905692 / 0377519833).
- PUBG ID validation (digits, 9–13).
- Admin workflow: pending → delivered/cancelled, online/offline status badge, stats, export.
- Events feed (Pre-Order RP A18) with like/share.
- WhatsApp/Facebook/phone support links, brand copy ("La référence PUBG Mobile à Madagascar").
