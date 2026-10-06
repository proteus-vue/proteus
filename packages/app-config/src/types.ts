// packages/app-config/src/types.ts
// ★app-config G-35：应用全局配置 Schema（01-app-config.md §2.2）
// 区别于 proteus.config（工程/框架构建配置）——本类型是应用级运行时配置
export type Env = 'dev' | 'staging' | 'prod'

export type Platform = 'mp-weixin' | 'web' | 'ios' | 'android' | 'harmony'

/** 深层部分（平台覆盖用，§2.2 DeepPartial） */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K]
}

/** 远端下发配置（§4.1） */
export interface RemoteConfigConfig {
  enabled: boolean
  source: {
    type: 'https' | 'local'
    url: string
  }
  strategy: {
    fetchOnLaunch: boolean
    fetchInterval: number
    cacheToDisk: boolean
  }
  fallback: 'last-cached' | 'defaults'
}

/** 应用全局配置 Schema（§2.2；开发者定义，框架推导类型） */
export interface AppConfig {
  app: {
    /** 应用运行时标识（上报/多租户；★决策 #211：区别于 proteus.config.appid——微信平台编译标识，构建期消费） */
    id: string
    name: string
    version: string
    buildNumber: number
  }
  env: Env
  api: {
    baseUrl: string
    timeout: number
    retry: number
    cache: {
      defaultTTL: number
      enabledEndpoints: string[]
    }
  }
  features: {
    glassEffect: boolean
    skeletonScreen: boolean
    memorialGray: boolean
    newHomePage: 'control' | 'variant-a' | 'variant-b'
    [key: string]: boolean | string | number
  }
  theme: {
    default: 'light' | 'dark' | 'system'
    allowUserToggle: boolean
  }
  font: {
    defaultScale: number
    allowUserAdjust: boolean
  }
  safeArea: {
    islandGlass: boolean
    /**
     * ★★★系统状态栏显示策略（2026-10-08 · 决策 #594）：`'show'`（默认）| `'hide'`。
     *   · `'show'`：显示系统状态栏——**与 Web 手机端 `viewport-fit=cover` + edge-to-edge 对齐**（内容背景铺到
     *     状态栏区，内容用 `--pf-inset-top` 让位）；这是框架默认（Web 基准：浏览器视口含状态栏区）。
     *   · `'hide'`：沉浸式全屏（隐藏状态栏，内容占满顶部）。
     *   宿主（Android/鸿蒙/iOS）经构建期产出的 `app-config.json` 读取本项；缺省 = `'show'`。
     */
    statusBar?: 'show' | 'hide'
  }
  platform?: Partial<Record<Platform, DeepPartial<AppConfig>>>
  remote?: RemoteConfigConfig
}

/** 合并层（优先级从低到高：默认 < env < platform < remote） */
export type ConfigLayer = 'defaults' | 'env' | 'platform' | 'remote'
