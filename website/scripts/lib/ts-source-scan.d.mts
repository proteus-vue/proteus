// website/scripts/lib/ts-source-scan.d.mts
// 类型声明（配套 ts-source-scan.mjs）——供以 TS 导入时拿到类型（否则 TS7016「找不到声明文件」）。
// 纯结构化扫描原语（不执行 TS）；签名与实现同源。

/** 注释/字符串 → 等长空白（保留换行）后的源码（长度与换行位置不变） */
export function maskNonCode(src: string): string

/** 圆括号配对；返回与 `open` 处 `(` 配对的 `)` 下标，不配对返回 -1 */
export function matchParen(masked: string, open: number): number

/** 花括号配对；返回与 `open` 处 `{` 配对的 `}` 下标，不配对返回 -1 */
export function matchBrace(masked: string, open: number): number

/** 函数体范围（`params` = 参数表范围，用于推导形参名） */
export interface FunctionBody {
  open: number
  close: number
  params: { open: number; close: number } | null
}

/** 定位 `export function <name>` 的函数体；找不到返回 null */
export function findFunctionBody(masked: string, name: string): FunctionBody | null

/** 函数体顶层最后一个 `return {` 的 `{` 下标；找不到返回 -1 */
export function findTopReturnObject(masked: string, body: FunctionBody): number

/** 对象体顶层成员（含取值片段） */
export interface TopLevelEntry {
  name: string
  value: string
  start: number
  end: number
}

/** 切分对象体顶层（深度 0）成员 → `[{ name, value, start, end }]` */
export function topLevelEntries(masked: string, open: number, close: number): TopLevelEntry[]

/** 对象体顶层成员名序列（`topLevelEntries` 的薄封装） */
export function topLevelMemberNames(masked: string, open: number, close: number): string[]

/** `export function <name>` 的顶层 `return {` 成员名抽取结果（`miss` 非空即结构失败，不抛错） */
export interface ReturnObjectMembers {
  /** 顶层成员名；为空且 `miss` == null = 合法空集（`return {}`），非失败 */
  names: string[]
  miss: string | null
}

/** `export function <name>` → 顶层 `return {` → 顶层成员名（失败信息放 `miss`，不抛错） */
export function returnObjectMembers(masked: string, name: string): ReturnObjectMembers
