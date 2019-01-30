# lockmaker

`lockmaker` is an NPM package designed to facilitate the offline installation of NPM packages. Its focus is providing a standard `npm install`-compatible process without requiring additional tooling or steps, and which doesn't require a separate compilation step to produce an offline-compatible version of a package.

The primary use case is mapping a project lacking a premade `node_modules` directory into an unmodified node.js container without network access and expecting `npm install --production` to get it into a usable state.
