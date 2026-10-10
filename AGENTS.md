# Architecture rules

- Keep typography centralized in CSS font variables and map Tailwind font families to those variables; load web fonts through the HTML head so all pages and controls share the selected fonts without component rewrites.
- Reuse the evolutionary-pack offer and eligibility UI in both its dedicated page and the catalogue filter so catalogue purchases keep the same eligibility flow.