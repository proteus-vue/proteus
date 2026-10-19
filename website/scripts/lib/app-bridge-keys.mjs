// app-bridge-keys.mjs —— App 宿主桥方法集抽取（生成器 ↔ 源码 的**显式契约** · 第一份）
//
// 【为什么有本模块（2026-10-13 · 决策 #881，承接审查报告 docs/native-capability-crossend-progress.md §3/§7）】
//   官网能力页的「App 端（iOS/Android）是否接线」由 `capability-app.ts` 的**桥方法名**推导。
//   旧实现是 gen-content.mjs 内一条窄正则 `/^\s{4}(get[A-Z]\w*)\(/gm` —— **只认方法简写风格**：
//     · 不认属性箭头 `getXxx: () => …`（capability-app.ts 两种风格**混用**）
//     · 不认无 `get` 前缀的动词式方法（`loadExtension` / `createWorker` / `navigateMiniProgram`）
//   ⇒ 13 个桥方法只抽到 3 个 ⇒ 8+ 个能力被错误标为「渲染核心已落地——能力桥未接线」（**对外谎报**）。
//   同一形态已咬过一次（#870 拆文件 → #876 修）：**文本隐式契约**这类缺陷，改对了代码反而静默打断它。
//
// 【本模块的做法】**锚定式**解析（不再全文件正则）：
//   ① 按 `export function <name>` 定位工厂函数体（花括号配对；先跳过参数表 `( … )`）；
//   ② 在函数体**顶层（深度 1）**找 `return {` 对象 → 花括号配对取对象体；
//   ③ 取对象体**深度 0** 的成员名（`name:` 与 `name(` 两种写法都收）。
//   底层原语（遮罩 / 配对 / 定函数体 / 定返回对象 / 切顶层成员）已收在 `lib/ts-source-scan.mjs`
//   （同一套原语也被 `lib/hook-bridge-refs.mjs` 复用——本仓禁止第二份手写副本）。
//   找不到函数 / 找不到返回对象 / 抽出 0 个 ⇒ **抛错（硬失败）**，绝不静默得空集。
//
// 【诚实边界】纯文本解析（不执行 TS）。工厂函数若彻底改名/改结构，本模块**报错**而非猜——
//   这是刻意选择（「数据源缺失 = 硬失败」），与本仓「不静默」纪律一致；改名时同步本文件常量即可。

import fs from 'node:fs'
import { maskNonCode, returnObjectMembers } from './ts-source-scan.mjs'

/**
 * 契约常量：App 桥的工厂函数（**按文件分组**）。
 * 各文件返回对象的方法名并集 = App 端可用桥方法集。★改源码里的工厂名/文件名须同步此表（否则硬失败报错）。
 *
 * 【★★2026-10-19 扩面（决策 #1067）】设备与系统域的 12 个桥方法在**独立文件**
 *   `capability-app-device.ts`（反巨型化拆出）。只扫 `capability-app.ts` 会让这 12 项在
 *   官网能力页上**仍显示 🟡（App 未接线）**——代码做了、文档谎报，与 #881 同一形态。
 *   ⇒ 本模块改为**多源**：每个源文件各自声明工厂名，任一源缺文件/解析失败即硬失败。
 */
export const APP_BRIDGE_FACTORIES = ['createAppNativeCapabilities', 'createAppLifecycleCapabilities']

