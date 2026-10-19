// website/scripts/lib/bridge-impl-reality.d.mts
// 类型声明（配套 bridge-impl-reality.mjs）——供生成器与测试以 TS 导入时拿到类型。

/** 桥成员的实现档位：shell = 纯空壳（恒 Err）· real = 有平台入口 · pure-js = 无 unsupported（证不出空壳） */
export type MemberReality = 'shell' | 'real' | 'pure-js'

/** 一个端参与判定的桥源（手写桥 + 声明式生成物） */
export interface BridgeSource { file: string; factory: string }

/** 参与判定的平台桥源（按端） */
export const BRIDGE_SOURCES: Record<'web' | 'mp', BridgeSource[]>

/** 剥掉注释与字符串/模板字面量内容（保留标识符与调用结构） */
export function stripLiterals(code: string): string

/** 判定一个桥成员的方法体属于哪一档 */
export function classifyMemberBody(code: string, end: 'web' | 'mp'): MemberReality

/** 从工厂函数的返回对象里抽出「成员名 → 方法体」（文本解析，不执行 TS） */
export function extractFactoryMembers(src: string, factory: string): Record<string, string>

/** 加载某端的纯空壳成员集（带缓存） */
export function loadPureShellMembers(root: string, end: 'web' | 'mp'): Set<string>

/** 清缓存（改源码后重新判定；测试用） */
export function resetBridgeRealityCache(): void
