# MagicGameStore — Frontend

This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app) and is driven by [CRACO](https://craco.js.org/).

## Install & build (authoritative)

**Yarn is the single authoritative package manager for this app.** `frontend/yarn.lock` is the
only lockfile that must be committed; do not add a `package-lock.json`.

```bash
cd frontend
yarn install --frozen-lockfile   # reproducible install — required
yarn build                       # production build
yarn test:ci                     # run the test suite once (CI mode)
```

Why yarn and not npm:

- The dependency graph relies on yarn's `resolutions` field to pin transitive versions
  (e.g. `webpack-dev-server`, `postcss`, `serialize-javascript`). npm ignores `resolutions`,
  so `npm install` resolves a different, broken tree.
- `npm install` also fails outright with `ERESOLVE` (peer conflict `react-day-picker@8` vs
  `date-fns@4`). Even with `--legacy-peer-deps` it hoists `ajv-keywords@5` next to `ajv@6`,
  which breaks the build with `Cannot find module 'ajv/dist/compile/codegen'`. This cannot be
  repaired with npm `overrides`, because `ajv-keywords`'s `ajv` is a **peerDependency** and
  npm overrides do not rewrite peer ranges — so npm is not a supported install path here.

> Build memory: the production build needs a bounded Node heap in constrained containers.
> If the build is killed with "the process exited too early", run
> `NODE_OPTIONS=--max-old-space-size=1536 yarn build`.

## Available Scripts

In the project directory, you can run:

### `npm start`

Runs the app in the development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in your browser.

The page will reload when you make changes.\
You may also see any lint errors in the console.

### `npm test`

Launches the test runner in the interactive watch mode.\
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `npm run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\
Your app is ready to be deployed!

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

### `npm run eject`

**Note: this is a one-way operation. Once you `eject`, you can't go back!**

If you aren't satisfied with the build tool and configuration choices, you can `eject` at any time. This command will remove the single build dependency from your project.

Instead, it will copy all the configuration files and the transitive dependencies (webpack, Babel, ESLint, etc) right into your project so you have full control over them. All of the commands except `eject` will still work, but they will point to the copied scripts so you can tweak them. At this point you're on your own.

You don't have to ever use `eject`. The curated feature set is suitable for small and middle deployments, and you shouldn't feel obligated to use this feature. However we understand that this tool wouldn't be useful if you couldn't customize it when you are ready for it.

## Learn More

You can learn more in the [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started).

To learn React, check out the [React documentation](https://reactjs.org/).

### Code Splitting

This section has moved here: [https://facebook.github.io/create-react-app/docs/code-splitting](https://facebook.github.io/create-react-app/docs/code-splitting)

### Analyzing the Bundle Size

This section has moved here: [https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size](https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size)

### Making a Progressive Web App

This section has moved here: [https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app](https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app)

### Advanced Configuration

This section has moved here: [https://facebook.github.io/create-react-app/docs/advanced-configuration](https://facebook.github.io/create-react-app/docs/advanced-configuration)

### Deployment

This section has moved here: [https://facebook.github.io/create-react-app/docs/deployment](https://facebook.github.io/create-react-app/docs/deployment)

### `npm run build` fails to minify

This section has moved here: [https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify](https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify)
