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
  /** ★诚实边界：proteus 引用的 p-* 为 L2 规划中（尚未实现）——引用门禁据此豁免（不豁免则视为幽灵） */
  planned?: boolean
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
  { mp: '<cover-view>', proteus: 'p-overlay（L2 规划）', status: 'compat', group: 'component', planned: true },
  { mp: '<cover-image>', proteus: 'p-overlay + ui.image（L2 规划）', status: 'compat', group: 'component', planned: true },
  { mp: '<icon>', proteus: 'ui.icon', status: 'ok', group: 'component' },
  { mp: '<progress>', proteus: 'ui.progress', status: 'ok', group: 'component' },
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
  { mp: '<label>', proteus: 'ui.label', status: 'ok', group: 'component' },
  { mp: '<navigator>', proteus: 'engineering.router-link / router.*', status: 'ok', group: 'component' },
  { mp: '<audio>', proteus: 'ui.media kind=audio（消灭为属性）', status: 'ok', group: 'component' },
  { mp: '<video>', proteus: 'ui.media kind=video（消灭为属性）', status: 'ok', group: 'component' },
  { mp: '<camera>', proteus: 'p-camera（L2 规划）+ useCamera', status: 'compat', group: 'component', planned: true },
  { mp: '<live-player>', proteus: 'ui.media kind=live（消灭为属性）', status: 'ok', group: 'component' },
  { mp: '<live-pusher>', proteus: 'ui.media kind=live mode=push', status: 'ok', group: 'component' },
  { mp: '<canvas>', proteus: 'ui.canvas', status: 'ok', group: 'component' },
  { mp: '<map>', proteus: 'p-map（L2 规划）+ useMap', status: 'compat', group: 'component', planned: true },
  { mp: '<web-view>', proteus: 'p-webview（L2 规划）', status: 'compat', group: 'component', planned: true },
  { mp: '<editor>', proteus: 'ui.rich-text editable', status: 'ok', group: 'component' },
  { mp: '<ad>', proteus: 'p-ad（L2 规划）', status: 'compat', group: 'component', planned: true },
  { mp: '<official-account>', proteus: 'useMiniProgram（微信私有）', status: 'private', group: 'component' },
  { mp: '<open-data>', proteus: 'useMiniProgram（微信私有）', status: 'private', group: 'component' },
  { mp: '<share-element>', proteus: 'p-share-element（L2 规划）', status: 'compat', group: 'component', planned: true },
  { mp: '<aria-component>', proteus: 'p-aria（L2 规划）', status: 'compat', group: 'component', planned: true },
  { mp: '<page-container>', proteus: 'shell.page-container', status: 'ok', group: 'component' },
  { mp: '<voip-room>', proteus: 'useMiniProgram（微信 VOIP）', status: 'private', group: 'component' },
  { mp: '<guild-room>', proteus: 'useMiniProgram（微信游戏）', status: 'private', group: 'component' },
  // ★2026-09-11 补齐：此前矩阵漏列的真实微信内置组件（Skyline 族为主）——有等价能力标 ok/compat，无则 missing
  { mp: '<match-media>', proteus: 'p-adaptive / p-zone（容器断点替代）', status: 'ok', group: 'component' },
  { mp: '<navigation-bar>', proteus: 'shell.nav（p-nav-bar 自绘）', status: 'ok', group: 'component' },
  { mp: '<keyframe-animation>', proteus: 'engineering.animate / engineering.transition', status: 'ok', group: 'component' },
  { mp: '<list-view>', proteus: 'layout.virtual-list（p-list-view 回收）', status: 'ok', group: 'component' },
  { mp: '<grid-view>', proteus: 'layout.grid / layout.virtual-list', status: 'ok', group: 'component' },
  { mp: '<snapshot>', proteus: 'ui.canvas（截图经 OffscreenCanvas）', status: 'compat', group: 'component' },
  { mp: '<page-meta>', proteus: 'shell.page（页面配置属性）', status: 'compat', group: 'component' },
  { mp: '<root-portal>', proteus: 'engineering.transition（teleport→root-portal 编译期）', status: 'ok', group: 'component' },
  { mp: '<sticky-header>', proteus: 'layout.scroll + sticky（CSS）', status: 'compat', group: 'component' },
  { mp: '<sticky-section>', proteus: 'layout.scroll + sticky（CSS）', status: 'compat', group: 'component' },
  { mp: '<double-tap-gesture>', proteus: 'gesture.draggable（p-draggable 手势识别器）', status: 'ok', group: 'component' },
  { mp: '<functional-page-navigator>', proteus: '—（微信插件页专属，非目标）', status: 'private', group: 'component' },
  { mp: '<open-container>', proteus: '—（微信开屏容器，私有）', status: 'private', group: 'component' },
]

