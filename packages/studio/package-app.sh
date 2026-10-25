#!/usr/bin/env bash
# 打包成可双击运行的 macOS 应用（决策 #1184）
#
# 【为什么自己组装 .app，而不是只用 `cargo tauri build`】
#   1. 本目录**没有装 tauri-cli**（`cargo install tauri-cli` 要现编译一套，且本仓是共享仓库，
#      不适合为一个 PoC 往根 package.json 加依赖）；
#   2. Tauri 2 的生产构建会把前端资源**嵌进二进制**（`generate_context!`），
#      所以 .app 只需要「二进制 + Info.plist + 图标」三件东西，手工组装完全等价；
#   3. 脚本本身就是"产物怎么来的"的文档——比一句 `cargo tauri build` 更可复核。
#   若将来装了 tauri-cli，`cargo tauri build` 也能直接用（tauri.conf 的 bundle 段已配好）。
#
# 用法：./package-app.sh [--open]
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(git -C "$HERE" rev-parse --show-toplevel)"
APP_NAME="Proteus Studio"
BIN_NAME="proteus-studio-shell"
OUT_DIR="$HERE/build-app"
APP="$OUT_DIR/$APP_NAME.app"

cd "$HERE"

# ① 前端产物：**每次都重建**（2026-10-25 修，根因见下）
#   ★原先写的是"缺了才构建"——改了 UI 但直接跑本脚本，就会把**旧 web-dist 嵌进新二进制**，
#     而外面完全看不出来：Tauri 把资源压缩后嵌进可执行文件，`strings` grep 不到、文件 mtime 只反映
#     "链接时间"。用户实测症状：双击打开还是三天前的骨架（#1184 的包，10-22 14:32）。
#     ⇒ 一律重建（Vite 一次 ~1s，比"嵌错一次"便宜得多）。
echo "▸ 构建前端（每次重建，避免嵌入旧产物）"
"$HERE/build-ui.sh"

# ② Rust 二进制（release）
#   ★`touch src/main.rs` 不是迷信：前端资源是 `generate_context!` 这个**proc macro 在编译期**
#     读进二进制里的。若 cargo 判定该 crate 是 fresh（只改了 web-dist，cargo 不一定知道），
#     宏不会重跑 ⇒ 编出来的仍是旧 UI。碰一下主源文件强制它重编，成本 = 这一个 crate（依赖全缓存）。
#
#   ★工具链要**按能力选**，别信 PATH 上第一个 cargo / rustc（2026-10-25 实测踩到两次）：
#     ① 本机 `/opt/homebrew/bin/cargo` 是 **1.83.0**，依赖链里的 `icu_provider 2.3.1` 要 `edition2024`
#        （需 cargo ≥1.85）⇒ 直接 `cargo build` 报 `feature edition2024 is required`；
#     ② 换成 rustup 的 cargo 1.98 还不够——**cargo 会去 PATH 找 rustc**，而 `/opt/homebrew/bin/rustc`
#        是 1.83 ⇒ 报 `time@0.3.55 requires rustc 1.88`（cargo 新、rustc 旧，最难看出的一种错配）。
#     ⇒ 先把 rustup 的 bin 目录放到 PATH 最前（cargo 与 rustc 必须**同源**），再按版本兜底挑选。
#     （同 AGENTS.md §6.5 的教训：默认路径/默认工具链是坑，按"能不能干这件事"选。）
RUSTUP_BIN="$HOME/.cargo/bin"
if [ -x "$RUSTUP_BIN/cargo" ] && [ -x "$RUSTUP_BIN/rustc" ]; then
  export PATH="$RUSTUP_BIN:$PATH"
fi
CARGO_MIN="1.85.0"
pick_cargo() {
  for c in "$RUSTUP_BIN/cargo" "$(command -v cargo 2>/dev/null || true)"; do
    [ -n "$c" ] && [ -x "$c" ] || continue
    v="$("$c" --version 2>/dev/null | awk '{print $2}')"
    [ -n "$v" ] || continue
    if [ "$(printf '%s\n%s\n' "$CARGO_MIN" "$v" | sort -V | head -1)" = "$CARGO_MIN" ]; then
      echo "$c"; return 0
    fi
  done
  return 1
}
if ! CARGO="$(pick_cargo)"; then
  echo "✗ 找不到 cargo ≥ $CARGO_MIN（依赖 icu_provider 需要 edition2024；brew 的 1.83 不够）"
  echo "  装 rustup 工具链，或把 ~/.cargo/bin 放到 PATH 前面"
  exit 1
