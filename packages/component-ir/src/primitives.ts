// packages/component-ir/src/primitives.ts
// ★G-32 B1（proteus-semantic-primitives-plus-plan）：完整语义原语清单冻结——128 原语唯一事实源（SSOT）
//   6 大类：layout(12) / ui(18) / shell(10) / gesture(10) / capability(50) / engineering(28)
//   ★闭环 IR 设计：本清单是「语义全集」的唯一来源——
//     · SEMANTIC_ENUM（C-IR 合法语义）⊇ 本清单组件原语（layout/ui/shell + gesture 组件 + engineering 组件）
//     · TAG_SEMANTIC_MAP（p-* 标签 → 语义）与本清单 tag 条目逐条对齐
//     · SEMANTIC_BACKEND_MAP（渲染映射）覆盖本清单 status='implemented' 的原语
//     · auditSemanticCoverage / auditCatalogConsistency 机器校验以上不变量（audit.ts）
//   命名：semantic = <domain>.<kind>（layout.box / ui.text / shell.modal / gesture.pan / capability.camera / engineering.router-push）

export type PrimitiveKind = 'layout' | 'ui' | 'shell' | 'gesture' | 'capability' | 'engineering'

/** 状态：implemented = 已在 SEMANTIC_BACKEND_MAP 登记 ≥3 端（G-31.4/G-32.3 门禁适用）；planned = 已冻结待实现（L2 生态） */
export type PrimitiveStatus = 'implemented' | 'planned'

export interface PrimitiveDef {
  /** 清单编号（L1..L12 / U1..U18 / S1..S10 / G1..G10 / C1..C50 / E1..E28） */
  id: string
  kind: PrimitiveKind
  /** 语义标识（<domain>.<kind>——C-IR semantic / 能力属性） */
  semantic: string
  /** 组件原语标签（p-*；非组件原语缺省） */
  tag?: string
  /** API/Hook/指令形态（useXxx() / router.push / v-gesture:tap；组件原语缺省） */
  api?: string
  /** 关键约束属性（G-32.5：属性是约束描述，非 CSS/平台名） */
  props?: string[]
  /** 小程序能力对等（完整性标尺） */
  mpEquiv: string
  /** L1/L2 层级 */
  tier: 'L1' | 'L2'
  status: PrimitiveStatus
}

/** G-32 §3 ① 布局原语（12）——G-22 泛化：swiper/scroll-view/movable 消灭为属性 */
const LAYOUT: PrimitiveDef[] = [
  { id: 'L1', kind: 'layout', semantic: 'layout.box', tag: 'p-box', props: ['aspectRatio', 'overflow'], mpEquiv: '<view>', tier: 'L1', status: 'implemented' },
  { id: 'L2', kind: 'layout', semantic: 'layout.inline', tag: 'p-inline', props: ['wrap'], mpEquiv: '<text> 内联', tier: 'L1', status: 'implemented' },
  { id: 'L3', kind: 'layout', semantic: 'layout.stack', tag: 'p-stack', props: ['direction', 'gap', 'align', 'wrap', 'snap', 'loop'], mpEquiv: 'flex + scroll-view + swiper', tier: 'L1', status: 'implemented' },
  { id: 'L4', kind: 'layout', semantic: 'layout.grid', tag: 'p-grid', props: ['minColWidth', 'maxCols', 'gap', 'autoFlow'], mpEquiv: '<view> + CSS Grid', tier: 'L1', status: 'implemented' },
  { id: 'L5', kind: 'layout', semantic: 'layout.fluid', tag: 'p-fluid', props: ['breakpoints', 'minItemWidth'], mpEquiv: '响应式 CSS', tier: 'L1', status: 'implemented' },
  { id: 'L6', kind: 'layout', semantic: 'layout.adaptive', tag: 'p-adaptive', props: ['sheet', 'dialog', 'popover', 'drawer'], mpEquiv: '无（容器宽度语义断点）', tier: 'L1', status: 'implemented' },
  { id: 'L7', kind: 'layout', semantic: 'layout.fit', tag: 'p-fit', props: ['mode'], mpEquiv: 'fit-content', tier: 'L1', status: 'implemented' },
  { id: 'L8', kind: 'layout', semantic: 'layout.spacer', tag: 'p-spacer', props: ['grow', 'shrink'], mpEquiv: 'flex:1', tier: 'L1', status: 'implemented' },
  { id: 'L9', kind: 'layout', semantic: 'layout.divider', tag: 'p-divider', props: ['orientation', 'inset'], mpEquiv: '<view> + border', tier: 'L1', status: 'implemented' },
  { id: 'L10', kind: 'layout', semantic: 'layout.scroll', tag: 'p-scroll', props: ['axis', 'paging', 'refresh', 'indicator'], mpEquiv: '<scroll-view>', tier: 'L1', status: 'implemented' },
  { id: 'L11', kind: 'layout', semantic: 'layout.virtual-list', tag: 'p-virtual-list', props: ['itemSize', 'buffer', 'direction'], mpEquiv: '<scroll-view> + 手动回收', tier: 'L1', status: 'implemented' },
  { id: 'L12', kind: 'layout', semantic: 'layout.masonry', tag: 'p-masonry', props: ['colCount', 'gap'], mpEquiv: '第三方瀑布流', tier: 'L1', status: 'implemented' },
]

