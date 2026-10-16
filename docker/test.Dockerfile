# Runs the complete test suite (unit + e2e + MCP integration) against the compose postgres.
#   docker compose --profile test run --rm tests
FROM node:22-alpine
WORKDIR /app
ENV NPM_CONFIG_FETCH_RETRIES=5 \
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000 \
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY mcp-server/package.json mcp-server/
RUN --mount=type=cache,target=/root/.npm npm ci
COPY api api
COPY mcp-server mcp-server
RUN npm run prisma:generate -w api
ENV NODE_ENV=test
CMD ["npm", "run", "test:all"]
