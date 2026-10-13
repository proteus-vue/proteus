// hook-bridge-refs.mjs —— hook → 桥方法引用（生成器 ↔ 源码 的**显式契约** · 第二份）
//
// 【为什么有本模块（2026-10-13 · 承接独立验证发现）】
//   官网能力页的「MP/Web/App 是否接线」由 **hook 取值里引用了哪些桥方法**推导：
//     · `wxMissing`/`webMissing` = refs 中不在 wxBridge / webBridge 的成员 ⇒ MP/Web 列 ⚠️
//     · App 列 ✅ 的条件 = `refs.length && refs.every(r => APP_BRIDGE_KEYS.has(r))`
//   旧实现在 `gen-content.mjs` 里用两条脆弱手段：
//     ① **切片**按"下一个 `useXxx:`/`setXxx:` 键"截断（`keyHits`）——实测抽到 **146** 个"键"
//        （真顶层成员 **94**（独立 AST 复算一致）；其余是句柄内部的 `setFillStyle:` 之类嵌套键与桥定义成员），且**最后一个键**的切片
//        会一路吃到 `capability-bridges.ts` 末尾（该处 `bridge.` 出现 80+ 次）；
//     ② **正则** `/bridge\.(\w+)\(/` 只认「名字紧跟调用括号」——
//        漏 `bridge.getCalendar!()`（**非空断言** `!` 夹在中间）
//        漏 `const nav = bridge.navigateMiniProgram`（**先取后调**）
//   ⇒ 实测 `useMiniProgram`(C47) 的 refs 恒为空 ⇒ App 端被判 🟡「能力桥未接线」（**对外谎报**）。
//   ★这与 #884 同型：生成器用文本解析源码 = 隐式契约；改对了源码（或写法风格），契约静默断裂。
//
// 【本模块的做法】锚定式：`export function createCapabilityHooks` → 函数体 → 顶层 `return {`
//   → 逐个**顶层成员**取**取值片段**（`lib/ts-source-scan.mjs` 的 `topLevelEntries`）
//   → 在片段内收 `bridge.<标识符>`（**不论是否紧跟调用括号**）。
//   桥接收者名从**形参表**推导（不写死）——形参改名不再静默得空集。
//   函数/返回对象/成员缺失，或**全表 refs 合计为 0** ⇒ **抛错（硬失败）**，绝不静默。
//
// 【诚实边界】
//   · 语义是"引用了"而非"一定调用"：`this.bridge.x`、动态拼名仍抽不到（源码不依赖该形态）；
//   · 因此本模块**只**回答"接线面"，不回答"调用正确性"——后者由真机判据（check:host-runtime）负责。

import fs from 'node:fs'
import { maskNonCode, findFunctionBody, findTopReturnObject, matchBrace, topLevelEntries } from './ts-source-scan.mjs'

/**
 * 契约常量：hooks 工厂（`packages/api/src/capability.ts`）。
 * ★改名须同步此表（否则硬失败报错，不静默）。
 */
export const HOOK_FACTORY = 'createCapabilityHooks'

/** 未显式传 receiver 时的兜底形参名（正常路径由形参表推导） */
const FALLBACK_RECEIVER = 'bridge'

/**
 * 抽取：源码 → `{ refs, hookCount, receiver, duplicates, misses }`。**纯函数**（可单测），不抛错。
 * `refs[hookName]` = 该 hook 取值片段内引用的桥方法名（去重、保持首次出现顺序）。
 */
export function extractHookBridgeRefs(src, factory = HOOK_FACTORY) {
  const masked = maskNonCode(src)
  const body = findFunctionBody(masked, factory)
  if (!body) return { refs: {}, hookCount: 0, receiver: FALLBACK_RECEIVER, duplicates: [], misses: [`${factory}（函数未找到）`] }
  const retOpen = findTopReturnObject(masked, body)
  if (retOpen < 0) return { refs: {}, hookCount: 0, receiver: FALLBACK_RECEIVER, duplicates: [], misses: [`${factory}（未找到顶层 \`return {\`）`] }
  const close = matchBrace(masked, retOpen)
  if (close < 0) return { refs: {}, hookCount: 0, receiver: FALLBACK_RECEIVER, duplicates: [], misses: [`${factory}（返回对象花括号不配对）`] }

  // 桥接收者：取形参表首个标识符（`createCapabilityHooks(bridge: CapabilityBridge = …)` → `bridge`）
  let receiver = FALLBACK_RECEIVER
  if (body.params) {
    const pm = /^\s*([A-Za-z_$][\w$]*)/.exec(masked.slice(body.params.open + 1, body.params.close))
    if (pm) receiver = pm[1]
  }

  const entries = topLevelEntries(masked, retOpen, close)
  if (!entries.length) return { refs: {}, hookCount: 0, receiver, duplicates: [], misses: [`${factory}（返回对象未解析出成员）`] }

  const reRef = new RegExp(`\\b${receiver}\\.([A-Za-z_$][\\w$]*)`, 'g')
  const refs = {}
  const duplicates = []
  let total = 0
  for (const e of entries) {
    if (e.name in refs) duplicates.push(e.name)
    const hits = [...e.value.matchAll(reRef)].map((x) => x[1])
    refs[e.name] = [...new Set(hits)]
    total += refs[e.name].length
  }
  const misses = []
  if (total === 0) misses.push(`${factory}（全部成员合计引用 0 个 \`${receiver}.<name>\`——接收者名或源码结构已变）`)
  return { refs, hookCount: entries.length, receiver, duplicates, misses }
}

/**
 * 从文件读并抽取。**数据源契约硬失败**：文件缺失 / 函数缺失 / 返回对象缺失 / 合计 0 引用 ⇒ 抛错。
 * 返回 `{ refs, hookCount, receiver, duplicates }`。
 */
export function loadHookBridgeRefs(filePath, factory = HOOK_FACTORY) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`[hook-bridge-refs] 找不到 hooks 源文件：${filePath}（数据源缺失 = 硬失败，不静默得空集）`)
  }
  const r = extractHookBridgeRefs(fs.readFileSync(filePath, 'utf8'), factory)
  if (r.misses.length) throw new Error(`[hook-bridge-refs] 解析失败（数据源契约被破坏）：${r.misses.join('；')}`)
  return r
}
