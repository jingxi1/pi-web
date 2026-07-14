# ===== Stage 1: builder =====
FROM harbor.192.168.9.220.nip.io/library/node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ===== Stage 2: runner =====
FROM harbor.192.168.9.220.nip.io/library/node:22-bookworm-slim AS runner

# git: pi worktree/branch features need it
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 只拷运行时需要的产物（不拷源码、tsconfig、eslint 等）
COPY --from=builder /app/.next          ./.next
COPY --from=builder /app/node_modules   ./node_modules
COPY --from=builder /app/package.json   ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/bin            ./bin
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# pi agent 数据目录（会话、模型配置、notify.json）—— 挂载 volume 持久化
ENV PI_CODING_AGENT_DIR=/data/pi-agent
# 代码工作区目录
ENV WORKSPACE_DIR=/workspace
ENV PORT=30141
ENV HOSTNAME=0.0.0.0

RUN mkdir -p /data/pi-agent /workspace

EXPOSE 30141

ENTRYPOINT ["docker-entrypoint.sh"]
