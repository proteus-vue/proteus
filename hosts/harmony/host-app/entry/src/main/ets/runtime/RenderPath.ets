// hosts/harmony/host-app/entry/src/main/ets/runtime/RenderPath.ets
// ★★★#1344：**渲染路径选择**（一次性 VM ⟷ 会话式 VM）—— 生产路径会话化的落点。
//
// 【为什么单列】`Superapp.ets` 已 998 行（`check:file-size` 硬上限 1000）——
//   这段带完整设计说明的双路径逻辑放进去必然越线。职责上也清楚：
//   本文件只回答"这一次渲染走哪条路、怎么走"，与"页面/布局/滚动"无关。
//
// ══════════════════════ 为什么要会话化（真机读数，不是感觉）══════════════════════
//   一次性 VM 下每次 render 实测 **115–135ms**（bundle 1542KB · KLE-AL00U 2026-10-28）：
//     CreateVM → eval 整包(1542KB) → boot → 实例化该屏 → DestroyVM
//   而这份成本**每次点击/切屏都要重付**，与"人眼可感卡顿阈值 100ms"同量级。
//   改成在**长活会话**里 eval 同一个渲染入口 ⇒ 整包只 eval 一次。
//   ★收益不只是"WS 能收事件"（那是同一前置的副产品），更是**交互延迟**。
//   读数证据：`hosts/harmony/results/render-cost.json`。
//
// ══════════════════════ 双路径（默认原路径，零回归）══════════════════════
//   `__proteusSessionRenderOn` 未置位 ⇒ **完全走原逻辑**（`hostAppRender`，每次建 VM）。
//   置位后才走会话。这样能先对比再切换，不是一把推翻。
//   ★会话不可用（未开/关闭/崩溃/eval 失败）⇒ **回落到原路径**，不白屏。
//
// ══════════════════════ 诚实边界 ══════════════════════
//   · 会话式路径要求宿主先 `hostVmSessionOpen(bundle)`；本模块**不负责开门**，
//     只在门已开时使用（`sessionReady` 由调用方传）。
//   · 会话里 eval 的返回值是 `{ok, value}` 包一层 JSON —— 这里负责解包并校验，
//     解不出就回落（**不猜**）。
//   · 回落时打 `SUPERAPP_SESSION_FALLBACK` —— "看起来走了会话其实回落了"必须可见。
import { hostVmSessionEval, hostVmSessionOpen, hostVmSessionClose } from 'proteus_render';

/** 渲染结果（与 `hostAppRender` 的字符串回执同形；调用方自行 JSON.parse） */
export interface RenderOutcome {
  /** 宿主回执原文（`{"tree":…,"state":…,"current":…}`） */
  raw: string
  /** 是否真的走了会话式路径（判据/日志用；false = 回落或未开启） */
  usedSession: boolean
  /** 回落的**原因**（空 = 未回落）——"静默回落"是不可接受的形态 */
  fallbackReason: string
}

/**
 * 走会话式渲染（若可用）；不可用则返回 `null` 让调用方回落原路径。
 *
 * @param argsJson `Superapp.rtArgsJson(...)` 的产物（已是 JSON 串）
 * @returns 成功 = `{raw, usedSession:true, fallbackReason:''}`；
 *          不可用/失败 = `null`（调用方必须回落，不得当成渲染成功）
 */
export function trySessionRender(argsJson: string): RenderOutcome | null {
  // ★把 argsJson 整体作为**JS 字符串字面量**嵌进表达式：
  //   `JSON.stringify(argsJson)` 会把它转义成带引号的合法字面量（argsJson 内含双引号）。
  const expr: string = 'String(__proteusHostAppRender(' + JSON.stringify(argsJson) + '))'
  let evRaw: string = ''
  try {
    evRaw = hostVmSessionEval(expr)
  } catch (e) {
    return null
  }
  try {
    const ev = JSON.parse(evRaw) as Record<string, Object>
    if (ev['ok'] !== true) return null
    const val = ev['value'] as string | undefined
    if (val === undefined || val.length === 0) return null
    return { raw: val, usedSession: true, fallbackReason: '' }
  } catch (e) {
    return null
  }
}

/**
 * 会话式路径是否就绪且启用（= `sessionRenderEnabled`，名字更直白）。
 * ★调用方据此决定走会话还是原路径。
 */
