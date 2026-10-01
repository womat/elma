# Ein Dockerfile, drei Ziele: --target backend / --target bridge / --target push-proxy
FROM node:24-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/backend/package.json apps/backend/
COPY apps/bridge/package.json apps/bridge/
COPY apps/push-proxy/package.json apps/push-proxy/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY packages packages
COPY apps apps

FROM deps AS web-build
# Version aus git describe, gesetzt von scripts/deploy.sh bzw. docker compose
ARG ELMA_VERSION=dev
RUN ELMA_VERSION=${ELMA_VERSION} pnpm --filter @elma/web build

FROM deps AS backend
ARG ELMA_VERSION=dev
ENV ELMA_VERSION=${ELMA_VERSION}
ENV NODE_ENV=production DB_PATH=/data/elma.db WEB_DIR=/app/apps/web/dist PORT=3000
COPY --from=web-build /app/apps/web/dist apps/web/dist
RUN mkdir -p /data && chown node:node /data
WORKDIR /app/apps/backend
VOLUME /data
EXPOSE 3000
USER node
CMD ["node", "src/server.ts"]

FROM deps AS bridge
ARG ELMA_VERSION=dev
ENV ELMA_VERSION=${ELMA_VERSION}
ENV NODE_ENV=production
WORKDIR /app/apps/bridge
USER node
CMD ["node", "src/index.ts"]

FROM deps AS push-proxy
ENV NODE_ENV=production PORT=3128
WORKDIR /app/apps/push-proxy
EXPOSE 3128
USER node
CMD ["node", "src/index.ts"]
