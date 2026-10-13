# MagicGameStore — Frontend

This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app) and is driven by [CRACO](https://craco.js.org/).

## Install & build (authoritative)

**Yarn is the single authoritative package manager for this app.** `frontend/yarn.lock` is the only lockfile that must be committed.

```bash
cd frontend
yarn install --frozen-lockfile
yarn build
yarn test:ci
```

The dependency graph uses Yarn's `resolutions`; npm may resolve an incompatible tree. In particular, the package dependencies include peer-version combinations that have caused clean-install failures with npm. Use the committed Yarn lockfile for reproducible installs.

If the production build is killed due to memory limits in a constrained container, run:

```bash
NODE_OPTIONS=--max-old-space-size=1536 yarn build
```

## Available scripts

- `yarn start` — development server.
- `yarn build` — production build.
- `yarn test` — interactive test runner.
- `yarn test:ci` — run tests once without watch mode.

## More information

See the [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started) and [CRACO documentation](https://craco.js.org/).