export function renderSessionActive(sessionReady: boolean): boolean {
  return sessionReady && renderModeIsSession()
}

/**
 * 会话式渲染是否**该**尝试（开关 + 会话就绪）。
 *
 * @param sessionReady 宿主是否已成功 `hostVmSessionOpen`
 */
/**
 * ★ArkTS 不允许 `any`/`unknown`（arkts-no-any-unknown），也不允许把 `globalThis`
 *   直接断言成 `Record<string, Object>`（属性类型不重叠）。
 *   ⇒ 用**专用 interface** 声明"全局里可能存在的那个开关"，再做一次收窄。
 *   ★这不是为了绕过检查：它把"全局开关"这件事显式建模，比 any 更有信息量。
 */
interface SessionRenderFlag {
  __proteusSessionRenderOn?: boolean
}

/**
 * 渲染模式：`session` = 会话式（VM 常驻）；其余（含缺省）= 一次性 VM。
 *
 * 【为什么从 AppStorage 读】`aa start --ps renderMode session` 由 EntryAbility 转进
 *   AppStorage（与 vmRounds/vmMode 同族 —— `--ps` 参数不会自动出现，必须显式转）。
 *   用 AppStorage 而非 globalThis 直写：**一处来源**，避免"两个全局标志谁说了算"。
 */
const RENDER_MODE_KEY: string = 'proteusRenderMode'

function renderModeIsSession(): boolean {
  const m: string = AppStorage.get<string>(RENDER_MODE_KEY) ?? ''
  return m === 'session'
}

export function sessionRenderEnabled(sessionReady: boolean): boolean {
  return sessionReady && renderModeIsSession()
}

/**
 * ★★★#1344：**打开渲染会话**（生产路径会话化的入口）。
 *
 * 在 `hostVmSessionOpen(bundle)` 成功后调用；失败返回 `null`（调用方保持一次性 VM 路径，
 * **不白屏**）。`autoMicrotask: true` 是 #1344 B-1 的决定性发现：
 * `EXPLICIT` 微任务策略会让会话在第一拍就崩（AUTO 才是正确解，真机 1000 拍零崩溃）。
 *
 * @returns 会话是否就绪（false ⇒ 调用方继续走 `hostAppRender`）
 */
export function openRenderSession(bundle: string): boolean {
  // ★开关在这里判定（来源 = AppStorage 的 renderMode；建模集中在本文件）
  if (!renderModeIsSession()) return false
  try {
    const raw: string = hostVmSessionOpen(bundle, true)
    const r = JSON.parse(raw) as Record<string, Object>
    return r['ok'] === true
  } catch (e) {
    return false
  }
}

/** 关闭渲染会话（页面销毁时调；不关会让 VM 与整包常驻内存）。 */
export function closeRenderSession(): void {
  try {
    hostVmSessionClose()
  } catch (e) {
    /* 关闭失败不影响主流程（进程退出会回收） */
  }
}

/**
 * ★★★#1344：**会话式 boot**（`hostAppDrive` 的会话版本）。
 *
 * 【为什么必须也有这一条（真机抓出）】只把 `renderCurrent` 改成会话内 eval 还不够：
 *   常驻启动路径先调 `hostAppDrive(...)`（**它自己建一个一次性 VM**）——
 *   于是会话开着的同时又建了第二个 VM ⇒ 日志停在 `SUPERAPP_BOOT`，之后 `renderCurrent`
 *   一次都没跑（`SUPERAPP_RENDER_MS` 零条）。⇒ **boot 也必须在会话里**。
 *
 * @returns 回执原文（与 `hostAppDrive` 同形，调用方 JSON.parse）；失败返回 `null` 让调用方回落
 */
export function trySessionDrive(argsJson: string): string | null {
  const expr: string = 'String(__proteusHostAppDrive(' + JSON.stringify(argsJson) + '))'
  try {
    const evRaw: string = hostVmSessionEval(expr)
    const ev = JSON.parse(evRaw) as Record<string, Object>
    if (ev['ok'] !== true) return null
    const val = ev['value'] as string | undefined
    return val !== undefined && val.length > 0 ? val : null
  } catch (e) {
    return null
  }
}
