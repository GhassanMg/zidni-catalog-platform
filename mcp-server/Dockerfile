# Build context: repository root.
#   docker build -f mcp-server/Dockerfile -t zidni-mcp .

FROM node:22-alpine AS base
WORKDIR /app
ENV NPM_CONFIG_FETCH_RETRIES=5 \
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000 \
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000

FROM base AS build
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY mcp-server/package.json mcp-server/
RUN --mount=type=cache,target=/root/.npm \
    npm ci --workspace mcp-server --include-workspace-root
COPY mcp-server mcp-server
RUN npm run build -w mcp-server

FROM base AS runtime
ENV NODE_ENV=production \
    MCP_TRANSPORT=http \
    MCP_HTTP_HOST=0.0.0.0 \
    MCP_HTTP_PORT=3001
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY mcp-server/package.json mcp-server/
RUN --mount=type=cache,target=/root/.npm \
    npm ci --workspace mcp-server --include-workspace-root --omit=dev
COPY --from=build /app/mcp-server/dist mcp-server/dist

WORKDIR /app/mcp-server
USER node
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3001/health > /dev/null || exit 1
CMD ["node", "dist/index.js"]
