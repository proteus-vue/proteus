#!/bin/bash
# Proteus 柔性布局本质定位（G-22 补充）打包脚本
set -e
cd /data/workspace/proteus-fluid-layout-essence

rm -f proteus-fluid-layout-essence.zip

# 标准 zip，去除 macOS/Unix 额外属性，跨平台兼容
zip -X proteus-fluid-layout-essence.zip \
    01-fluid-vs-rpx.md \
    02-system-capability-mapping.md \
    pack.sh

echo "=== 打包完成 ==="
ls -la proteus-fluid-layout-essence.zip
unzip -t proteus-fluid-layout-essence.zip

echo ""
echo "=== SHA256 ==="
shasum -a 256 proteus-fluid-layout-essence.zip
