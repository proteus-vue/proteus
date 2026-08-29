// src/compiler/overrides.ts
// 规则覆盖解析 —— ★底线循环 ①③：AI / proteus.config.ts 改写或禁用编译规则，编译器即时生效
// 所有转换函数（template/style/script）从本模块取"生效的映射表 + 禁用集"，不再直接读 tags.ts 常量
import { TAG_MAP, EVENT_MAP, SEMANTIC_CLASS } from './tags'
import { getTransformRule } from './transforms/registry'
import type { TransformRuleOverrides } from './types'

/** 解析后的生效配置（供转换函数查询） */
export interface ResolvedOverrides {
  /** 生效的标签映射（TAG_MAP + customTags + tag/* 规则覆盖） */
  tagMap: Record<string, string>
  /** 生效的事件映射（EVENT_MAP + event/click-to-tap 覆盖） */
  eventMap: Record<string, string>
  /** 生效的语义基础类（SEMANTIC_CLASS + semantic/base-class 覆盖） */
  semanticClass: Record<string, string>
  /** 被禁用的规则 ID 集合 */
  disabled: Set<string>
}

/** 解析规则覆盖：合并 tags.ts 常量 + 覆盖补丁；未知规则 ID 编译期警告（防配置笔误） */
export function resolveOverrides(options?: TransformRuleOverrides): ResolvedOverrides {
  const tagMap: Record<string, string> = { ...TAG_MAP }
  const eventMap: Record<string, string> = { ...EVENT_MAP }
  const semanticClass: Record<string, string> = { ...SEMANTIC_CLASS }
  const disabled = new Set<string>(options?.disabled ?? [])

  for (const [ruleId, patch] of Object.entries(options?.mapping ?? {})) {
    const rule = getTransformRule(ruleId)
    if (!rule) {
      console.warn(`[proteus] 规则覆盖引用了未注册的规则 ID：${ruleId}（已忽略，可用 listTransformRules() 查看合法 ID）`)
      continue
    }
    if (rule.id.startsWith('tag/')) Object.assign(tagMap, patch)
    else if (rule.id === 'event/click-to-tap') Object.assign(eventMap, patch)
    else if (rule.id === 'semantic/base-class') Object.assign(semanticClass, patch)
    else console.warn(`[proteus] 规则 ${ruleId} 不支持 mapping 覆盖（仅 tag/* / event/click-to-tap / semantic/base-class）`)
  }

  // 自定义标签映射：AI 扩展新标签的入口（最高优先级）
  Object.assign(tagMap, options?.customTags)

  for (const id of disabled) {
    if (!getTransformRule(id)) console.warn(`[proteus] 规则覆盖禁用了未注册的规则 ID：${id}（已忽略）`)
  }

  return { tagMap, eventMap, semanticClass, disabled }
}