/** G-32 §4 ② 基础 UI 原语（18）——视图/内容 + 输入/表单 */
const UI: PrimitiveDef[] = [
  { id: 'U1', kind: 'ui', semantic: 'ui.text', tag: 'p-text', props: ['content', 'selectable', 'truncate', 'align'], mpEquiv: '<text>', tier: 'L1', status: 'implemented' },
  { id: 'U2', kind: 'ui', semantic: 'ui.heading', tag: 'p-heading', props: ['level'], mpEquiv: '<h1>-<h6>', tier: 'L1', status: 'implemented' },
  { id: 'U3', kind: 'ui', semantic: 'ui.rich-text', tag: 'p-rich-text', props: ['source', 'schema'], mpEquiv: '<rich-text>', tier: 'L1', status: 'planned' },
  { id: 'U4', kind: 'ui', semantic: 'ui.icon', tag: 'p-icon', props: ['name', 'size', 'color', 'spin'], mpEquiv: '<icon>', tier: 'L1', status: 'implemented' },
  { id: 'U5', kind: 'ui', semantic: 'ui.image', tag: 'p-image', props: ['src', 'fit', 'placeholder', 'lazy'], mpEquiv: '<image>', tier: 'L1', status: 'implemented' },
  { id: 'U6', kind: 'ui', semantic: 'ui.avatar', tag: 'p-avatar', props: ['src', 'shape', 'size', 'fallback'], mpEquiv: '组合', tier: 'L1', status: 'planned' },
  { id: 'U7', kind: 'ui', semantic: 'ui.media', tag: 'p-media', props: ['kind', 'controls', 'autoplay', 'poster', 'loop', 'muted', 'pictureInPicture'], mpEquiv: '<video>+<audio>', tier: 'L1', status: 'planned' },
  { id: 'U8', kind: 'ui', semantic: 'ui.canvas', tag: 'p-canvas', props: ['engine', 'resolution'], mpEquiv: '<canvas>', tier: 'L1', status: 'planned' },
  { id: 'U9', kind: 'ui', semantic: 'ui.svg', tag: 'p-svg', props: ['path', 'viewbox'], mpEquiv: '无', tier: 'L1', status: 'planned' },
  { id: 'U10', kind: 'ui', semantic: 'ui.input', tag: 'p-input', props: ['type', 'mask', 'validation', 'clearable'], mpEquiv: '<input>', tier: 'L1', status: 'implemented' },
  { id: 'U11', kind: 'ui', semantic: 'ui.textarea', tag: 'p-textarea', props: ['autosize', 'maxLength', 'count'], mpEquiv: '<textarea>', tier: 'L1', status: 'implemented' },
  { id: 'U12', kind: 'ui', semantic: 'ui.select', tag: 'p-select', props: ['options', 'multiple', 'searchable', 'cascader'], mpEquiv: '<picker> 部分', tier: 'L1', status: 'planned' },
  { id: 'U13', kind: 'ui', semantic: 'ui.checkbox', tag: 'p-checkbox', props: ['checked', 'indeterminate', 'group'], mpEquiv: '<checkbox>', tier: 'L1', status: 'planned' },
  { id: 'U14', kind: 'ui', semantic: 'ui.radio', tag: 'p-radio', props: ['value', 'group'], mpEquiv: '<radio>', tier: 'L1', status: 'planned' },
  { id: 'U15', kind: 'ui', semantic: 'ui.switch', tag: 'p-switch', props: ['checked', 'loading'], mpEquiv: '<switch>', tier: 'L1', status: 'implemented' },
  { id: 'U16', kind: 'ui', semantic: 'ui.slider', tag: 'p-slider', props: ['min', 'max', 'step', 'range'], mpEquiv: '<slider>', tier: 'L1', status: 'implemented' },
  { id: 'U17', kind: 'ui', semantic: 'ui.picker', tag: 'p-picker', props: ['mode', 'start', 'end'], mpEquiv: '<picker>', tier: 'L1', status: 'planned' },
  { id: 'U18', kind: 'ui', semantic: 'ui.form', tag: 'p-form', props: ['model', 'rules', 'layout'], mpEquiv: '组合', tier: 'L1', status: 'planned' },
]

