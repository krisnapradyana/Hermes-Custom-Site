FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* values are baked into the client bundle at BUILD time.
ARG NEXT_PUBLIC_AUTH_ENABLED=true
ENV NEXT_PUBLIC_AUTH_ENABLED=$NEXT_PUBLIC_AUTH_ENABLED
ARG NEXT_PUBLIC_DRIVE_BASE="G:\\My Drive\\"
ENV NEXT_PUBLIC_DRIVE_BASE=$NEXT_PUBLIC_DRIVE_BASE
ARG NEXT_PUBLIC_DRIVE_MOUNT_BASE="/gdrive/"
ENV NEXT_PUBLIC_DRIVE_MOUNT_BASE=$NEXT_PUBLIC_DRIVE_MOUNT_BASE
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
CMD ["node", "server.js"]
