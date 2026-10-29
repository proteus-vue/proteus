<script setup lang="ts">
// Studio 壳（决策 #1183）：纯 Vue 3 + Vite，**不接 Proteus**（自举死锁的红线）。
// 布局仍是「顶部条 / 左栏 / 画布 / 右栏 / 状态栏」，画布位置由 HTML 驱动原生视图。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  loadLayout,
  railHidden,
  railW,
  sideHidden,
  sideW,
  startDrag,
  toggleRail,
  toggleSide,
  toggleTree,
  termH,
  termMode,
  termSplit,
  termSplitW,
  toggleTermMax,
  toggleTermPane,
  treeHidden,
  treeW,
  startDragTerm,
} from './layout'
import { capturePreset, copyText, deviceSwipe, deviceTap, iosKey, iosLongpress, iosScroll, iosStreamHint, iosSwipe, iosTap, openSettings, setCanvasRect, type IosHint } from './bridge'
import { pushToast } from './toast'
import { ms, num, pct, useStats } from './useStats'
import DevicePanel from './panels/DevicePanel.vue'
import DeviceSwitcher from './panels/DeviceSwitcher.vue'
import PipelinePanel from './panels/PipelinePanel.vue'
import RuntimePanel from './panels/RuntimePanel.vue'
import InspectorPanel from './panels/InspectorPanel.vue'
import CodePanel from './panels/CodePanel.vue'
import TerminalPanel from './panels/TerminalPanel.vue'
import StudioIcon from './icons/StudioIcon.vue'
import StudioMark from './icons/StudioMark.vue'
import ContextMenu from './ContextMenu.vue'
import { detectLangId, editorLang, effectiveLangId, langOverrides, setLangOverride } from './editorLang'
import { LANGS, langLabel } from './langs'
import { openMenu } from './contextmenu'
import ToastStack from './ToastStack.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import { clampZoom, hydrateWorkspace, useWorkspaceState, type ViewName } from './useWorkspaceState'
import { onMenuAction, wireMenu } from './menu'
import { useStageGeometry } from './composables/useStageGeometry'
import { useQuality } from './composables/useQuality'
import { useDeviceKeyboard } from './composables/useDeviceKeyboard'

const { stats, error, hasBridge } = useStats(500)
const rect = ref('—')
const canvasEl = ref<HTMLElement | null>(null)
const stageEl = ref<HTMLElement | null>(null)

/** ★G5：视图状态存在工作区会话里（重启恢复），不再是组件内的临时 ref。
 *  ★切到 code 时必须把**原生视图**收成 0×0 —— 它是叠在 HTML 之上的独立 NSView，
 *    只隐藏 HTML 里的 #canvas 是盖不住它（会看到 GL 画面浮在代码面板上）。 */
const ws = useWorkspaceState()
const view = computed(() => ws.view)

/* ─── 设备画面：等比适配 + 缩放 / 平移（几何计算已抽到 composables/useStageGeometry.ts）───
 * 该文件头保存完整事故记录：为什么必须等比（FBO dump 永远正确、只有人眼看窗口才看得出变形）
 * 与为什么平移必须在 HTML 侧（原生 mouseDown 被 webview 吃掉，一次都不触发）。
 * 抽出理由：本文件脚本区曾 800 行、整文件 1109 行越过 check:file-size 的 1000 行上限。
 */
/**
 * ★把 `ws.zoom` 桥成可写 Ref：stageGeometry 要"读 + 写"同一个缩放值。
 *   不能直接传 `ws.zoom`（那是个 number，不是 Ref）；也不能每次传新对象
 *   （会破坏 composable 内部 computed 的响应性）。⇒ 用 get/set 双钩子。
 */
const wsZoom = computed({
  get: () => ws.zoom,
  set: (v: number) => { ws.zoom = v },
})
const stageGeom = useStageGeometry(stats, wsZoom)
const stageBox = stageGeom.stageBox
const devAspect = stageGeom.devAspect
const pan = stageGeom.pan
const screenSize = stageGeom.screenSize
const panLimit = stageGeom.panLimit
const clampPan = stageGeom.clampPan
const screenStyle = stageGeom.screenStyle
const zoomLabel = stageGeom.zoomLabel

function setZoom(z: number) {
  stageGeom.setZoom(z, () => void syncRect())
}

/** 当前文件的语言模式名（手选优先）——底部状态栏的 chip 用它 */
const langNow = computed(() => langLabel(effectiveLangId(editorLang.path)))

function pickLang(e: MouseEvent) {
  const p = editorLang.path
  if (!p) return
  const auto = detectLangId(p)
  openMenu(
    e,
    [
      { id: '__auto', label: `自动（${langLabel(auto)}）`, accel: langOverrides[p] ? '' : '✓' },
      { id: '__sep', label: '', sep: true },
      ...LANGS.map((lang) => ({ id: lang.id, label: lang.label, accel: langOverrides[p] === lang.id ? '✓' : '' })),
    ],
    (id) => setLangOverride(p, id === '__auto' ? '' : id),
  )
}

/* ─── 菜单动作（决策 #1221）───────────────────────────────────────────────────
 * 原生菜单只送 id 过来，具体做什么在这里定。★菜单、快捷键、面板按钮共用**同一批函数**——
 * 不复制第二份逻辑（复制出来的第二份一定会漂移，这是本仓反复踩过的坑）。
 * ★`nativeMenu` 由 wireMenu() 给出：true = 窗口里真的挂着我们建的 NSMenu。
 */
let nativeMenu = false
const menuOffs = [
  onMenuAction('view.device', () => void switchView('device')),
  onMenuAction('view.code', () => void switchView('code')),
  onMenuAction('view.term', () => void switchView('term')),  onMenuAction('view.zoomReset', () => setZoom(1)),
  onMenuAction('view.zoomIn', () => setZoom(ws.zoom + 0.25)),
  onMenuAction('view.zoomOut', () => setZoom(ws.zoom - 0.25)),
  // ★设置是**独立窗口**（决策 #1267）：菜单/按钮只负责把它叫出来
  onMenuAction('app.settings', () => void openSettings()),
]

