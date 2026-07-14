#!/bin/bash
set -e

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$SCRIPT_DIR"

# === Harbor 配置 ===
HARBOR_HOST="harbor.192.168.9.220.nip.io"
HARBOR_USER="admin"
HARBOR_PASS="Developer200"
HARBOR_PROJECT="library"
IMAGE_NAME="pi-web"

# 版本号：从 package.json 提取，或用时间戳
VERSION=$(node -p "require('./package.json').version" 2>/dev/null || date +%Y%m%d)

echo "=== pi-web 镜像构建与推送 ==="
echo "Harbor: ${HARBOR_HOST}/${HARBOR_PROJECT}/${IMAGE_NAME}"
echo "Version: ${VERSION}"
echo ""

# 登录 Harbor
echo "=== 登录 Harbor ==="
echo "${HARBOR_PASS}" | docker login "${HARBOR_HOST}" -u "${HARBOR_USER}" --password-stdin

# 构建 amd64 镜像
echo ""
echo "=== 构建镜像 (linux/amd64) ==="
docker buildx build \
  --platform linux/amd64 \
  -t "${HARBOR_HOST}/${HARBOR_PROJECT}/${IMAGE_NAME}:${VERSION}" \
  -t "${HARBOR_HOST}/${HARBOR_PROJECT}/${IMAGE_NAME}:latest" \
  --load \
  .

# 推送到 Harbor
echo ""
echo "=== 推送镜像 ==="
docker push "${HARBOR_HOST}/${HARBOR_PROJECT}/${IMAGE_NAME}:${VERSION}"
docker push "${HARBOR_HOST}/${HARBOR_PROJECT}/${IMAGE_NAME}:latest"

echo ""
echo "=== 完成 ==="
echo "镜像地址:"
echo "  ${HARBOR_HOST}/${HARBOR_PROJECT}/${IMAGE_NAME}:${VERSION}"
echo "  ${HARBOR_HOST}/${HARBOR_PROJECT}/${IMAGE_NAME}:latest"
echo ""
echo "docker-compose.yml 使用:"
echo "  image: ${HARBOR_HOST}/${HARBOR_PROJECT}/${IMAGE_NAME}:${VERSION}"