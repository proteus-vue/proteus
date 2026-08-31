// packages/types/src/define-proteus.ts
// ★cli-plus G-33 M1：defineProteus 配置入口（01-cli.md §3 五端统一入口，借鉴 Vite defineConfig 模式）
// 定位：identity 函数——完整 TS 类型推导 + 原样返回（零运行时逻辑，types 包纯类型铁律保持）
// 校验：CLI 侧（proteus check / config-validate）消费；本模块只做「配置错误在 IDE 即时报错」

/** 各端目标配置（01-cli.md §3 targets：语义层，框架映射到原生） */
export interface DefineProteusTargets {
  web?: { output: string }
  skyline?: { appid: string }
  ios?: { bundleId: string; teamId?: string }
  android?: { package: string }
  harmony?: { bundleName: string }
}

/** 能力开关（联动横切层） */
export interface DefineProteusFeatures {
  glass?: boolean // G-29
  safeArea?: boolean // G-23
  memorial?: boolean // G-25
  skeleton?: boolean // G-26
  styleSafety?: boolean // G-31
  strictRouter?: boolean // G-32
}

/** 主题/字体/缓存（联动 G-27/G-28） */
export interface DefineProteusTheme {
  default?: 'light' | 'dark'
  tokens?: string
}

export interface DefineProteusFontScale {
  enabled?: boolean
  min?: number
  max?: number
}

export interface DefineProteusCache {
  budget?: string
}

/** defineProteus 配置（01-cli.md §3：五端统一入口，单一事实源） */
export interface DefineProteusConfig {
  /** 五端统一入口（单一事实源） */
  entry: string
  /** 各端配置（语义层，框架映射到原生） */
  targets: DefineProteusTargets
  /** 能力开关 */
  features?: DefineProteusFeatures
  theme?: DefineProteusTheme
  fontScale?: DefineProteusFontScale
  cache?: DefineProteusCache
  /** 路由（联动 G-32 router-plus） */
  router?: { deepLink?: { scheme: string } }
}

/**
 * 配置入口：完整 TS 类型推导 + 原样返回（借鉴 Vite defineConfig）
 * 运行时零逻辑（identity）；配置错误在 IDE 即时报错；深度校验走 CLI check
 */
export function defineProteus(config: DefineProteusConfig): DefineProteusConfig {
  return config
}
