// bridge-keys.mjs —— 平台桥**成员集**抽取（生成器 ↔ 源码 的**显式契约** · 第三份）
//
// 【三份同族契约】生成器 `gen-content.mjs` 靠**文本解析框架源码**推导能力页三列分档：
//   ① `app-bridge-keys.mjs`  —— `capability-app.ts` 工厂返回对象成员 → App 端（iOS/Android/鸿蒙）
//   ② `hook-bridge-refs.mjs` —— `capability.ts` 的 hooks 各自引用了哪些桥方法 → `refs`
//   ③ **本模块**             —— 运行时**真实桥成员集** → MP 列（`wxMissing`）/ Web 列（`webMissing`）
//   ①②③ 共用底层原语 `ts-source-scan.mjs`（本仓纪律：同一件事不得有第二份手写副本）。
//
// 【为什么有本模块（2026-10-13 · 承接 T-app-bridge-refs 的独立验证发现）】
//   旧实现在 `gen-content.mjs` 内：`extractFnKeys(apiSrc, 'wxBridge' | 'webBridge')` ——
//   `indexOf('function wxBridge')` + `/^}/m` 切片 + `/^ {4}([a-zA-Z]+):/gm` 行匹配。
//   它只扫**手写桥**的函数体，而运行时桥是**两源并集**（`capability.ts` 的 `createCapabilityBridge`）：
//     `mp`  ⇒ `{ ...wxBridge(g.wx), ...mpBridgeExt(g.wx, CapError), ...appCaps }`
//     其它  ⇒ `{ ...webBridge(globalThis), ...webBridgeExt(globalThis, CapError), ...appCaps }`
//   声明式桥成员在 `packages/api/src/generated/bridge-ext.ts`（`scripts/gen-bridge-ext.mjs` 生成）
//   ⇒ 漏抽 ⇒ `keep-screen-on`(C83) / `document-preview`(C84) 两页的 **Web+MP 共 8 格**被错标 ⚠️
//   「wx/web 桥未提供 xxx → Err 显式降级」——而真值是 ✅（**对外谎报**，与 #884/#889 同型）。
//
// 【本模块的做法】锚定式（`ts-source-scan.mjs` 原语），两源并集：
//   手写桥（`capability-bridges.ts` 的 `wxBridge` / `webBridge`）∪ 声明式桥（生成物的 `mpBridgeExt` / `webBridgeExt`）。
//   ★并用生成物自带的 `GENERATED_BRIDGE_COUNT`（= 声明数）做**交叉校验**：每个声明恰好产出 1 个成员
//     ⇒ 解析到的成员数 ≠ 声明数 ⇒ 硬失败（生成物与声明脱节，或解析器坏了）。
//
// 【诚实边界】纯文本解析（不执行 TS）：
//   · 只回答「桥面提供了哪些方法名」，**不回答**「实现是否正确」（后者归真机判据 / 单测）；
//   · `appCaps`（App 宿主能力）**不计入** wxKeys/webKeys —— 它们是 App 档，由 ① 负责，
//     且 MP/Web 列在非 App 宿主上拿不到（口径见 `capability.ts:22-32` 的分支注释）。

import fs from 'node:fs'
import { maskNonCode, returnObjectMembers } from './ts-source-scan.mjs'

/** 手写桥工厂（`capability-bridges.ts`）——契约常量；改源码工厂名须同步此表（否则硬失败） */
export const HANDWRITTEN_BRIDGE_FACTORIES = { wx: 'wxBridge', web: 'webBridge' }

/** 声明式桥工厂（`generated/bridge-ext.ts`，由 `scripts/gen-bridge-ext.mjs` 生成）——同上 */
export const DECLARATIVE_BRIDGE_FACTORIES = { wx: 'mpBridgeExt', web: 'webBridgeExt' }

