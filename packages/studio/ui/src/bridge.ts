// packages/studio/ui/src/bridge.ts
// Tauri IPC 的**唯一入口**（决策 #1183）
//
// 【为什么要包一层】面板里有 20 个字段要靠 `stats` 拉，散落调用会：
//   · 每处自己判 `window.__TAURI__` 是否存在；
//   · 无法统一在"桥不可用"时降级（Playwright 里没有 Tauri，浏览器直接打开也不该白屏）。
// ⇒ 全部走这里，缺桥时返回**明确的失败**（而不是 undefined 让调用方静默出错）。

export interface Stats {
  frames: number
  late: number
  cpu_pct: number
  fps: number
  iv_p50: number
  iv_p95: number
  lat_p50: number
  lat_p95: number
  qw_p50: number
  dec_p50: number
  cmp_p50: number
  pres_p50: number
  aus: number
  mbps: number
  empty: number
  ticks: number
  width: number
  height: number
  hwdec: boolean
  /** 推流是否已中断（>1.5s 没有新帧）——界面据此把"运行中"改成"手机端已停止推流" */
  stalled: boolean
  /** 当前采集源：android / ios / file / none（触控分派依据） */
  source: string
  device: string | null
  /** 设备**物理**像素（`wm size`；0 = 未知）。触摸回传必须用它，不能用码流尺寸（决策 #1260） */
  dev_w: number
  dev_h: number
}

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>

/** 取注入的 IPC（Tauri 的 `withGlobalTauri` 提供；测试时由 Playwright 注入桩） */
function rawInvoke(): Invoke | null {
  const t = (globalThis as { __TAURI__?: { core?: { invoke?: Invoke } } }).__TAURI__
  return t?.core?.invoke ?? null
}

/** 桥是否可用（面板用它决定显示"未连接"还是真的读数为 0） */
export const hasBridge = (): boolean => rawInvoke() !== null

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const fn = rawInvoke()
  if (!fn) throw new Error('Tauri 桥不可用（不在 Tauri 里，或没开 withGlobalTauri）')
  return (await fn(cmd, args)) as T
}

export const getStats = (): Promise<Stats> => invoke<Stats>('stats')

export const setCanvasRect = (r: { x: number; y: number; w: number; h: number }): Promise<void> =>
  invoke<void>('set_canvas_rect', r)

/** 读到的一段文本 + 它的 mtime（保存时回传，用于"打开后被改过"的冲突检测）。 */
export interface FileText {
  text: string
  /** mtime（**微秒**，Unix epoch）。用微秒而不是毫秒：连续两次保存可能落在同一毫秒里，
   *  那时"打开后被改过"会漏判。 */
  mtime_us: number
}

/** 读仓库内一个文本文件。边界由 Rust 侧把关：仓库内 + ≤512KB。 */
export const readText = (path: string): Promise<FileText> => invoke<FileText>('read_text', { path })

/** 写回。`expect` = 打开时读到的 mtime；返回新的 mtime。
 *  ★Rust 侧会比对 mtime：不一致就**拒绝覆盖**（本仓常驻多个 AI 会话同时改文件）。 */
export const writeText = (path: string, text: string, expect: number): Promise<number> =>
  invoke<number>('write_text', { path, text, expect })

/** 列仓库内若干子树下的源码文件（G4 文件列表）。边界同上，另有扩展名白名单与 300 条上限。 */
export const listFiles = (roots: string[]): Promise<string[]> => invoke<string[]>('list_files', { roots })

/** Git **只读**（决策 #1246）：分支 / 领先落后 / 改动文件。非仓库时 `isRepo=false`，不抛错。 */
export interface GitFileStatus {
  path: string
  /** M 修改 / A 新增 / D 删除 / R 重命名 / ? 未跟踪 / U 冲突 */
  status: string
}
export interface GitStatusInfo {
  isRepo: boolean
  branch: string
  ahead: number
  behind: number
  files: GitFileStatus[]
}

export const gitStatus = (): Promise<GitStatusInfo> => invoke<GitStatusInfo>('git_status')

/** 某个文件在 HEAD 里的内容；未跟踪/不存在 ⇒ null。 */
export const gitHead = (path: string): Promise<string | null> => invoke<string | null>('git_head', { path })

