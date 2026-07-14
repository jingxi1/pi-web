#!/bin/bash
set -e

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$SCRIPT_DIR"

case "${1:-}" in
  sync)
    echo "=== 从上游同步 ==="
    git fetch upstream
    echo ""
    echo "上游更新列表:"
    git log --oneline HEAD..upstream/main
    echo ""
    read -p "确认合并? [y/N] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
      git merge upstream/main
      echo ""
      echo "=== 同步完成 ==="
    else
      echo "已取消"
    fi
    ;;

  push)
    echo "=== 推送到所有远程仓库 ==="
    echo "→ GitHub (origin)"
    git push origin main
    echo "→ GitLab (gitlab)"
    git push gitlab main
    echo ""
    echo "=== 推送完成 ==="
    ;;

  status)
    echo "=== 当前远程配置 ==="
    git remote -v
    echo ""
    echo "=== 当前分支状态 ==="
    git status
    echo ""
    echo "=== 上游距离 ==="
    git log --oneline HEAD..upstream/main --count 2>/dev/null || echo "无上游"
    ;;

  *)
    echo "用法:"
    echo "  $0 sync    → 从上游 agegr/pi-web 同步更新"
    echo "  $0 push    → 推送到 GitHub + GitLab"
    echo "  $0 status  → 查看状态"
    echo ""
    echo "远程仓库:"
    git remote -v
    ;;
esac