/** 小程序 API 类别 → Proteus（miniprogram-mapping.md §3，按类别聚合——本行代表该类 API 集合） */
const MP_API_GROUPS: MpMatrixItem[] = [
  { mp: 'wx.request/upload/download/websocket（网络）', proteus: 'useFetch / useUpload / useDownload / useWebSocket / useSocketTask', status: 'ok', group: 'api' },
  { mp: 'wx.requestPayment', proteus: 'usePayment', status: 'ok', group: 'api' },
  { mp: 'wx.chooseImage/chooseMedia/previewImage（媒体）', proteus: 'useAlbum / useCamera + ui.image', status: 'ok', group: 'api' },
  { mp: 'wx.startRecord/RecorderManager（录音）', proteus: 'useMicrophone / useRecorder', status: 'ok', group: 'api' },
  { mp: 'wx.createVideoContext/CameraContext', proteus: 'ui.media + createCameraContext（ui.canvas 承接）', status: 'ok', group: 'api' },
  { mp: 'wx.scanCode', proteus: 'useQRCode / p-scan-qr', status: 'ok', group: 'api' },
  { mp: 'wx.saveImageToPhotosAlbum/saveVideoToPhotosAlbum', proteus: 'useAlbum（saveImage/saveVideo）', status: 'ok', group: 'api' },
  { mp: 'wx.createWorker（多线程）', proteus: 'useWorker', status: 'ok', group: 'api' },
  { mp: 'wx.chooseAddress（收货地址）', proteus: 'useAddress', status: 'ok', group: 'api' },
  { mp: 'wx.getConnectedWifi/getWifiList/connectWifi（WiFi）', proteus: 'useWifi', status: 'ok', group: 'api' },
  { mp: 'wx.getWeRunData（微信运动）', proteus: 'useWeRun', status: 'ok', group: 'api' },
  // ★组件实例 API 对齐（2026-09-12）：Canvas/查询/媒体组件实例（此前矩阵误标 useElement/useIntersection/useMedia——均为幽灵引用）
  { mp: 'wx.createCanvasContext / canvasToTempFilePath / createOffscreenCanvas（Canvas 组件实例）', proteus: 'useCanvas', status: 'ok', group: 'api' },
  { mp: 'wx.createSelectorQuery（元素几何查询）', proteus: 'useElement', status: 'ok', group: 'api' },
  { mp: 'wx.createIntersectionObserver（交叉观察）', proteus: 'useIntersection', status: 'ok', group: 'api' },
  { mp: 'wx.createMediaQueryObserver（媒体查询）', proteus: 'useMediaQuery', status: 'ok', group: 'api' },
  { mp: 'wx.createVideoContext（视频组件实例）', proteus: 'useVideo', status: 'ok', group: 'api' },
  { mp: 'wx.createInnerAudioContext（音频实例）', proteus: 'useAudio', status: 'ok', group: 'api' },
  { mp: 'wx.createLivePusherContext（直播推流实例）', proteus: 'useLivePusher', status: 'ok', group: 'api' },
  { mp: 'wx.createRewardedVideoAd/createInterstitialAd/createBannerAd（广告）', proteus: 'useAd', status: 'ok', group: 'api' },
  { mp: 'wx.getPrivacySetting/openPrivacyContract/requirePrivacyAuthorize（隐私协议）', proteus: 'usePrivacy', status: 'ok', group: 'api' },
  { mp: 'wx.getPerformance/reportPerformance（性能）', proteus: 'usePerformance', status: 'ok', group: 'api' },
  { mp: 'wx.preloadAssets/preloadSkylineView/preloadWebview/preDownloadSubpackage（预加载）', proteus: 'usePreload', status: 'ok', group: 'api' },
  { mp: 'wx.cropImage/editImage（图像编辑）', proteus: 'useImageEdit', status: 'ok', group: 'api' },
  { mp: 'wx.createUDPSocket/createTCPSocket（网络底层 Socket）', proteus: 'useSocket', status: 'ok', group: 'api' },
  { mp: 'wx.createMediaContainer/createVideoDecoder/createMediaAudioPlayer（媒体高级）', proteus: 'useMediaProcessing', status: 'ok', group: 'api' },
  { mp: 'wx.getScreenRecordingState/onScreenRecordingStateChanged/onUserCaptureScreen/checkIsPictureInPictureActive（录屏/截屏）', proteus: 'useScreenCapture', status: 'ok', group: 'api' },
  { mp: 'wx.createCacheManager（请求缓存管理）', proteus: 'useCacheManager', status: 'ok', group: 'api' },
  { mp: 'wx.requestIdleCallback/cancelIdleCallback（空闲调度）', proteus: 'useIdle', status: 'ok', group: 'api' },
  { mp: 'wx.setWindowSize（PC 窗口）', proteus: 'useWindow', status: 'ok', group: 'api' },
  { mp: 'wx.enableAlertBeforeUnload/disableAlertBeforeUnload（卸载拦截）', proteus: 'useNavigationGuard', status: 'ok', group: 'api' },
  { mp: 'wx.getFileSystemManager/*（文件 30+）', proteus: 'useFileSystem', status: 'ok', group: 'api' },
  { mp: 'wx.compressFile/unzip', proteus: 'useArchive', status: 'ok', group: 'api' },
  { mp: 'wx.set/get/remove/clearStorage(+Sync)', proteus: 'useStorage', status: 'ok', group: 'api' },
  { mp: 'wx.getLocation/chooseLocation/openLocation', proteus: 'useLocation / p-location', status: 'ok', group: 'api' },
  { mp: 'wx.createMapContext', proteus: 'useMap', status: 'ok', group: 'api' },
  { mp: 'wx.getSystemInfo（设备/屏幕/网络/电量/亮度/方向/震动/传感器/剪贴板/电话）', proteus: 'useDevice / useScreen / useNetwork / useBattery / useBrightness / useOrientation / useVibrate / useSensor / useClipboard / usePhoneCall', status: 'ok', group: 'api' },
  { mp: 'wx.openBluetoothAdapter（蓝牙 20+）', proteus: 'useBluetooth', status: 'ok', group: 'api' },
  { mp: 'wx.getHCEState（NFC）', proteus: 'useNFC', status: 'ok', group: 'api' },
  { mp: 'wx.checkIsSupportFingerPrint/FaceID', proteus: 'useBiometric / useFaceID', status: 'ok', group: 'api' },
  { mp: 'wx.showToast/showLoading/showModal/showActionSheet', proteus: 'shell.toast + ui.loading + shell.modal + shell.action-sheet', status: 'ok', group: 'api' },
  { mp: 'wx.setNavigationBarTitle/Color', proteus: 'shell.nav', status: 'ok', group: 'api' },
  { mp: 'wx.setTabBarItem/Style/hide/show', proteus: 'shell.tabbar', status: 'ok', group: 'api' },
  { mp: 'wx.pageScrollTo', proteus: 'layout.scroll（p-scroll-view）', status: 'ok', group: 'api' },
  { mp: 'wx.createAnimation', proteus: 'engineering.animate / engineering.transition', status: 'ok', group: 'api' },
  { mp: 'wx.createSelectorQuery/IntersectionObserver', proteus: 'engineering.router-link + layout.scroll（实测能力）', status: 'ok', group: 'api' },
  { mp: 'wx.navigateTo/redirectTo/navigateBack/switchTab/reLaunch', proteus: 'engineering.router-link + router.* API', status: 'ok', group: 'api' },
  { mp: 'wx.getCurrentPages', proteus: 'engineering.router-link + shared adapter', status: 'ok', group: 'api' },
  { mp: 'App()/Page() 生命周期/getApp()', proteus: 'useAppLifecycle / usePageLifecycle', status: 'ok', group: 'api' },
  { mp: 'wx.shareAppMessage/requestSubscribeMessage', proteus: 'useShare / useNotification', status: 'ok', group: 'api' },
  { mp: 'wx.login/checkSession/getUserInfo/authorize', proteus: 'useLogin / useAuth / usePermission', status: 'ok', group: 'api' },
  { mp: 'wx.getUpdateManager', proteus: 'useUpdate', status: 'ok', group: 'api' },
  { mp: 'wx.requestWeChatPay/navigateToMiniProgram/模板消息/客服（微信私有）', proteus: 'useMiniProgram', status: 'private', group: 'api' },
]