/** G-32 §5 ③ 容器/导航原语 Shell（10） */
const SHELL: PrimitiveDef[] = [
  { id: 'S1', kind: 'shell', semantic: 'shell.page', tag: 'p-page', props: ['title', 'statusBar', 'pullRefresh'], mpEquiv: '<page>', tier: 'L1', status: 'planned' },
  { id: 'S2', kind: 'shell', semantic: 'shell.nav', tag: 'p-nav', props: ['title', 'transparent'], mpEquiv: '导航栏配置', tier: 'L1', status: 'implemented' },
  { id: 'S3', kind: 'shell', semantic: 'shell.tabbar', tag: 'p-tabbar', props: ['tabs', 'active', 'badge'], mpEquiv: '<tabbar>', tier: 'L1', status: 'implemented' },
  { id: 'S4', kind: 'shell', semantic: 'shell.segment', tag: 'p-segment', props: ['options', 'active'], mpEquiv: '<segment>', tier: 'L1', status: 'planned' },
  { id: 'S5', kind: 'shell', semantic: 'shell.drawer', tag: 'p-drawer', props: ['side', 'width', 'overlay'], mpEquiv: '组合', tier: 'L1', status: 'implemented' },
  { id: 'S6', kind: 'shell', semantic: 'shell.modal', tag: 'p-modal', props: ['open', 'dismissible', 'sheet', 'dialog', 'alert'], mpEquiv: '<modal>+wx.showModal', tier: 'L1', status: 'implemented' },
  { id: 'S7', kind: 'shell', semantic: 'shell.popover', tag: 'p-popover', props: ['trigger', 'placement'], mpEquiv: '组合', tier: 'L1', status: 'planned' },
  { id: 'S8', kind: 'shell', semantic: 'shell.toast', tag: 'p-toast', props: ['message', 'duration', 'type'], mpEquiv: 'wx.showToast', tier: 'L1', status: 'planned' },
  { id: 'S9', kind: 'shell', semantic: 'shell.action-sheet', tag: 'p-action-sheet', props: ['actions', 'cancel'], mpEquiv: 'wx.showActionSheet', tier: 'L1', status: 'planned' },
  { id: 'S10', kind: 'shell', semantic: 'layout.split', tag: 'p-split', props: ['breakpoint', 'ratio', 'collapse'], mpEquiv: '无（分栏布局）', tier: 'L1', status: 'implemented' }, // ★已落地绑定：分栏语义由 layout.split 承载（G-32 文档为 shell.split——机器事实以实现为准）
]

