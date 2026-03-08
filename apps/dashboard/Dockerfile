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
WORKDIR /app

COPY --from=builder /app/apps/dashboard/.next/standalone ./
COPY --from=builder /app/apps/dashboard/.next/static ./apps/dashboard/.next/static
COPY --from=builder /app/apps/dashboard/public ./apps/dashboard/public

EXPOSE 3000
ENV PORT=3000
CMD ["node", "apps/dashboard/server.js"]
