// packages/hmr/src/style-gate/index.ts —— Style Safety 可视化数据源（devtools-plus G-34 M2）
// 「编译透明」原则的直接体验：每条样式经闸门链（白名单 → 校验 → 平台收窄）的完整记录，
// 供 DevTools 面板展示（放行/拒绝/降级 + 各端原生值映射）。
// ★纯函数（联动 @proteus-vue/runtime/style-safety），零副作用可单测。
import { ALLOWED_STYLE_PROPS, validateProp, narrowValue } from '@proteus-vue/runtime/style-safety'
import type { StylePlatform } from '@proteus-vue/runtime/style-safety'

export type StyleGateName = 'whitelist' | 'validator' | 'narrowing'

/** 单条闸门判定 */
export interface StyleGateStep {
  gate: StyleGateName
  decision: 'pass' | 'reject' | 'narrow'
  detail: string
}

/** 样式闸门记录（可视化单元） */
export interface StyleGateRecord {
  prop: string
  value: unknown
  /** 闸门链判定轨迹 */
  gates: StyleGateStep[]
  /** 最终决策：pass（原样）/ narrow（平台值映射）/ drop（拒绝丢弃） */
  decision: 'pass' | 'narrow' | 'drop'
  /** narrow 时的各端原生值映射 */
  nativeValues?: Partial<Record<StylePlatform, unknown>>
  /** drop 时的拒绝原因 */
  rejectReason?: string
}

export interface CollectStyleGateOptions {
  /** 收窄平台（缺省 'web'——单平台决策链） */
  platform?: StylePlatform
  /** 是否同时产出全部平台原生值映射（allPlatforms 时 nativeValues 全量五端） */
  allPlatforms?: boolean
}

const ALL_PLATFORMS: StylePlatform[] = ['web', 'skyline', 'ios', 'android', 'harmony']

/** 白名单等级 → 可读原因 */
function whitelistReason(prop: string, level: string): string {
  if (level === 'SEMANTIC_ONLY') return `${prop} 必须用 p-* 语义组件（STS003）`
  if (level === 'FORBIDDEN') return `${prop} 已禁用（STS004）`
  return `${prop} 不在样式白名单（STS001）`
}

/** 样式对象 → 闸门记录[]（每 prop 一条完整决策链） */
export function collectStyleGateRecords(
  style: Record<string, unknown>,
  options: CollectStyleGateOptions = {},
): StyleGateRecord[] {
  const platform = options.platform ?? 'web'
  const records: StyleGateRecord[] = []
  for (const [prop, value] of Object.entries(style)) {
    const gates: StyleGateStep[] = []
    const level = ALLOWED_STYLE_PROPS[prop as keyof typeof ALLOWED_STYLE_PROPS] as string | undefined

    // ① 白名单闸门
    if (level === undefined || level === 'SEMANTIC_ONLY' || level === 'FORBIDDEN') {
      const reason = whitelistReason(prop, level ?? '')
      gates.push({ gate: 'whitelist', decision: 'reject', detail: reason })
      records.push({ prop, value, gates, decision: 'drop', rejectReason: reason })
      continue
    }
    gates.push({ gate: 'whitelist', decision: 'pass', detail: '白名单放行' })

    // ② 校验闸门（validateProp：类型守卫 + 平台收窄一体）
    const result = validateProp(prop, value, platform)
    if (!result.valid) {
      const reason = result.reason || `值类型非法: ${String(value)}`
      gates.push({ gate: 'validator', decision: 'reject', detail: reason })
      records.push({ prop, value, gates, decision: 'drop', rejectReason: reason })
      continue
    }
    gates.push({ gate: 'validator', decision: 'pass', detail: '类型校验通过' })

    // ③ 平台收窄闸门（逐平台原生值映射）
    const nativeValues: Partial<Record<StylePlatform, unknown>> = {}
    let changedAny = false
    for (const p of ALL_PLATFORMS) {
      if (!options.allPlatforms && p !== platform) continue
      const n = narrowValue(prop, value, p)
      nativeValues[p] = n.valid ? n.value : value
      if (n.valid && n.value !== value) changedAny = true
    }
    const changed = result.value !== value || changedAny
    if (changed) {
      gates.push({
        gate: 'narrowing',
        decision: 'narrow',
        detail: `平台收窄（${platform}）：${JSON.stringify(result.value)}`,
      })
      records.push({ prop, value, gates, decision: 'narrow', nativeValues: options.allPlatforms ? nativeValues : { [platform]: result.value } })
    } else {
      gates.push({ gate: 'narrowing', decision: 'pass', detail: '无需收窄（原样透传）' })
      records.push({ prop, value, gates, decision: 'pass', nativeValues: options.allPlatforms ? nativeValues : { [platform]: result.value } })
    }
  }
  return records
}
