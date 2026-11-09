// plugin-tools.ts —— 插件开发相关的 MCP 工具（决策 #1471）
//
// 【为什么需要这一组】`@proteus-vue/mcp` 现有 11 个工具覆盖的是「Agent 写 Proteus 业务页面」
//   （原语 / design token / 能力矩阵 / IR 校验 / 代码生成），**没有一个是给"写插件"用的**。
//   而插件 API 恰恰是 AI 最容易编造的东西——capability 名、tier 限制、Provider 入出参形状
//   都记不住，凭印象写出来的 manifest 会被安装闸拒掉，然后 AI 继续瞎猜下一个名字。
//
// 【★★硬边界：本文件不提供 install / enable / 任意能力执行】
//   MCP 客户端是 AI。若 AI 能装插件，它就能给自己装后门、给别人的仓库植入后门。
//   安装与人确认必须留在**人**这一侧。（同源：G-58「提案 API 禁发布」——发布期强制校验，
//   不是君子协定；也同源 #1470 的 `terminal` 定级思路：危险动作靠能力边界挡，不靠文案提醒。）
//
// 【★★单一真源】capability 表读同目录的 `plugin-capabilities.json`。
//   Rust 侧安装闸**将来必须读同一份**：两边各抄一份必然漂移，那时 MCP 说"校验通过"、
//   宿主却拒装——那正是本仓反复踩过的「判据通过 ≠ 功能可用」的变体。
//   构建说明：esbuild `--bundle` 会把 JSON 内联进 dist，所以发布产物里没有独立 JSON 副本，
//   真源始终是源码树里这一份。
//
// 【为什么不提供 plugin_dry_run（真跑格式化/Provider）】
//   它要真起进程（prettier / rustfmt / tsserver）。MCP server 是**用户机器上的独立进程**，
//   给它开"任意起进程"的口子，等于把 #1470 里刚定级的 `spawnProcess` 边界从侧门拆掉。
//   要做也只能是"在 Studio 里由人点一下 dry run"，不能由 MCP 直接调。

import caps from './plugin-capabilities.json'
import type { McpToolDefWithHandler } from './tools'

interface CapabilityRow {
  readonly id: string
  readonly grant: 'auto' | 'user'
  readonly minTier: string
  readonly reasonRequired: boolean
  readonly requires?: string
  readonly status: 'stable' | 'proposed'
  readonly implemented: boolean
  readonly summary: string
  readonly commands: readonly string[]
}

interface ProviderKindRow {
  readonly kind: string
  readonly status: 'has-channel' | 'no-channel'
  readonly summary: string
  readonly channel: string | null
}

const TABLE = caps as unknown as {
  readonly version: string
  readonly tiers: readonly string[]
  readonly capabilities: readonly CapabilityRow[]
  readonly providerKinds: readonly ProviderKindRow[]
}

/** tier 高低（数字越大权限越高）。★与 Rust 侧 `TIER_RANK` 必须一致。 */
const TIER_RANK: Record<string, number> = { builtin: 3, trusted: 2, 'third-party': 1 }

/** 包名前缀（防抢注普通包名）。 */
const NAME_PREFIXES = ['@proteus-studio/', 'proteus-studio-plugin-']

interface Issue {
  readonly code: string
  readonly message: string
}

const capById = (id: string): CapabilityRow | undefined => TABLE.capabilities.find((c) => c.id === id)

/**
 * manifest 校验 —— **这是安装闸的规格**，不是"友好提示"。
 * 返回 errors（装不上）与 warnings（能装但要注意），严重度必须分开：
 *   · `implemented: false` 是 **error**（宿主没有对应实现，装上也是"点了没反应"）
 *   · `status: proposed` 是 **warning**（方向对，但还没收编，将来可能变）
 */