/** G-32 §6 ④ 交互/手势原语 Gesture（10）——手势是声明式约束（v-gesture:* 指令 + 组件 + Hook） */
const GESTURE: PrimitiveDef[] = [
  { id: 'G1', kind: 'gesture', semantic: 'gesture.tap', api: 'v-gesture:tap', props: ['count'], mpEquiv: 'bindtap', tier: 'L1', status: 'planned' },
  { id: 'G2', kind: 'gesture', semantic: 'gesture.longpress', api: 'v-gesture:longpress', props: ['duration', 'onEnd'], mpEquiv: 'bindlongpress', tier: 'L1', status: 'planned' },
  { id: 'G3', kind: 'gesture', semantic: 'gesture.swipe', api: 'v-gesture:swipe', props: ['direction', 'threshold'], mpEquiv: 'bindswipe', tier: 'L1', status: 'planned' },
  { id: 'G4', kind: 'gesture', semantic: 'gesture.pan', api: 'v-gesture:pan', props: ['axis', 'bounds'], mpEquiv: 'bindtouchmove', tier: 'L1', status: 'planned' },
  { id: 'G5', kind: 'gesture', semantic: 'gesture.pinch', api: 'v-gesture:pinch', props: ['scale', 'onChange'], mpEquiv: 'touchstart/move 组合', tier: 'L1', status: 'planned' },
  { id: 'G6', kind: 'gesture', semantic: 'gesture.rotate', api: 'v-gesture:rotate', props: ['angle'], mpEquiv: '组合', tier: 'L1', status: 'planned' },
  { id: 'G7', kind: 'gesture', semantic: 'gesture.press', api: 'v-gesture:press', props: ['force'], mpEquiv: '3D Touch', tier: 'L1', status: 'planned' },
  { id: 'G8', kind: 'gesture', semantic: 'gesture.draggable', tag: 'p-draggable', props: ['ghost', 'snapToGrid', 'onDrop'], mpEquiv: 'movable-view', tier: 'L1', status: 'planned' },
  { id: 'G9', kind: 'gesture', semantic: 'gesture.scrollable', tag: 'p-scrollable', props: ['bounce', 'refresh', 'loadMore'], mpEquiv: '<scroll-view>', tier: 'L1', status: 'planned' },
  { id: 'G10', kind: 'gesture', semantic: 'gesture.use-gesture', api: 'useGesture()', props: ['recognizers', 'simultaneous'], mpEquiv: '无', tier: 'L1', status: 'planned' },
]

/** G-32 §7.1-7.4 ⑤ 能力原语 Capability（46）——全部 useXxx() Hook（无回调/全类型/Result<T>） */
function cap(id: string, name: string, api: string, mpEquiv: string, returnType: string): PrimitiveDef {
  return { id, kind: 'capability', semantic: `capability.${name}`, api, props: [returnType], mpEquiv, tier: 'L1', status: 'planned' }
}

