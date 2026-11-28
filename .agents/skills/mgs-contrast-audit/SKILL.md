---
name: mgs-contrast-audit
description: Run the Magic Game Store WCAG contrast audit — load after any colour/theme change, and always after a merge into main, before deploying.
---

# Contrast audit

1. `cd frontend`, export `REACT_APP_BACKEND_URL`, then `nice -n 10 yarn build` (the audit reads the compiled bundle).
2. `CHROMIUM_PATH=<path to an installed Chromium> yarn audit:contrast` — it downloads nothing and stops without the variable.
   It measures painted contrast on key pages at 390 px and 1440 px, light and dark, and exits non-zero while any failure remains.
3. **After every merge into `main`, re-run it on `main`.** The audit checks the merge result, not the branch:
   PR #43 was at 0 failures on its branch and caused 24 on `main` (cream price on white card in dark mode).
4. Never loosen the script to reach 0. Every measurement exclusion is listed at the top of the script with its reason;
   a new exclusion goes there too.
