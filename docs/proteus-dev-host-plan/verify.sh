#!/usr/bin/env bash
# G-45 dev-host 参考实现自检（装载即验证 / pending 回放 / 热升级 / 双层构建缓存）
# 用法：bash verify.sh   （对照原则：机器证据而非口头宣称）
set -e
cd "$(dirname "$0")"

echo "== G-45 dev-host self-test =="
node dev-host-reference.cjs --self-test

echo ""
echo "== 结论 =="
echo "全部检查通过：基座常驻 0 重打 + pending 回放 + 热升级 + 门禁链（签名/conformance/覆盖率）+ 双层构建缓存 O(改动)"