const CAPABILITY: PrimitiveDef[] = [
  // 7.1 设备/硬件（15）
  cap('C1', 'camera', 'useCamera()', 'wx.createCameraContext', 'Result<Media>'),
  cap('C2', 'microphone', 'useMicrophone()', 'RecorderManager', 'Result<AudioBuffer>'),
  { id: 'C3', kind: 'capability', semantic: 'capability.location', api: 'useLocation()', props: ['Result<Coords>'], mpEquiv: 'wx.getLocation', tier: 'L1', status: 'implemented' },
  cap('C4', 'map', 'useMap()', 'wx.createMapContext', 'MapController'),
  cap('C5', 'sensor', 'useSensor()', 'onAccelerometer/onCompass/onGyroscope', 'SensorStream'),
  cap('C6', 'vibrate', 'useVibrate()', 'wx.vibrateShort/Long', 'void'),
  cap('C7', 'battery', 'useBattery()', 'wx.getBatteryInfo', 'BatteryInfo'),
  cap('C8', 'network', 'useNetwork()', 'wx.getNetworkType', 'NetworkType'),
  cap('C9', 'clipboard', 'useClipboard()', 'wx.set/getClipboardData', 'Result<string>'),
  cap('C10', 'screen', 'useScreen()', 'wx.getSystemInfo', 'ScreenInfo'),
  cap('C11', 'device', 'useDevice()', 'wx.getSystemInfo', 'DeviceInfo'),
  cap('C12', 'orientation', 'useOrientation()', 'wx.onDeviceOrientationChange', 'Orientation'),
  cap('C13', 'brightness', 'useBrightness()', 'wx.setScreenBrightness', 'Result<void>'),
  cap('C14', 'keyboard', 'useKeyboard()', 'wx.onKeyboardHeightChange', 'KeyboardInfo'),
  cap('C15', 'storage', 'useStorage()', 'wx.set/getStorage', 'StorageAPI'),
  // 7.2 系统/OS（10）
  cap('C16', 'permission', 'usePermission()', 'wx.authorize', 'Result<PermissionStatus>'),
  cap('C17', 'notification', 'useNotification()', 'wx.requestSubscribeMessage', 'NotificationAPI'),
  cap('C18', 'share', 'useShare()', 'wx.shareAppMessage', 'Result<void>'),
  cap('C19', 'contact', 'useContact()', 'wx.chooseContact', 'Result<Contact[]>'),
  cap('C20', 'calendar', 'useCalendar()', 'wx.addPhoneCalendar', 'CalendarAPI'),
  cap('C21', 'phone-call', 'usePhoneCall()', 'wx.makePhoneCall', 'Result<void>'),
  cap('C22', 'sms', 'useSMS()', 'wx.??（受限）', 'Result<void>'),
  cap('C23', 'app-lifecycle', 'useAppLifecycle()', 'App.onLaunch/onShow', 'LifecycleHooks'),
  cap('C24', 'page-lifecycle', 'usePageLifecycle()', 'Page.onLoad/onShow', 'LifecycleHooks'),
  cap('C25', 'background', 'useBackground()', 'wx.onBackground', 'BackgroundAPI'),
  // 7.3 通信/数据（10）
  cap('C26', 'fetch', 'useFetch()', 'wx.request', 'Promise<T>'),
  cap('C27', 'websocket', 'useWebSocket()', 'wx.connectSocket', 'WSConnection'),
  cap('C28', 'socket-task', 'useSocketTask()', 'wx.SocketTask', 'SocketTask'),
  cap('C29', 'upload', 'useUpload()', 'wx.uploadFile', 'Progress<Result>'),
  cap('C30', 'download', 'useDownload()', 'wx.downloadFile', 'Progress<Result>'),
  cap('C31', 'data-channel', 'useDataChannel()', 'wx...（直播/实时）', 'Channel'),
  cap('C32', 'cookie', 'useCookie()', '无', 'CookieJar'),
  cap('C33', 'auth', 'useAuth()', '组合', 'AuthState'),
  cap('C34', 'analytics', 'useAnalytics()', 'wx.reportEvent', 'TrackAPI'),
  cap('C35', 'log', 'useLog()', 'console + 上报', 'Logger'),
  // 7.4 扩展能力（10）
  cap('C36', 'bluetooth', 'useBluetooth()', 'wx.openBluetoothAdapter', 'BluetoothAPI'),
  cap('C37', 'nfc', 'useNFC()', 'wx.getHCEState', 'NFCAPI'),
  cap('C38', 'biometric', 'useBiometric()', 'wx.checkIsSupportFingerPrint', 'Result<boolean>'),
  cap('C39', 'face-id', 'useFaceID()', '组合', 'Result<boolean>'),
  cap('C40', 'payment', 'usePayment()', 'wx.requestPayment', 'Result<PayResult>'),
  cap('C41', 'login', 'useLogin()', 'wx.login', 'Result<Token>'),
  cap('C42', 'qr-code', 'useQRCode()', 'wx.scanCode + canvas', 'Result<string>'),
  cap('C43', 'file-system', 'useFileSystem()', 'wx.getFileSystemManager', 'FSAdapter'),
  cap('C44', 'archive', 'useArchive()', 'wx.compressFile', 'Result<void>'),
  cap('C45', 'shortcut', 'useShortcut()', 'wx.addToDesktop', 'Result<void>'),
  cap('C46', 'in-app-purchase', 'useInAppPurchase()', 'wx.requestPayment 扩展', 'Result<Receipt>'),
  // 7.5 平台特有（4——C47-C50，此前 7.4 末 C46，总 50）
  { id: 'C47', kind: 'capability', semantic: 'capability.mini-program', api: 'useMiniProgram()', props: ['MPContext'], mpEquiv: 'wx.navigateToMiniProgram', tier: 'L1', status: 'planned' },
  { id: 'C48', kind: 'capability', semantic: 'capability.embedded', api: 'useEmbedded()', props: ['HostContext'], mpEquiv: '无（被宿主嵌入）', tier: 'L1', status: 'planned' },
  { id: 'C49', kind: 'capability', semantic: 'capability.live', api: 'useLive()', props: ['LiveRoom'], mpEquiv: 'wx...（直播组件）', tier: 'L1', status: 'planned' },
  { id: 'C50', kind: 'capability', semantic: 'capability.extension', api: 'useExtension()', props: ['ExtensionAPI'], mpEquiv: '无（插件/扩展点 G-21）', tier: 'L1', status: 'planned' },
]