/** 画布矩形：HTML 定布局，原生跟随（#1173 的接线，这里只是搬到 Vue 里） */
async function syncRect() {
  const stage = stageEl.value
  if (!stage || view.value !== 'device') return
  // ① 先量**舞台**（决定屏幕该多大）→ ② 等 Vue 把新尺寸刷到 DOM → ③ 再量屏幕
  //   ★顺序不能反：直接量 #canvas 拿到的是**上一轮**的尺寸，缩放/改窗口时会慢一拍，
  //     而慢一拍的表现是"画面比边框大一点"（原生视图跟着旧矩形走）。
  const sb = stage.getBoundingClientRect()
  if (sb.width !== stageBox.value.w || sb.height !== stageBox.value.h) {
    stageBox.value = { w: sb.width, h: sb.height }
  }
  await nextTick()
  const el = canvasEl.value
  if (!el) return
  const r = el.getBoundingClientRect()
  rect.value = `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}×${Math.round(r.height)}`
  try {
    await setCanvasRect({ x: r.x, y: r.y, w: r.width, h: r.height })
  } catch {
    /* 没桥时静默：面板本身还要能看（Playwright / 浏览器直开） */
  }
}

async function switchView(v: ViewName) {
  ws.view = v
  /* ★不是 device 就必须把原生画布收成 0×0（决策 #1279 把 code 那条判断泛化了）：
     原来只判 `code`，加终端视图后如果漏了，GL 画面会**浮在终端上面**——
     终端看起来"打不出字"，其实是原生视图盖着（与 #1257 同一类故障）。 */
  if (v !== 'device') {
    rect.value = '—'
    try {
      await setCanvasRect({ x: 0, y: 0, w: 0, h: 0 })
    } catch {
      /* 没桥时静默 */
    }
  } else {
    // ★等 DOM 把 #canvas 渲染回来再量（否则 canvasEl 还是 null）
    await nextTick()
    void syncRect()
  }
}

/* 缩放快捷键（IDE 通用）：⌘0 适应 / ⌘= 放大 / ⌘- 缩小。
   ★只在设备视图生效——代码视图里 ⌘- 该留给「编辑器字号」，不能在这里抢。
   ★原生菜单在时直接返回：这三组快捷键做了 menu accelerator，在 **NSApplication 层**就被吃掉了，
     webview 的 keydown 根本收不到（真机上这里不会执行）；只有浏览器/门禁才走这条兜底。
     留着它是因为"没菜单的环境也该能缩放"，同时 **不能** 两边都执行（会一次跳两档）。 */
function onKey(e: KeyboardEvent) {
  /* ★**画布聚焦时，按键送给设备**（决策 #1341）：
     复用这一个全局入口，而不是再加一个 canvas 级监听——
     两个监听会各自处理一次（今天踩过同名冲突 + 双触发）。
     放在最前面且**先于**快捷键判断：否则 Cmd+C 之类会先被 IDE 吃掉。 */
  if (canvasEl.value && document.activeElement === canvasEl.value && touchOn.value) {
    if (!(e.metaKey || e.ctrlKey || e.altKey) && sendKeyToDevice(e)) return
  }
  /* ⌘J 终端面板 · ⌘⇧J 终端最大化（决策 #1346）：VS Code 手感 */
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
    e.preventDefault()
    if (e.shiftKey) toggleTermMax()
    else toggleTermPane()
    return
  }
  /* ⌘B 收起/展开右栏 · ⌘⇧B 收起/展开左栏（决策 #1343）：IDE 通用手感 */
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
    e.preventDefault()
    /* ⌘B = 当前视图的"主侧栏"（VS Code 手感）：画布视图切右面板，代码视图切文件树 */
    if (e.shiftKey) toggleRail()
    else if (view.value === 'code') toggleTree()
    else toggleSide()
    return
  }
  if (nativeMenu) return
  if (view.value !== 'device' || !(e.metaKey || e.ctrlKey)) return
  if (e.key === '0') {
    e.preventDefault()
    setZoom(1)
  } else if (e.key === '=' || e.key === '+') {
    e.preventDefault()
    setZoom(ws.zoom + 0.25)
  } else if (e.key === '-') {
    e.preventDefault()
    setZoom(ws.zoom - 0.25)
  }
}

let rectTimer: ReturnType<typeof setInterval> | undefined
/** ★首帧到达 ⇒ 设备比例从"未知"变成真值 ⇒ 屏幕矩形变了 ⇒ **必须立刻**重新同步原生视图。
 *  只靠 1s 的兜底定时器会出现最多 1 秒的"画面仍按满屏拉伸"的窗口，
 *  而那一秒恰好是用户第一次看到画面的时刻。 */
watch(devAspect, () => {
  void syncRect()
})
/** 平移是高频事件（pointermove 可达 120Hz）：用 rAF 合并成每帧一次 IPC。
 *  不合并的话每个 pointermove 都发一次 set_canvas_rect，原生侧跟着改视图 frame —— 白烧 CPU。 */
let rafId = 0
function scheduleSync() {
  if (rafId) return
  rafId = requestAnimationFrame(() => {
    rafId = 0
    void syncRect()
  })
}
watch(pan, scheduleSync)

/** 指针输入（点选落点 + 拖拽平移）。坐标一律折算成**设备像素** ——
 *  这是设备检查器真正关心的量（"我点的这个点在设备上是第几个像素"），
 *  而不是 CSS px（同一台设备在 100% / 200% 缩放下 CSS 值会变，设备值不会）。 */
const pick = ref<{ x: number; y: number } | null>(null)
/** `device` = 这一次按下带 ⌥（手势注入而非平移）；`t0` 按下时刻（算滑动/长按时长）。 */
let drag: {
  id: number
  x0: number
  y0: number
  px: number
  py: number
  moved: boolean
  device: boolean
  t0: number
  lx: number
  ly: number
} | null = null

/** 视口坐标 → 设备像素。★单独一个函数：滑动的**起点**要能随时折算（不能只靠事件对象）。 */
function clientToDevice(clientX: number, clientY: number): { x: number; y: number } | null {
  const el = canvasEl.value
  const d = stats.value
  if (!el || !d || d.width <= 0 || d.height <= 0) return null
  const r = el.getBoundingClientRect()
  if (r.width <= 0 || r.height <= 0) return null
  /* ★★映射到**设备物理像素**，不是码流像素（决策 #1260）。
     码流是按长边≤1920 等比缩过的（1200×2608 ⇒ 884×1920，差 0.737 倍）；
     拿码流尺寸去 `input tap`，点屏幕下方的"设置"就会落到它上面那个 App
     （实测：PICK 621,1746，而设置图标实际在 y≈2450）。
     `dev_w/h` 未知时（iOS 那条腿 / 探测失败）才回落到码流尺寸。 */
  const dw = d.dev_w > 0 ? d.dev_w : d.width
  const dh = d.dev_h > 0 ? d.dev_h : d.height
  const x = Math.round(((clientX - r.left) / r.width) * dw)
  const y = Math.round(((clientY - r.top) / r.height) * dh)
  /* ★★夹进屏幕范围（决策 #1262）：指针捕获会让拖拽在画布外继续产生 pointermove
     （拖到窗口外也照样来）⇒ 不夹会算出**负坐标**，而 `device_tap/swipe` 的参数是 `u32`，
     Tauri 直接拒绝并弹「invalid value: integer -220, expected u32」——用户只看到一条莫名其妙的红条，
     而该发生的是"手指顶到屏幕边上"。
     ★为什么只夹这一次：在**映射之后**夹，就等于同时处理了左下越界与右上越界；
       再在映射前夹一遍只是重复（第一版就写了两道，破坏性验证因此测不出差别）。 */
  return {
    x: Math.min(Math.max(x, 0), dw - 1),
    y: Math.min(Math.max(y, 0), dh - 1),
  }
}