/** 多源契约（文件 → 该文件的工厂名）。新增 App 桥源文件必须登记在此（否则文档静默漏判）。 */
export const APP_BRIDGE_SOURCES = [
  { file: 'packages/api/src/capability-app.ts', functions: APP_BRIDGE_FACTORIES },
  { file: 'packages/api/src/capability-app-device.ts', functions: ['createAppDeviceCapabilities'] },
  // ★★★决策 #1081：元素查询域（`useElement` 的桥成员在独立文件——与设备域同因拆出）
  { file: 'packages/api/src/capability-app-element.ts', functions: ['createAppElementBridge'] },
  // ★★★决策 #1083：录屏/截屏状态（C71）
  { file: 'packages/api/src/capability-app-capture.ts', functions: ['createAppCaptureCapabilities'] },
  // ★★★决策 #1093：装配层也直接贡献桥成员（`connectWebSocket: createAppWebSocket()` 写在
  //   `createAppCapabilities` 的返回对象里，不在任何子工厂内）⇒ 不登记就会被判「桥未接线」。
  //   ★这条是实测抓出来的：ws.* 的宿主腿都实现并编译通过了，页面仍显示 🟡。
  { file: 'packages/api/src/capability-app-device.ts', functions: ['createAppCapabilities'] },
  // ★★★决策 #1095：C29/C30 的 upload/download 在**独立工厂**的返回对象里
  //   （`capability-transfer.ts::createAppTransfer` 展开进装配层）。
  //   ★不登记就会被判「桥未接线」——与 #1093 的 connectWebSocket 同一形态。
  { file: 'packages/api/src/capability-transfer.ts', functions: ['createAppTransfer'] },
]

/**
 * 抽取：给定源码 + 工厂函数名列表 → `{ keys:Set<string>, perFn:{[fn]:number}, misses:string[] }`。
 * 纯函数（可单测）；不抛错，把问题汇总到 `misses`。
 */
export function extractAppBridgeKeys(src, functions = APP_BRIDGE_FACTORIES) {
  const masked = maskNonCode(src)
  const keys = new Set()
  const perFn = {}
  const misses = []
  for (const fn of functions) {
    // 「函数 → 顶层 `return {` → 成员名」收在 ts-source-scan 一份（本仓禁止第二份手写副本）
    const { names, miss } = returnObjectMembers(masked, fn)
    if (miss) {
      misses.push(miss)
      continue
    }
    // App 桥工厂**必须**有成员（空返回对象 = 数据源被破坏，不静默）
    if (!names.length) {
      misses.push(`${fn}（返回对象未解析出成员）`)
      continue
    }
    perFn[fn] = names.length
    for (const nm of names) keys.add(nm)
  }
  return { keys, perFn, misses }
}

/**
 * 从文件读并抽取。**数据源契约硬失败**：文件缺失 / 函数缺失 / 返回对象缺失 / 抽到 0 个 ⇒ 抛错。
 * 返回 `{ keys, perFn }`。
 */
export function loadAppBridgeKeys(filePath, functions = APP_BRIDGE_FACTORIES) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`[app-bridge-keys] 找不到 App 桥源文件：${filePath}（数据源缺失 = 硬失败，不静默得空集）`)
  }
  const { keys, perFn, misses } = extractAppBridgeKeys(fs.readFileSync(filePath, 'utf8'), functions)
  if (misses.length) {
    throw new Error(`[app-bridge-keys] 解析失败（数据源契约被破坏）：${misses.join('；')}`)
  }
  if (keys.size === 0) {
    throw new Error('[app-bridge-keys] 抽取到 0 个 App 桥方法（不静默得空集）')
  }
  return { keys, perFn }
}

/**
 * 从**多个源文件**读并合并（生成器用）。★任一源缺失/解析失败 ⇒ 抛错（不静默漏判）。
 * @param {string} root 仓库根
 * @param {{file:string, functions:string[]}[]} sources 默认 APP_BRIDGE_SOURCES
 * @returns {{keys:Set<string>, perSource:{[file]:{perFn:object,count:number}}}}
 */
export function loadAppBridgeKeysFrom(root, sources = APP_BRIDGE_SOURCES) {
  const keys = new Set()
  const perSource = {}
  for (const src of sources) {
    const abs = root.endsWith('/') ? root + src.file : root + '/' + src.file
    const one = loadAppBridgeKeys(abs, src.functions)
    perSource[src.file] = { perFn: one.perFn, count: one.keys.size }
    for (const k of one.keys) keys.add(k)
  }
  if (keys.size === 0) throw new Error('[app-bridge-keys] 多源合计抽取到 0 个 App 桥方法（不静默得空集）')
  return { keys, perSource }
}
