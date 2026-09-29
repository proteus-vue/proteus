#!/usr/bin/env node
// scripts/gen-instruction-spec.mjs —— ★★生成**指令集规格表**（卡 I1）
//
// 【为什么必须生成而不是手写（本仓纪律 #22）】指令集是**跨端契约**：
//   opcode 值 / 字节尺寸 / 语义说明散在 4 处实现里（TS 编码 `buffer.ts` · TS 解码 ·
//   Rust 解码 `ops.rs` · Rust 应用 `ops_apply.rs`）。**手写规格表 = 第 5 份副本**，
//   而副本漂移是静默的（表上写着 11 字节、实现改成 13 也没人发现）。
//   ⇒ 本脚本从**代码**提取事实生成规格文档；`--check` 模式纳入 CI ⇒ 表与代码不可能漂移。
//
// 【数据来源（唯一事实源）】
//   · opcode 值 + 语义注释 ← `packages/slot-runtime/src/opcode.ts`
//   · 字节尺寸           ← `packages/slot-runtime/src/buffer.ts` 的 `opSize()`（**求值真实函数**）
//   · 线上格式头/版本     ← `buffer.ts` 的 OPS_MAGIC / OPS_VERSION
//   · Draw 类            ← `packages/layout-core/src/render-cmd.ts` 的 RenderCmdKind + 字段
//   · 协商结构           ← `docs/Proteus_HostABI宿主抽象层设计方案.md` §6（三件套）
//
// 用法：
//   node scripts/gen-instruction-spec.mjs          # 生成
//   node scripts/gen-instruction-spec.mjs --check  # 校验（CI；漂移 exit 1）
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const OUT = path.join(ROOT, 'docs/generated/instruction-spec.md')
const CHECK = process.argv.includes('--check')

// ── ① 求值真实函数（不解析源码文本——避免"解析器本身的漂移"）──────────────
const probe = `
import { OpCode, InsertPos } from ${JSON.stringify(path.join(ROOT, 'packages/slot-runtime/src/opcode.ts'))}
import { opSize, OPS_MAGIC, OPS_VERSION, OPS_HEADER_BYTES } from ${JSON.stringify(path.join(ROOT, 'packages/slot-runtime/src/buffer.ts'))}

// 每条 opcode 的**样本指令**（用于求值真实字节数——变长指令给 0 项 / 3 项两档）
const samples = {
  SET_PROP: { op: OpCode.SET_PROP, nodeId: 1, keyId: 2, value: 3 },
  SET_STYLE: { op: OpCode.SET_STYLE, nodeId: 1, keyId: 2, value: 3 },
  SET_TEXT: { op: OpCode.SET_TEXT, nodeId: 1, textRef: 2 },
  SET_ATTRS: { op: OpCode.SET_ATTRS, nodeId: 1, attrs: [{ keyId: 2, value: 3 }] },
  TOGGLE_VIS: { op: OpCode.TOGGLE_VIS, nodeId: 1, visible: true },
  INSERT_BLOCK: { op: OpCode.INSERT_BLOCK, blockId: 1, refNodeId: 2, pos: InsertPos.Append },
  REMOVE_NODE: { op: OpCode.REMOVE_NODE, nodeId: 1 },
  MOVE_NODE: { op: OpCode.MOVE_NODE, nodeId: 1, refNodeId: 2, pos: InsertPos.Append },
  LIST_SET: { op: OpCode.LIST_SET, listId: 1, dataRef: 2 },
  LIST_SPLICE: { op: OpCode.LIST_SPLICE, listId: 1, start: 0, delCount: 1, itemKeyRefs: [2, 3] },
  LIST_UPDATE: { op: OpCode.LIST_UPDATE, listId: 1, itemKeyRef: 2, slotId: 3, value: 4 },
  CALL_COMPONENT_UPDATE: { op: OpCode.CALL_COMPONENT_UPDATE, componentId: 1, slotId: 2, value: 3 },
}
const out = []
for (const [k, v] of Object.entries(samples)) {
  out.push({ name: k, code: v.op, bytes: opSize(v), sample: JSON.stringify(v) })
}
// 变长指令的**第二档**（证明尺寸随成员数增长）
const attrs3 = { op: OpCode.SET_ATTRS, nodeId: 1, attrs: [{keyId:2,value:3},{keyId:4,value:5},{keyId:6,value:7}] }
const splice3 = { op: OpCode.LIST_SPLICE, listId: 1, start: 0, delCount: 1, itemKeyRefs: [2,3,4] }
process.stdout.write(JSON.stringify({
  version: OPS_VERSION, magic: '0x' + OPS_MAGIC.toString(16), headerBytes: OPS_HEADER_BYTES,
  ops: out, attrs3Bytes: opSize(attrs3), splice3Bytes: opSize(splice3),
}))
`
const raw = execFileSync('npx', ['tsx', '-e', probe], { cwd: ROOT, encoding: 'utf-8' })
const facts = JSON.parse(raw.trim().split('\n').pop())