/** 把文本写进系统剪贴板（Rust 侧走 NSPasteboard）——右键菜单"复制相对路径"用。 */
export const copyText = (text: string): Promise<void> => invoke<void>('copy_text', { text })

/** 开发环境设置（决策 #1270）：按**端**分组的工具路径，`目标.工具 → 路径` */
export interface StudioSettings {
  paths: Record<string, string>
  ios_port: number | null
}
export const getSettings = (): Promise<StudioSettings> => invoke<StudioSettings>('get_settings')
export const saveSettings = (s: StudioSettings): Promise<void> => invoke<void>('save_settings', { s })
/** 自动检测到的候选（决策 #1268）：路径 + 版本，点一下就能用 */
export interface ToolCandidate {
  path: string
  version: string | null
}
export const detectTools = (): Promise<{ by_key: Record<string, ToolCandidate[]> }> =>
  invoke<{ by_key: Record<string, ToolCandidate[]> }>('detect_tools')
/** 打开系统面板选路径；返回 null = 用户取消 */
export const pickTool = (key: string): Promise<string | null> =>
  invoke<string | null>('pick_tool', { key })

/** 打开**独立设置窗口**（决策 #1267）：已开就聚焦，不重复建窗 */
export const openSettings = (): Promise<void> => invoke<void>('open_settings')

/** 窗口级命令（决策 #1271）：`start_dragging` / `internal_toggle_maximize`。
 *  ★为什么不靠 `data-tauri-drag-region`：那是 window 插件**初始化脚本**注入的行为，
 *    在代码里新建的窗口上实测不生效（主窗口可以、新窗口不行）。
 *    直接调插件命令就绕开"脚本到底注没注入"这个不确定性。 */
export const tauriWindowCommand = (cmd: 'start_dragging' | 'internal_toggle_maximize'): Promise<void> =>
  invoke<void>(`plugin:window|${cmd}`)
/** 真跑一次命令验证路径（"检测"按钮）：返回 ok + 命令输出 */
export const probeTool = (key: string, path: string): Promise<{ ok: boolean; detail: string }> =>
  invoke<{ ok: boolean; detail: string }>('probe_tool', { key, path })

/** 设备管理（决策 #1265）：列出所有 adb 设备（`size` 是**物理**像素） */
export interface DeviceInfo {
  /** `android` / `ios`（列表按平台分组） */
  platform: string
  /** 界面提示（iOS：要手机端跑 ProteusHost 才有画面；离线时说明原因） */
  note: string
  serial: string
  state: string
  model: string
  size: string | null
  current: boolean
}
export const listDevices = (force = false): Promise<DeviceInfo[]> =>
  invoke<DeviceInfo[]>('list_devices', { force })

/** 切换当前设备：改串号/尺寸 → 用**当前画质档**重建采集命令 → 重启会话 */
export const selectDevice = (serial: string): Promise<CaptureInfo> =>
  invoke<CaptureInfo>('select_device', { serial })

/** iOS 接法提示（决策 #1277）。★这不是"锦上添花的提示"：
 *  装到真机要 `codesign` 访问 login 钥匙串，Studio **代跑不了**（沙箱被拦），
 *  所以界面唯一能做对的事是**把那行命令摆到用户能复制的地方**（以前只写在 stderr 里）。 */
export interface IosHint {
  /** 本机默认路由那块网卡的 IP（手机要连的就是它）；拿不到是 null */
  ip: string | null
  port: number
  /** 终端里要跑的整行命令（含 IP:端口） */
  cmd: string
  /** `nc -l` 是否真的在听：false 就说明"手机上推过来也没人接" */
  listening: boolean
  /** 采集源此刻就是 iOS 推流 —— 只有 true 才值得显示引导卡 */
  active: boolean
}
export const iosStreamHint = (): Promise<IosHint> => invoke<IosHint>('ios_stream_hint')

/** 采集档位（决策 #1263）：切换会**重启采集会话**（停旧 → 起新 → 重建解码器）。
 *  `standard` = 长边 ≤1920 等比；`sharp` = 设备原生分辨率。 */
export interface CaptureInfo {
  preset: string
  width: number
  height: number
  mbps: number
}
export const capturePreset = (preset: string): Promise<CaptureInfo> =>
  invoke<CaptureInfo>('capture_preset', { preset })

