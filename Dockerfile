FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# npm ci only: a lockfile mismatch should FAIL the build, not silently float.
RUN npm ci --no-audit --no-fund

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* values are baked into the client bundle at BUILD time.
ARG NEXT_PUBLIC_AUTH_ENABLED=true
ENV NEXT_PUBLIC_AUTH_ENABLED=$NEXT_PUBLIC_AUTH_ENABLED
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# fs calls run on the libuv threadpool (default 4). Slow Drive-mount reads
# must never starve the rest of the app, so give them room.
ENV UV_THREADPOOL_SIZE=32
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
# Server state lives here — MUST be a mounted volume or it dies with the container.
ENV DATA_DIR=/app/data
RUN mkdir -p /app/data && chown node:node /app/data
VOLUME /app/data
# Never run a network-facing Node process as root.
USER node
EXPOSE 3000
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/hermes/health >/dev/null 2>&1 || exit 1
CMD ["node", "server.js"]
