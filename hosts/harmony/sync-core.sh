#!/usr/bin/env bash
# hosts/harmony/sync-core.sh —— ★核心移植副本的**字节级同步检查**（防漂移）
#
# 【为什么需要】鸿蒙工程里的 `entry/src/main/ets/core/app-stack.ts` 是
#   `packages/router/src/app-stack.ts` 的**移植副本**（ArkTS 工程与 pnpm workspace
#   是两套构建；本文件零运行时依赖 ⇒ 副本是成本最低的落地形态）。
#   ★副本会漂移——上游改了而副本没跟上，两端行为分歧且**静默**。本脚本把这件事变成机器判据。
#
# 判据（双向）：除**声明的移植差异**外，两份文件必须逐字节相同。
#   声明的差异（恰好两处，各带标记）：
#     ① 头部：插入移植说明块（以 `// ★★★本文件 = ` 开头到 import 行为止）
#     ② import 行：3 处 `import type` 合并为 1 行（指向本地 app-stack-types.ts）
# 用法：bash hosts/harmony/sync-core.sh   （退出码 0 = 已同步；1 = 漂移）
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
UPSTREAM="$ROOT/packages/router/src/app-stack.ts"
PORTED="$HERE/host-app/entry/src/main/ets/core/app-stack.ts"

[ -f "$UPSTREAM" ] || { echo "✗ 缺上游文件：$UPSTREAM"; exit 2; }
[ -f "$PORTED" ] || { echo "✗ 缺移植副本：$PORTED"; exit 2; }

python3 - "$UPSTREAM" "$PORTED" <<'PY'
import sys, re
up = open(sys.argv[1]).read()
po = open(sys.argv[2]).read()

# ① 还原移植副本：去掉移植说明块 + 把合并的 import 行还原成上游三行
po_restored = re.sub(
    r'// ─+ 鸿蒙移植差异（唯一一处；sync-core\.sh 双向校验）─+\n(?:.*?\n)*?'
    r'// ─+\nimport type \{ RouteParams, RouteTransition, KeepAliveTier \} from \'\./app-stack-types\'\n',
    "import type { RouteParams } from './types'\nimport type { RouteTransition } from './transforms/transform-transition'\nimport type { KeepAliveTier } from './types'\n",
    po, count=1)
if po_restored == po:
    print('✗ 移植副本的头部/import 结构与预期不符（同步检查无法归一）——人工核对')
    sys.exit(1)

# ② 比对（逐字节）
if po_restored != up:
    import difflib
    diff = list(difflib.unified_diff(up.split('\n'), po_restored.split('\n'),
                                     'upstream', 'ported(restored)', lineterm='', n=1))
    print('✗ 核心副本已漂移——上游改了而鸿蒙副本没同步（或反之）。')
    print('  修法：cp packages/router/src/app-stack.ts → 鸿蒙工程 + 重做两处移植差异（见 sync-core.sh 头注）。')
    print('  差异摘要（前 30 行）：')
    for l in diff[:30]:
        print('   ', l)
    sys.exit(1)
print('✓ 鸿蒙核心副本与上游逐字节一致（含声明的两处移植差异）')
PY
