// component-props.d.mts —— scripts/lib/component-props.mjs 的类型声明（照 website/scripts/lib/wit.d.mts 先例）
// 该 .mjs 为共享脚本工具（被 audit-component-attrs / audit-degradation 与测试共用），不在 tsconfig paths 内；
// 测试经相对路径导入，需结构声明避免 TS7016（隐式 any）。仅声明测试消费的公开契约。

/** 仓库根（绝对路径） */
export const ROOT: string
/** 框架组件目录（packages/components） */
export const COMPONENTS_DIR: string

/** 全部框架组件目录名（p-*，按字母序） */
export function listComponentDirs(): string[]

/**
 * 从框架组件源码抽 props 名（defineProps 块内的 camelCase 键）。
 * @returns null = 无 index.vue；[] = 有文件但无 defineProps
 */
export function propsOf(dir: string): string[] | null

/** 全部组件的 {tag, props} 规格（供门禁遍历） */
export function componentSpecs(): Array<{ tag: string; props: string[] }>