/** 触摸回传（决策 #1254）：把画布上的一次点击**注入到真机**（只有 Android 实时投屏支持）。
 *  返回 `"x,y"` = adb 侧确认已注入；抛错时分两类原因（源不支持 / adb 失败），
 *  界面据此区分"这种源做不了"和"这次没成功"——两者都不能静默。
 *  ★不违反下面那条"指针输入不走 IPC"：那条说的是**入向**（原生点画布 → 前端），
 *    本函数是**出向**（前端算好设备像素 → Rust → adb input tap），方向相反。 */
export const deviceTap = (x: number, y: number): Promise<string> => invoke<string>('device_tap', { x, y })

/** 滑动 / 长按（决策 #1255）：`input swipe x1 y1 x2 y2 <ms>`。
 *  ★长按 = 同点 + 时长（`deviceSwipe(x,y,x,y,600)`）——不在协议层再造一个概念。 */
export const deviceSwipe = (x1: number, y1: number, x2: number, y2: number, ms: number): Promise<string> =>
  invoke<string>('device_swipe', { x1, y1, x2, y2, ms })

/** 工作区状态（G5）：落在 `~/Library/Application Support/dev.proteus.studio/state.json`。 */
export const loadState = (): Promise<string> => invoke<string>('load_state')
export const saveState = (json: string): Promise<void> => invoke<void>('save_state', { json })

// ── 指针输入不走 IPC（★这是对 B1 的修正，别再加回来）────────────────────────
// B1 曾在原生侧注册 mouseDown 回调、经 Tauri `emit('canvas-click')` 送到前端。
// 但 GL 视图是 `addSubview ... positioned:NSWindowBelow` 挂的，**在所有兄弟视图最下面**，
// 而 WKWebView 铺满 contentView ⇒ 真实点击全被 webview 吃掉，那个回调一次都不会触发。
// 正确做法：`#canvas` 是真实 DOM 元素，pointer 事件直接在前端处理（零坐标翻转、零 C 接缝）。

/** 一条搜索命中（字段与 Rust 侧 `search::Hit` 一一对应，不另起名字）。 */
export interface SearchHit {
  path: string
  /** 1-based 行号 */
  line: number
  /** 1-based **字符**列（不是字节、不是 UTF-16 —— 换算在 search.rs 里做完了） */
  col: number
  /** 该行原文（截断到 300 字符） */
  text: string
}

/** 搜索结果。`engine` 如实告诉你走的是哪条路——内置扫描比 rg 慢一个量级。 */
export interface SearchResult {
  engine: 'rg' | 'builtin'
  hits: SearchHit[]
  /** 到了上限被截断（此时"还有更多"，不是全部） */
  truncated: boolean
}

/** 仓库内全文搜索。返回 Err 时是**人能读的原因**（查询太短 / rg 报错）。 */
export const searchText = (query: string): Promise<SearchResult> =>
  invoke<SearchResult>('search_text', { query })

// ── 菜单（决策 #1221）──────────────────────────────────────────────────────
/** 原生菜单事件。Rust 侧把 `ACTIONS` 里登记的动作 id 用 `emit("menu", id)` 送过来。 */
export interface MenuBridge {
  /** true = 走的是真 Tauri 事件通道；false = 浏览器/门禁里的兜底（DOM 事件） */
  native: boolean
  off: () => void
}

type ListenFn = (
  name: string,
  cb: (e: { payload: unknown }) => void,
) => Promise<() => void>

/** 订阅"关闭被拦下"事件（决策 #1244）。
 *
 *  ★为什么 Rust 不直接弹框：确认框是 **UI**，归前端；Rust 只负责"阻止关闭 + 告知脏数量"。
 *    和菜单同样的双路：原生走 `app:close-blocked`，浏览器/门禁走 `studio:close-blocked` 自定义事件
 *    —— 这样门禁能驱动同一条通路（但**证明不了** AppKit 真的拦下了关闭，那一段只能人眼验）。
 */
