// packages/component-ir/src/audit.ts
// ★G-32 B1（proteus-semantic-primitives-plus-plan）：audit:coverage 工具 + 闭环一致性门禁
//   ① auditMiniprogramCoverage——小程序全量能力对照矩阵 → 覆盖率报告（G-32.1：缺失 > 0 → CI 红）
//   ② auditCatalogConsistency——闭环 IR 一致性（SSOT = PRIMITIVE_CATALOG）：
//      catalog(tag) ↔ TAG_SEMANTIC_MAP / catalog(语义) ⊆ SEMANTIC_ENUM / TAG_SEMANTIC_MAP ⊆ SEMANTIC_ENUM /
//      implemented 语义 ∈ SEMANTIC_BACKEND_MAP（≥3 端由 checkSemanticCoverage 另行门禁）
//   矩阵数据源：docs/proteus-semantic-primitives-plus-plan/miniprogram-mapping.md（社区对照表编码）
import { SEMANTIC_BACKEND_MAP } from './map'
import { SEMANTIC_ENUM, TAG_SEMANTIC_MAP } from './schema'
import { PRIMITIVE_CATALOG } from './primitives'

// —— ① 小程序全量能力对照矩阵（完整性标尺——miniprogram-mapping.md 编码） ——

/** 覆盖标记：✅ L1 原语 / 🔄 L2 或 compat / ⬛ 平台私有（C47 useMiniProgram）/ ❌ 缺失（CI 拦截） */
export type MpCoverageStatus = 'ok' | 'compat' | 'private' | 'missing'

export interface MpMatrixItem {
  /** 小程序组件名或 API 名 */
  mp: string
  /** Proteus 原语（语义/API/组件名） */
  proteus: string
  status: MpCoverageStatus
  /** 对照类别（component / api-*) */
  group: 'component' | 'api'
}

