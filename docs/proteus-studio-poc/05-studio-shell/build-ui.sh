#!/usr/bin/env bash
# 构建 Studio 壳（Vue 3 + Vite）→ web-dist/
# ★本目录不是 pnpm workspace 成员（pnpm-workspace.yaml 只含 packages/*、website、examples…），
#   所以直接借用仓库根的 vite / vue / @vitejs/plugin-vue，不在这里装第二套 node_modules。
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# 用 git 定位仓库根（比数 ../../.. 稳：本文件所在层级变过两次）
ROOT="$(git -C "$HERE" rev-parse --show-toplevel)"
exec "$ROOT/node_modules/.bin/vite" build --config "$HERE/vite.config.mjs"