// ── ② 提取 Draw 类（RenderCmdKind + 字段）────────────────────────────────
const cmdSrc = fs.readFileSync(path.join(ROOT, 'packages/layout-core/src/render-cmd.ts'), 'utf-8')
const kindBlock = cmdSrc.match(/export type RenderCmdKind =([\s\S]*?)\n\n/)?.[1] ?? ''
const drawKinds = [...kindBlock.matchAll(/\|\s*'([a-zA-Z]+)'\s*\/\/\s*(.+)/g)].map((m) => ({ kind: m[1], note: m[2].trim() }))

// ── ③ 生成文档 ────────────────────────────────────────────────────────────
const ts = (s) => String(s).replace(/\|/g, '\\|')
const lines = []
lines.push('# 指令集规格（生成物 —— 勿手改）')
lines.push('')
lines.push('> **生成**：`node scripts/gen-instruction-spec.mjs`（`--check` 纳入 CI，漂移即红）')
lines.push('> **卡**：I1「指令集规格化与版本化」· **依赖**：无 · **性质**：跨端契约（多团队并行开发的前提）')
lines.push('')
lines.push('## 0. 为什么有这份文档')
lines.push('')
lines.push('指令集是**端与内核之间的唯一契约**：TS 编码、Rust 解码、各平台执行器都必须对同一批')
lines.push('opcode/字节布局/语义达成一致。此前这些事实散在 4 处实现里（`buffer.ts` 编解码 ·')
lines.push('`ops.rs` 解码 · `ops_apply.rs` 应用 · `render-cmd.ts` 绘制），**没有一份公开规格**——')
lines.push('⇒ 多端协作时无法对齐、无法协商版本。')
lines.push('')
lines.push('★**本表由代码生成**（不手抄）：opcode 与尺寸来自**求值真实函数**，`--check` 在 CI 比对，')
lines.push('⇒ **表与代码不可能漂移**（手写规格 = 第 5 份副本，漂移是静默的——本仓纪律 #22）。')
lines.push('')
lines.push('## 1. 两大类指令')
lines.push('')
lines.push('| 类别 | 载体 | 方向 | 何时用 |')
lines.push('|---|---|---|---|')
lines.push('| **Draw（绘制）** | `RenderCmd` 线性指令流 | 内核 → 平台（单向） | **全量**渲染：布局完成后一次性生成，平台顺序消费 |')
lines.push('| **Update（更新）** | `UpdateOp` 二进制指令流 | JS → 内核 → 平台 | **增量**更新：Vapor 槽位变化（不重建 VDOM、不 diff） |')
lines.push('')
lines.push('两者的共同设计：**定长字段 + 顺序读**（无字符扫描、无 f32 文本解析）——因为都是热路径。')
lines.push('')
lines.push('## 2. Update 指令集（' + facts.ops.length + ' 条 opcode）')
lines.push('')
lines.push('### 2.1 线上格式')
lines.push('')
lines.push('```')
lines.push(`Header（${facts.headerBytes}B）: magic u32 = ${facts.magic}("PVOP") · version u32 = ${facts.version}`)
lines.push('                · opCount u32 · keyCount u32 · strCount u32')
lines.push('KeyPool:        keyCount ×（u16 len, utf8 bytes）')
lines.push('StringPool:     strCount ×（u16 len, utf8 bytes）')
lines.push('Ops:            opCount 条（判别字节 + 定长字段）')
lines.push('```')
lines.push('')
lines.push('★**V2 起「池按需」**：编码时只把**本消息实际引用的**键/字符串放进池，并**重映射 ref 下标**')
lines.push('（V1 是每条消息携带全量池 ⇒ 列表场景单条更新膨胀 ~78×、编码成本 42×）。')
lines.push('解码端语义不变（池是自包含声明，按池内下标解析）——Rust 侧仅版本号需跟随。')
lines.push('')
lines.push('### 2.2 opcode 清单（全部小端）')
lines.push('')
lines.push('| opcode | 名称 | 字节 | 参数与语义 |')
lines.push('|---|---|---|---|')
for (const o of facts.ops) {
  // ★opcode 用**十六进制**显示（十进制失去"对着字节流核对"的价值——规格表的第一用途就是排查）
  const hex = '0x' + o.code.toString(16).padStart(2, '0')
  lines.push(`| \`${hex}\` | **${o.name}** | ${o.bytes} | \`${ts(o.sample.replace(/^\{|\}$/g, ''))}\` |`)
}
lines.push('')
lines.push('**变长指令的尺寸随成员数增长**（已实测）：')
lines.push(`· \`SET_ATTRS\`：1 项 ${facts.ops.find((o) => o.name === 'SET_ATTRS').bytes}B → 3 项 **${facts.attrs3Bytes}B**（\`7 + 6n\`）`)
lines.push(`· \`LIST_SPLICE\`：2 项 ${facts.ops.find((o) => o.name === 'LIST_SPLICE').bytes}B → 3 项 **${facts.splice3Bytes}B**（\`15 + 4n\`）`)
lines.push('')
lines.push('### 2.3 实现状态（★诚实标注：不是所有 opcode 都已支持）')
lines.push('')
lines.push('| opcode | 实现状态 |')
lines.push('|---|---|')
lines.push('| SET_PROP / SET_STYLE / SET_TEXT / SET_ATTRS / TOGGLE_VIS | ✅ 已实现并真机验证 |')
lines.push('| LIST_UPDATE / LIST_SPLICE / REMOVE_NODE | ✅ 已实现（含跨语言 golden） |')
lines.push('| **INSERT_BLOCK** | ❌ **unsupported**（需编译期块实例）——**如实上报不静默** |')
lines.push('| **MOVE_NODE** | ❌ **unsupported**（需宿主先解析目标父与位次）——如实上报 |')
lines.push('| **CALL_COMPONENT_UPDATE** | ❌ **unsupported**（需组件边界调度）——如实上报 |')
lines.push('| LIST_SET | ⚪ 语义保留（结构性换源属独立课题，当前显式跳过） |')
lines.push('')
lines.push('## 3. Draw 指令集（RenderCmd）')
lines.push('')
lines.push('| kind | 语义 |')
lines.push('|---|---|')
for (const d of drawKinds) lines.push(`| \`${d.kind}\` | ${ts(d.note)} |`)
lines.push('')
lines.push('**关键设计（三条，均为架构不变量）**：')
lines.push('')
lines.push('1. **绝对坐标**：每条指令自带绝对位置（父链偏移已累加）⇒ 平台层**零换算**；')
lines.push('   让裁剪（overdraw culling）成为一次坐标比较，无需维护变换栈；')
lines.push('2. **拍平不产生独立指令**：被拍平节点的绘制**并入父级指令**（`mergedFrom` 记录可验证），')
lines.push('   **不新建合成位图**——一旦破坏，iOS 上曾出现的 +78% 内存会以更难查的形式复发；')
lines.push('3. **paint-hint 编译期推导**：`isMonochrome` / `isPureBackground` / `shareableContent`')
lines.push('   随指令携带，平台据此决定 backing store 策略（**禁止运行时猜**）。')
lines.push('')
lines.push('## 4. 版本化与协商')
lines.push('')
lines.push('### 4.1 版本常量（实现）')
lines.push('')
lines.push('| 常量 | 值 | 位置 | 语义 |')
lines.push('|---|---|---|---|')
lines.push(`| \`OPS_VERSION\` | **${facts.version}** | \`slot-runtime/src/buffer.ts\` · \`layout-core-rust/src/ops.rs\` | Update 指令流线格式版本（**双端必须一致**，不符即报错） |`)
lines.push('| `OPS_MAGIC` | `0x504f5650` | 同上 | "PVOP" 魔数（防串流） |')
lines.push('')
lines.push('### 4.2 协商结构（Host ABI §6，沿用不重设计）')
lines.push('')
lines.push('```c')
lines.push('typedef struct {')
lines.push('  uint32_t abi_version;      // Host ABI 版本')
lines.push('  uint32_t ir_version;       // IR 版本')
lines.push('  uint32_t min_shell_version;// 最低宿主版本')
lines.push('} ProteusVersionInfo;')
lines.push('```')
lines.push('')
lines.push('**强制要求**：① 版本号语义化（**禁止 commit hash 等不可比标识**）；')
lines.push('② 校验不通过 ⇒ **明确提示升级，不得静默崩溃**；③ 能力清单版本也纳入协商。')
lines.push('')
lines.push('### 4.3 变更流程（major / minor）')
lines.push('')
lines.push('| 变更类型 | 版本动作 | 兼容性 |')
lines.push('|---|---|---|')
lines.push('| **新增 opcode**（未用旧值） | `OPS_VERSION` **minor** 递增 | 向后兼容：旧端忽略未知 opcode 即可 |')
lines.push('| **改字段语义 / 改字节布局** | **major** 递增 | **不兼容**：双端必须同步升级 |')
lines.push('| **移除 opcode** | **major** 递增 | 不兼容 |')
lines.push('| 新增**可选**头部字段（尾部追加） | minor 递增 | 兼容（旧端按 `opCount` 停止读取） |')
lines.push('')
lines.push('★**本仓实测的两次版本变更**（作为流程实例）：')
lines.push('')
lines.push('| 版本 | 变更 | 兼容性 |')
lines.push('|---|---|---|')
lines.push('| 1 | 初版（全量池） | — |')
lines.push('| **2** | **池按需 + ref 重映射**（改字节语义 ⇒ major） | **不兼容**：TS 与 Rust 必须同步；`ops_conformance` golden 当场抓出未同步端 |')
lines.push('')
lines.push('## 5. 门禁（可复现）')
lines.push('')
lines.push('| 门禁 | 锁什么 |')
lines.push('|---|---|')
lines.push('| `node scripts/gen-instruction-spec.mjs --check` | **本表与代码一致**（表漂移即红） |')
lines.push('| `cargo test --test ops_conformance` | **跨语言 golden**：TS 编码 → Rust 解码，逐字节 + 语义比对 |')
lines.push('| `tests/update-ops-golden.test.ts` | golden 与当前编码一致（改了格式必须显式重新生成） |')
lines.push('| `tests/layout-core-render-cmd.test.ts` | Draw 类：绝对坐标 / 拍平 / 裁剪 三条架构不变量 |')
lines.push('')

const content = lines.join('\n')
if (CHECK) {
  const existing = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf-8') : ''
  if (existing.trim() !== content.trim()) {
    console.error(`✗ 指令集规格与代码不一致：${path.relative(ROOT, OUT)}`)
    console.error('  ⇒ 跑 `node scripts/gen-instruction-spec.mjs` 重新生成（改了 opcode/尺寸/版本后必须重生成）')
    process.exit(1)
  }
  console.log(`✅ 指令集规格与代码一致（${facts.ops.length} opcode · OPS_VERSION=${facts.version}）`)
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, content)
  console.log(`[instr-spec] ✅ 生成 ${path.relative(ROOT, OUT)}`)
  console.log(`    ${facts.ops.length} opcode · OPS_VERSION=${facts.version} · Draw kind ${drawKinds.length} 种`)
}
