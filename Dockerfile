# PiTools multi-stage build. node-pty is a native module, so the builder
# needs a full toolchain; the runtime stage only needs the artifacts.
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# Toolchain for node-pty + any native deps of the pi coding agent.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ARG NEXT_PUBLIC_PIWEB_VERSION
ARG NEXT_PUBLIC_PI_TOOLS_VERSION
ARG NEXT_PUBLIC_APP_VERSION
ARG NEXT_PUBLIC_PI_VERSION

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN NEXT_PUBLIC_PIWEB_VERSION=${NEXT_PUBLIC_PIWEB_VERSION} \
    NEXT_PUBLIC_PI_TOOLS_VERSION=${NEXT_PUBLIC_PI_TOOLS_VERSION} \
    NEXT_PUBLIC_APP_VERSION=${NEXT_PUBLIC_APP_VERSION} \
    NEXT_PUBLIC_PI_VERSION=${NEXT_PUBLIC_PI_VERSION} \
    npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    PI_WEB_ALLOWED_HOSTS=

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash zsh curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/docker-entrypoint.sh ./docker-entrypoint.sh

RUN mkdir -p /pi-workspace /root/.pi/agent && chmod +x /docker-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["npm", "run", "start"]
