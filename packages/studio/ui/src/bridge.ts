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
  device: string | null
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

/** 触摸回传（决策 #1254）：把画布上的一次点击**注入到真机**（只有 Android 实时投屏支持）。
 *  返回 `"x,y"` = adb 侧确认已注入；抛错时分两类原因（源不支持 / adb 失败），
 *  界面据此区分"这种源做不了"和"这次没成功"——两者都不能静默。
 *  ★不违反下面那条"指针输入不走 IPC"：那条说的是**入向**（原生点画布 → 前端），
 *    本函数是**出向**（前端算好设备像素 → Rust → adb input tap），方向相反。 */
export const deviceTap = (x: number, y: number): Promise<string> => invoke<string>('device_tap', { x, y })

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