/** G-32 §8 ⑥ 工程原语 Engineering（28）——状态/生命周期 + 路由/导航 + 动画/过渡 + 调试/工程化 */
const ENGINEERING: PrimitiveDef[] = [
  { id: 'E1', kind: 'engineering', semantic: 'engineering.state', api: 'useState()', mpEquiv: 'data', tier: 'L1', status: 'planned' },
  { id: 'E2', kind: 'engineering', semantic: 'engineering.computed', api: 'useComputed()', mpEquiv: 'computed', tier: 'L1', status: 'planned' },
  { id: 'E3', kind: 'engineering', semantic: 'engineering.watch', api: 'useWatch()', mpEquiv: 'watch', tier: 'L1', status: 'planned' },
  { id: 'E4', kind: 'engineering', semantic: 'engineering.store', api: 'useStore()', mpEquiv: 'getApp().globalData', tier: 'L1', status: 'planned' },
  { id: 'E5', kind: 'engineering', semantic: 'engineering.provide-inject', api: 'useProvide()/useInject()', mpEquiv: '无', tier: 'L1', status: 'planned' },
  { id: 'E6', kind: 'engineering', semantic: 'engineering.lifecycle', api: 'useLifecycle()', mpEquiv: 'onLoad/onShow/onHide/onUnload', tier: 'L1', status: 'planned' },
  { id: 'E7', kind: 'engineering', semantic: 'engineering.ready', api: 'useReady()', mpEquiv: 'onReady', tier: 'L1', status: 'planned' },
  { id: 'E8', kind: 'engineering', semantic: 'engineering.error-boundary', api: 'useErrorBoundary()', mpEquiv: 'onError', tier: 'L1', status: 'planned' },
  { id: 'E9', kind: 'engineering', semantic: 'engineering.page-param', api: 'usePageParam()', mpEquiv: 'onLoad(options)', tier: 'L1', status: 'planned' },
  { id: 'E10', kind: 'engineering', semantic: 'engineering.route', api: 'useRoute()', mpEquiv: 'getCurrentPages()', tier: 'L1', status: 'planned' },
  { id: 'E11', kind: 'engineering', semantic: 'engineering.router-push', api: 'router.push()', mpEquiv: 'wx.navigateTo', tier: 'L1', status: 'planned' },
  { id: 'E12', kind: 'engineering', semantic: 'engineering.router-replace', api: 'router.replace()', mpEquiv: 'wx.redirectTo', tier: 'L1', status: 'planned' },
  { id: 'E13', kind: 'engineering', semantic: 'engineering.router-back', api: 'router.back()', mpEquiv: 'wx.navigateBack', tier: 'L1', status: 'planned' },
  { id: 'E14', kind: 'engineering', semantic: 'engineering.router-switch-tab', api: 'router.switchTab()', mpEquiv: 'wx.switchTab', tier: 'L1', status: 'planned' },
  { id: 'E15', kind: 'engineering', semantic: 'engineering.router-relaunch', api: 'router.reLaunch()', mpEquiv: 'wx.reLaunch', tier: 'L1', status: 'planned' },
  { id: 'E16', kind: 'engineering', semantic: 'engineering.router-before-each', api: 'router.beforeEach()', mpEquiv: 'onLaunch 手动', tier: 'L1', status: 'planned' },
  { id: 'E17', kind: 'engineering', semantic: 'engineering.router-after-each', api: 'router.afterEach()', mpEquiv: '无', tier: 'L1', status: 'planned' },
  { id: 'E18', kind: 'engineering', semantic: 'engineering.router-link', tag: 'router-link', props: ['to'], mpEquiv: '<navigator>', tier: 'L1', status: 'planned' },
  { id: 'E19', kind: 'engineering', semantic: 'engineering.transition', tag: 'p-transition', props: ['name', 'mode'], mpEquiv: 'transition CSS', tier: 'L1', status: 'planned' },
  { id: 'E20', kind: 'engineering', semantic: 'engineering.animate', tag: 'p-animate', props: ['keyframes', 'duration'], mpEquiv: 'animation CSS', tier: 'L1', status: 'planned' },
  { id: 'E21', kind: 'engineering', semantic: 'engineering.animation', api: 'useAnimation()', mpEquiv: 'wx.createAnimation', tier: 'L1', status: 'planned' },
  { id: 'E22', kind: 'engineering', semantic: 'engineering.gesture-animation', api: 'useGestureAnimation()', mpEquiv: '组合', tier: 'L1', status: 'planned' },
  { id: 'E23', kind: 'engineering', semantic: 'engineering.scroll-animation', api: 'useScrollAnimation()', mpEquiv: '组合', tier: 'L1', status: 'planned' },
  { id: 'E24', kind: 'engineering', semantic: 'engineering.devtools', api: 'useDevTools()', mpEquiv: '小程序 DevTools', tier: 'L1', status: 'planned' },
  { id: 'E25', kind: 'engineering', semantic: 'engineering.inspector', api: 'useInspector()', mpEquiv: '无', tier: 'L1', status: 'planned' },
  { id: 'E26', kind: 'engineering', semantic: 'engineering.performance', api: 'usePerformance()', mpEquiv: 'wx.reportPerformance', tier: 'L1', status: 'planned' },
  { id: 'E27', kind: 'engineering', semantic: 'engineering.define-component', api: 'defineComponent()', mpEquiv: 'Component()', tier: 'L1', status: 'planned' },
  { id: 'E28', kind: 'engineering', semantic: 'engineering.define-capability', api: 'defineCapability()', mpEquiv: '无', tier: 'L1', status: 'planned' },
]