/**
 * 视口坐标 → **归一化 0..1**（决策 #1295 · 只给 iOS 触控回传用）。
 *
 * ★为什么不能复用 `clientToDevice`：iOS 注入要**逻辑点**（宿主 `bounds`，如 390×844），
 *   而 `clientToDevice` 给的是**设备物理像素**（安卓 `input tap` 口径，如 1200×2608）；
 *   ReplayKit 推流帧又是第三种（888×1920）。三者换算需要 scale，而 scale 只有设备知道。
 *   ⇒ 传归一化、由宿主乘自己的 `bounds`：两端都不用猜（实测 0.5/0.15 → 195,126.6）。
 */
function clientToNorm(clientX: number, clientY: number): { nx: number; ny: number } | null {
  const el = canvasEl.value
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (r.width <= 0 || r.height <= 0) return null
  return {
    nx: Math.min(1, Math.max(0, (clientX - r.left) / r.width)),
    ny: Math.min(1, Math.max(0, (clientY - r.top) / r.height)),
  }
}

const toDevice = (e: PointerEvent) => clientToDevice(e.clientX, e.clientY)

function onPointerDown(e: PointerEvent) {
  /* ★点击画布即聚焦（决策 #1341）：键盘输入依赖"画布是当前焦点"，
     而 div 只有在 tabindex 且被点过之后才会成为 activeElement。 */
  canvasEl.value?.focus?.()
  const p = toDevice(e)
  if (p) pick.value = p
  // ★`moved` 用来区分"点一下"和"拖着看别处"（决策 #1254）：拖拽是**看**，不该在设备上留下点击。
  //   阈值 4 CSS px：手抖/触控板微动不算拖，而真正的平移手势早就超过这个量。
  // ★`device` = 这次拖拽**注入到设备**（滑动/长按）。★★2026-10-26 反转默认（决策 #1261）：
  //   原来要求按住 ⌥ 才注入（怕抢走"平移画布"），结果用户第一反应就是"直接拖"⇒ 拖不动手机。
  //   **镜像工具的心智模型里，拖拽本来就该操作手机**；平移是次要动作 ⇒ 挪到 ⌥ 上。
  //   触控关掉时（`touchOn=false`）退化成纯看图：拖拽仍然是平移。
  drag = {
    id: e.pointerId,
    x0: e.clientX,
    y0: e.clientY,
    px: pan.value.x,
    py: pan.value.y,
    moved: false,
    device: touchOn.value && !e.altKey,
    t0: performance.now(),
    lx: e.clientX,
    ly: e.clientY,
  }
  try {
    e.currentTarget instanceof HTMLElement && e.currentTarget.setPointerCapture(e.pointerId)
  } catch {
    /* 合成事件（测试）没有真实 pointerId，捕获失败不影响逻辑 */
  }
}

function onPointerMove(e: PointerEvent) {
  if (!drag || drag.id !== e.pointerId) return
  if (Math.abs(e.clientX - drag.x0) > 4 || Math.abs(e.clientY - drag.y0) > 4) drag.moved = true
  drag.lx = e.clientX
  drag.ly = e.clientY
  if (drag.device) return // ⌥ 手势：不移动画布，只等 up 时把整段位移注入设备
  pan.value = clampPan({
    x: drag.px + (e.clientX - drag.x0),
    y: drag.py + (e.clientY - drag.y0),
  })
}

function onPointerUp(e: PointerEvent) {
  if (!drag || drag.id !== e.pointerId) return
  const { moved, device, t0, x0, y0 } = drag
  drag = null
  try {
    e.currentTarget instanceof HTMLElement && e.currentTarget.releasePointerCapture(e.pointerId)
  } catch {
    /* 同上 */
  }
  if (device) {
    void injectGesture(e, x0, y0, t0, moved)
    return
  }
  // 只有"没拖动过的一次点击"才回传到设备（普通拖拽 = 平移，不上设备）
  if (!moved) void injectTap(e)
}

/* ─── 触摸回传（决策 #1254 · G4 第三项）：画布点一下 ⇒ 真机上也点一下 ─────────────
 * 【为什么值得做】投屏只解决"看得见"，而调试 90% 的动作是"点一下这一步"。没有回传，
 *   每次验证都要放下鼠标去拿手机——这就是"能看不能用"。
 * 【坐标】用 `toDevice()` 的**设备像素**（不是 CSS px）：同一台设备在 100%/200% 缩放下
 *   CSS 值会变、设备值不会；注入必须用设备值，否则放大后就点偏。
 * 【失败怎么表现】`device_tap` 的 Err 分两类：源不支持（iOS/录制流）与 adb 失败。
 *   前者只提示一次并**自动关掉**开关（否则每次点击都弹一次、用户以为是自己点错）；
 *   后者每次都提示（那是真故障，不能吞）。
 */
const touchOn = ref(true)
let touchWarned = false
let touchBusy = false

/* ★★★#1344：**画质档位**（#1264）已抽到 composables/useQuality.ts（自包含；只依赖
   capturePreset + pushToast）。文件头记着那两条设计理由：① 用户纠正的是"同分辨率的清晰度档"
   而不是"切分辨率"（两个轴不是一回事）；② 真机 USB 实测 4/8/13/20 Mbps 四档迟到帧恒为 0
   ⇒ 低码率在 USB 下换不到帧率，它换的是抗抖动与省带宽（Wi-Fi adb 才有意义）。 */
const quality = useQuality()
const qIndex = quality.qIndex
const capBusy = quality.capBusy
const qNow = quality.qNow
const capLabel = quality.capLabel
const capTitle = quality.capTitle
const cycleQuality = quality.cycleQuality

/** ⌥ 手势里"按住多久算长按"（Android 默认 long press ≈500ms，取 600ms 更稳） */
const HOLD_MS = 600

