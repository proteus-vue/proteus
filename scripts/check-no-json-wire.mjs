#!/usr/bin/env node
// scripts/check-no-json-wire.mjs —— ★★★静态门禁：**逐帧指令通道禁 JSON 文本**（S2「去 JSON」的机器化，2026-10-10）
//
// 【为什么需要】跨语言逐帧通道一律走 JSON 文本（`number[]` + `双 UTF-8`）是本仓结构性瓶颈
//   （方案 `docs/proteus-performance-plan/14-input-bridge-latency.md` 的 B2）：JS 侧
//   `JSON.stringify(Array.from(bytes))`（每字节膨胀 3~4×）+ 宿主 `new JSONArray` 逐元素解析 +
//   `Integer` 装箱。**"字节通道"曾是 `number[]` JSON——名字骗人**（决策 #769）。
//   ⇒ 已落地 **字节直传**（`applyOpsBytes`：`Uint8Array`→`byte[]`）；本门禁把它**钉住**，
//     防止后续改动**静默回退**到旧 JSON 通道（与 `check:no-blind-wait` / `check:host-rounding`
//     同族：**结构性问题只有工具层能兜住**）。
//
// 【判据（机器推导，不手写清单）】逐帧指令的**生产出口**必须走 `sendOps`（内部优先 `applyOpsBytes`）：
//   ① `hosts/android/bridge/entry-vapor.ts`：**除 `sendOps` 回退体外，不得出现** `applyOps(JSON.stringify(`
//      ——即命令字节不得被编成 `number[]` JSON 文本再发。
//   ② 宿主 `VaporRenderHost.java` 必须**定义** `applyOpsBytes`（字节直传入口）。
//   ③ C 桥 `quickjs_jni.c` 必须**引用** `applyOpsBytes`（JS `Uint8Array` → `byte[]` 的转接）。
//
// 【诚实边界】只覆盖 **Android vapor 指令通道**（当前唯一已接字节直传的逐帧路径）；
//   iOS/鸿蒙字节通道、整树 mount 的 blob（入口已存在未接生产）为后续——各端接入时**扩本门禁**。
//
// 用法：node scripts/check-no-json-wire.mjs
// 退出码：0 通过 / 1 命中
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BRIDGE = path.join(ROOT, 'hosts/android/bridge/entry-vapor.ts')
const HOST = path.join(ROOT, 'hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/VaporRenderHost.java')
const CBRIDGE = path.join(ROOT, 'hosts/android/js-engine/quickjs_jni.c')

let failed = false
const fail = (m) => { console.error(`✗ ${m}`); failed = true }

// ── ① 桥：逐帧字节不得经 number[] JSON（唯一合法处 = sendOps 回退体）──
{
  const src = fs.readFileSync(BRIDGE, 'utf-8')
  if (!src.includes('applyOpsBytes')) fail('桥缺 `applyOpsBytes` 新通道引用（去 JSON 通道未被使用）')
  // 其它一切 `applyOps(JSON.stringify(` 均违规（sendOps 回退体里的那一处除外——用函数体切分排除）
  const fnMatch = /function sendOps\([\s\S]*?\n\}/.exec(src)
  const sendOpsBody = fnMatch ? fnMatch[0] : ''
  const total = (src.match(/applyOps\(\s*JSON\.stringify/gi) || []).length
  const inFallback = (sendOpsBody.match(/applyOps\(\s*JSON\.stringify/gi) || []).length
  if (total - inFallback > 0) {
    fail(`桥里出现 ${total - inFallback} 处 \`applyOps(JSON.stringify(...))\`（逐帧字节被编成 number[] JSON）——应统一走 \`sendOps\`（其内优先 applyOpsBytes）`)
  } else {
    console.log(`  ✓ 桥：逐帧字节走 \`sendOps\`（回退体 ${inFallback} 处 number[] JSON 属合规兜底）`)
  }
}

// ── ② 宿主：必须定义字节直传入口 applyOpsBytes ──
{
  const host = fs.readFileSync(HOST, 'utf-8')
  if (!/public\s+String\s+applyOpsBytes\s*\(\s*byte\[\]/.test(host)) {
    fail('宿主 `VaporRenderHost.java` 未定义 `applyOpsBytes(byte[])`（字节直传入口缺失）')
  } else {
    console.log('  ✓ 宿主：`applyOpsBytes(byte[])` 字节直传入口存在')
  }
}

// ── ③ C 桥：必须有 applyOpsBytes 的转接 ──
{
  const c = fs.readFileSync(CBRIDGE, 'utf-8')
  if (!c.includes('applyOpsBytes')) fail('C 桥 `quickjs_jni.c` 缺 `applyOpsBytes` 转接（Uint8Array→byte[]）')
  else console.log('  ✓ C 桥：`applyOpsBytes` 转接存在（JS Uint8Array → Java byte[]）')
}

if (failed) {
  console.error('\n✗ 逐帧指令通道出现 JSON 文本（S2 去 JSON 被回退）——见上；正确做法：走 `sendOps`（字节直传）')
  process.exit(1)
}
console.log('\n✅ 逐帧指令通道零 JSON（字节直传 · 去 JSON 生效，S2/#769）')
