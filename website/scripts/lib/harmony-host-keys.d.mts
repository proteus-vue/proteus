// website/scripts/lib/harmony-host-keys.d.mts
// 类型声明（配套 harmony-host-keys.mjs）——供生成器与契约测试以 TS 导入时拿到类型。

/** 桥方法 → 鸿蒙宿主方法名（`null` = 不由宿主方法分派回答，走专门通道判定） */
export const BRIDGE_TO_HOST: Record<string, string | null>

/** 承载设备域桥的工厂函数名 */
export const DEVICE_BRIDGE_FACTORY: string

/** 元素查询域（#1081）的桥工厂名与方法映射 */
export const ELEMENT_BRIDGE_FACTORY: string
export const ELEMENT_BRIDGE_TO_HOST: Record<string, string | null>

/** 参与鸿蒙分档的全部桥源（文件 + 工厂 + 该域的映射表） */
export const HARMONY_BRIDGE_SOURCES: Array<{
  file: string
  factory: string
  map: Record<string, string | null>
}>

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

/** 鸿蒙端在能力页上的分档（按"宿主有无该方法"三档） */
export function harmonyEndStatus(
  root: string,
  refs: string[],
  appBridgeKeys: Set<string>,
  en?: boolean,
): { status: string; note: string }

/** 「壳主动推」类通道的源码证据（每端：实现 + 装配点） */
export const KEYBOARD_PUSH_SOURCES: Record<
  'android' | 'ios' | 'harmony',
  Array<{ file: string; tokens: string[] }>
>

/** 该端是否真的会推键盘事件（读源码，不看桥方法） */
export function hasKeyboardPush(root: string, end: 'android' | 'ios' | 'harmony'): boolean

/** 推送型能力的端分档（桥方法齐 ≠ 可用，还要壳真的推） */
export function pushChannelStatus(
  root: string,
  end: 'android' | 'ios' | 'harmony',
): { supported: boolean; note: string }

/** 推送缺失时的英文说明 */
export const PUSH_MISS_EN: string

/** App 三端（iOS/Android/鸿蒙）能力分档的唯一判定入口（含推送型能力的附加判据） */
export function appEndStatus(
  root: string,
  end: 'ios' | 'android' | 'harmony',
  refs: string[],
  appBridgeKeys: Set<string>,
  opts: {
    capSlug: string
    pushCapabilities: Set<string>
    verified: Set<string>
    en?: boolean
  },
): { status: string; note: string }
