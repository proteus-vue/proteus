// wit.d.mts —— website/scripts/lib/wit.mjs 的类型声明（G-60 B1「文档即契约」基建）
// 该 .mjs 为构建脚本（website），不在 tsconfig paths 内；测试经相对路径导入，需结构声明避免 any。
// 仅声明测试消费的公开契约；解析模型与 .mjs 实现保持同构。

/** WIT 类型块（record/enum/variant）字段 */
export interface WitField {
  name: string
  type?: string
}

/** WIT func 参数 */
export interface WitParam {
  name: string
  type: string
}

/** interface 内条目（func 或类型块） */
export interface WitItem {
  kind: 'func' | 'record' | 'enum' | 'variant'
  name: string
  doc: string
  params?: WitParam[]
  result?: string
  fields?: WitField[]
}

/** 单个 .wit 文件解析结果 */
export interface WitInterface {
  name: string
  doc: string
  items: WitItem[]
}

export interface ApiSpec {
  version: string | null
  package: string | null
  interfaces: WitInterface[]
}

/** SPEC_DIFF 单条差异 */
export interface SpecChange {
  name: string
  kind: 'removed' | 'changed'
  breaking: boolean
  detail: string
}

export interface SpecDiff {
  added: string[]
  removed: string[]
  changed: SpecChange[]
  breaking: SpecChange[]
}

export function parseWit(text: string, options?: { version?: string | null }): ApiSpec
export function lintSpec(spec: ApiSpec): string[]
export function sourceHash(text: string): string
export function renderSpecMd(spec: ApiSpec, ifaceName: string, options?: { sourceHash?: string; order?: number }): string | null
export function checkDrift(committed: string, generated: string): { status: 'fresh' | 'stale'; message?: string }
export function diffSpecs(oldSpec: ApiSpec, newSpec: ApiSpec): SpecDiff
