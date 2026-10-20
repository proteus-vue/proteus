// website/scripts/lib/hook-bridge-refs.d.mts
// 类型声明（配套 hook-bridge-refs.mjs）——供以 TS 导入时拿到类型（否则 TS7016「找不到声明文件」）。
// 纯解析函数，签名与实现同源。

/** hooks 工厂函数名（`capability.ts`）——契约常量；改源码工厂名须同步此表 */
export const HOOK_FACTORY: string

/**
 * ★#1112：**runtime 间接引用契约**——hook 经 runtime 方法转手引桥时（如
 * `useWebSocket → res.connectWs(bridge,…)`），此表声明「runtime 方法 → 它内部真正读取的桥方法名」。
 * 抽取时据此**展开**，否则该 hook 的 refs 为空 ⇒ 对外会谎报「能力桥未接线」。
 */
export const RUNTIME_INDIRECT_REFS: Record<string, string[]>

/** 抽取结果 */
export interface HookRefExtract {
  /** `refs[hookName]` = 该 hook 取值片段内引用的桥方法名（去重、保持首次出现顺序） */
  refs: Record<string, string[]>
  /** 解析到的顶层成员数（≈ hooks 对象成员数） */
  hookCount: number
  /** 桥接收者形参名（由形参表推导，正常为 `bridge`） */
  receiver: string
  /** 顶层重名成员（同一 hook 名出现多次——旧实现会静默取后者） */
  duplicates: string[]
  /** 失败原因（空数组 = 成功）；非空即「数据源契约被破坏」 */
  misses: string[]
}

/** 纯函数抽取：给定源码 → 结果（不抛错，问题汇总到 misses） */
export function extractHookBridgeRefs(src: string, factory?: string): HookRefExtract

/** 从文件读并抽取；文件缺失 / 工厂符号缺失 / 返回对象缺失 / 合计 0 引用 ⇒ 抛错（硬失败） */
export function loadHookBridgeRefs(
  filePath: string,
  factory?: string,
): { refs: Record<string, string[]>; hookCount: number; receiver: string; duplicates: string[] }
