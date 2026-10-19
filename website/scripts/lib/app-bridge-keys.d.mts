// website/scripts/lib/app-bridge-keys.d.mts
// 类型声明（配套 app-bridge-keys.mjs）——供 tests/gen-content-app-bridge.test.ts 等以 TS 导入时
// 拿到类型（否则 TS7016「找不到声明文件」）。纯解析函数，签名与实现同源。

/** App 桥的两个工厂函数名（`capability-app.ts`）——契约常量；改源码工厂名须同步此表 */
export const APP_BRIDGE_FACTORIES: string[]

/** 抽取结果 */
export interface AppBridgeExtract {
  /** 桥方法名并集（两个工厂返回对象的成员名） */
  keys: Set<string>
  /** 各工厂解析到的顶层成员数 */
  perFn: Record<string, number>
  /** 失败原因（空数组 = 成功）；非空即「数据源契约被破坏」 */
  misses: string[]
}

/** 纯函数抽取：给定源码 + 工厂函数名列表 → 结果（不抛错，问题汇总到 misses） */
export function extractAppBridgeKeys(src: string, functions?: string[]): AppBridgeExtract

/** 从文件读并抽取；文件缺失 / 工厂符号缺失 / 返回对象缺失 / 抽到 0 个 ⇒ 抛错（硬失败） */
export function loadAppBridgeKeys(
  filePath: string,
  functions?: string[],
): { keys: Set<string>; perFn: Record<string, number> }

/** 多源契约（文件 → 该文件的工厂名）。新增 App 桥源文件必须登记在此。 */
export const APP_BRIDGE_SOURCES: Array<{ file: string; functions: string[] }>

/** 从多个源文件读并合并；任一源缺失/解析失败 ⇒ 抛错（不静默漏判） */
export function loadAppBridgeKeysFrom(
  root: string,
  sources?: Array<{ file: string; functions: string[] }>,
): { keys: Set<string>; perSource: Record<string, { perFn: Record<string, number>; count: number }> }
