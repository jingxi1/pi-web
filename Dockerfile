# ===== Stage 1: builder =====
# 基础镜像：默认走公网 Docker Hub（`node:22-bookworm-slim`），公司内网可覆盖为
# `--build-arg BASE_IMAGE=harbor.192.168.9.220.nip.io/library/node:22-bookworm-slim`
ARG BASE_IMAGE=node:22-bookworm-slim
FROM ${BASE_IMAGE} AS builder

# npm 镜像源（默认 npmmirror，国内拉包飞快；可通过 --build-arg NPM_REGISTRY=... 覆盖）
ARG NPM_REGISTRY=https://registry.npmmirror.com
# apt 镜像源（默认 tuna；外部构建可覆盖为 `--build-arg APT_MIRROR=deb.debian.org`）
ARG APT_MIRROR=mirrors.tuna.tsinghua.edu.cn
# HTTP/HTTPS 代理（基础镜像里可能烧进了过时代理，清掉再用正确的；通过 --build-arg 传入）
ARG HTTP_PROXY=
ARG HTTPS_PROXY=

# 抹掉基础镜像里可能存在的过时代理 env（指向 .69 旧代理），按 build-arg 重新设置
ENV HTTP_PROXY=${HTTP_PROXY} \
    HTTPS_PROXY=${HTTPS_PROXY} \
    http_proxy=${HTTP_PROXY} \
    https_proxy=${HTTPS_PROXY} \
    NO_PROXY=localhost,127.0.0.1 \
    no_proxy=localhost,127.0.0.1

WORKDIR /app

# node-pty 是原生模块，npm ci 时用 node-gyp 编译，需要 python3/make/g++
# bookworm-slim 默认不带编译链，这里补上
RUN sed -i "s|deb.debian.org|${APT_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm config set registry "${NPM_REGISTRY}" \
 && npm ci

COPY . .
RUN npm run build

# ===== Stage 2: runner =====
FROM ${BASE_IMAGE} AS runner

# Multi-stage builds don't carry ARGs across stages — re-declare here.
ARG APT_MIRROR=mirrors.tuna.tsinghua.edu.cn
ARG HTTP_PROXY=
ARG HTTPS_PROXY=
ENV HTTP_PROXY=${HTTP_PROXY} \
    HTTPS_PROXY=${HTTPS_PROXY} \
    http_proxy=${HTTP_PROXY} \
    https_proxy=${HTTPS_PROXY} \
    NO_PROXY=localhost,127.0.0.1 \
    no_proxy=localhost,127.0.0.1

# git: pi worktree/branch features need it
RUN sed -i "s|deb.debian.org|${APT_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
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
# Windows host may have CRLF line endings — strip them so the shebang is valid
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh \
    && chmod +x /usr/local/bin/docker-entrypoint.sh

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
