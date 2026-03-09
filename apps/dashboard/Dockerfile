FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY tsconfig.base.json ./
COPY apps/dashboard/package.json apps/dashboard/

RUN pnpm install --frozen-lockfile || pnpm install

COPY apps/dashboard apps/dashboard

ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @openbase/dashboard build

FROM node:20-alpine
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder /app/apps/dashboard ./apps/dashboard

EXPOSE 3000
WORKDIR /app/apps/dashboard
CMD ["pnpm", "start", "--hostname", "0.0.0.0", "--port", "3000"]