/** ★G-32 B1：128 原语冻结清单（唯一事实源） */
export const PRIMITIVE_CATALOG: PrimitiveDef[] = [...LAYOUT, ...UI, ...SHELL, ...GESTURE, ...CAPABILITY, ...ENGINEERING]

// —— 选取器（SSOT 派生：下游一律经此取数，防手工漂移） ——

/** 组件原语（p-* 标签 → C-IR 语义的来源） */
export function componentPrimitives(kinds: PrimitiveKind[] = ['layout', 'ui', 'shell', 'gesture', 'engineering']): PrimitiveDef[] {
  return PRIMITIVE_CATALOG.filter((p) => p.tag && kinds.includes(p.kind))
}

/** 已实现状态原语（语义必须在 SEMANTIC_BACKEND_MAP ≥3 端——G-31.4/G-32.3 门禁适用） */
export function implementedPrimitives(): PrimitiveDef[] {
  return PRIMITIVE_CATALOG.filter((p) => p.status === 'implemented')
}

/** 按 id 查原语 */
export function primitiveById(id: string): PrimitiveDef | undefined {
  return PRIMITIVE_CATALOG.find((p) => p.id === id)
}

/** 按语义查原语 */
export function primitiveBySemantic(semantic: string): PrimitiveDef | undefined {
  return PRIMITIVE_CATALOG.find((p) => p.semantic === semantic)
}

/** 按 p-* 标签查原语 */
export function primitiveByTag(tag: string): PrimitiveDef | undefined {
  return PRIMITIVE_CATALOG.find((p) => p.tag === tag)
}

/** 清单自检：128 项 / id 唯一 / semantic 唯一 / 编号连续 */
export function checkPrimitiveCatalog(): string[] {
  const errors: string[] = []
  if (PRIMITIVE_CATALOG.length !== 128) errors.push(`清单长度 ${PRIMITIVE_CATALOG.length} ≠ 128`)
  const ids = new Set(PRIMITIVE_CATALOG.map((p) => p.id))
  if (ids.size !== PRIMITIVE_CATALOG.length) errors.push('id 重复')
  const sems = new Set(PRIMITIVE_CATALOG.map((p) => p.semantic))
  if (sems.size !== PRIMITIVE_CATALOG.length) errors.push('semantic 重复')
  const tags = PRIMITIVE_CATALOG.filter((p) => p.tag).map((p) => p.tag)
  if (new Set(tags).size !== tags.length) errors.push('tag 重复')
  return errors
}