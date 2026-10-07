# Build everything, then ship only the server and what it needs.
# Build from the repository root: docker build -f advanced/deploy/Dockerfile -t roommix .
FROM node:24-alpine AS build
WORKDIR /app
RUN npm install -g pnpm@12
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY core/package.json core/
COPY server/package.json server/
COPY simulator/package.json simulator/
COPY advanced/cli/package.json advanced/cli/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm --filter @roommix/server deploy --prod /deploy

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 STATIC_DIR=/app/public
COPY --from=build /deploy /app
COPY --from=build /app/simulator/dist /app/public
EXPOSE 8080
USER node
CMD ["node", "dist/main.js"]