/** 注入失败的统一处理：**两类失败必须分开**——
 *  「源不支持」⇒ 提示一次 + 自动关开关（否则每次点击都弹，用户以为是自己点错）；
 *  「这次没成功」（熄屏 / adb 报错）⇒ 每次都提示（真故障不能吞）。 */
function onTouchError(err: unknown) {
  const msg = String((err as Error)?.message ?? err)
  if (msg.includes('不支持触控回传')) {
    touchOn.value = false
    if (!touchWarned) {
      touchWarned = true
      pushToast(`${msg}（已关闭触控回传）`, 'info')
    }
  } else {
    pushToast(msg, 'err')
  }
}

async function injectTap(e: PointerEvent) {
  if (!touchOn.value || touchBusy) return
  const p = toDevice(e)
  if (!p) return
  touchBusy = true
  try {
    /* ★iOS 走控制通道注入归一化坐标（决策 #1295）；安卓仍走 adb 物理像素 */
    const n = iosSource.value ? clientToNorm(e.clientX, e.clientY) : null
    if (n) await iosTap(n.nx, n.ny)
    else await deviceTap(p.x, p.y)
  } catch (err) {
    onTouchError(err)
  } finally {
    touchBusy = false
  }
}

/**
 * ⌥ 手势（决策 #1255）：按下到松开的整段位移注入到设备。
 * 三种落点：**拖动 ⇒ 滑动**（时长 = 真实按住时长）· **不动且 ≥600ms ⇒ 长按** · 其余 ⇒ 普通点击。
 *
 * ★长按没有单独的命令/手势：Android 的语义就是 `input swipe x y x y <ms>`，
 *   另立一套只会让两条路各写一遍闸门（源不支持 / 熄屏 / 串号），迟早漂移。
 * ★时长用**真实按住时长**而不是写死：用户在画布上慢慢拖，设备上也该慢慢滑——
 *   写死 300ms 会把"慢慢挪到某个按钮"变成"甩一下"，端点就飞了。
 */
async function injectGesture(e: PointerEvent, x0: number, y0: number, t0: number, moved: boolean) {
  if (!touchOn.value || touchBusy) return
  const a = clientToDevice(x0, y0)
  const b = clientToDevice(e.clientX, e.clientY)
  if (!a || !b) return
  const elapsed = Math.round(performance.now() - t0)
  touchBusy = true
  try {
    if (iosSource.value) {
      const n0 = clientToNorm(x0, y0)
      const n1 = clientToNorm(e.clientX, e.clientY)
      if (!n0 || !n1) return
      if (moved) await iosSwipe(n0.nx, n0.ny, n1.nx - n0.nx, n1.ny - n0.ny)
      else if (elapsed >= HOLD_MS) await iosLongpress(n0.nx, n0.ny)
      else await iosTap(n0.nx, n0.ny)
      return
    }
    if (moved) await deviceSwipe(a.x, a.y, b.x, b.y, elapsed)
    else if (elapsed >= HOLD_MS) await deviceSwipe(a.x, a.y, a.x, a.y, HOLD_MS)
    else await deviceTap(a.x, a.y)
  } catch (err) {
    onTouchError(err)
  } finally {
    touchBusy = false
  }
}

/**
 * 滚轮 → 设备（决策 #1327）：iPhone 镜像会把 Mac 滚轮换算成手机的上下滑。
 *
 * ★必须 `preventDefault`（模板里用 `@wheel.prevent`）：否则先把**页面**滚了；
 * ★按帧节流：触控板一次滑动会连发几十个 wheel，一个个注入会把手机刷爆。
 */
/**
 * 滚轮 → 设备（决策 #1327 / 会话化 #1329）。
 *
 * ★★为什么要"会话"：滚轮是连续输入，而每条消息都要做"藏指针+激活+还原"（30~80ms），
 *   串行发送就成了"一格一格"，用户实测"没有在镜像里直接滚那么丝滑"。
 *   现在：begin 只做一次准备；期间每 16ms 把累积量 post 一次（只发滚动事件，~1ms）；
 *   停手 220ms 后 end 还原指针与焦点。
 * ★所有调用走**串行队列**：begin 必须早于 post，end 必须晚于最后一个 post。
 */
let scrollActive = false
let scrollAcc = 0
let scrollPt: { nx: number; ny: number } | null = null
let scrollTick: number | undefined
let scrollIdle: number | undefined
let queue: Promise<void> = Promise.resolve()

function enqueue(fn: () => Promise<unknown>) {
  queue = queue.then(fn).then(
    () => undefined,
    (err) => {
      const msg = String((err as Error)?.message ?? err)
      /* 滚轮在某源上不支持时只提示**一次**，并且不再发送（否则每帧弹一个） */
      if (msg.includes('不支持滚轮')) {
        scrollUnsupported = true
        if (scrollActive) {
          scrollActive = false
          if (scrollTick) {
            window.clearInterval(scrollTick)
            scrollTick = undefined
          }
        }
      }
      onTouchError(err)
    },
  )
}

let scrollUnsupported = false
function onWheel(e: WheelEvent) {
  if (!touchOn.value || scrollUnsupported) return
  const n = clientToNorm(e.clientX, e.clientY)
  if (!n) return
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1
  scrollAcc += e.deltaY * unit
  scrollPt = n
  if (!scrollActive) {
    scrollActive = true
    const p0 = n
    enqueue(() => iosScroll(p0.nx, p0.ny, 0, 'begin'))
  }
  /* 每 16ms 发一次（约一帧），而不是每个 wheel 事件都发 */
  if (!scrollTick) {
    scrollTick = window.setInterval(() => {
      if (!scrollPt || Math.abs(scrollAcc) < 1) return
      const dy = scrollAcc
      scrollAcc = 0
      const pt = scrollPt
      enqueue(() => iosScroll(pt.nx, pt.ny, dy, 'post'))
    }, 16)
  }
  /* 停手 220ms ⇒ 收尾：把余量发完，再结束会话 */
  if (scrollIdle) window.clearTimeout(scrollIdle)
  scrollIdle = window.setTimeout(() => {
    if (scrollTick) {
      window.clearInterval(scrollTick)
      scrollTick = undefined
    }
    if (scrollPt && Math.abs(scrollAcc) >= 1) {
      const dy = scrollAcc
      const pt = scrollPt
      scrollAcc = 0
      enqueue(() => iosScroll(pt.nx, pt.ny, dy, 'post'))
    }
    enqueue(async () => {
      await iosScroll(0, 0, 0, 'end')
      scrollActive = false
    })
  }, 220)
}

