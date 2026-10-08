#!/usr/bin/env bash
# hosts/ios/signing.sh —— ★★★两台电脑 iOS 签名切换（薄壳；实现与判据见 lib/ios-signing.mjs 文件头）
#
# 【这是干什么的】家里 / 办公室两台 Mac 共用同一块工作盘（本仓），而 iOS 签名资产是**每台机各一套**
#   （钥匙串证书 / Xcode 描述文件 / 登录的 Apple ID）。本工具按**主机名**记住本机该用哪套：
#     ① 每台机器上跑**一次**：bash hosts/ios/signing.sh use <账号>（例：use lyl@shxuxi.cn）
#     ② 之后 run-selfdraw.sh / provision.sh 自动按本机档选证书与描述文件（无需再记参数）。
#
# 用法：
#   bash hosts/ios/signing.sh list                # 列出钥匙串有效身份 + 本机有效描述文件 + 当前档
#   bash hosts/ios/signing.sh use <账号|SHA-1>     # 给本机**上档**（含 --bundle= / --label= 可选）
#   bash hosts/ios/signing.sh status              # 本机当前档 + 逐项校验（含"下一步"）
#   bash hosts/ios/signing.sh clear               # 清本机档（回到脚本自动模式）
#   bash hosts/ios/signing.sh resolve --shell     # 供脚本消费（一般不用手跑）
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "${HERE}/lib/ios-signing.mjs" "$@"
