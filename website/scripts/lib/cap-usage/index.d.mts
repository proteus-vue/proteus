// website/scripts/lib/cap-usage/index.d.mts
// 类型声明（配套 cap-usage/index.mjs）——供生成器与测试以 TS 导入时拿到类型。

/** 一条双语言示例：zh/en 两段行数组（代码骨架相同，注释/文案不同） */
export interface UsageExample { zh: string[]; en: string[] }

/** 能力页「用法」示例全集（键 = hook 名） */
export const CAP_USAGE: Record<string, UsageExample>

/** 取某 hook 的示例（按语言）；未登记 ⇒ null（调用方走派生模板） */
export function usageOf(hook: string, lang?: 'zh' | 'en'): string[] | null

/** 自检：中英两段的代码骨架必须逐行对应（不一致 ⇒ 抛错） */
export function assertUsageParity(): void
