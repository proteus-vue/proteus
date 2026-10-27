// packages/studio/ui/src/useWorkspaceState.ts
// ★★★G5：**工作区会话状态**（记住视图与打开的文件；重启即恢复）
//
// 【为什么单独一个模块】状态要跨组件共享（左栏切换在 App.vue，打开文件在 CodePanel），
//   各自读写同一个 JSON 会互相覆盖。这里一处持有、一处落盘。
//
// 【为什么落文件而不是 localStorage】localStorage 会随清缓存/换 identifier 丢，
//   而且用户看不见也改不了；会话偏好属于"工程之外的用户状态"，放 macOS 标准的
//   `~/Library/Application Support/dev.proteus.studio/state.json` 才能备份/迁移/排障。
//
// 【失败一律降级，不阻断】读不到（首次运行）、JSON 坏了、写失败 —— 全部静默回到默认值。
//   会话状态不是功能，**不该因为它挂了导致 Studio 起不来**。

import { reactive, watch } from 'vue'
import { hasBridge, loadState, saveState } from './bridge'

export type ViewName = 'device' | 'code' | 'term'

export interface WorkspaceState {
  view: ViewName
  /** 代码视图里上次打开的文件（相对仓库根）。空 = 用默认（App.vue）。 */
  codeFile: string
  /** 设备预览缩放（相对「适应窗口」= 1）。★画面比例始终由设备决定，缩放只改大小、不改形状。 */
  zoom: number
  /** 代码树里被**折叠**的目录（默认全展开 ⇒ 存"折叠"比存"展开"短，且新增目录自动是展开的）。 */
  codeCollapsed: string[]
  /** 代码视图里打开的标签（顺序 = 标签栏顺序）。★只存路径：内容/undo 属于内存态，不落盘。 */
  openFiles: string[]
}

const ZOOM_MIN = 0.25
const ZOOM_MAX = 4

const state = reactive<WorkspaceState>({ view: 'device', codeFile: '', zoom: 1, codeCollapsed: [], openFiles: [] })
/** 读到磁盘状态之前不要回写（否则会用默认值覆盖用户上次的设置） */
let hydrated = false
/** ★"恢复完成"的信号：子组件的 onMounted 会**早于**父组件的，直接读 state 会拿到默认值。
 *  实测踩到：CodePanel 改成 `v-show` 后一直在挂载态，它在 hydrate 之前就 boot，
 *  读到 codeFile='' ⇒ 打开默认 App.vue 并把 ws.codeFile 改写掉 ⇒ 重启后再也恢复不了上次的文件。 */
let markHydrated: () => void = () => {}
const hydratedOnce = new Promise<void>((r) => {
  markHydrated = r
})

/** 等"从磁盘恢复完毕"（已恢复则立即返回）。子组件的 onMounted 里必须先 await 它。 */
export function whenHydrated(): Promise<void> {
  return hydrated ? Promise.resolve() : hydratedOnce
}

export function useWorkspaceState(): WorkspaceState {
  return state
}

/** 缩放夹紧（0.25×～4×）。放这里而不是组件里：读盘恢复与按钮点击必须用**同一条**边界。 */
export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 1
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100))
}

/** 启动时调用一次：从磁盘恢复。无桥/首次运行/JSON 损坏都落到默认值。 */
export async function hydrateWorkspace(): Promise<void> {
  if (!hasBridge()) {
    hydrated = true
    markHydrated()
    return
  }
  try {
    const raw = await loadState()
    const o = JSON.parse(raw || '{}') as Partial<WorkspaceState>
    if (o.view === 'code' || o.view === 'device') state.view = o.view
    if (typeof o.codeFile === 'string') state.codeFile = o.codeFile
    // ★缩放要**夹紧**：手改坏的 state.json（zoom:0 / 1e9）会让画布消失或撑爆，
    //   而"画布不见了"是最难自查的症状 ⇒ 宁可回落到 1，也不信磁盘上的任意数值。
    if (typeof o.zoom === 'number' && Number.isFinite(o.zoom)) state.zoom = clampZoom(o.zoom)
    // 折叠状态：只收字符串数组（磁盘上的东西一律当**不可信输入**处理）
    if (Array.isArray(o.codeCollapsed)) {
      state.codeCollapsed = o.codeCollapsed.filter((d): d is string => typeof d === 'string')
    }
    // 标签页：同样是不可信输入（去重 + 只收字符串 + 上限 12，防手改写坏成上千个）
    if (Array.isArray(o.openFiles)) {
      state.openFiles = [...new Set(o.openFiles.filter((f): f is string => typeof f === 'string'))].slice(0, 12)
    }
  } catch {
    /* 首次运行 / 文件损坏 ⇒ 用默认值，不打扰用户 */
  }
  hydrated = true
  markHydrated()
}

// 变更即落盘。切换视图/打开文件都是低频操作，不做防抖也够；
// 真要做防抖得引入定时器，反而给"关窗口时丢最后一次写"留了窗口。
watch(
  state,
  () => {
    if (!hydrated || !hasBridge()) return
    void saveState(
      JSON.stringify({
        view: state.view,
        codeFile: state.codeFile,
        zoom: state.zoom,
        codeCollapsed: state.codeCollapsed,
        openFiles: state.openFiles,
      }),
    ).catch(() => {
      /* 写失败不影响使用 */
    })
  },
  { deep: true },
)
