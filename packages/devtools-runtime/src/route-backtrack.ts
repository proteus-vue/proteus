// packages/devtools-runtime/src/route-backtrack.ts
// devtools-plan M5（B5）：路由回溯（UI 无关纯逻辑）
//   · beginNav/guardStart/guardEnd/finishNav：导航生命周期采集（Router beforeEach/afterEach 钩子适配）
//   · guards：守卫耗时瀑布（start/end 计时）+ 结果 next/redirect/cancel/error
//   · 回溯查询：pathTo 逆推父链 / redirects / cancels（"怎么到这页 / 为什么重定向 / 为什么没跳转"）
//   · 环形缓冲（导航记录上限，缺省 500）
// ★MP 产物安全（决策 #32/#36）：无 ?? / ?. / 对象展开 / 数组解构

export type GuardResult = 'next' | 'redirect' | 'cancel' | 'error'

/** 路由位置形状（结构类型：Router RouteLocation / 页面路径均可注入） */
export interface RouteLocationLike {
  path: string
  query?: Record<string, unknown>
  name?: string
}

/** 单条守卫执行记录 */
export interface GuardRecord {
  name: string
  durationMs: number
  result: GuardResult
}

/** 导航记录（一次 router.push/replace） */
export interface NavRecord {
  id: string
  from: RouteLocationLike
  to: RouteLocationLike
  guards: GuardRecord[]
  /** 导航总耗时（begin → finish） */
  durationMs: number
  traceId?: string
  timestamp: number
}

export interface RouteBacktrackerOptions {
  /** 导航记录环形缓冲上限（缺省 500） */
  bufferSize?: number
  /** 时钟注入（缺省 Date.now——测试可控制） */
  now?: () => number
  /** 可观测（导航生命周期事件，联动 TraceBus/时间轴） */
  onEvent?: (event: { type: 'begin' | 'guard' | 'finish'; navId: string }) => void
}

export interface RouteBacktracker {
  /** 开始一条导航（Router beforeEach 之前调用）→ 返回 navId */
  beginNav(from: RouteLocationLike, to: RouteLocationLike, traceId?: string): string
  /** 守卫开始（计时起点） */
  guardStart(navId: string, name: string): void
  /** 守卫结束（计时终点 + 结果） */
  guardEnd(navId: string, result: GuardResult): void
  /** 结束导航（Router afterEach 调用） */
  finishNav(navId: string): void
  /** 已完成的导航记录（时间序 = 页面栈序） */
  records(): NavRecord[]
  /** 回溯：到达 to.path 的导航链（逆推父链） */
  pathTo(toPath: string): NavRecord[]
  /** 触发 redirect 的导航 */
  redirects(): NavRecord[]
  /** 被取消（cancel）的导航 */
  cancels(): NavRecord[]
  clear(): void
}

let seq = 0
function nextNavId(): string {
  seq += 1
  return 'nav-' + seq
}

interface InflightGuard {
  name: string
  startMs: number
}

interface InflightNav {
  record: NavRecord
  beginMs: number
  guard: InflightGuard | null
}

export function createRouteBacktracker(options: RouteBacktrackerOptions = {}): RouteBacktracker {
  const bufferSize = options.bufferSize ?? 500
  const now = options.now ?? (() => Date.now())
  const onEvent = options.onEvent ?? null
  const completed: NavRecord[] = []
  const inflight = new Map<string, InflightNav>()

  function pushRecord(record: NavRecord): void {
    completed.push(record)
    if (completed.length > bufferSize) completed.shift()
  }

  return {
    beginNav(from: RouteLocationLike, to: RouteLocationLike, traceId?: string): string {
      const id = nextNavId()
      inflight.set(id, {
        record: {
          id,
          from,
          to,
          guards: [],
          durationMs: 0,
          traceId,
          timestamp: now(),
        },
        beginMs: now(),
        guard: null,
      })
      onEvent?.({ type: 'begin', navId: id })
      return id
    },
    guardStart(navId: string, name: string): void {
      const nav = inflight.get(navId)
      if (!nav) return
      nav.guard = { name, startMs: now() }
    },
    guardEnd(navId: string, result: GuardResult): void {
      const nav = inflight.get(navId)
      if (!nav || !nav.guard) return
      nav.record.guards.push({ name: nav.guard.name, durationMs: Math.max(0, now() - nav.guard.startMs), result })
      nav.guard = null
      onEvent?.({ type: 'guard', navId })
    },
    finishNav(navId: string): void {
      const nav = inflight.get(navId)
      if (!nav) return
      nav.record.durationMs = Math.max(0, now() - nav.beginMs)
      inflight.delete(navId)
      pushRecord(nav.record)
      onEvent?.({ type: 'finish', navId })
    },
    records: () => completed,
    pathTo(toPath: string): NavRecord[] {
      const out: NavRecord[] = []
      for (const r of completed) {
        if (r.to.path === toPath) out.push(r)
      }
      return out
    },
    redirects(): NavRecord[] {
      const out: NavRecord[] = []
      for (const r of completed) {
        for (const g of r.guards) {
          if (g.result === 'redirect') {
            out.push(r)
            break
          }
        }
      }
      return out
    },
    cancels(): NavRecord[] {
      const out: NavRecord[] = []
      for (const r of completed) {
        for (const g of r.guards) {
          if (g.result === 'cancel' || g.result === 'error') {
            out.push(r)
            break
          }
        }
      }
      return out
    },
    clear: () => {
      completed.length = 0
      inflight.clear()
    },
  }
}