/** 小程序官方组件 → Proteus（miniprogram-mapping.md §2，42 项） */
const MP_COMPONENTS: MpMatrixItem[] = [
  { mp: '<view>', proteus: 'layout.box / layout.stack', status: 'ok', group: 'component' },
  { mp: '<text>', proteus: 'ui.text / ui.heading', status: 'ok', group: 'component' },
  { mp: '<image>', proteus: 'ui.image', status: 'ok', group: 'component' },
  { mp: '<scroll-view>', proteus: 'layout.scroll / layout.virtual-list', status: 'ok', group: 'component' },
  { mp: '<swiper>', proteus: 'layout.stack snap/loop（消灭为属性）', status: 'ok', group: 'component' },
  { mp: '<swiper-item>', proteus: 'layout.stack 子项', status: 'ok', group: 'component' },
  { mp: '<movable-area>', proteus: 'gesture.scrollable 容器', status: 'ok', group: 'component' },
  { mp: '<movable-view>', proteus: 'gesture.draggable', status: 'ok', group: 'component' },
  { mp: '<cover-view>', proteus: 'p-overlay (L2)', status: 'compat', group: 'component' },
  { mp: '<cover-image>', proteus: 'p-overlay + ui.image', status: 'compat', group: 'component' },
  { mp: '<icon>', proteus: 'ui.icon', status: 'ok', group: 'component' },
  { mp: '<progress>', proteus: 'p-progress (L2)', status: 'compat', group: 'component' },
  { mp: '<rich-text>', proteus: 'ui.rich-text', status: 'ok', group: 'component' },
  { mp: '<button>', proteus: 'ui.button', status: 'ok', group: 'component' },
  { mp: '<form>', proteus: 'ui.form', status: 'ok', group: 'component' },
  { mp: '<input>', proteus: 'ui.input', status: 'ok', group: 'component' },
  { mp: '<textarea>', proteus: 'ui.textarea', status: 'ok', group: 'component' },
  { mp: '<checkbox>', proteus: 'ui.checkbox', status: 'ok', group: 'component' },
  { mp: '<radio>', proteus: 'ui.radio', status: 'ok', group: 'component' },
  { mp: '<picker>', proteus: 'ui.picker / ui.select', status: 'ok', group: 'component' },
  { mp: '<picker-view>', proteus: 'ui.picker mode=wheel', status: 'ok', group: 'component' },
  { mp: '<slider>', proteus: 'ui.slider', status: 'ok', group: 'component' },
  { mp: '<switch>', proteus: 'ui.switch', status: 'ok', group: 'component' },
  { mp: '<label>', proteus: 'p-label (L2)', status: 'compat', group: 'component' },
  { mp: '<navigator>', proteus: 'engineering.router-link / router.*', status: 'ok', group: 'component' },
  { mp: '<audio>', proteus: 'ui.media kind=audio（消灭为属性）', status: 'ok', group: 'component' },
  { mp: '<video>', proteus: 'ui.media kind=video（消灭为属性）', status: 'ok', group: 'component' },
  { mp: '<camera>', proteus: 'p-camera (L2) + capability.camera', status: 'ok', group: 'component' },
  { mp: '<live-player>', proteus: 'ui.media kind=live（消灭为属性）', status: 'ok', group: 'component' },
  { mp: '<live-pusher>', proteus: 'ui.media kind=live mode=push', status: 'ok', group: 'component' },
  { mp: '<canvas>', proteus: 'ui.canvas', status: 'ok', group: 'component' },
  { mp: '<map>', proteus: 'p-map (L2) + capability.map', status: 'ok', group: 'component' },
  { mp: '<web-view>', proteus: 'p-webview (L2)', status: 'compat', group: 'component' },
  { mp: '<editor>', proteus: 'ui.rich-text editable', status: 'ok', group: 'component' },
  { mp: '<ad>', proteus: 'p-ad (L2)', status: 'compat', group: 'component' },
  { mp: '<official-account>', proteus: 'capability.mini-program（微信私有）', status: 'private', group: 'component' },
  { mp: '<open-data>', proteus: 'capability.mini-program（微信私有）', status: 'private', group: 'component' },
  { mp: '<share-element>', proteus: 'p-share-element (L2)', status: 'compat', group: 'component' },
  { mp: '<aria-component>', proteus: 'p-aria (L2)', status: 'compat', group: 'component' },
  { mp: '<page-container>', proteus: 'p-page-container (L2)', status: 'compat', group: 'component' },
  { mp: '<voip-room>', proteus: 'capability.mini-program（微信 VOIP）', status: 'private', group: 'component' },
  { mp: '<guild-room>', proteus: 'capability.mini-program（微信游戏）', status: 'private', group: 'component' },
]