/**
 * 键盘 → 设备（决策 #1341）：缓冲/合并/顺序逻辑已抽到 composables/useDeviceKeyboard.ts。
 * ★该文件头记着两条**真机踩出来的**设计（可打印字符合并后发 / 特殊键立刻发以保顺序），
 *   以及"Cmd/Ctrl 组合键一律放行"（那是 IDE 自己的快捷键）。
 * ★失败处理仍走本文件的 onTouchError（源不支持只提示一次并关开关 / 真故障每次提示）。
 */
const deviceKeyboard = useDeviceKeyboard(onTouchError)

/** 把一次按键送给设备；返回 true 表示"已消费"（调用方不再往下走快捷键） */
function sendKeyToDevice(e: KeyboardEvent): boolean {
  return deviceKeyboard.sendKeyToDevice(e)
}

/**
 * 终端面板的**左偏移**（决策 #1347）：用户实测"终端把文件树那列也盖住了"。
 *
 * VS Code 的规则是：面板属于**编辑器组**，只占编辑器宽度，不横向跨到侧栏/文件树。
 * 这里用"距中栏左侧 = 文件树宽度"来对齐：代码视图且文件树展开时才偏移，其它情况为 0。
 */
/**
 * 终端面板几何（决策 #1348）：
 *  · **代码视图**：绝对定位、只浮在**编辑器列**下方（left = 文件树宽度）⇒
 *    文件树可以**占满整列高度**（左栏不再出现一大片空白）；
 *    编辑器列自己加 `padding-bottom = termH`（见 CodePanel），所以内容不会被盖住。
 *  · **画布视图**：仍是在文档流里的下半个区（原生画布要按 rect 收缩，不能被覆盖）。
 */
/** 拆分开关：拆开时副栏会**新开一个会话**（副栏自己的 TerminalPanel 负责） */
function toggleTermSplit() {
  termSplit.value = !termSplit.value
  if (!termSplit.value) termSplitW.value = 0
}

