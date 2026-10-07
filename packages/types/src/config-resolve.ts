// packages/types/src/config-resolve.ts
// ★★★配置模型 v4 归一（决策 #641）：`resolveProteusConfig(raw)` = **消费方唯一入口**。
//   职责：① 版本链迁移（显式 version<4 → 跑 migration）② 形状归一（旧平铺形态 → v4 按端分区）
//   ③ 默认值填充（renderer/style/setDataBridge/page… ）。产出**确定的 v4 ProteusConfig**，
//   消费方只读该形态——禁止裸读原始 config 字段（旧字段在 v4 已不存在）。
// 定位：纯函数零依赖（node 侧构建期消费——gen-routes/plugin/CLI 均在 node）；MP 产物安全风格（无 ?./??）
import type { ProteusConfig } from './config'
import { migrateConfig, CONFIG_VERSION } from './migration'
import { migrateShapeToV4 } from './config-v4-shape'

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

export interface ResolveProteusConfigResult {
  config: ProteusConfig
  /** 归一过程提示（旧字段迁移、缺 appid 等——不阻断，供 CLI 打印） */
  warnings: string[]
  /** 顶层路由别名与 router.* 双处声明的字段名（router.* 优先） */
  duplicates: string[]
}

/** 默认值填充（产出确定的 v4 形态；消费方无需再判缺省） */
function applyDefaults(c: Record<string, unknown>): ProteusConfig {
  if (!isObj(c.targets)) c.targets = {}
  const targets = c.targets as Record<string, unknown>

  if (isObj(targets.mp)) {
    const mp = targets.mp as Record<string, unknown>
    if (mp.renderer === undefined) mp.renderer = 'skyline'
    if (!isObj(mp.style)) mp.style = {}
    const st = mp.style as Record<string, unknown>
    if (st.px2rpx === undefined) st.px2rpx = true
    if (st.rpxRatio === undefined) st.rpxRatio = 2
    if (!isObj(mp.setDataBridge)) mp.setDataBridge = {}
    const sdb = mp.setDataBridge as Record<string, unknown>
    if (sdb.batchWindow === undefined) sdb.batchWindow = 16
    if (sdb.perComponent === undefined) sdb.perComponent = true
    if (!isObj(mp.page)) mp.page = {}
    const pg = mp.page as Record<string, unknown>
    if (pg.autoScrollContainer === undefined) pg.autoScrollContainer = true
  }
  if (c.pagesDir === undefined) c.pagesDir = 'pages'
  return c as unknown as ProteusConfig
}

/**
 * 解析工程配置 → 确定的 v4 ProteusConfig（消费方唯一入口）。
 *   ① 显式 version<CONFIG_VERSION → 版本链迁移
 *   ② 无 targets（旧平铺形态）→ 形状归一
 *   ③ 默认值填充
 */
export function resolveProteusConfig(raw: unknown): ResolveProteusConfigResult {
  const warnings: string[] = []
  if (!isObj(raw)) {
    warnings.push('[proteus.config] 配置不是对象（默认导出应为对象）')
    return { config: applyDefaults({ targets: {} }), warnings, duplicates: [] }
  }
  let c: Record<string, unknown> = raw
  const vDeclared = typeof raw.version === 'number' ? (raw.version as number) : undefined
  if (vDeclared !== undefined && vDeclared < CONFIG_VERSION) {
    const res = migrateConfig(raw, vDeclared)
    c = res.config
  }
  // ★形状归一：把平铺字段收进 targets、顶层路由别名收进 router 段。
  //   对已 v4 的配置是幂等（只挑 SHARED_KEYS + targets，并折叠遗留顶层别名）。
  c = migrateShapeToV4(c, warnings)
  const config = applyDefaults(c)
  return { config, warnings, duplicates: [] }
}
