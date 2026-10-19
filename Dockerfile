# Sahynex OS container image (web app and worker share one image).
# NOTE: written for production use but NOT built in the original build environment (registry access was blocked).
FROM node:22.22.0-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22.22.0-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx next build

FROM node:22.22.0-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN useradd --system --uid 1001 sahynex && mkdir -p /var/lib/sahynex/storage && chown sahynex /var/lib/sahynex/storage
COPY --from=build --chown=sahynex /app ./
USER sahynex
EXPOSE 3000
# Web: npx next start -p 3000 · Worker: npx tsx src/worker/index.ts · Migrations: npx tsx src/db/migrate.ts
CMD ["npx", "next", "start", "-p", "3000"]
