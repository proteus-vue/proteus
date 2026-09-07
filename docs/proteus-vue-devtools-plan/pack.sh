#!/usr/bin/env bash
# 打包 + SHA256 校验（双通道交付）
set -e
cd "$(dirname "$0")"
rm -f proteus-vue-devtools.zip proteus-vue-devtools.zip.sha256 CHECKSUM.md

FILES=(
  01-vue-devtools-integration.md
  02-g19-revision.md
  03-positioning-update.md
  README.md
  pack.sh
)

zip proteus-vue-devtools.zip "${FILES[@]}"
sha256sum proteus-vue-devtools.zip > proteus-vue-devtools.zip.sha256
HASH=$(cat proteus-vue-devtools.zip.sha256 | awk '{print $1}')

cat > CHECKSUM.md <<EOF
# CHECKSUM

- archive: \`proteus-vue-devtools.zip\`
- sha256: \`$HASH\`
- files: ${#FILES[@]}
- generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF

echo "--- unzip -t ---"
unzip -t proteus-vue-devtools.zip

echo "--- file sizes ---"
wc -l "${FILES[@]}"