export function validateManifest(raw: unknown): { ok: boolean; errors: Issue[]; warnings: Issue[] } {
  const errors: Issue[] = []
  const warnings: Issue[] = []

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: [{ code: 'E_MANIFEST', message: 'manifest 必须是对象' }], warnings }
  }
  const m = raw as Record<string, unknown>

  // ① 包名：必须有可识别的 scope，否则任何人都能发一个同名普通包
  const name = typeof m.name === 'string' ? m.name : ''
  if (!NAME_PREFIXES.some((p) => name.startsWith(p))) {
    errors.push({
      code: 'E_NAME',
      message: `name 必须以 ${NAME_PREFIXES.join(' 或 ')} 开头（当前：${name || '(空)'}）`,
    })
  }

  // ② tier
  const tier = typeof m.tier === 'string' ? m.tier : ''
  if (!TABLE.tiers.includes(tier)) {
    errors.push({ code: 'E_TIER_VALUE', message: `tier 必须是 ${TABLE.tiers.join(' / ')}（当前：${tier || '(空)'}）` })
  }
  const myRank = TIER_RANK[tier] ?? 0

  // ③ engines：不满足就别装，不做"尽力而为"
  const engines = (m.engines ?? {}) as Record<string, unknown>
  const studioRange = typeof engines.studio === 'string' ? engines.studio : ''
  if (!studioRange) {
    errors.push({ code: 'E_ENGINES', message: 'engines.studio 必填（形如 ">=0.4.0 <0.6.0"）' })
  }

  // ④ permissions
  const perms = m.permissions
  if (!Array.isArray(perms)) {
    errors.push({ code: 'E_PERMISSIONS', message: 'permissions 必须是数组（可以为空数组）' })
    return { ok: errors.length === 0, errors, warnings }
  }

  const seen = new Set<string>()
  for (const [i, item] of perms.entries()) {
    const p = (item ?? {}) as Record<string, unknown>
    const id = typeof p.id === 'string' ? p.id : ''
    const where = `permissions[${i}]`

    if (!id) {
      errors.push({ code: 'E_CAP_EMPTY', message: `${where}.id 不能为空` })
      continue
    }
    if (seen.has(id)) {
      warnings.push({ code: 'W_DUP_CAP', message: `${where} 重复声明了 ${id}` })
    }
    seen.add(id)

    const spec = capById(id)
    if (!spec) {
      errors.push({
        code: 'E_UNKNOWN_CAP',
        message: `${where}: 未知 capability「${id}」。可选：${TABLE.capabilities.map((c) => c.id).join(', ')}`,
      })
      continue
    }

    // tier 不够格（★结构性封印：第三方永远碰不到 builtin 档）
    if (myRank < (TIER_RANK[spec.minTier] ?? 99)) {
      errors.push({
        code: 'E_TIER_TOO_LOW',
        message: `${where}: ${id} 要求 tier 至少 ${spec.minTier}（当前 ${tier || '(未声明)'}）`,
      })
    }

    // 需要理由的必须写，且要写给人看
    if (spec.reasonRequired) {
      const reason = typeof p.reason === 'string' ? p.reason.trim() : ''
      if (!reason) {
        errors.push({ code: 'E_REASON', message: `${where}: ${id} 必须提供 reason（这段文字会原样展示给用户）` })
      } else if (reason.length < 6) {
        warnings.push({ code: 'W_REASON_SHORT', message: `${where}: reason 过短，用户看不懂在授权什么` })
      }
    }

    // 带参能力必须给参数
    if (spec.requires) {
      const v = p[spec.requires]
      if (v === undefined || (Array.isArray(v) && v.length === 0)) {
        errors.push({ code: 'E_REQUIRES', message: `${where}: ${id} 必须提供 ${spec.requires}（白名单不能为空）` })
      }
    }

    // ★宿主没实现的能力：装上也是"点了没反应"，必须当 error 而不是提示
    if (!spec.implemented) {
      errors.push({
        code: 'E_NOT_IMPLEMENTED',
        message: `${where}: ${id} 在宿主侧**尚未实现**（当前 Studio 无对应命令）——声明了也无法工作`,
      })
    }

    if (spec.status === 'proposed') {
      warnings.push({
        code: 'W_PROPOSED',
        message: `${where}: ${id} 尚属"提案能力"（未进正式 API 版本），上线前可能改名或收紧`,
      })
    }
  }

  // ⑤ 结构性封印的第二道：第三方不得声明 system.*
  if (tier !== 'builtin' && [...seen].some((id) => id.startsWith('system.'))) {
    errors.push({ code: 'E_SYSTEM_SCOPE', message: 'system.* 仅内置插件可用（第三方声明即拒装）' })
  }

  return { ok: errors.length === 0, errors, warnings }
}

