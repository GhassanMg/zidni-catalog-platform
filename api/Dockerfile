# Build context: repository root (npm workspaces share one lockfile).
#   docker build -f api/Dockerfile -t zidni-api .

FROM node:22-alpine AS base
WORKDIR /app
# Prisma's query engine links against libssl3, which the Alpine base image already ships.
ENV NPM_CONFIG_FETCH_RETRIES=5 \
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000 \
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000

# ---- build: full dependency tree, compile TypeScript, generate Prisma client
FROM base AS build
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY mcp-server/package.json mcp-server/
RUN --mount=type=cache,target=/root/.npm \
    npm ci --workspace api --include-workspace-root
COPY api api
RUN npm run prisma:generate -w api && npm run build -w api

# ---- runtime: production dependencies only, non-root user
FROM base AS runtime
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY mcp-server/package.json mcp-server/
RUN --mount=type=cache,target=/root/.npm \
    npm ci --workspace api --include-workspace-root --omit=dev
COPY --from=build /app/api/dist api/dist
COPY api/prisma api/prisma
RUN npx --workspace api prisma generate
COPY api/docker-entrypoint.sh api/docker-entrypoint.sh
RUN chmod +x api/docker-entrypoint.sh

WORKDIR /app/api
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/api/v1/health/ready > /dev/null || exit 1
ENTRYPOINT ["./docker-entrypoint.sh"]
