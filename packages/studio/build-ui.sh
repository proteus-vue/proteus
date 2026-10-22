#!/usr/bin/env bash
# 构建 Studio 壳（Vue 3 + Vite）→ web-dist/
# 用法：./build-ui.sh   或从仓库根 `pnpm run build:studio-ui`
#
# ★本目录不是 npm 包（决策 #1187：刻意不放 package.json），所以前端依赖借仓库根的
#   vite / vue / @vitejs/plugin-vue，不在这里装第二套 node_modules。
#   （不放 package.json 的另一个原因：check:docs-stats 的包数按 `@proteus-vue/*` 统计，
#     一个非发布包混进去会让官网/文档里的包数漂移——它本来就不该被算作框架包。）
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# 用 git 定位仓库根（比数 ../../.. 稳：本文件所在层级变过两次）
ROOT="$(git -C "$HERE" rev-parse --show-toplevel)"
exec "$ROOT/node_modules/.bin/vite" build --config "$HERE/vite.config.mjs"
