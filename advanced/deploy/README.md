# Deployment

Everything needed to run roommix somewhere other than a laptop. None of it is
required to build, test or run the project locally.

| file | what it is |
|---|---|
| `Dockerfile` | two-stage image: build the monorepo, ship only the server and the built page. Build from the repository root: `docker build -f advanced/deploy/Dockerfile -t roommix .` (the root `.dockerignore` keeps `node_modules` and `dist` out of the context). |
| `cloudbuild.yaml` | the Cloud Build job that builds that image and pushes it to Artifact Registry. |
| `firebase.json`, `.firebaserc` | Firebase Hosting serving `public/`, a copy of `simulator/dist` that the release script makes here (Firebase only serves a folder next to its config). Hashed assets get long-lived caching. |

## How the live demo is deployed

- **Cloud Run** runs the server from the `Dockerfile` (service `roommix`,
  region `europe-west1`, project `f2f-audio-mixer`). Rooms live in the server's
  memory, so the service is pinned to one instance; Cloud Run gives it TLS,
  which is what lets phones use the microphone. It closes a WebSocket after an
  hour, and the page reconnects and rejoins on its own.
- **Firebase Hosting** serves the built simulator. That build is told where the
  mixer lives through `VITE_WS_URL`, so the page opens its WebSocket straight to
  Cloud Run; without that variable the page connects to whatever host served
  it, which is what the Docker image and `pnpm start` rely on.

With the `gcloud` and `firebase` CLIs signed in to a project that has billing,
from the repository root:

```bash
pnpm release:server   # Cloud Build builds the image, then a new Cloud Run revision
pnpm release:web      # builds the page against the Cloud Run URL and deploys Firebase Hosting
```

`pnpm release` runs both. The project and region are written into the scripts
in the root `package.json` and in `.firebaserc`; change them there for another
project. (The scripts are not called `deploy` because pnpm has a built-in
`deploy` command, which the Dockerfile uses.) Google's edge answers `/healthz`
itself on Cloud Run, so the server also answers `/health`. Anywhere else, the
server speaks plain HTTP and WebSocket: put TLS termination in front of it.