/** 全量对照矩阵 */
export const MP_MAPPING_MATRIX: MpMatrixItem[] = [...MP_COMPONENTS, ...MP_API_GROUPS]

export interface CoverageReport {
  total: number
  ok: number
  compat: number
  private: number
  missing: number
  /** ★诚实边界：`planned: true` 行——L2 规划中（尚未实现），计作已覆盖但**不是已落地** */
  planned: number
  /** ★真·已落地 = total − private − missing − planned（有等价能力且现已可用）——区分「有等价」与「真缺」 */
  landed: number
  /** 覆盖百分比（非 missing 占比） */
  percent: number
  /** G-32.1：missing > 0 → 不达标（CI 红） */
  pass: boolean
  missingItems: MpMatrixItem[]
}

/**
 * ★G-32.1 audit:coverage：小程序官方能力 100% 覆盖校验
 * 缺失（❌）= 无 Proteus 原语且非平台私有 —— 出现即 CI 红
 * ★非纯计数：额外区分 `landed`（现已可用）与 `planned`（L2 规划待落地），避免「100% = 全做完」的误读
 */
export function auditMiniprogramCoverage(matrix: MpMatrixItem[] = MP_MAPPING_MATRIX): CoverageReport {
  const missing = matrix.filter((i) => i.status === 'missing')
  const missingItems = missing
  const ok = matrix.filter((i) => i.status === 'ok').length
  const compat = matrix.filter((i) => i.status === 'compat').length
  const priv = matrix.filter((i) => i.status === 'private').length
  const planned = matrix.filter((i) => i.planned === true).length
  const total = matrix.length
  return {
    total,
    ok,
    compat,
    private: priv,
    missing: missingItems.length,
    planned,
    landed: total - priv - missingItems.length - planned,
    percent: total === 0 ? 0 : Math.round(((total - missingItems.length) / total) * 100),
    pass: missingItems.length === 0,
    missingItems,
  }
}

