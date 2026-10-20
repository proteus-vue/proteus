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
 * ★★★决策 #1112：**runtime 间接引用契约**——hook 不直接碰 `bridge.*`，而是经 runtime 方法转手。
 *
 * 【为什么需要（2026-10-20 实测的对外谎报）】
 *   `useWebSocket: (url, protocols) => wrap(res.connectWs(bridge, url, protocols))`
 *   ——取值片段里**没有** `bridge.connectWebSocket`，真正的桥引用藏在
 *   `capability-runtime.ts::makeCapabilityRuntime().connectWs()` 内部。
 *   ⇒ 解析器抽到 `refs = []` ⇒ App 列判定条件 `refs.length && …` 不成立
 *     ⇒ **官网把已落地的 websocket 标成「能力桥未接线 🟡」**（宿主腿 #1093 早已实现且编译通过）。
 *     **这是对外谎报**（与 #881 `useMiniProgram` refs 恒空同型）。
 *
 * 【本表是"显式契约"而不是"猜"】每个条目必须写清「runtime 方法 → 它内部真正读取的桥方法名」+ 锚点。
 *   ★新增此类间接调用时**必须在此登记**，否则该能力各端列会如实显示 🟡/⚠️（宁可显示未接线，
 *     也不要显示假绿——但登记了才是对的）。
 *   ★与 `APP_BRIDGE_EXTRA_MEMBERS`（桥工厂闭包）是**两类不同的间接**：那张表解决"桥成员在工厂闭包里"，
 *     本表解决"hook 根本不直接引用桥，而是调 runtime 方法"。
 */
export const RUNTIME_INDIRECT_REFS = {
  /** `useWebSocket` → `res.connectWs(bridge, …)` → `bridge.connectWebSocket`
   *  锚点：`packages/api/src/capability-runtime.ts` 的 `connectWs()`（读 `bridge.connectWebSocket`） */
  connectWs: ['connectWebSocket'],
}

/**
 * 抽取：源码 → `{ refs, hookCount, receiver, duplicates, misses }`。**纯函数**（可单测），不抛错。
 * `refs[hookName]` = 该 hook 取值片段内引用的桥方法名（去重、保持首次出现顺序，**含 runtime 间接展开**）。
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
  // ★#1112：runtime 间接（`res.connectWs(...)` 之类）。receiver 名同样从形参/局部推断不可靠
  //   ⇒ 用**宽匹配** `<ident>.<runtimeMethod>(`，再经显式表展开成真实桥方法名。
  //   为什么宽匹配安全：`RUNTIME_INDIRECT_REFS` 只登记了少数**明确**的 runtime 方法名，
  //   误收一个同名调用的概率极低；且收错的表现是"多一个 ref"⇒ 该能力反而更可能被判 ⚠️，
  //   不会制造假绿（假绿面已被 `refs.length && refs.every(...)` 与 shell/verified 判定守住）。
  const indirectKeys = Object.keys(RUNTIME_INDIRECT_REFS)
  const reIndirect = indirectKeys.length
    ? new RegExp(`\\b[A-Za-z_$][\\w$]*\\.(${indirectKeys.map((k) => k.replace(/[$]/g, '\\$&')).join('|')})\\b`, 'g')
    : null
  for (const e of entries) {
    if (e.name in refs) duplicates.push(e.name)
    const hits = [...e.value.matchAll(reRef)].map((x) => x[1])
    // 展开 runtime 间接引用
    if (reIndirect) {
      for (const m of e.value.matchAll(reIndirect)) {
        for (const bridged of RUNTIME_INDIRECT_REFS[m[1]] ?? []) hits.push(bridged)
      }
    }
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
