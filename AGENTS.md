# Magic Game Store

- Frontend agent: never change `backend/`, payment logic or API calls. Backend agent: load `mgs-backend-reference`.
- Only touch the files the task names. No refactor beyond the task, no renames, no unlisted dependency. If another file needs a change, stop and say so.
- If a spec is ambiguous or you can't find what it describes, stop and ask (overrides the global "decide and continue").
- Export `REACT_APP_BACKEND_URL` before `yarn build` / `yarn start`: without it the build succeeds but ships a broken bundle (white home page).
- Every user-visible string goes through `t()` with an FR and an EN key. French is the default language.
- Colours only through existing CSS tokens. Touch targets ≥ 44×44 px. Many customers are on a 390 px screen on a slow network.
- Before touching any style or class name, load `mgs-design-system`: Tailwind classes do not render what they say here.
- Done = `yarn build` then `yarn test:ci` pass, one commit `fix(zone): short description`, short report (files, what, how verified, open points).
