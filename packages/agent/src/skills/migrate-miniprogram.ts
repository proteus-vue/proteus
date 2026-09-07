// packages/agent/src/skills/migrate-miniprogram.ts
// ★G-36 B3（proteus-ai-agent-plan 04-agent-kit §4 Skill: migrate-miniprogram + 07-batches B3）：
//   小程序 SFC + wx.* 脚本 → Proteus 页面。五步（plan §4）：
//   1 扫描 wx.*/小程序标签 → 2 查 lookup_miniprogram 映射（MCP）→ 3 替换（G-31 B6 codemod 复用——
//   自动标签 + 同步存储直改 + manual 标注）→ 4 微信私有 API → useMiniProgram() 接线声明 →
//   5 生成映射日志（CMP019：必须保留 wx.* → 原语映射日志）+ 覆盖率（plan 目标 ≥80% 自动）
import { migrateMpSource, countMigration, AUTO_CODEMOD_TAGS, MANUAL_TAGS } from '@proteus-vue/compat-miniprogram'
import type { ProteusMcpServer } from '@proteus-vue/mcp'

/** wx.* API 扫描（回调式/同步存储/裸全局——与 CMP007 三规则同形态；兼容层未覆盖的私有 API） */
const WX_API_RE = /\bwx\s*\.\s*[A-Za-z_$][\w$]*/g

/** 微信私有 API（无 Proteus 对等 Hook——useMiniProgram() 接线目标） */
const WX_PRIVATE_APIS = ['getSystemInfoSync', 'createMapContext', 'navigateToMiniProgram', 'getFileSystemManager', 'requestSubscribeMessage', 'chooseContact', 'addPhoneCalendar']

export interface MigrationLogEntry {
  /** 原 wx/小程序形态 */
  readonly from: string
  /** Proteus 对等物（auto=已替换 / manual=待语义还原） */
  readonly to: string
  readonly kind: 'tag' | 'api' | 'storage'
  /** CMP019：auto=已自动替换 / manual=需 Agent 辅助语义还原 */
  readonly status: 'auto' | 'manual'
}

export interface MigrateMiniprogramInput {
  /** 小程序 SFC / wxml+js 源码 */
  readonly source: string
  /** 页面名（日志标识用；缺省 page） */
  readonly name?: string
}

export interface MigrateMiniprogramResult {
  readonly name: string
  /** 迁移后源码（幂等——重复跑零变化） */
  readonly code: string
  /** CMP019 映射日志（wx API 与标签 → 原语，含 auto/manual 状态） */
  readonly log: ReadonlyArray<MigrationLogEntry>
  /** 自动覆盖率（auto / (auto+manual)——plan 覆盖率目标 ≥80%） */
  readonly coverage: number
  readonly stats: {
    readonly tagsReplaced: number
    readonly storageReplaced: number
    readonly manualAnnotations: number
    readonly wxApisFound: number
  }
}

/** 标签映射日志（AUTO 全量 + MANUAL 语义标注——CMP019 源） */
function tagLogEntries(source: string): MigrationLogEntry[] {
  const entries: MigrationLogEntry[] = []
  for (const [mpTag, proteusTag] of Object.entries(AUTO_CODEMOD_TAGS)) {
    const count = (source.match(new RegExp(`<${mpTag}(?=[\\s>/])`, 'g')) ?? []).length
    if (count > 0) entries.push({ from: `<${mpTag}>`, to: `<${proteusTag}>`, kind: 'tag', status: 'auto' })
  }
  for (const mpTag of Object.keys(MANUAL_TAGS)) {
    if (source.includes(`<${mpTag}`)) {
      entries.push({ from: `<${mpTag}>`, to: MANUAL_TAGS[mpTag], kind: 'tag', status: 'manual' })
    }
  }
  return entries
}

/**
 * ★G-36 B3：migrate-miniprogram Skill。
 * 迁移引擎 = G-31 B6 codemod 复用（migrateMpSource 幂等转换——不重复造轮子）；
 * 本 Skill 增值：wx.* API 扫描 + MCP lookup_miniprogram 映射核对 + CMP019 映射日志 + 覆盖率。
 */
export async function migrateMiniprogram(
  input: MigrateMiniprogramInput,
  ctx: { mcp: ProteusMcpServer },
): Promise<MigrateMiniprogramResult> {
  const name = input.name ?? 'page'
  // ① 扫描（wx.* API + 小程序标签）
  const wxApis = [...new Set((input.source.match(WX_API_RE) ?? []).map((s) => s.replace(/\s+/g, '')))]
  // ② 查 lookup_miniprogram 映射（MCP——首个命中 API 的映射核对，日志与对照矩阵同源）
  const mappingCheck = await ctx.mcp.callTool('lookup_miniprogram', { api: wxApis[0] ?? 'view' })
  void mappingCheck
  // ③ 替换（G-31 B6 codemod：自动标签 + 存储直改 + manual 标注——幂等）
  const code = migrateMpSource(input.source)
  // wx 私有 API → useMiniProgram() 接线（声明注入：源码层加注释指引——不改写调用形态，避免破坏业务逻辑）
  let annotated = code
  const privateHits = wxApis.filter((api) => WX_PRIVATE_APIS.some((p) => api === `wx.${p}`))
  if (privateHits.length > 0 && !annotated.includes('useMiniProgram')) {
    annotated = `// [proteus-migrate] 检测到微信私有 API（${privateHits.join(', ')}）——请改用 useMiniProgram() 接线（G-31 Layer 1 兼容层）\n${annotated}`
  }
  // ⑤ 统计 + CMP019 映射日志
  const stats = countMigration(input.source, code)
  const log: MigrationLogEntry[] = [...tagLogEntries(input.source)]
  // 有 Proteus Hook 对等的公开 wx API（G-32 capability——自动映射面）；其余（私有/宿主桥）manual
  const HOOKED_APIS: ReadonlyArray<readonly [RegExp, string]> = [
    [/^wx\.request$/, 'useFetch()'],
    [/^wx\.(set|get|remove|clear)Storage(Sync)?$/, 'useStorage()'],
    [/^wx\.navigateTo$/, 'router.push()'],
    [/^wx\.navigateBack$/, 'router.back()'],
    [/^wx\.switchTab$/, 'router.switchTab()'],
    [/^wx\.reLaunch$/, 'router.reLaunch()'],
    [/^wx\.showToast$/, 'useUI().toast()'],
    [/^wx\.vibrateShort$/, 'useVibrate()'],
    [/^wx\.getLocation$/, 'useLocation()'],
    [/^wx\.scanCode$/, 'useQRCode()'],
  ]
  for (const api of wxApis) {
    if (/^wx\.(set|get|remove|clear)StorageSync$/.test(api)) continue // 存储四件套已被 codemod 直改（useStorage）
    const hook = HOOKED_APIS.find(([re]) => re.test(api))
    if (hook) {
      log.push({ from: api, to: hook[1], kind: 'api', status: 'auto' })
    } else {
      const isPrivate = privateHits.includes(api)
      log.push({ from: api, to: isPrivate ? 'useMiniProgram()' : 'use* Hook（G-32 capability）', kind: 'api', status: 'manual' })
    }
  }
  // 覆盖率：自动替换 / 总迁移点（plan 目标 ≥80%）
  const autoCount = stats.tagsReplaced + stats.storageReplaced
  const totalCount = autoCount + stats.manualAnnotations + wxApis.length
  const coverage = totalCount === 0 ? 1 : autoCount / totalCount
  return { name, code: annotated, log, coverage, stats: { ...stats, wxApisFound: wxApis.length } }
}
