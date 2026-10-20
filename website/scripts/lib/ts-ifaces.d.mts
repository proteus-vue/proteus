// website/scripts/lib/ts-ifaces.d.mts
// 类型声明（配套 ts-ifaces.mjs）——供以 TS 导入时拿到类型（否则 TS7016「找不到声明文件」）。
// ★#1130：本文件由 #1129 引入但当时没补声明 ⇒ 根 tsconfig 的 `npx vue-tsc --noEmit` 一直红。

/** 接口属性成员 */
export interface IfaceProp {
  name: string
  /** `foo?: T` 的可选标记 */
  optional: boolean
  /** 类型文本（未解析；`namesIn` 会从里面抽类型名） */
  type: string
  doc: string
}

/** 接口方法成员 */
export interface IfaceMethod {
  name: string
  /** 原始签名行（已去尾部分号） */
  sig: string
  doc: string
}

/** 一个接口（或别名指向的接口）的成员表 */
export interface IfaceInfo {
  props: IfaceProp[]
  methods: IfaceMethod[]
  /** 仅 `export type X = Y` 形态存在；解析成功后被真接口替换 */
  aliasOf?: string
}

/** 接口名 → 成员表 */
export type IfaceMap = Record<string, IfaceInfo>

/** 抽 `export interface X { ... }` 成员（含 `export type X = Y` 别名收集）。 */
export function extractInterfaces(src: string): IfaceMap

/** 解析**已合并的多文件**结果里的 alias 链（最多 5 跳，防循环）；原地改写并返回。 */
export function resolveAlias(ifaces: IfaceMap): IfaceMap

/** 取某接口名 → 属性名集合（门禁最常用的形态）。 */
export function propsOf(ifaces: IfaceMap, name: string): Set<string>
