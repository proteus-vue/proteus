// website/scripts/lib/harmony-host-keys.d.mts
// 类型声明（配套 harmony-host-keys.mjs）——供生成器与契约测试以 TS 导入时拿到类型。

/** 桥方法 → 鸿蒙宿主方法名（`null` = 不由宿主回答，页面保持 🟡） */
export const BRIDGE_TO_HOST: Record<string, string | null>

/** 承载设备域桥的工厂函数名 */
export const DEVICE_BRIDGE_FACTORY: string

/** 鸿蒙宿主里承载能力分发的源码（相对仓库根） */
export const HARMONY_HOST_SOURCES: string[]

/** 从宿主 C++ 源码抽出已实现的方法名字面量 */
export function extractHarmonyHostMethods(src: string): Set<string>

/** 加载鸿蒙真的回答得了的桥方法名集合 */
export function loadHarmonyBridgeKeys(root: string): {
  keys: Set<string>
  bridgeMethods: string[]
  hostMethods: Set<string>
  misses: string[]
}

/** 鸿蒙端在能力页上的分档（生成器唯一判定入口） */
export function harmonyEndStatus(
  root: string,
  refs: string[],
  appBridgeKeys: Set<string>,
  en?: boolean,
): { status: string; note: string }
