#!/usr/bin/env bash
# cache_fetch.sh —— 远程资源「一次拉取 → 本地缓存 → 复用 → 用完清理」
#
# 用法:
#   # 仓库：浅层 + 稀疏拉取，输出缓存路径（stdout），重复调用直接命中缓存
#   cache_fetch.sh --repo <url> [--ref main] [--subdir src,docs] [--name <id>]
#   # URL / API 响应：命中缓存直接输出内容，未命中则拉取并落盘
#   cache_fetch.sh --url <url> [--timeout 15]
#   # 清理：删除单个缓存项 / 全部缓存
#   cache_fetch.sh --clean <name>
#   cache_fetch.sh --clean-all
#   # 查看缓存清单
#   cache_fetch.sh --list
#
# 约定:
#   - 缓存根统一为 ${CACHE_ROOT:-.cache/ai-external}
#   - 同一资源在同一任务内路径恒定，避免重复下载
#   - 资源不再被引用时应立即清理，而不是等任务结束

set -uo pipefail

CACHE_ROOT=${CACHE_ROOT:-.cache/ai-external}
MODE=""
REPO=""; REF="main"; SUBDIR=""; NAME=""
URL=""; TIMEOUT=15

usage() { sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }

[[ $# -eq 0 ]] && usage
while [[ $# -gt 0 ]]; do
  case $1 in
    --repo) MODE=repo; REPO=${2:?--repo 需要 URL}; shift 2;;
    --ref) REF=${2:?}; shift 2;;
    --subdir) SUBDIR=${2:?}; shift 2;;
    --name) NAME=${2:?}; shift 2;;
    --url) MODE=url; URL=${2:?--url 需要 URL}; shift 2;;
    --timeout) TIMEOUT=${2:?}; shift 2;;
    --clean) MODE=clean; NAME=${2:?--clean 需要缓存名}; shift 2;;
    --clean-all) MODE=clean-all; shift;;
    --list) MODE=list; shift;;
    -h|--help) usage;;
    *) echo "未知参数: $1" >&2; usage;;
  esac
done

case $MODE in
  list)
    echo "缓存根: $CACHE_ROOT"
    [[ -d $CACHE_ROOT ]] || { echo "（空）"; exit 0; }
    du -sh "$CACHE_ROOT"/*/* 2>/dev/null || find "$CACHE_ROOT" -maxdepth 2 -mindepth 1
    exit 0
    ;;
  clean)
    target="$CACHE_ROOT/$NAME"
    [[ -d $target || -f $target ]] || { echo "无此缓存项: $NAME" >&2; exit 1; }
    rm -rf "$target"; echo "已清理: $NAME"
    exit 0
    ;;
  clean-all)
    [[ -d $CACHE_ROOT ]] && rm -rf "$CACHE_ROOT"
    echo "已清理全部缓存: $CACHE_ROOT"
    exit 0
    ;;
esac

mkdir -p "$CACHE_ROOT"

if [[ $MODE == repo ]]; then
  # 生成稳定标识：owner-repo-ref
  slug=$(printf '%s' "$REPO" | sed -E 's#.*[:/]([^/]+)/([^/]+?)(\.git)?$#\1-\2#')
  [[ -n $NAME ]] && slug=$NAME
  dest="$CACHE_ROOT/github/${slug}-${REF}"

  if [[ -d $dest/.git ]]; then
    echo "HIT(cache): $dest" >&2
    echo "$dest"; exit 0
  fi

  echo "MISS: 首次拉取 $REPO@$REF -> $dest" >&2
  mkdir -p "$dest"
  git clone --depth 1 --filter=blob:none --no-checkout --branch "$REF" "$REPO" "$dest" >&2 || {
    # 分支名失败时可能是 SHA/Tag，退回 fetch 指定对象
    rm -rf "$dest"; mkdir -p "$dest"
    git -C "$dest" init -q
    git -C "$dest" remote add origin "$REPO"
    git -C "$dest" fetch --depth 1 origin "$REF" >&2 || { echo "FAIL: 拉取 $REPO@$REF" >&2; exit 1; }
  }
  if [[ -n $SUBDIR ]]; then
    git -C "$dest" sparse-checkout set ${SUBDIR//,/ } >&2
  fi
  git -C "$dest" checkout >&2 2>&1
  echo "$dest"
  exit 0
fi

if [[ $MODE == url ]]; then
  key=$(printf '%s' "$URL" | md5sum 2>/dev/null | cut -d' ' -f1 || printf '%s' "$URL" | md5)
  cache="$CACHE_ROOT/web/$key"
  mkdir -p "$CACHE_ROOT/web"
  if [[ -s $cache ]]; then
    echo "HIT(cache): $cache" >&2
    cat "$cache"; exit 0
  fi
  echo "MISS: 首次拉取 $URL" >&2
  curl -fsSL --connect-timeout 5 --max-time "$TIMEOUT" --retry 2 --retry-delay 1 "$URL" | tee "$cache" || {
    rm -f "$cache"; echo "FAIL: $URL" >&2; exit 1
  }
  exit 0
fi

usage
