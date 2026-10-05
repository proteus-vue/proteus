// css-conformance/app.config.ts —— 应用级运行时配置（与 proteus.config.ts 职责正交）
// ★决策 #211：proteus.config.ts = 构建期；app.config.ts = 运行时（怎么表现）
import { defineAppConfig } from '@proteus-vue/app-config'

export default defineAppConfig({
  app: {
    id: 'cn.proteus.css-conformance',
    name: 'Proteus CSS 验收',
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
    skeletonScreen: false,
    memorialGray: false,
    newHomePage: 'control',
  },
  theme: { default: 'light', allowUserToggle: false },
  font: { defaultScale: 1.0, allowUserAdjust: false },
  safeArea: { islandGlass: false },
})
