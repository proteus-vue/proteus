// packages/test-core/src/driver/wxide.ts
// ★★2026-09-08 重构：小程序 E2E 后端从 miniprogram-automator 迁移到 **wechatide skill-CLI**（官方 Electron 版标准）。
//   automator 0.12.1 与新版 Electron IDE 的 automation WS 协议不兼容（launch 报 "Failed to launch ... http port is open"，
//   服务端口一直开着仍连不上 = 协议/端口不可发现问题）——唯一可靠通道 = wechatide skill-CLI（get_simulator_console/
//   automation_evaluate/automation_runtime_info/simulator_screenshot 实测可用）。
//   ★本适配器实现 `AutomatorMiniLike` 形状（driver/mp.ts 消费）→ createMpDriver(wxideMini, debugger) 无缝复用；
//   内部 spawn `wechatide -c <client> <tool> --project <path> ...` + 解析嵌套 JSON。
// ★体验内化（05/15 铁律）：console 零错门禁第一 → 稳通道（reLaunch/currentPage/evaluate）断言 → 元素级待激活态。
//   p-* 组件内部不可见（glass-easel 组件 DOM 隔离）→ 交互/断言走 evaluate 调页面方法。
import { spawnSync } from 'node:child_process'
import type { AutomatorMiniLike, AutomatorElementLike } from './types'

export interface WxideMiniOptions {
  /** 微信开发者工具 CLI 绝对路径（wechatide；无则走 PATH） */
  cliPath?: string
  /** 项目产物绝对路径（dist/mp-weixin） */
  project: string
  /** 授权 clientName（缺省 zed——与 wechatide auth 一致） */
  client?: string
}

/** ★统一 wechatide 调用：spawn + 解析 JSON + 提取业务值；失败抛带工具名的可行动错误 */
export function callWxide(tool: string, args: Record<string, string | number | undefined>, opts: WxideMiniOptions): any {
  const bin = opts.cliPath || 'wechatide'
  const argv = ['-c', opts.client || 'zed', tool, '--project', opts.project]
  for (const [k, v] of Object.entries(args)) {
    if (v == null) continue
    // ★wechatide 参数必须带 '--' 前缀（'--fn-source' 已带则保留）；值转字符串
    const flag = k.startsWith('--') ? k : `--${k}`
    argv.push(flag, String(v))
  }
  const res = spawnSync(bin, argv, { encoding: 'utf8', timeout: 60_000 })
  if (res.status !== 0) {
    throw new Error(`[wxide] ${tool} 退出码 ${res.status}：${cliHint(tool, res.stderr || res.stdout)}`)
  }
  const body = parseJsonOutput(res.stdout || '', tool)
  const resObj = (body.result ?? body) as Record<string, unknown>
  if (resObj && resObj.success === false) {
    throw new Error(`[wxide] ${tool} 失败：${String((resObj as Record<string, unknown>).error ?? (resObj as Record<string, unknown>).message ?? JSON.stringify(resObj))}`)
  }
  return extractValue(body)
}

/** ★wechatide 输出含 `[wechatide] skill-call` 前缀日志 + 一行 JSON——截取首个 `{` 起的 JSON */
function parseJsonOutput(text: string, tool: string): Record<string, unknown> {
  try {
    const b = JSON.parse(text)
    if (b && typeof b === 'object') return b as Record<string, unknown>
  } catch {
    /* fallthrough */
  }
  const m = text.match(/(\{[\s\S]*\})/)
  if (!m) throw new Error(`[wxide] ${tool} 输出非 JSON：${text.slice(0, 300)}`)
  return JSON.parse(m[1])
}

/** ★嵌套结果提取：evaluate 值在 `result.result.result`；currentPage 在 `result.currentPage`——逐形态取 */
function extractValue(body: Record<string, unknown>): unknown {
  const r = body.result as Record<string, unknown> | undefined
  if (!r) return body
  // evaluate：r.result.result = 值（3 层）；currentPage：r.currentPage；systemInfo：r.systemInfo
  if (r.currentPage !== undefined) return r.currentPage
  if (r.systemInfo !== undefined) {
    // ★systemInfo 形状 = { result: {...} }（3 层）——解包到实际对象
    const si = r.systemInfo as Record<string, unknown>
    return si && typeof si === 'object' && si.result !== undefined ? si.result : si
  }
  if (r.result !== undefined) {
    const rr = r.result as Record<string, unknown>
    if (rr && typeof rr === 'object' && rr.result !== undefined) return rr.result
    return rr
  }
  return r
}