export function onCloseBlocked(cb: (dirty: number) => void): () => void {
  const ev = (globalThis as { __TAURI__?: { event?: { listen?: ListenFn } } }).__TAURI__?.event
  if (ev?.listen) {
    let off: (() => void) | undefined
    void ev.listen('app:close-blocked', (e) => cb(Number(e.payload ?? 0))).then((f) => (off = f))
    return () => off?.()
  }
  const h = (e: Event) => cb(Number((e as CustomEvent).detail ?? 0))
  addEventListener('studio:close-blocked', h)
  return () => removeEventListener('studio:close-blocked', h)
}

/** 订阅菜单动作。
 *
 *  ★为什么要有浏览器兜底：Tauri 之外（Playwright 门禁、直接用浏览器开 web-dist）没有事件系统。
 *    兜底走 `window` 上的 `studio:menu` 自定义事件 ⇒ **同一套 dispatch** 能在门禁里被驱动。
 *    但要说清：这条只证明"动作侧通了"，**不证明原生菜单真的发得出来**（那一段只能人眼验）。
 */
export function onMenu(cb: (id: string) => void): MenuBridge {
  const ev = (globalThis as { __TAURI__?: { event?: { listen?: ListenFn } } }).__TAURI__?.event
  if (ev?.listen) {
    let off: (() => void) | undefined
    void ev.listen('menu', (e) => cb(String(e.payload ?? ''))).then((f) => (off = f))
    return { native: true, off: () => off?.() }
  }
  const h = (e: Event) => cb(String((e as CustomEvent).detail ?? ''))
  addEventListener('studio:menu', h)
  return { native: false, off: () => removeEventListener('studio:menu', h) }
}

// ── 内置终端（决策 #1279）─────────────────────────────────────────────────
/* 【为什么数据走事件、按键走命令】pty 的输出是**流**（Rust 读线程持续推），
   而按键是一次次离散动作。Tauri 的 invoke 是一问一答，做流要么长轮询要么事件
   ⇒ 输出用 `emit("term:data")`，按键用 `term_write`。 */

/** 打开会话。`cols/rows` 是字符格子数（前端按字宽量出来的，不是像素） */
export const termOpen = (cols: number, rows: number): Promise<void> => invoke<void>('term_open', { cols, rows })
/** 送键盘输入（字节语义由前端生成：`\r` / `\x1b[A` / `\x03` …） */
export const termWrite = (data: string): Promise<void> => invoke<void>('term_write', { data })
/** 面板尺寸变了：告诉 pty，让 `ls`/`vim` 之类按新宽度排版 */
export const termResize = (cols: number, rows: number): Promise<void> => invoke<void>('term_resize', { cols, rows })
export const termClose = (): Promise<void> => invoke<void>('term_close')
export interface TermInfo {
  open: boolean
  pid: number
}
export const termInfo = (): Promise<TermInfo> => invoke<TermInfo>('term_info')

/** 订阅终端输出。
 *  ★浏览器/门禁兜底走 `studio:term-data` 自定义事件 —— 与 `onMenu` 同一套路子，
 *    这样 Playwright 能驱动"字节进来 → 屏幕画对"这整段（但**证明不了** pty 真的产出了字节，
 *    那一段由 Rust 侧单测 `pty_runs_echo_and_reads_back` 兜住）。 */
export function onTermData(cb: (data: string) => void): () => void {
  const ev = (globalThis as { __TAURI__?: { event?: { listen?: ListenFn } } }).__TAURI__?.event
  if (ev?.listen) {
    let off: (() => void) | undefined
    void ev.listen('term:data', (e) => cb(String(e.payload ?? ''))).then((f) => (off = f))
    return () => off?.()
  }
  const h = (e: Event) => cb(String((e as CustomEvent).detail ?? ''))
  addEventListener('studio:term-data', h)
  return () => removeEventListener('studio:term-data', h)
}

/** 订阅"shell 退出"（子进程结束）。界面据此显示"会话已结束，按回车重开"。 */
export function onTermExit(cb: () => void): () => void {
  const ev = (globalThis as { __TAURI__?: { event?: { listen?: ListenFn } } }).__TAURI__?.event
  if (ev?.listen) {
    let off: (() => void) | undefined
    void ev.listen('term:exit', () => cb()).then((f) => (off = f))
    return () => off?.()
  }
  const h = () => cb()
  addEventListener('studio:term-exit', h)
  return () => removeEventListener('studio:term-exit', h)
}