// —— ①-b ★引用一致性门禁（2026-09-11，修「假门禁」） ——

export interface MatrixRefIssue {
  mp: string
  ref: string
  kind: 'component' | 'semantic' | 'hook'
}

/**
 * ★矩阵引用一致性：proteus 列引用的 token 必须真实存在（组件标签 ∈ TAG_SEMANTIC_MAP / 语义 ∈ SEMANTIC_ENUM /
 *   Hook ∈ knownHooks）——否则「幽灵引用」（旧矩阵把未实现的 p-overlay/p-progress、不存在的 capability.fetch 等
 *   标为 ok/compat，致「100% 覆盖」自证同义反复）。`planned: true` 行豁免「组件标签不存在」（诚实登记 L2 规划）。
 * @param knownHooks 能力 Hook 名集合（来自 @proteus-vue/api SSOT——component-ir 不 import api，由调用方传入）
 */
export function auditMatrixReferences(
  matrix: MpMatrixItem[] = MP_MAPPING_MATRIX,
  knownHooks: ReadonlySet<string> = new Set(),
): { issues: MatrixRefIssue[]; plannedRefs: number } {
  const issues: MatrixRefIssue[] = []
  const tags = new Set(Object.keys(TAG_SEMANTIC_MAP))
  const semantics = new Set<string>(SEMANTIC_ENUM as readonly string[])
  let plannedRefs = 0
  for (const it of matrix) {
    // status=missing 是**已登记的缺口**（引用可不存在）——非幽灵，跳过
    if (it.status === 'missing') continue
    for (const m of it.proteus.matchAll(/\bp-[a-z][\w-]*/g)) {
      if (tags.has(m[0])) continue
      if (it.planned) { plannedRefs++; continue }
      issues.push({ mp: it.mp, ref: m[0], kind: 'component' })
    }
    for (const m of it.proteus.matchAll(/\b(?:layout|ui|shell|gesture|capability|engineering)\.[a-z][\w-]*/g)) {
      if (semantics.has(m[0])) continue
      issues.push({ mp: it.mp, ref: m[0], kind: 'semantic' })
    }
    if (knownHooks.size) {
      // Hook 约定统一 useXxx()（不匹配 setXxx——矩阵里 wx.setNavigationBarTitle 是 wx API 名，非 Hook，避免误报）
      for (const m of it.proteus.matchAll(/\buse[A-Z]\w*/g)) {
        if (!knownHooks.has(m[0])) issues.push({ mp: it.mp, ref: m[0], kind: 'hook' })
      }
    }
  }
  return { issues, plannedRefs }
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
    `  总计 ${report.total} · ✅ 有等价 ${report.total - report.missing}（L1 原语 ${report.ok} + 兼容等价 ${report.compat - report.planned}）· ⬛ 私有 ${report.private} · ❌ 缺失 ${report.missing}`,
    `  ★真·已落地 ${report.landed} · 📋 L2 规划待落地 ${report.planned}（计作覆盖，非已实现——诚实边界）`,
    `  覆盖率 ${report.percent}% ${report.pass ? '✅ 达标（0 缺失）' : '❌ 未达标（CI 红）'}`,
  ]
  if (report.missingItems.length) {
    lines.push('  缺失项：')
    for (const m of report.missingItems) lines.push(`    ❌ ${m.mp} → ${m.proteus}`)
  }
  return lines.join('\n')
}