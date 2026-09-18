#!/bin/bash
# Proteus 柔性布局方案打包脚本（双通道交付）
set -e

cd "$(dirname "$0")"
OUTPUT="proteus-fluid-layout"
rm -rf "$OUTPUT.zip"

# 用 python 生成 SHA256（macOS 无 sha256sum）
python3 - <<'PY'
import hashlib, zipfile, os

files = [
    "README.md",
    "01-fluid-layout.md",
    "02-compiler-implementation.md",
    "03-api-strict-rules.md",
    "04-five-end-runtime.md",
    "05-benchmark-batches.md",
    "architecture-update.md",
    "pack.sh",
]

with zipfile.ZipFile("proteus-fluid-layout.zip", "w", zipfile.ZIP_DEFLATED) as zf:
    for f in files:
        if os.path.exists(f):
            zf.write(f)
            print(f"  added: {f}")
        else:
            print(f"  MISSING: {f}")

# 计算 SHA256
h = hashlib.sha256()
with open("proteus-fluid-layout.zip", "rb") as f:
    h.update(f.read())
sha = h.hexdigest()
print(f"\nSHA256: {sha}")

# 写入 CHECKSUM.md
with open("CHECKSUM.md", "w") as f:
    f.write(f"# SHA256\n\n`{sha}`\n")

print("✅ done")
PY

echo ""
echo "--- 校验 ---"
python3 -c "
import zipfile
z = zipfile.ZipFile('proteus-fluid-layout.zip')
bad = z.testzip()
print('unzip -t equivalent:', 'No errors detected' if bad is None else f'ERRORS: {bad}')
for i in z.infolist():
    print(f'  {i.filename}  ({i.file_size} bytes)')
"
echo ""
ls -la proteus-fluid-layout.zip