// ── 一键投屏到 iPhone（决策 #1288）───────────────────────────────────────
/* 【契约】`ios_stream_start` 立刻返回；进度走 `ios:progress`、结果走 `ios:result`。
   为什么不是"一个同步命令跑完"：编译 Swift 宿主几十秒，同步会把 IPC 和界面一起卡住。 */
export interface IosProgress {
  /** 阶段标题（脚本里的 `==> ④ 编译 Swift 宿主`）；不是阶段行时为 null */
  stage: string | null
  line: string
}
export interface IosOutcome {
  ok: boolean
  code: number | null
  /** 人话解释（后端翻译过的，例如"设备上有另一个团队签的同名应用"） */
  hint: string | null
  /** 界面该给哪个动作按钮 */
  action: 'uninstall' | 'rebuild' | 'signing' | 'none' | null
}
export const iosStreamStart = (udid: string, ip: string, port: number): Promise<void> =>
  invoke<void>('ios_stream_start', { udid, ip, port })
/** 卸载设备上的同名应用（团队冲突时的标准解法）；bundle 省略则用后端记住的那个 */
export const iosUninstall = (udid: string, bundle?: string): Promise<string> =>
  invoke<string>('ios_uninstall', { udid, bundle: bundle ?? null })
export const iosRunState = (): Promise<{ running: boolean; bundle: string | null }> =>
  invoke<{ running: boolean; bundle: string | null }>('ios_run_state')

/** 订阅投屏流水线进度。浏览器/门禁兜底走 `studio:ios-progress` 自定义事件。 */
export function onIosProgress(cb: (p: IosProgress) => void): () => void {
  const ev = (globalThis as { __TAURI__?: { event?: { listen?: ListenFn } } }).__TAURI__?.event
  if (ev?.listen) {
    let off: (() => void) | undefined
    void ev.listen('ios:progress', (e) => cb(e.payload as IosProgress)).then((f) => (off = f))
    return () => off?.()
  }
  const h = (e: Event) => cb((e as CustomEvent).detail as IosProgress)
  addEventListener('studio:ios-progress', h)
  return () => removeEventListener('studio:ios-progress', h)
}

export function onIosResult(cb: (o: IosOutcome) => void): () => void {
  const ev = (globalThis as { __TAURI__?: { event?: { listen?: ListenFn } } }).__TAURI__?.event
  if (ev?.listen) {
    let off: (() => void) | undefined
    void ev.listen('ios:result', (e) => cb(e.payload as IosOutcome)).then((f) => (off = f))
    return () => off?.()
  }
  const h = (e: Event) => cb((e as CustomEvent).detail as IosOutcome)
  addEventListener('studio:ios-result', h)
  return () => removeEventListener('studio:ios-result', h)
}

// ── 触控回传（决策 #1295）────────────────────────────────────────────────
/* 【契约】坐标一律**归一化 0..1**（相对画面）。宿主自己乘 `bounds`：
   帧是像素（888×1920）、注入要逻辑点（390×844），传归一化两边都不用猜 scale。
   ★只能注入到**我们自己的宿主 app 内**（iOS 没有系统级注入 API）。 */
export const iosTap = (nx: number, ny: number): Promise<void> => invoke<void>('ios_tap', { nx, ny })

/** 滚轮注入（决策 #1327）：`dy` 用浏览器 deltaY 语义（正 = 向下滚） */
export const iosScroll = (
  nx: number,
  ny: number,
  dy: number,
  phase: 'begin' | 'post' | 'end' = 'post',
): Promise<void> => invoke<void>('ios_scroll', { nx, ny, dy, phase })
export const iosLongpress = (nx: number, ny: number): Promise<void> => invoke<void>('ios_longpress', { nx, ny })
export const iosSwipe = (nx: number, ny: number, dx: number, dy: number): Promise<void> =>
  invoke<void>('ios_swipe', { nx, ny, dx, dy })
export const iosTouchState = (): Promise<boolean> => invoke<boolean>('ios_touch_state')

/** ★推荐入口（决策 #1297）：先试"直接启动已装宿主"（秒级）；没装才回退到完整构建。
 *  用户不该为了看一眼画面每次等 40 秒编译。 */
export const iosStartHost = (udid: string, ip: string, port: number): Promise<void> =>
  invoke<void>('ios_start_host', { udid, ip, port })
