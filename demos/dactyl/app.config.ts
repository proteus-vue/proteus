// app.config.ts —— 应用级运行时配置（构建期产 `app-config.json` → 宿主读）
// ★决策 #211：proteus.config.ts = 构建期；app.config.ts = 运行时（怎么表现）
import { defineAppConfig } from '@proteus-vue/app-config'

export default defineAppConfig({
  app: {
    id: 'cn.proteus.dactyl',
    name: 'Dactyl 触感穹顶',
    version: '0.1.0',
    buildNumber: 1,
  },
  env: 'prod',
  api: {
    baseUrl: 'https://api.proteus-vue.cn',
    timeout: 10000,
    retry: 0,
    cache: { defaultTTL: 60, enabledEndpoints: [] },
  },
  features: {
    glassEffect: false,
    skeletonScreen: false,
    memorialGray: false,
    newHomePage: 'control',
    // ★★★Dactyl 延迟显影（决策 #780）：开启宿主叠加绘制（幽灵拖尾/延迟环/帧格）。
    //   本 demo 即以"把延迟做成可见像素"为目的 ⇒ 开启；其余 App 缺省关（对既有零影响）。
    dactylOverlay: true,
  },
  theme: { default: 'dark', allowUserToggle: false },
  font: { defaultScale: 1.0, allowUserAdjust: false },
  safeArea: { islandGlass: false, statusBar: 'show' },
})
