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

# ① 前端产物（缺了就现构建，避免"打了个旧壳进去"）
if [ ! -f "$HERE/web-dist/index.html" ]; then
  echo "▸ web-dist 缺失，先构建前端"
  "$HERE/build-ui.sh"
fi

# ② Rust 二进制（release）
echo "▸ cargo build --release"
cargo build --release --quiet
BIN="$HERE/target/release/$BIN_NAME"
[ -f "$BIN" ] || { echo "✗ 找不到二进制：$BIN"; exit 1; }

# ③ 图标（icns 由脚本生成，可复现）
if [ ! -f "$HERE/icons/icon.icns" ]; then
  echo "▸ 生成图标"
  python3 "$HERE/icons/make-icon.py" >/dev/null
  iconutil -c icns "$HERE/icons/AppIcon.iconset" -o "$HERE/icons/icon.icns"
fi

# ④ 组装 .app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/$BIN_NAME"
cp "$HERE/icons/icon.icns" "$APP/Contents/Resources/icon.icns"
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

if [ "${1:-}" = "--open" ]; then
  echo "▸ 打开"
  open "$APP"
fi
