// website/scripts/lib/bridge-keys.d.mts
// 类型声明（配套 bridge-keys.mjs）——供 tests/gen-content-bridge-keys.test.ts 等以 TS 导入时
// 拿到类型（否则 TS7016「找不到声明文件」）。纯解析函数，签名与实现同源。

/** 手写桥工厂名（`capability-bridges.ts` 的 wxBridge / webBridge）——契约常量 */
export const HANDWRITTEN_BRIDGE_FACTORIES: { wx: string; web: string }

/** 声明式桥工厂名（`generated/bridge-ext.ts` 的 mpBridgeExt / webBridgeExt）——契约常量 */
export const DECLARATIVE_BRIDGE_FACTORIES: { wx: string; web: string }

/** 声明式桥生成物的仓库相对路径 */
export const BRIDGE_EXT_REL_PATH: string

/** 生成物导出的声明数常量名 */
export const DECLARED_COUNT_CONST: string

/** 抽取结果 */
export interface BridgeKeysExtract {
  /** MP 侧桥方法名并集（wxBridge ∪ mpBridgeExt） */
  wxKeys: Set<string>
  /** Web 侧桥方法名并集（webBridge ∪ webBridgeExt） */
  webKeys: Set<string>
  /** 各工厂解析到的顶层成员数（键 = 函数名） */
  perFn: Record<string, number>
  /** 生成物声明的能力数（未解析到 = -1） */
  declaredCount: number
  /** 失败原因（空数组 = 成功）；非空即「数据源契约被破坏」 */
  misses: string[]
}

/** 纯函数抽取：手写桥源码 + 声明式桥生成物源码 → 结果（不抛错，问题汇总到 misses） */
export function extractBridgeKeys(handSrc: string, extSrc: string): BridgeKeysExtract

/** 从文件读并抽取；文件缺失 / 工厂符号缺失 / 返回对象缺失 / 成员数与声明数不等 ⇒ 抛错（硬失败） */
export function loadBridgeKeys(handSrcPath: string, extSrcPath: string): BridgeKeysExtract