fi
echo "▸ cargo build --release（cargo $("$CARGO" --version | awk '{print $2}') · rustc $(rustc --version | awk '{print $2}')）"
touch "$HERE/src/main.rs"
"$CARGO" build --release --quiet
BIN="$HERE/target/release/$BIN_NAME"
[ -f "$BIN" ] || { echo "✗ 找不到二进制：$BIN"; exit 1; }

# ③ 图标（icns 由脚本生成，可复现）
if [ ! -f "$HERE/icons/icon.icns" ]; then
  echo "▸ 生成图标"
  python3 "$HERE/icons/make-icon.py" >/dev/null
  iconutil -c icns "$HERE/icons/AppIcon.iconset" -o "$HERE/icons/icon.icns"
fi

# ④ 组装 .app —— **原地刷新，不整包删除**（2026-10-25 修）
#   ★原先 `rm -rf "$APP"` 会一次删掉 74 个文件（Frameworks 里 65 个 dylib）⇒ 被工作区的
#     批量删除保护拦下（`SAFE_DELETE_BULK_CONFIRM_REQUIRED`），脚本中途退出、.app 没更新，
#     而 cargo 那步已经成功了 —— 又是一次"看起来构建过"的假象。
#   ⇒ 改成覆盖式：可执行文件与 plist 都是单文件覆盖，Frameworks 由 bundle-dylibs.py 幂等补齐。
#     代价：已从依赖里消失的旧 dylib 不会被自动清理（多留几十 MB，不影响运行）。
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp -f "$BIN" "$APP/Contents/MacOS/$BIN_NAME"
cp -f "$HERE/icons/icon.icns" "$APP/Contents/Resources/icon.icns"
printf 'APPL????' > "$APP/Contents/PkgInfo"

VERSION="$(python3 -c "import json;print(json.load(open('$HERE/tauri.conf.json'))['version'])")"
IDENT="$(python3 -c "import json;print(json.load(open('$HERE/tauri.conf.json'))['identifier'])")"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>zh_CN</string>
  <key>CFBundleDisplayName</key><string>$APP_NAME</string>
  <key>CFBundleExecutable</key><string>$BIN_NAME</string>
  <key>CFBundleIconFile</key><string>icon.icns</string>
  <key>CFBundleIdentifier</key><string>$IDENT</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>$APP_NAME</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.developer-tools</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
</dict>
</plist>
PLIST

# ④b 把 ffmpeg 等非系统 dylib 打进 Contents/Frameworks
#     ★不做这步，.app 只在"装了 Homebrew ffmpeg 且路径相同"的机器上能跑
python3 "$HERE/bundle-dylibs.py" "$APP"

# ⑤ 签名：ad-hoc（`-`）。★这只是让本机能跑，**不能**消除 Gatekeeper 在别人机器上的拦截
codesign --force --sign - --timestamp=none "$APP" >/dev/null 2>&1 || echo "⚠ ad-hoc 签名失败（应用通常仍可本机运行）"

# ⑥ 自检
echo "▸ 校验"
plutil -lint "$APP/Contents/Info.plist" >/dev/null && echo "  ✓ Info.plist 合法"
codesign -dv "$APP" 2>&1 | grep -E "Identifier|Signature" | sed 's/^/  /' || true
echo "  ✓ 产物：$APP"
du -sh "$APP" | sed 's/^/  /'
# ★把三个时间点摆出来："看起来构建过"和"里面是三天前的 UI"从外面分不出来，只有时间能说话
#   ★macOS 的 `stat -f` 里 `%Sm` 才是"最后修改时间"，`-t` 给的是它的格式串；
#     写成 `-f '%m-%d %H:%M:%S'` 会命中 `%m`（八进制权限）并报 `bad format`（踩过一次）。
printf '  ✓ 新鲜度：UI %s · 二进制 %s · 包内 %s\n' \
  "$(stat -f '%Sm' -t '%m-%d %H:%M:%S' "$HERE/web-dist/index.html")" \
  "$(stat -f '%Sm' -t '%m-%d %H:%M:%S' "$BIN")" \
  "$(stat -f '%Sm' -t '%m-%d %H:%M:%S' "$APP/Contents/MacOS/$BIN_NAME")"

if [ "${1:-}" = "--open" ]; then
  echo "▸ 打开"
  open "$APP"
fi