/** 声明式桥生成物的仓库相对路径（数据源，缺失 = 硬失败） */
export const BRIDGE_EXT_REL_PATH = 'packages/api/src/generated/bridge-ext.ts'

/** 生成物导出的声明数常量名（用于与解析到的成员数交叉校验） */
export const DECLARED_COUNT_CONST = 'GENERATED_BRIDGE_COUNT'

/**
 * 抽取：手写桥源码 + 声明式桥生成物源码 → `{ wxKeys, webKeys, perFn, declaredCount, misses }`。
 * **纯函数**（可单测），不抛错——把问题汇总到 `misses`。
 */
export function extractBridgeKeys(handSrc, extSrc) {
  const misses = []
  const perFn = {}
  const sets = { wx: new Set(), web: new Set() }

  // ① 手写桥（capability-bridges.ts：wxBridge / webBridge）
  const handMasked = maskNonCode(handSrc)
  for (const [side, fn] of Object.entries(HANDWRITTEN_BRIDGE_FACTORIES)) {
    const { names, miss } = returnObjectMembers(handMasked, fn)
    if (miss) {
      misses.push(miss)
      continue
    }
    perFn[fn] = names.length
    for (const nm of names) sets[side].add(nm)
  }

  // ② 声明式桥（generated/bridge-ext.ts：mpBridgeExt / webBridgeExt）
  const extMasked = maskNonCode(extSrc)
  const cntM = new RegExp(`export\\s+const\\s+${DECLARED_COUNT_CONST}\\s*=\\s*(\\d+)`).exec(extMasked)
  if (!cntM) {
    misses.push(`${DECLARED_COUNT_CONST}（未在生成物中解析到声明数——生成物被手改或生成器改名？）`)
    return { wxKeys: sets.wx, webKeys: sets.web, perFn, declaredCount: -1, misses }
  }
  const declaredCount = Number(cntM[1])
  // ★声明数 = 成员数（生成器对每个声明恰好产出一个成员）——不等即契约脱节。
  //   ★声明数为 0 时**仍然解析**工厂：否则「常量被改成 0、工厂实含成员」这类脱节会静默溜过
  //     （独立验证抓出的盲区；`return {}` 是合法空集，此时成员数 0 == 声明数 0，天然通过）。
  for (const [side, fn] of Object.entries(DECLARATIVE_BRIDGE_FACTORIES)) {
    const { names, miss } = returnObjectMembers(extMasked, fn)
    if (miss) {
      misses.push(miss)
      continue
    }
    if (names.length !== declaredCount) {
      misses.push(`${fn}（成员数 ${names.length} ≠ ${DECLARED_COUNT_CONST}=${declaredCount}——生成物与声明脱节）`)
      continue
    }
    perFn[fn] = names.length
    for (const nm of names) sets[side].add(nm)
  }

  return { wxKeys: sets.wx, webKeys: sets.web, perFn, declaredCount, misses }
}

/**
 * 从文件读并抽取。**数据源契约硬失败**：文件缺失 / 工厂符号缺失 / 返回对象缺失 / 成员数与声明数不等 ⇒ 抛错。
 */
export function loadBridgeKeys(handSrcPath, extSrcPath) {
  for (const [label, p] of [
    ['手写桥源文件', handSrcPath],
    ['声明式桥生成物', extSrcPath],
  ]) {
    if (!fs.existsSync(p)) {
      throw new Error(`[bridge-keys] 找不到${label}：${p}（数据源缺失 = 硬失败，不静默得空集）`)
    }
  }
  const r = extractBridgeKeys(fs.readFileSync(handSrcPath, 'utf8'), fs.readFileSync(extSrcPath, 'utf8'))
  if (r.misses.length) throw new Error(`[bridge-keys] 解析失败（数据源契约被破坏）：${r.misses.join('；')}`)
  if (r.wxKeys.size === 0 || r.webKeys.size === 0) throw new Error('[bridge-keys] 抽取到 0 个桥方法（不静默得空集）')
  return r
}