/** 小程序 API 类别 → Proteus（miniprogram-mapping.md §3，按类别聚合——本行代表该类 API 集合） */
const MP_API_GROUPS: MpMatrixItem[] = [
  { mp: 'wx.request/upload/download/websocket（网络）', proteus: 'capability.fetch/upload/download/websocket', status: 'ok', group: 'api' },
  { mp: 'wx.requestPayment', proteus: 'capability.payment', status: 'ok', group: 'api' },
  { mp: 'wx.chooseImage/chooseMedia/previewImage（媒体）', proteus: 'capability.camera + ui.image preview', status: 'ok', group: 'api' },
  { mp: 'wx.startRecord/RecorderManager（录音）', proteus: 'capability.microphone', status: 'ok', group: 'api' },
  { mp: 'wx.createVideoContext/CameraContext', proteus: 'capability.media + ui.media', status: 'ok', group: 'api' },
  { mp: 'wx.scanCode', proteus: 'capability.qr-code / capability.scan-qr', status: 'ok', group: 'api' },
  { mp: 'wx.saveImageToPhotosAlbum', proteus: 'capability.album (L2)', status: 'compat', group: 'api' },
  { mp: 'wx.getFileSystemManager/*（文件 30+）', proteus: 'capability.file-system', status: 'ok', group: 'api' },
  { mp: 'wx.compressFile/unzip', proteus: 'capability.archive', status: 'ok', group: 'api' },
  { mp: 'wx.set/get/remove/clearStorage(+Sync)', proteus: 'capability.storage', status: 'ok', group: 'api' },
  { mp: 'wx.getLocation/chooseLocation/openLocation', proteus: 'capability.location', status: 'ok', group: 'api' },
  { mp: 'wx.createMapContext', proteus: 'capability.map', status: 'ok', group: 'api' },
  { mp: 'wx.getSystemInfo（设备/屏幕/网络/电量/亮度/方向/震动/传感器/剪贴板/电话）', proteus: 'capability.device/screen/network/battery/brightness/orientation/vibrate/sensor/clipboard/phone-call', status: 'ok', group: 'api' },
  { mp: 'wx.openBluetoothAdapter（蓝牙 20+）', proteus: 'capability.bluetooth', status: 'ok', group: 'api' },
  { mp: 'wx.getHCEState（NFC）', proteus: 'capability.nfc', status: 'ok', group: 'api' },
  { mp: 'wx.checkIsSupportFingerPrint/FaceID', proteus: 'capability.biometric / face-id', status: 'ok', group: 'api' },
  { mp: 'wx.showToast/showLoading/showModal/showActionSheet', proteus: 'shell.toast + capability.toast/loading + shell.modal + shell.action-sheet', status: 'ok', group: 'api' },
  { mp: 'wx.setNavigationBarTitle/Color', proteus: 'shell.nav', status: 'ok', group: 'api' },
  { mp: 'wx.setTabBarItem/Style/hide/show', proteus: 'shell.tabbar', status: 'ok', group: 'api' },
  { mp: 'wx.pageScrollTo', proteus: 'capability.page-scroll', status: 'ok', group: 'api' },
  { mp: 'wx.createAnimation', proteus: 'engineering.animation', status: 'ok', group: 'api' },
  { mp: 'wx.createSelectorQuery/IntersectionObserver', proteus: 'capability.element / intersection', status: 'ok', group: 'api' },
  { mp: 'wx.navigateTo/redirectTo/navigateBack/switchTab/reLaunch', proteus: 'engineering.router-push/replace/back/switch-tab/relaunch', status: 'ok', group: 'api' },
  { mp: 'wx.getCurrentPages', proteus: 'engineering.route', status: 'ok', group: 'api' },
  { mp: 'App()/Page() 生命周期/getApp()', proteus: 'engineering.lifecycle + capability.app-lifecycle/page-lifecycle', status: 'ok', group: 'api' },
  { mp: 'wx.shareAppMessage/requestSubscribeMessage', proteus: 'capability.share / notification', status: 'ok', group: 'api' },
  { mp: 'wx.login/checkSession/getUserInfo/authorize', proteus: 'capability.login / auth / permission', status: 'ok', group: 'api' },
  { mp: 'wx.getUpdateManager', proteus: 'capability.update (L2)', status: 'compat', group: 'api' },
  { mp: 'wx.requestWeChatPay/navigateToMiniProgram/模板消息/客服（微信私有）', proteus: 'capability.mini-program', status: 'private', group: 'api' },
]

/** 全量对照矩阵 */
export const MP_MAPPING_MATRIX: MpMatrixItem[] = [...MP_COMPONENTS, ...MP_API_GROUPS]

export interface CoverageReport {
  total: number
  ok: number
  compat: number
  private: number
  missing: number
  /** 覆盖百分比（非 missing 占比） */
  percent: number
  /** G-32.1：missing > 0 → 不达标（CI 红） */
  pass: boolean
  missingItems: MpMatrixItem[]
}

/**
 * ★G-32.1 audit:coverage：小程序官方能力 100% 覆盖校验
 * 缺失（❌）= 无 Proteus 原语且非平台私有 —— 出现即 CI 红
 */
export function auditMiniprogramCoverage(matrix: MpMatrixItem[] = MP_MAPPING_MATRIX): CoverageReport {
  const missing = matrix.filter((i) => i.status === 'missing')
  const missingItems = missing
  const ok = matrix.filter((i) => i.status === 'ok').length
  const compat = matrix.filter((i) => i.status === 'compat').length
  const priv = matrix.filter((i) => i.status === 'private').length
  const total = matrix.length
  return {
    total,
    ok,
    compat,
    private: priv,
    missing: missingItems.length,
    percent: total === 0 ? 0 : Math.round(((total - missingItems.length) / total) * 100),
    pass: missingItems.length === 0,
    missingItems,
  }
}

// —— ② 闭环一致性审计（SSOT = PRIMITIVE_CATALOG） ——

