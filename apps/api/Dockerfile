FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# Copy workspace config
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY tsconfig.base.json ./

# Copy package manifests
COPY packages/core/package.json packages/core/
COPY packages/telegram/package.json packages/telegram/
COPY apps/api/package.json apps/api/

# Install dependencies
RUN pnpm install --frozen-lockfile || pnpm install

# Copy source
COPY packages/core packages/core
COPY packages/telegram packages/telegram
COPY apps/api apps/api

# Build
RUN pnpm --filter @openbase/core build
RUN pnpm --filter @openbase/telegram build
RUN pnpm --filter @openbase/api build

# Production image
FROM node:20-alpine
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

COPY --from=builder /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=builder /app/packages/core/package.json packages/core/
COPY --from=builder /app/packages/core/dist packages/core/dist
COPY --from=builder /app/packages/telegram/package.json packages/telegram/
COPY --from=builder /app/packages/telegram/dist packages/telegram/dist
COPY --from=builder /app/apps/api/package.json apps/api/
COPY --from=builder /app/apps/api/dist apps/api/dist
COPY --from=builder /app/node_modules node_modules
COPY --from=builder /app/apps/api/node_modules apps/api/node_modules

RUN mkdir -p /app/data/indexes

EXPOSE 3001
CMD ["node", "apps/api/dist/index.js"]
