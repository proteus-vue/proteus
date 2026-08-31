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
  }
  platform?: Partial<Record<Platform, DeepPartial<AppConfig>>>
  remote?: RemoteConfigConfig
}

/** 合并层（优先级从低到高：默认 < env < platform < remote） */
export type ConfigLayer = 'defaults' | 'env' | 'platform' | 'remote'
