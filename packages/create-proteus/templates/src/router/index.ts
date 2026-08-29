// packages/router/src/index.ts
// 统一路由 API（P3-1 + 拆包步骤 4 工厂化）—— 只依赖 @proteus/shared 接口，禁止直连 wx（执行规则 4）
// ★工厂化：createRouter(routes) 接收路由表（应用侧由 gen-routes 生成的 auto-routes 提供），
//   不再全局单例 import——路由表由调用方注入（对齐 docs/proteus-router-plan M2）
import type { NavigateOptions, RouteParams, RouteRecord, RouteParamsByName } from './types'
import { runBeforeEach, runAfterEach } from './guards'
import { isSkyline, navigateWithCustomRoute } from './skyline'
import { adapter } from '@proteus/shared'

class Router {
  /** 当前页面栈深度（MP 返回真实栈深；Web 恒为 1） */
  get stackDepth(): number {
    return adapter.getCurrentPages().length
  }

  constructor(private routeMap: Record<string, RouteRecord>) {}

  /** 命名路由跳转（推荐）——泛型 N 由 name 字面量推断，params 类型自动匹配（类型提示全链路） */
  async push<N extends keyof RouteParamsByName = keyof RouteParamsByName>(options: NavigateOptions<N>): Promise<void> {
    const target = this.resolve(options as NavigateOptions)
    if (!target) throw new Error(`[router] route not found: ${JSON.stringify(options)}`)

    // 路由守卫：返回 false 取消导航（routeMap 注入，工厂化）
    const guardResult = await runBeforeEach(target, this.routeMap)
    if (guardResult === false) return

    const url = this.buildUrl(target.path, { ...(options.params as RouteParams | undefined), ...options.query })

    // Skyline 自定义路由（仅 MP + Skyline 环境）
    if (options.routeType && isSkyline()) {
      await navigateWithCustomRoute(url, options.routeType)
    }
    // TabBar 页面
    else if (options.switchTab || target.meta?.isTab) {
      await adapter.switchTab({ url: target.path })
    }
    // 替换当前页
    else if (options.replace) {
      await adapter.redirectTo({ url })
    }
    // 重启
    else if (options.reLaunch) {
      await adapter.reLaunch({ url })
    }
    // 普通跳转（栈深保护仅 MP 生效；Web 端不受 10 层限制）
    else {
      if (adapter.isMP && this.stackDepth >= 9) {
        // MP 栈深≥9 自动降级为 redirectTo，避免第 10 层报错（平台硬边界）
        await adapter.redirectTo({ url })
      } else {
        // routeType 透传：MP 由 skyline 分支消费，Web 端由 adapter 用于 CSS 转场
        await adapter.navigateTo({ url, routeType: options.routeType })
      }
    }

    await runAfterEach(target, this.routeMap)
  }

  /** 后退 */
  back(delta = 1): void {
    adapter.navigateBack({ delta })
  }

  /** 替换当前页 */
  replace<N extends keyof RouteParamsByName = keyof RouteParamsByName>(options: NavigateOptions<N>): Promise<void> {
    return this.push({ ...options, replace: true })
  }

  /** 根据命名路由/路径解析目标 */
  private resolve(options: NavigateOptions): RouteRecord | null {
    if (options.name && this.routeMap[options.name]) return this.routeMap[options.name]
    if (options.path) {
      const found = Object.values(this.routeMap).find((r) => r.path === options.path || r.name === options.path)
      return found ?? null
    }
    return null
  }

  /** 拼接 URL（params + query → query string，自动 encode） */
  private buildUrl(path: string, params?: RouteParams): string {
    if (!params) return `/${path}`
    const qs = Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&')
    return qs ? `/${path}?${qs}` : `/${path}`
  }
}

/**
 * 创建 Router 实例（拆包步骤 4 工厂化）：路由表由调用方注入
 * 用法：const router = createRouter(routes)（routes 来自 gen-routes 生成的 auto-routes）
 */
export function createRouter(routes: RouteRecord[]): Router {
  const routeMap = routes.reduce((m, r) => {
    m[r.name] = r
    return m
  }, {} as Record<string, RouteRecord>)
  return new Router(routeMap)
}

export type RouterInstance = Router

// 类型契约再导出（应用侧 import type { RouteRecord } from '@proteus/router' 即可，无需深路径）
export type {
  RouteRecord,
  RouteMeta,
  RouteBlock,
  RouteNode,
  GlobalRouteDefaults,
  RouteParams,
  RouteParamsByName,
  PageOnLoad,
  BaseNavigateOptions,
  NavigateOptions,
} from './types'