function cliHint(tool: string, err: string): string {
  if (/runtimeid/i.test(err)) return '项目窗口未开/无运行时——先 open_project_window + simulator_open_page'
  if (/login|auth/i.test(err)) return '登录过期/未授权——wechatide -c <client> login 或 auth'
  if (/未知|unknown tool/i.test(err)) return `工具 ${tool} 不存在——核对 wechatide -h`
  return err.slice(0, 200)
}

// ============ AutomatorMiniLike 兼容适配（供 createMpDriver 复用） ============

/** ★wechatide 适配：实现 AutomatorMiniLike 所需方法（reLaunch/currentPage/evaluate/systemInfo/screenshot/disconnect + $ 元素） */
export function createWxideMini(opts: WxideMiniOptions): AutomatorMiniLike {
  const runInfo = (action: string) => callWxide('automation_runtime_info', { action }, opts) as Record<string, unknown> | null

  /** ★元素操作（automation_element_action——每次调用即解析）；p-* 内部不可见 → 不缓存 */
  const elementOp = (selector: string, action: string, extra: Record<string, string | number | undefined> = {}): unknown => {
    return callWxide('automation_element_action', { action, selector, ...extra }, opts)
  }

  /** ★AutomatorElementLike：由 automation_element_action 支撑各操作 */
  const makeElement = (selector: string): AutomatorElementLike => ({
    async tap() {
      elementOp(selector, 'tap')
    },
    async input(text: string) {
      elementOp(selector, 'input', { value: text })
    },
    async longPress(durationMs = 600) {
      elementOp(selector, 'longpress', { value: String(durationMs) })
    },
    async text() {
      return String((elementOp(selector, 'text') as string) ?? '')
    },
    async value() {
      return String((elementOp(selector, 'value') as string) ?? '')
    },
    async attribute(name: string) {
      // ★wechatide element action 的 attribute 需 `--name`；缺失返回 null
      return (elementOp(selector, 'attribute', { name }) as string) ?? null
    },
  })

  return {
    async reLaunch(url: string) {
      const p = url.replace(/^\//, '')
      callWxide('automation_navigate', { action: 'reLaunch', url: `/${p}` }, opts)
      // ★reLaunch 后页面栈重置——evaluate 延时（★必须传函数；无 arg 自包含）
      await this.evaluate(() => new Promise((r) => setTimeout(r, 600)))
      return { path: p }
    },
    async currentPage() {
      const cur = (runInfo('currentPage') ?? {}) as { path?: string; route?: string }
      const path = String(cur.path || (cur.route || '').replace(/^\//, ''))
      // ★$ 元素解析（AutomatorElementLike）——MpElement 每次操作即经 automation_element_action；
      //   p-* 组件内部（glass-easel DOM 隔离）查询不到 → null（调用方走 evaluate）
      return {
        path,
        $: async (selector: string) => makeElement(selector),
      }
    },
    async systemInfo() {
      // ★systemInfo 嵌套且平台字段在 r.systemInfo 或直接——稳妥给整对象
      const info = runInfo('systemInfo')
      return (info && typeof info === 'object' ? info : {}) as Record<string, unknown>
    },
    async evaluate<T = unknown>(fn: string | ((...args: any[]) => unknown), ...args: unknown[]): Promise<T> {
      // ★automation_evaluate 期望**裸函数源码 function(){...}**（非 IIFE ——手动实测 (function(){})() 会 exit 1）。
      //   裸函数由工具自行调用并返回表达式值。无参 → 直传 fn.toString()（不包装）；带参 → 闭包内联。
      const src = typeof fn === 'function'
        ? args.length
          ? `(${fn.toString()})(${args.map((a) => JSON.stringify(a)).join(',')})`
          : fn.toString()
        : String(fn)
      const r = callWxide('automation_evaluate', { '--fn-source': src }, opts)
      return r as T
    },
    async screenshot(options?: { path?: string }) {
      const path = options?.path
      const r = (callWxide('simulator_screenshot', { path }, opts) ?? {}) as { path?: string }
      return { path: r.path || path || '' }
    },
    disconnect() {
      // ★wechatide 是命令式调用，无持连接——空操作（close_project_window 由 CLI 收尾）
    },
  } as AutomatorMiniLike & { __elementOp: typeof elementOp }
}

export type { AutomatorMiniLike, AutomatorElementLike }
