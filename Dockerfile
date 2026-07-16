# ===== Stage 1: builder =====
FROM harbor.192.168.9.220.nip.io/library/node:22-bookworm-slim AS builder

# npm 镜像源（默认 npmmirror，国内拉包飞快；可通过 --build-arg NPM_REGISTRY=... 覆盖）
ARG NPM_REGISTRY=https://registry.npmmirror.com

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm config set registry "${NPM_REGISTRY}" \
 && npm ci

COPY . .
RUN npm run build

# ===== Stage 2: runner =====
FROM harbor.192.168.9.220.nip.io/library/node:22-bookworm-slim AS runner

# git: pi worktree/branch features need it
# 清华源：deb.debian.org 从国内出口被限速到 ~30 KB/s，跑 22 MB apt install 要 20+ 分钟
# mirrors.tuna.tsinghua.edu.cn 实测 1.6 MB/s，同一 install 40 秒搞定
RUN sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

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
# 让 os.homedir() 指向固定路径，"使用默认目录" 按钮的落点 = $HOME/pi-cwd-YYYYMMDD
# 在 docker-compose 里把这个目录挂到 host 即可跨容器重启保留
ENV HOME=/home/pi
ENV PORT=30141
ENV HOSTNAME=0.0.0.0

RUN mkdir -p /data/pi-agent /workspace /home/pi

EXPOSE 30141

ENTRYPOINT ["docker-entrypoint.sh"]
