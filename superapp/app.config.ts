// superapp/app.config.ts —— 应用级运行时配置（与 proteus.config.ts 职责正交）
// ★决策 #211：proteus.config.ts = 构建期；app.config.ts = 运行时（怎么表现）
import { defineAppConfig } from '@proteus-vue/app-config'

export default defineAppConfig({
  app: {
    id: 'cn.proteus.superapp',
    name: 'Proteus 超级应用',
    version: '0.1.0',
    buildNumber: 1,
  },
  env: 'prod',
  api: {
    baseUrl: 'https://api.proteus-vue.cn',
    timeout: 10000,
    retry: 2,
    cache: { defaultTTL: 60, enabledEndpoints: [] },
  },
  features: {
    glassEffect: false,
    skeletonScreen: true,
    memorialGray: false,
    newHomePage: 'control',
  },
  theme: { default: 'light', allowUserToggle: true },
  font: { defaultScale: 1.0, allowUserAdjust: true },
  // ★决策 #594：系统状态栏显示策略（'show' 默认 = 与 Web 手机端 viewport-fit=cover 对齐；'hide' = 沉浸式）
  safeArea: { islandGlass: false, statusBar: 'show' },
})