export interface ConsistencyIssue {
  rule: string
  detail: string
}

/**
 * ★闭环 IR 一致性门禁：清单 ↔ 枚举 ↔ 标签映射 ↔ 渲染映射 四方不漂移
 * - C1 catalog(tag) 条目：TAG_SEMANTIC_MAP[tag] === semantic（逐条对齐）
 * - C2 catalog 组件语义 ⊆ SEMANTIC_ENUM（清单不越界）
 * - C3 TAG_SEMANTIC_MAP 值 ⊆ SEMANTIC_ENUM（标签映射不产出非法语义）
 * - C4 implemented 语义 ∈ SEMANTIC_BACKEND_MAP（已实现必有渲染映射）
 * - C5 SEMANTIC_ENUM 全量 ∈ SEMANTIC_BACKEND_MAP ∪ planned（枚举中未实现的语义必须是 catalog planned 或已在 map）
 */
export function auditCatalogConsistency(): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = []
  const enumSet = new Set<string>(SEMANTIC_ENUM as readonly string[])
  const catalogTags = PRIMITIVE_CATALOG.filter((p) => p.tag)

  // C1：catalog tag ↔ TAG_SEMANTIC_MAP
  for (const p of catalogTags) {
    const tag = p.tag as string
    if (TAG_SEMANTIC_MAP[tag] !== p.semantic) {
      issues.push({ rule: 'C1', detail: `catalog ${p.id} (${tag}) 语义=${p.semantic} ≠ TAG_SEMANTIC_MAP=${TAG_SEMANTIC_MAP[tag] ?? '<未登记>'}` })
    }
  }

  // C2：catalog 组件语义 ⊆ SEMANTIC_ENUM
  for (const p of catalogTags) {
    if (!enumSet.has(p.semantic)) {
      issues.push({ rule: 'C2', detail: `catalog ${p.id} 语义 ${p.semantic} 不在 SEMANTIC_ENUM` })
    }
  }

  // C3：TAG_SEMANTIC_MAP 值 ⊆ SEMANTIC_ENUM（含既有对齐 p-view/p-list-view 等）
  for (const [tag, sem] of Object.entries(TAG_SEMANTIC_MAP)) {
    if (!enumSet.has(sem)) {
      issues.push({ rule: 'C3', detail: `${tag} → ${sem}（TAG_SEMANTIC_MAP 值不在 SEMANTIC_ENUM）` })
    }
  }

  // C4：implemented 语义必有渲染映射
  for (const p of PRIMITIVE_CATALOG.filter((x) => x.status === 'implemented')) {
    if (!SEMANTIC_BACKEND_MAP[p.semantic]) {
      issues.push({ rule: 'C4', detail: `${p.id} ${p.semantic}（implemented 但 SEMANTIC_BACKEND_MAP 无行）` })
    }
  }

  // C5：枚举中非 map 的语义必须 ∈ catalog planned（防孤立语义）
  for (const sem of enumSet) {
    if (!SEMANTIC_BACKEND_MAP[sem]) {
      const inCatalog = PRIMITIVE_CATALOG.some((p) => p.semantic === sem)
      if (!inCatalog) {
        issues.push({ rule: 'C5', detail: `${sem} 在 SEMANTIC_ENUM 但不在 catalog（孤立语义）` })
      }
    }
  }

  return issues
}

/** 输出覆盖率报告（CLI 展示用） */
export function formatCoverageReport(report: CoverageReport): string {
  const lines = [
    `G-32.1 小程序能力覆盖审计：`,
    `  总计 ${report.total} · ✅ L1 ${report.ok}（${Math.round((report.ok / report.total) * 100)}%）· 🔄 L2/compat ${report.compat} · ⬛ 私有 ${report.private} · ❌ 缺失 ${report.missing}`,
    `  覆盖率 ${report.percent}% ${report.pass ? '✅ 达标（0 缺失）' : '❌ 未达标（CI 红）'}`,
  ]
  if (report.missingItems.length) {
    lines.push('  缺失项：')
    for (const m of report.missingItems) lines.push(`    ❌ ${m.mp} → ${m.proteus}`)
  }
  return lines.join('\n')
}