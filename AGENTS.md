# Architecture rules

- Keep typography centralized in CSS font variables and map Tailwind font families to those variables; load web fonts through the HTML head so all pages and controls share the selected fonts without component rewrites.
- Keep heading case and emphasis in the base stylesheet (one uppercase style for h1/h2, an opt-out class for personal names) and express card emphasis with font weights, so visual polish never needs per-page markup edits.
- Reuse the evolutionary-pack offer and eligibility UI in both its dedicated page and the catalogue filter so catalogue purchases keep the same eligibility flow.