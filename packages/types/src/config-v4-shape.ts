// packages/types/src/config-v4-shape.ts
// ★配置 v3(平铺) → v4(按端分区) 形状变换（决策 #641）。独立成模块，供 migration 链与 resolveProteusConfig 共用
//   （避免 migration ↔ resolve 循环导入）。纯函数、零依赖、MP 产物安全风格（无 ?./??）。
function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/** 旧顶层「小程序专属」字段（v3 → targets.mp） */
export const MP_FIELD_KEYS = ['appid', 'skyline', 'skylineLayout', 'profileBoundary', 'setDataBridge', 'style', 'globalStyle', 'page', 'rules']
/** 旧顶层路由别名（v3 → router 段） */
export const LEGACY_ROUTER_ALIASES = ['routesOutput', 'subPackages', 'customRoute']
/** 跨端共享顶层字段（原样保留） */
export const SHARED_KEYS = ['version', 'pagesDir', 'budget', 'router', 'vite', 'audit', 'gates', 'compiler', 'layout', 'app']

/** 组装 mp 段（把旧顶层小程序字段搬进 targets.mp） */
function buildMp(c: Record<string, unknown>): Record<string, unknown> {
  const mp: Record<string, unknown> = {}
  for (let i = 0; i < MP_FIELD_KEYS.length; i++) {
    const k = MP_FIELD_KEYS[i]
    const v = c[k]
    if (v === undefined) continue
    if (k === 'skyline') mp.renderer = v ? 'skyline' : 'webview'
    else mp[k] = v
  }
  return mp
}

/**
 * 形状归一：把 v3（平铺）形态转成 v4（按端分区）。已含 targets 的视为 v4（仅补漏并入）。
 * 纯函数；不修改入参。warnings 收集迁移提示（可传空数组丢弃）。
 */
export function migrateShapeToV4(c: Record<string, unknown>, warnings: string[]): Record<string, unknown> {
  // ★保留**未知顶层字段**（不在 共享面 / 旧小程序面 / 旧路由别名 之列）——供 config:check 报 CONFIG_UNKNOWN_FIELD。
  //   归一不得吞掉拼写错误（否则校验器看不到）。
  const consumed = new Set<string>([...SHARED_KEYS, ...MP_FIELD_KEYS, ...LEGACY_ROUTER_ALIASES, 'platform', 'native', 'targets'])
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(c)) {
    if (!consumed.has(k)) out[k] = c[k]
  }
  for (let i = 0; i < SHARED_KEYS.length; i++) {
    const k = SHARED_KEYS[i]
    if (c[k] !== undefined) out[k] = c[k]
  }
  const targets: Record<string, unknown> = isObj(c.targets) ? Object.assign({}, c.targets) : {}

  // ── 原生工程身份：native.{app,ios,android,harmony} → app / targets.<端>（字段名同形，直接并入） ──
  if (isObj(c.native)) {
    const nat = c.native
    if (isObj(nat.app) && out.app === undefined) out.app = nat.app
    const appTargets = ['ios', 'android', 'harmony']
    for (let i = 0; i < appTargets.length; i++) {
      const t = appTargets[i]
      if (isObj(nat[t])) {
        targets[t] = Object.assign({}, isObj(targets[t]) ? (targets[t] as Record<string, unknown>) : {}, nat[t] as Record<string, unknown>)
      }
    }
  }

  // ── 小程序专属字段 → targets.mp ──
  const platform = c.platform
  const mpFromFields = buildMp(c)
  const hasMpFields = Object.keys(mpFromFields).length > 0
  if (platform === 'mp-weixin' || hasMpFields) {
    targets.mp = Object.assign({}, isObj(targets.mp) ? (targets.mp as Record<string, unknown>) : {}, mpFromFields)
  }
  if (platform === 'web' && targets.web === undefined) targets.web = {}
  if (platform !== undefined && platform !== 'mp-weixin' && platform !== 'web') {
    warnings.push(`[proteus.config] 旧字段 platform="${String(platform)}" 已废弃（v4 用 targets 按端声明）`)
  }
  if (isObj(targets.mp) && (targets.mp as Record<string, unknown>).appid === undefined) {
    warnings.push('[proteus.config] targets.mp 缺 appid（小程序构建需要；请补 targets.mp.appid）')
  }

  // ── 旧顶层路由别名 → router 段（router.* 优先，双处提示收敛） ──
  const router: Record<string, unknown> = isObj(c.router) ? Object.assign({}, c.router) : {}
  for (let i = 0; i < LEGACY_ROUTER_ALIASES.length; i++) {
    const k = LEGACY_ROUTER_ALIASES[i]
    if (c[k] === undefined) continue
    if (router[k] === undefined) router[k] = c[k]
    else warnings.push(`[proteus.config] ${k} 同时声明于顶层与 router.*——router.* 优先（请收敛）`)
  }
  if (Object.keys(router).length > 0) out.router = router

  out.targets = targets
  return out
}
