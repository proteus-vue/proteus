// packages/api/src/capability-lifecycle-once.ts
// ★★★生命周期事件源的**幂等守卫**（决策 #1071）—— 2026-10-19
//
// 【它解决什么（实测抓出的平方级缺陷）】
//   `createCapabilityHooks()` 的默认参数是 `createCapabilityBridge()`，而每条桥构造路径都会调
//   `installWebEventSources` / `installWxAppEventBridge`。这两个安装器原先**没有幂等守卫**：
//   · Web：每次 `webBridge()` 都往 `window` 挂 5 个监听器（visibilitychange/resize/load/scroll/beforeunload）；
//   · MP：`wx.onAppShow` / `wx.onError` / `wx.onMemoryWarning` 都是**追加订阅**语义。
//   而总线是**全局单例** ⇒ 一次系统事件被 N 个监听器各 emit 一次，再分发给 N 个页面订阅者
//   = **N×N 次业务回调**。实测：100 页 ⇒ 10000 次（应为 100）；500 页 ⇒ 50 万次/事件、6.3ms。
//
// 【为什么按"事件源身份"去重，而不是布尔/全局键】
//   · 生产环境 `window.addEventListener`（或 `wx` 对象）恒同一引用 ⇒ 只装一次（正是要的）；
//   · 测试里每次替换成新的桩 ⇒ 新身份 ⇒ 正常重装（不破坏既有测试的隔离语义）。
//   ⇒ 用 `WeakSet<object>` 记"装过的源"，源被回收即自动出表（无泄漏）。
//
// 【诚实边界】只防"同一源重复安装"；多窗口 / 多 document 各自有独立身份，互不影响。

/** 已装过 Web 事件源的事件源身份（`addEventListener` 函数引用） */
const webSourcesInstalled = new WeakSet<object>()
/** 已装过 MP 应用事件桥的 `wx` 对象身份 */
const wxBridgesInstalled = new WeakSet<object>()

/**
 * 一次完成「查—标记—计数」：返回 `true` = **首次**（调用方应安装），`false` = 已装过（跳过）。
 * ★把三步合成一次调用，是为了让消费方的守卫只占**一行**（存量巨型文件按行数做棘轮）。
 */
export function onceWebEventSource(source: object): boolean {
  if (webSourcesInstalled.has(source)) { skippedInstalls++; return false }
  webSourcesInstalled.add(source)
  webInstalls++
  return true
}

/** 同上，MP 的 `wx` 全局。 */
export function onceWxAppBridge(wx: object): boolean {
  if (wxBridgesInstalled.has(wx)) { skippedInstalls++; return false }
  wxBridgesInstalled.add(wx)
  wxInstalls++
  return true
}

/** 该 Web 事件源是否已装过（**只读**，不标记）。 */
export function isWebEventSourceInstalled(source: object): boolean {
  return webSourcesInstalled.has(source)
}

/** 标记该 Web 事件源已装（首次安装前调用；重复调用无副作用）。 */
export function markWebEventSourceInstalled(source: object): void {
  webSourcesInstalled.add(source)
}

/** 该 `wx` 全局是否已装过应用事件桥（只读）。 */
export function isWxAppBridgeInstalled(wx: object): boolean {
  return wxBridgesInstalled.has(wx)
}

/** 标记该 `wx` 全局已装（首次安装前调用；重复调用无副作用）。 */
export function markWxAppBridgeInstalled(wx: object): void {
  wxBridgesInstalled.add(wx)
}

/* ══════════════════ 诊断读数（供测试与真机判据） ══════════════════ */

let webInstalls = 0
let wxInstalls = 0
let skippedInstalls = 0

export function recordInstall(kind: 'web' | 'wx'): void {
  if (kind === 'web') webInstalls++
  else wxInstalls++
}

export function recordSkip(): void {
  skippedInstalls++
}

/** 安装次数读数（判据用：页面数 ↑ 时 `webInstalls` 必须恒为 1）。 */
export function lifecycleInstallStats(): { web: number; wx: number; skipped: number } {
  return { web: webInstalls, wx: wxInstalls, skipped: skippedInstalls }
}

/** 测试/诊断复位（**不**清空已装集合——那只应随对象生命周期结束）。 */
export function resetLifecycleInstallStats(): void {
  webInstalls = 0
  wxInstalls = 0
  skippedInstalls = 0
}