export const PLUGIN_TOOLS: readonly McpToolDefWithHandler[] = [
  {
    name: 'plugin_list_capabilities',
    description: '列出插件可申请的 capability（含授予方式 / tier 限制 / 是否已实现）',
    readonly: true,
    inputSchema: {
      tier: {
        type: 'string',
        enum: ['builtin', 'trusted', 'third-party'],
        description: '按插件 tier 过滤（缺省返回全部）',
      },
      implementedOnly: { type: 'boolean', description: '只看宿主已实现的（缺省 false）' },
    },
    run(args) {
      const tier = args.tier as string | undefined
      const implementedOnly = args.implementedOnly === true
      const rank = tier ? (TIER_RANK[tier] ?? 0) : Number.POSITIVE_INFINITY
      const rows = TABLE.capabilities.filter((c) => {
        if ((TIER_RANK[c.minTier] ?? 99) > rank) return false
        if (implementedOnly && !c.implemented) return false
        return true
      })
      return {
        apiVersion: TABLE.version,
        total: rows.length,
        capabilities: rows.map((c) => ({
          id: c.id,
          grant: c.grant,
          minTier: c.minTier,
          requires: c.requires ?? null,
          implemented: c.implemented,
          status: c.status,
          summary: c.summary,
        })),
      }
    },
  },
  {
    name: 'plugin_validate_manifest',
    description: '校验插件 manifest（未知能力 / tier 不足 / 缺 reason / 宿主未实现）——这是安装闸的同一套规则',
    readonly: true,
    inputSchema: {
      manifest: { type: 'object', required: true, description: '插件 manifest 对象（不要传字符串）' },
    },
    run(args) {
      const r = validateManifest(args.manifest)
      return { ok: r.ok, errors: r.errors, warnings: r.warnings }
    },
  },
  {
    name: 'plugin_scaffold',
    description: '生成插件骨架（manifest + 入口 + README）。★只返回文本，不落盘——写盘必须由人确认',
    readonly: true,
    inputSchema: {
      name: { type: 'string', required: true, maxLength: 80, description: '形如 @proteus-studio/plugin-rustfmt' },
      capabilities: { type: 'array', description: '要申请的 capability id 列表' },
      tier: { type: 'string', enum: ['third-party', 'trusted'], description: '缺省 third-party' },
      summary: { type: 'string', maxLength: 200, description: '一句话说明插件做什么' },
    },
    run(args) {
      const name = String(args.name)
      const tier = (args.tier as string | undefined) ?? 'third-party'
      const capsIn = Array.isArray(args.capabilities) ? (args.capabilities as unknown[]).map(String) : []
      const summary = typeof args.summary === 'string' && args.summary.trim() ? args.summary.trim() : '（待补充）'

      const permissions = capsIn.map((id) => {
        const spec = capById(id)
        return {
          id,
          ...(spec?.reasonRequired ? { reason: `说明为什么要 ${id}（这段会展示给用户）` } : {}),
          ...(spec?.requires ? { [spec.requires]: [`请填 ${spec.requires}`] } : {}),
        }
      })

      const manifest = {
        name,
        version: '0.1.0',
        tier,
        engines: { studio: '>=0.4.0 <0.6.0' },
        permissions,
        contributes: { commands: [{ id: `${name.split('/').pop()}.hello`, title: '示例命令' }] },
      }

      // ★生成完立刻用同一套规则自检：模板本身不合法就没有意义
      const check = validateManifest(manifest)

      return {
        ok: check.ok,
        selfCheck: { errors: check.errors, warnings: check.warnings },
        summary,
        files: [
          { path: 'proteus.plugin.json', content: `${JSON.stringify(manifest, null, 2)}\n` },
          {
            path: 'README.md',
            content: `# ${name}\n\n${summary}\n\n## 权限\n\n${capsIn.length ? capsIn.map((c) => `- \`${c}\``).join('\n') : '（无）'}\n`,
          },
        ],
        wroteToDisk: false,
      }
    },
  },
  {
    name: 'plugin_describe_provider',
    description: '查询 Provider 插槽的入出参形状（写编辑器扩展前先看这个，别猜）',
    readonly: true,
    inputSchema: {
      kind: { type: 'string', description: '缺省返回全部 kind 的清单' },
    },
    run(args) {
      const kind = args.kind as string | undefined
      if (!kind) {
        return {
          total: TABLE.providerKinds.length,
          kinds: TABLE.providerKinds.map((p) => ({ kind: p.kind, status: p.status, channel: p.channel })),
        }
      }
      const p = TABLE.providerKinds.find((x) => x.kind === kind)
      if (!p) {
        return { ok: false, error: `未知 ProviderKind：${kind}` }
      }
      return { ok: true, ...p }
    },
  },
]
