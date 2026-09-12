// showcase/app.config.ts —— 应用级运行时配置（与 proteus.config.ts 职责正交）
// ★决策 #211：proteus.config.ts = 构建期（怎么构建）；app.config.ts = 运行时（怎么表现）
import { defineAppConfig } from '@proteus-vue/app-config'

export default defineAppConfig({
  app: {
    id: 'cn.proteus.showcase',
    name: 'Proteus 官方演示',
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
    glassEffect: true,
    skeletonScreen: true,
    memorialGray: false,
    newHomePage: 'control',
  },
  theme: { default: 'light', allowUserToggle: true },
  font: { defaultScale: 1.0, allowUserAdjust: true },
  safeArea: { islandGlass: true },
})
