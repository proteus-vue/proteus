// docs/proteus-studio-poc/05-studio-shell/ui/src/bridge.ts
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

/** 读仓库内一个文本文件（G4 第一块砖）。边界由 Rust 侧把关：仓库内 + ≤512KB + 只读。 */
export const readText = (path: string): Promise<string> => invoke<string>('read_text', { path })

/** 列仓库内若干子树下的源码文件（G4 文件列表）。边界同上，另有扩展名白名单与 300 条上限。 */
export const listFiles = (roots: string[]): Promise<string[]> => invoke<string[]>('list_files', { roots })

/** 工作区状态（G5）：落在 `~/Library/Application Support/dev.proteus.studio/state.json`。 */
export const loadState = (): Promise<string> => invoke<string>('load_state')
export const saveState = (json: string): Promise<void> => invoke<void>('save_state', { json })
