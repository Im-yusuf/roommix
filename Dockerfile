# Build everything, then ship only the server and what it needs.
FROM node:24-alpine AS build
WORKDIR /app
RUN npm install -g pnpm@12
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/cli/package.json packages/cli/
COPY apps/simulator/package.json apps/simulator/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm --filter @roommix/server deploy --prod /deploy

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 STATIC_DIR=/app/public
COPY --from=build /deploy /app
COPY --from=build /app/apps/simulator/dist /app/public
EXPOSE 8080
USER node
CMD ["node", "dist/main.js"]
