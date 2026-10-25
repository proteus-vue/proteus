// packages/api/src/capability-app-fallback.ts
// ★★★#1238 App 宿主上「禁止 web 兜底冒充」的合并规则 —— 从 `capability.ts` 拆出（反巨型化）。
//
// 【这是个真 bug（#1238 Hook 层 E2E 抓出来的，不是重构）】
//   装配顺序是 `webBridge → webBridgeExt → appCaps`，App 能力只是**覆盖同名键**；
//   当 App 能力**不可用**（工厂返回 `{}`）时，**web 的实现留在原位接管**：
//     · `getStorage`    → `memoryStorage()`（或 localStorage；App 的 QuickJS/JSC 里都没有）
//     · `getFileSystem` → `memoryFileSystem()`（纯内存假文件系统）
//     · `log`           → `console`（**不进** logcat / os_log / hilog）
//   ⇒ 业务调 `useStorage().set()` **成功返回**，重启后数据全没；而能力页写着"鸿蒙如实不可用"。
//   ★这与 #1207 / #1226 在**桥工厂**里守住的"绝不用内存兜底冒充持久化"直接冲突——
//     那两处只挡住了工厂层，**装配层的兜底把它打穿了**（只在桥工厂写测试发现不了）。
//
// 【为什么只删这三个键，不把所有键都删】
//   App 端其余域（媒体/位置/支付…）**故意**走 web 桥降级（`capability.ts` 的注释：
//   逐域铺开、不冒充已完成）。那类"降级"在页面上标 ⚠️ 且行为是"能力弱一点"；
//   而持久化 / 文件 / 日志的兜底是**语义谎言**（数据看起来存住了、日志看起来记了）
//   ⇒ 这三类的缺失必须**可见**（如实 unsupported），由业务自己决定降级策略。
//
// 【★判据】`tests/capability-app-hook-e2e.test.ts` 的 ⑥⑦⑧（反向对照）——
//   破坏性验证过：删掉本文件的删除逻辑 ⇒ 三条当场红。
import { detectAppHost } from './capability-app'

/**
 * App 宿主上**不得**由 web 桥兜底的桥成员。
 * ★新增条目必须有"兜底 = 语义谎言"的理由（不是"更好用"）——否则会把合理的降级也掐掉。
 */
export const APP_NO_WEB_FALLBACK = ['getStorage', 'getFileSystem', 'log'] as const

/**
 * 合并 web 桥与 App 能力，并在 App 宿主上掐掉"语义谎言"兜底。
 *
 * @param webLayer `{ ...webBridge(...), ...webBridgeExt(...) }` 的结果
 * @param appCaps  App 能力（`detectAppHost()` 为假时是空对象）
 */
export function mergeWebWithApp<T extends object>(webLayer: T, appCaps: object): T {
  const merged = { ...webLayer, ...appCaps } as Record<string, unknown>
  if (detectAppHost()) {
    for (const key of APP_NO_WEB_FALLBACK) {
      // ★只在 App **没提供**时删：App 提供了真实现就保留它（那是正常覆盖）
      if (!(key in appCaps)) delete merged[key]
    }
  }
  return merged as T
}
