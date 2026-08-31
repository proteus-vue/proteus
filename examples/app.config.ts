// examples/app.config.ts —— ★应用级运行时配置（与 proteus.config.ts 职责正交）
// ★决策 #211 职责边界：proteus.config.ts = 构建期（怎么构建）；app.config.ts = 运行时（怎么表现）
// 消费方：业务 useAppConfig()/useFeatureFlag()；生命周期：启动读取 + 可选远端热更新
import { defineAppConfig } from '@proteus-vue/app-config'

export default defineAppConfig({
  // 应用运行时标识（区别于 proteus.config.appid——那是微信平台编译标识，构建期写 project.config.json）
  app: {
    id: 'com.proteus.demo',
    name: 'Proteus Demo',
    version: '1.0.0',
    buildNumber: 1,
  },
  env: 'dev',
  api: {
    baseUrl: 'https://api.example.com',
    timeout: 10000,
    retry: 3,
    cache: { defaultTTL: 60, enabledEndpoints: [] },
  },
  features: {
    glassEffect: true,
    skeletonScreen: true,
    memorialGray: false,
    newHomePage: 'control',
  },
  theme: { default: 'system', allowUserToggle: true },
  font: { defaultScale: 1.0, allowUserAdjust: true },
  safeArea: { islandGlass: true },
})
