# Deployment

Everything needed to run roommix somewhere other than a laptop. None of it is
required to build, test or run the project locally.

| file | what it is |
|---|---|
| `Dockerfile` | two-stage image: build the monorepo, ship only the server and the built page. Build from the repository root: `docker build -f advanced/deploy/Dockerfile -t roommix .` (the root `.dockerignore` keeps `node_modules` and `dist` out of the context). |
| `cloudbuild.yaml` | the Cloud Build job that builds that image and pushes it to Artifact Registry. |
| `firebase.json`, `.firebaserc` | Firebase Hosting serving `public/`, a copy of `simulator/dist` that the release script makes here (Firebase only serves a folder next to its config). Hashed assets get long-lived caching. |

The root `package.json` wires them up: `pnpm release:server` (Cloud Build,
then a new Cloud Run revision), `pnpm release:web` (page built against the
Cloud Run WebSocket address, then Firebase Hosting), `pnpm release` for both.
The README's "Deploying" section explains the shape of the live deployment.