/** 拖动两栏分隔条（与栏宽拖动同一套 pointer 手势，不引入新依赖） */
function startDragTermSplit(e: PointerEvent) {
  const wrap = (e.currentTarget as HTMLElement).parentElement
  if (!wrap) return
  const rect = wrap.getBoundingClientRect()
  const move = (ev: PointerEvent) => {
    const w = ev.clientX - rect.left
    termSplitW.value = Math.round(Math.min(Math.max(240, w), rect.width - 240))
  }
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

const paneStyle = computed(() => {
  if (termMode.value === 'full') return undefined
  if (termMode.value !== 'pane') return undefined
  if (view.value === 'code') return { left: termLeft.value + 'px', height: termH.value + 'px' }
  return { height: termH.value + 'px' }
})

const termLeft = computed(() => (view.value === 'code' && !treeHidden.value ? treeW.value : 0))

onMounted(async () => {
  loadLayout()
  // ★先恢复上次的视图，再量画布：顺序反了会先按设备视图同步一次 rect，
  //   而恢复成 code 视图时那次同步是白做的（还会让原生画布闪一下）。
  await hydrateWorkspace()
  await nextTick()
  if (view.value === 'device') await syncRect()
  else await setCanvasRect({ x: 0, y: 0, w: 0, h: 0 }).catch(() => {})
  rectTimer = setInterval(syncRect, 1000)
  addEventListener('resize', syncRect)
  addEventListener('keydown', onKey)
  // 接上原生菜单（#1221）。★放在最后：处理器在上面的模块作用域已注册完，
  //   此刻起用户点菜单才有东西可接。
  nativeMenu = wireMenu().native
  // iOS 接法提示（#1277）：先取一次（首帧可能还没来），之后低频轮询
  void refreshIosHint()
  iosTimer = setInterval(refreshIosHint, 2000)
})
onBeforeUnmount(() => {
  if (rectTimer) clearInterval(rectTimer)
  if (iosTimer) clearInterval(iosTimer)
  if (rafId) cancelAnimationFrame(rafId)
  removeEventListener('resize', syncRect)
  removeEventListener('keydown', onKey)
  menuOffs.forEach((off) => off())
})

/** 点击标记的百分比位置（相对设备屏幕，不用关心舞台的像素值与平移） */
const pickStyle = computed(() => {
  const p = pick.value
  const d = stats.value
  if (!p || !d || d.width <= 0 || d.height <= 0) return null
  return { left: `${(p.x / d.width) * 100}%`, top: `${(p.y / d.height) * 100}%` }
})

/** 推流已中断（决策 #1290）：画布已被抹黑，此时不能再说"运行中" */
const stalled = computed(() => !!stats.value?.stalled)
/* ★`frames` 是累计值，第一帧之后永远 >0 ⇒ 光看它会把"断了"也报成运行中。
   必须叠加 `!stalled`，否则用户看到"画布运行中"而画面是停的（实测反馈）。 */
const running = computed(() => (stats.value?.frames ?? 0) > 0 && !stalled.value)
/* ★"静止"是第三种态（决策 #1291）：iOS 的 ReplayKit 只在屏幕**变化**时出帧，
   所以"没有新帧"多数时候是**正常**的 —— 画面保持最后一帧、只把帧率报 0。
   注意它**不能**让 `running` 变 false：`.screen` 靠 running 决定"透明洞"，
   一旦变 false 会盖一层不透明底色，把最后一帧也挡住。 */
const still = computed(
  () => !stalled.value && (stats.value?.frames ?? 0) > 0 && (stats.value?.fps ?? -1) === 0,
)
const linkText = computed(() =>
  !hasBridge
    ? '未连接 IPC'
    : stalled.value
      ? '手机端已停止推流'
      : still.value
        ? '画面静止'
        : running.value
          ? '画布运行中'
          : '等待首帧',
)
const hint = computed(() => {
  if (error.value) return 'stats 调用失败：' + error.value
  if (!hasBridge) return '无 Tauri 桥（浏览器直开时属正常）'
  if (stalled.value) return '推流已中断：手机端退出/回桌面/断网后重新开始直播即可'
  if (still.value) return '画面静止：手机端没有新的画面变化（iOS 只在屏幕变化时出帧），画面停在最后一帧'
  return running.value ? '原生画布运行中 · 60Hz 调度 · VT 解码' : '等待原生画布…'
})
/** 画面角标：一眼知道"这是什么流"，不用去右栏找 */
const hud = computed(() => {
  const s = stats.value
  if (!s || s.width <= 0 || s.height <= 0) return '无画面'
  return `${s.width}×${s.height} · ${s.hwdec ? '硬解' : '软解'}`
})

/* ─── iOS 投屏引导（决策 #1277）─────────────────────────────────────────────
 *
 * 【为什么必须做在界面上】iOS 那条腿的最后一公里**只能用户自己走**：
 *   装 ProteusHost 到真机要 `codesign` 访问 login 钥匙串，沙箱环境实测被拦
 *   （`[sandbox] 命令被沙箱拦截：login.keychain-db (file-write)`）。
 *   而"该跑哪条命令"以前只写在 stderr 里 —— 用户点了 iPhone 行，看到的只是黑屏。
 *   ⇒ 界面唯一做对的事：把 IP / 端口 / 整行命令**摆到能复制的地方**，并说清现在卡在哪一步。
 *
 * 【为什么轮询而不是"切设备时算一次"】采集源有三种入口（启动自动探测 / 环境变量 /
 *   设备列表点选），只有 Rust 侧知道此刻到底是不是 nc 在听。轮询 2s 一次足够，成本是
 *   两次 `lsof`（微秒级）；而这个提示的存在时长本来就很短（手机一推上来就消失）。
 */
const iosHint = ref<IosHint | null>(null)
/**
 * 当前采集源是不是 iOS（决定触控走哪条腿：控制通道 vs adb）。
 *
 * ★★不能用 `iosHint.active`（决策 #1298，用户实测"点了没反应"的直因）：
 *   那个值是挂载时算一次的**快照**，切到 iOS 后不会重算 ⇒ `iosSource` 恒 false
 *   ⇒ 点击走的是 `deviceTap`（安卓腿），而 iOS 模式下 ADB_SERIAL 是空的 ⇒ 发给空气。
 *   改用 `stats.source`（每拍都来自 `capture_preset::current_kind()`，是真源）。
 */
const iosSource = computed(
  () =>
    stats.value?.source === 'ios' || stats.value?.source === 'sim' || stats.value?.source === 'mirror',
)
let iosTimer: ReturnType<typeof setInterval> | null = null
/** 只在"没画面 + 采集源是 iOS"时才显示，避免 Android 投屏时弹一段无关说明 */
const iosGuide = computed(() => (!running.value && iosHint.value?.active ? iosHint.value : null))

async function refreshIosHint() {
  if (!hasBridge) return
  try {
    iosHint.value = await iosStreamHint()
  } catch {
    iosHint.value = null // 提示是**附加信息**：拿不到就安静地不显示，不弹错
  }
}

async function copyIosCmd() {
  const c = iosHint.value?.cmd
  if (!c) return
  try {
    await copyText(c)
    pushToast('命令已复制，粘到终端里跑（要在仓库根目录）', 'info')
  } catch (e) {
    pushToast(String((e as Error)?.message ?? e), 'err')
  }
}
</script>

<template>
  <!-- ★布局宽度/收起由内联 style 统一计算（决策 #1345）：
       内联优先级高于类规则 ⇒ "在类里把 --side-w 置 0"是无效的，
       表现就是"面板没了、但 320px 的白色占位还在"（用户截图指出的问题）。 -->
  <div
    class="app"
    :class="{ 'side-hidden': sideHidden, 'rail-hidden': railHidden }"
        :style="{
      '--rail-w': (railHidden ? 0 : railW) + 'px',
      '--side-w': (sideHidden ? 0 : sideW) + 'px',
    }"
  >
    <!-- ★分隔条挂在 `.app` 上并用**绝对定位**（决策 #1343）：
         一开始塞进 `.rail` 当第一个子元素，结果把 `.rail button:nth-child(N)` 的序号整体后移，
         门禁（用 `nth-child(2)` 点"代码"）点到了"设备" ⇒ 代码视图没打开、文件树不可见。
         ⇒ **不要往 rail/side 里插节点**，改在 .app 层用 left/right 定位。 -->
    <div
      class="grip grip-rail"
      :class="{ 'grip-off': railHidden }"
      :style="{ left: railW - 3 + 'px' }"
      title="拖动调整左栏宽度（⌘⇧B 收起/展开）"
      @pointerdown="startDrag('rail', $event)"
    />
    <div
      class="grip grip-side"
      :class="{ 'grip-off': sideHidden }"
      :style="{ right: sideW - 3 + 'px' }"
      title="拖动调整右栏宽度（⌘B 收起/展开）"
      @pointerdown="startDrag('side', $event)"
    />
    <!-- 沉浸式标题栏（2026-10-25 · 决策 #1219）：窗口用 titleBarStyle=Overlay + hiddenTitle，
         内容一直画到窗口顶部，原生红绿灯（trafficLightPosition 14,13）浮在这条上。
         ★可拖拽区域靠 `data-tauri-drag-region="deep"` —— **必须带 `deep`**（2026-10-25 实测踩到）：
           Tauri 的判定是「bare/`true` = 只有**直接点在这个元素上**才算拖拽；`deep` = 子树里任何位置都算」。
           标题条里塞着芯片和 spacer，点击永远先落在**子元素**上 ⇒ bare 模式下几乎点不到本体，
           表现就是"整条标题栏拖不动、双击也不缩放"。带 `deep` 后芯片上也能拖，
           而 `<button>/<input>` 之类仍然会自动阻断（Tauri 的 isClickableElement 规则）。
         左内边距 84px 给红绿灯让位。★不再放品牌文字：窗口标题 + macOS 菜单栏已经说明是哪个应用，
         重复一遍只会挤占拖拽区（用户 2026-10-25 指出"冗余"）。 -->
    <div class="top" data-tauri-drag-region="deep">
      <div class="chip"><span class="dot" :class="{ off: !running }" /><span id="linkChip">{{ linkText }}</span></div>
      <!-- 触摸回传开关（决策 #1254）：开 = 点画布会注入到真机；关 = 只标记坐标（纯看） -->
      <button
        class="chip btn"
        id="touchChip"
        :class="{ on: touchOn }"
        :aria-pressed="touchOn"
        :title="
          touchOn
            ? '触控回传：开 —— 单击 = 点；拖拽 = 滑动；按住不动 = 长按；⌥+拖拽 = 平移画布（仅 Android 实时投屏）'
            : '触控回传：关 —— 画布只标记设备坐标，拖拽 = 平移画布，不注入'
        "
        @click="touchOn = !touchOn"
      >
        <span class="dot" :class="{ off: !touchOn }" />触控{{ touchOn ? '·开' : '·关' }}
      </button>
      <!-- 采集档位（决策 #1263）：点击切换，会重启采集会话 -->
      <button class="chip btn" id="capChip" :title="capTitle" :aria-busy="capBusy" @click="cycleQuality">
        <span class="dot" :class="{ off: !hasBridge }" /><span id="capLabel">{{ capLabel }}</span>
      </button>
      <div class="chip">镜像 60fps 上限</div>
      <div style="flex:1" />
      <!-- ★布局开关放标题栏（决策 #1344）：`⌘B`/`⌘⇧B` 有快捷键，但**必须也有可点的图标**
           （用户明确指出"标题栏里没有对应图标可操作"）。图标沿用 VS Code 那套语义：
           方框 + 一侧被填充 = 那一侧的面板。
           ★左按钮**按视图分流**：画布视图切左图标条，代码视图切文件树（那里才是"左栏"）。 -->
      <div class="topbtns">
        <button
          class="topbtn"
          id="toggleLeft"
          :class="{ on: view === 'code' ? !treeHidden : !railHidden }"
          aria-label="切换左栏"
          :title="view === 'code' ? '切换文件树（⌘B）' : '切换左栏图标条（⌘⇧B）'"
          @click="view === 'code' ? toggleTree() : toggleRail()"
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3">
            <rect x="1.6" y="2.6" width="12.8" height="10.8" rx="2.2" />
            <path d="M6.1 2.9v10.2" />
            <path d="M2 3.2h4v9.6H2z" fill="currentColor" stroke="none" opacity=".55" />
          </svg>
        </button>
        <button
          class="topbtn"
          id="toggleRight"
          :class="{ on: !sideHidden }"
          aria-label="切换右栏"
          title="切换右栏面板（⌘B）"
          @click="toggleSide()"
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3">
            <rect x="1.6" y="2.6" width="12.8" height="10.8" rx="2.2" />
            <path d="M9.9 2.9v10.2" />
            <path d="M10 3.2h4v9.6h-4z" fill="currentColor" stroke="none" opacity=".55" />
          </svg>
        </button>
      </div>
      <div class="chip">画布由 HTML 布局驱动 · 等比适配</div>
    </div>

    <div class="rail">
      <button
        :class="{ on: view === 'device' }"
        :aria-pressed="view === 'device'"
        aria-label="设备画布"
        title="设备画布"
        @click="switchView('device')"
      >
        <StudioIcon name="device" :size="18" />
      </button>
      <button
        :class="{ on: view === 'code' }"
        :aria-pressed="view === 'code'"
        aria-label="代码（只读）"
        title="代码（只读）"
        @click="switchView('code')"
      >
        <StudioIcon name="code" :size="18" />
      </button>
      <button
        :class="{ on: termMode !== 'off' }"
        :aria-pressed="termMode !== 'off'"
        aria-label="终端"
        title="终端面板（⌘J）· ⌘⇧J 最大化"
        id="railTerm"
        @click="toggleTermPane()"
      >
        <StudioIcon name="terminal" :size="18" />
      </button>
      <div class="sep" />
      <button aria-label="断言（未实现）" title="断言（未实现）" disabled><StudioIcon name="assert" :size="18" /></button>
      <button aria-label="录制（未实现）" title="录制（未实现）" disabled><StudioIcon name="record" :size="18" /></button>
      <div class="sep" />
      <!-- 设置（决策 #1267）：开**独立窗口**，不是右栏小面板 -->
      <button id="openSettings" aria-label="设置" title="设置（⌘,）" @click="openSettings">
        <StudioIcon name="settings" :size="18" />
      </button>
    </div>

    <div class="main" :class="{ codeview: view === 'code' }">
      <!-- ★主轴改为**垂直分割**（决策 #1346）：上面是当前视图（画布/代码），下面是终端面板。
           `mainstage.hid` 在终端全屏时把上半区藏掉 ⇒ 原生画布被 set_canvas_rect 收成 0×0，
           不会浮在终端上（这是旧判据 ㊼ 关注的那条风险）。 -->
      <div class="mainstage" :class="{ hid: termMode === 'full' }">
      <template v-if="view === 'device'">
        <!-- 舞台：只负责居中与留白；设备屏幕（#canvas）是它的等比子元素 -->
        <div class="stage" ref="stageEl">
          <!-- ★`live` 决定这块是"洞"还是"关着的屏"（决策 #1257）：
               有画面时祖先链全透明，露出垫在下面的原生 GL；没画面时给一块实心底色，
               否则洞会露出窗口背景（浅色系统下是一块灰白，比黑更难看）。 -->
          <div class="screen" :class="{ live: running }" :style="screenStyle">
            <!-- ★画布洞：这块必须保持透明——原生 GL 视图就垫在它后面。
                 ★指针事件在这里收（不是原生侧）：GL 视图挂在 webview **下面**，
                   真实点击永远先到 webview ⇒ 前端才是唯一有效的输入源。 -->
            <div
              id="canvas"
              ref="canvasEl"
              tabindex="0"
              @pointerdown="onPointerDown"
              @pointermove="onPointerMove"
              @pointerup="onPointerUp"
              @pointercancel="onPointerUp"
              @wheel.prevent="onWheel"
            />
            <!-- 点击落点标记（输入通路已通的可见证据；元素信息要等设备侧视图树） -->
            <div class="picks">
              <div v-if="pickStyle" class="pick" :style="pickStyle" id="pickMark" />
            </div>
          </div>
          <!-- 空状态：生产 IDE 必须有——不然用户看到纯黑会以为坏了 -->
          <div v-if="!running && !iosGuide" class="empty">
            <!-- 产品标记（立方体 + 取景框）：只在尺寸够大的地方用 —— 空状态正是这种地方 -->
            <StudioMark :size="62" class="mark" />
            <p>等待首帧</p>
            <span v-if="!hasBridge">无 Tauri 桥（浏览器直开时属正常）</span>
            <span v-else>没有输入源：接 Android（adb）或 iPhone（--stream）</span>
          </div>
          <!-- iOS：空状态换成**可执行的接法**（#1277）。
               这一块必须能收指针（复制按钮），所以不能塞进 .empty（那是 pointer-events:none）。 -->
          <div v-if="iosGuide" class="iosguide" id="iosGuide">
            <div class="ig-head">
              <StudioIcon name="device" :size="15" />
              <b>iPhone 投屏：还差手机端那一步</b>
            </div>
            <p class="ig-lead">
              装到真机要动钥匙串签名，Studio 代跑不了 —— 这条命令得在<b>你自己的终端</b>里跑。
            </p>
            <div class="ig-cmd">
              <code id="iosCmd">{{ iosGuide.cmd }}</code>
              <button class="ig-copy" id="iosCopy" @click="copyIosCmd">复制</button>
            </div>
            <ol class="ig-steps">
              <li>上面这条在<b>仓库根目录</b>执行（会编译 + 安装 + 启动 ProteusHost）</li>
              <li>手机上弹「录制屏幕」时点<b>允许</b>（不点就一帧都没有）</li>
              <li>画面会自己出现在这里，不用再点任何按钮</li>
            </ol>
            <p class="ig-state" :class="{ ok: iosGuide.listening }" id="iosState">
              <template v-if="iosGuide.listening">
                本机已在 {{ iosGuide.port }} 端口等待推流（{{ iosGuide.ip ?? 'IP 未知' }}）
              </template>
              <template v-else>
                端口 {{ iosGuide.port }} 现在没人监听 —— 采集会话可能没起来
              </template>
            </p>
          </div>
        </div>

        <div class="hud" id="hud">{{ hud }}</div>

        <!-- 缩放：相对的「适应」倍数；比例永远由设备决定，缩放只改大小 -->
        <div class="zoom">
          <button
            aria-label="缩小"
            title="缩小（⌘-）"
            :disabled="ws.zoom <= 0.25"
            @click="setZoom(ws.zoom - 0.25)"
          >
            <StudioIcon name="zoomOut" :size="15" />
          </button>
          <button class="lbl" title="恢复「适应窗口」（⌘0）" @click="setZoom(1)">
            <span id="zoomLabel">{{ zoomLabel }}</span>
          </button>
          <button
            aria-label="放大"
            title="放大（⌘=）"
            :disabled="ws.zoom >= 4"
            @click="setZoom(ws.zoom + 0.25)"
          >
            <StudioIcon name="zoomIn" :size="15" />
          </button>
          <div class="sep" />
          <button aria-label="适应窗口" title="适应窗口（⌘0）" @click="setZoom(1)">
            <StudioIcon name="fit" :size="15" />
          </button>
        </div>
      </template>
      <!-- ★`v-show` 而不是 `v-if`：切到设备视图时**不能卸载**代码面板——
           卸载会销毁 EditorView，未保存的编辑就静默丢了。
           代价：代码面板在设备视图下也保持挂载（display:none），CM 自己的 ResizeObserver
           会在重新可见时重新测量，不需要额外通知。 -->
      <CodePanel v-show="view === 'code'" />
      <!-- 终端：v-show 而不是 v-if —— 会话状态在组件里，卸载即丢（决策 #1279） -->
      </div>

      <!-- 拖高分割线（只在面板态出现；全屏时没有下半区可拖） -->
      <!-- 拖高条：代码视图里贴在"面板顶边"（绝对定位在编辑器列），画布视图里在文档流中 -->
      <div
        v-if="termMode === 'pane'"
        class="vhsplit"
        :class="{ overlay: view === 'code' }"
        :style="view === 'code' ? { left: termLeft + 'px', bottom: termH + 'px' } : undefined"
        title="拖动调整终端高度"
        @pointerdown="startDragTerm($event)"
      />

      <!-- 终端面板（**唯一实例**：三种模式共用同一个组件，切模式不会丢会话） -->
      <div
        v-show="termMode !== 'off'"
        class="termpane"
        :class="{ full: termMode === 'full', overlay: view === 'code' }"
        :style="paneStyle"
      >
        <!-- ★拆分（决策 #1384）：左右各一个 TerminalPanel，**各自持有自己的会话**。
             主栏带工具栏，副栏 minimal（不重复工具栏/查找条）。 -->
        <div class="tpane main" :style="termSplit && termSplitW ? { flex: `0 0 ${termSplitW}px` } : undefined">
          <TerminalPanel
            :active="termMode !== 'off'"
            :split="termSplit"
            @close="toggleTermPane()"
            @maximize="toggleTermMax()"
            @split="toggleTermSplit()"
          />
        </div>
        <template v-if="termSplit">
          <div class="tsplit" title="拖动调整两栏宽度" @pointerdown="startDragTermSplit($event)" />
          <div class="tpane side">
            <TerminalPanel :active="termMode !== 'off'" minimal />
          </div>
        </template>
      </div>
    </div>

    <div class="side">
      <DeviceSwitcher />
      <DevicePanel :s="stats" />
      <PipelinePanel :s="stats" />
      <RuntimePanel :s="stats" />
      <InspectorPanel />
    </div>

    <div class="status">
      <span><span class="k">canvas</span> <span id="srect">{{ rect }}</span></span>
      <span><span class="k">frames</span> <span id="sframes">{{ stats?.frames ?? 0 }}</span></span>
      <span><span class="k">fps</span> <span id="sfps">{{ stats ? num(stats.fps, 1) : '—' }}</span></span>
      <span><span class="k">lat</span> <span id="slat">{{ stats ? ms(stats.lat_p50) : '—' }}</span></span>
      <span><span class="k">late</span> <span id="slate">{{ stats?.late ?? 0 }}</span></span>
      <span><span class="k">cpu</span> <span id="scpu">{{ stats ? pct(stats.cpu_pct) : '—' }}</span></span>
      <span><span class="k">zoom</span> <span id="szoom">{{ zoomLabel }}</span></span>
      <span><span class="k">pan</span> <span id="span">{{ Math.round(pan.x) }},{{ Math.round(pan.y) }}</span></span>
      <span title="设备像素坐标"><span class="k">pick</span> <span id="spick">{{ pick ? `${pick.x},${pick.y}` : '—' }}</span></span>
      <span style="flex:1" />
      <!-- 语言模式（决策 #1241）：这里是**当前文件**的类型，点开可手动改；
           只在代码视图 + 有打开文件时出现，避免设备视图里显示一个过期的类型 -->
      <button
        v-if="view === 'code' && editorLang.path"
        class="lang"
        id="langMode"
        :data-lang="effectiveLangId(editorLang.path)"
        :title="`语言模式：${langNow}（点击切换）`"
        @click="pickLang"
      >
        <StudioIcon name="code" :size="11" />{{ langNow }}
      </button>
      <span id="shint">{{ hint }}</span>
    </div>

    <!-- 全局右键菜单（决策 #1234）：标签栏/文件树/编辑器各自 openMenu，这里只负责画与关 -->
    <ContextMenu />
    <!-- 关闭前的确认（决策 #1243）：未保存的标签/多标签一起关时三选一 -->
    <ConfirmDialog />
    <!-- 瞬时反馈（决策 #1236）：复制成功/保存失败这类"说一句就走"的消息，右下角卡片，
         不再挤在状态栏里（状态栏留给常驻信息）。错误不自动消失，等人处理。 -->
    <ToastStack />
  </div>
</template>
