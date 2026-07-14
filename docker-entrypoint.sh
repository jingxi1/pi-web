#!/bin/sh
set -e

# 可选：首次启动时自动 git clone 代码到 /workspace
if [ -n "$GIT_REPO_URL" ] && [ -z "$(ls -A /workspace 2>/dev/null)" ]; then
    echo "[entrypoint] Cloning $GIT_REPO_URL into /workspace ..."
    git clone --depth 1 "$GIT_REPO_URL" /workspace
    echo "[entrypoint] Clone complete."
fi

# 切到 /workspace 启动 pi-web，让 process.cwd() 指向代码目录
# 这样 pi-web 的默认 cwd 和文件浏览器从 /workspace 开始
cd /workspace

echo "[entrypoint] Starting pi-web on port ${PORT:-30141} ..."
exec node /app/bin/pi-web.js
