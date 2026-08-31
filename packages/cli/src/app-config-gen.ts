// packages/cli/src/app-config-gen.ts
// ★app-config G-35 M5：proteus gen config —— 生成 app.config.ts 骨架（06-cli-integration.md §1）
// 补齐 app-config:check 缺文件提示的引用命令；骨架经 defineAppConfig（Vite 模式类型安全）
// 产物可直接过 app-config:check（闭环测试验证）
import fs from 'node:fs'
import path from 'node:path'

const SKELETON = `// app.config.ts —— 应用全局配置骨架（proteus gen config 生成，可编辑）
// Schema 见 docs/proteus-app-config-plan/01-app-config.md §2.2
import { defineAppConfig } from '@proteus-vue/app-config'

export default defineAppConfig({
  app: { id: 'com.example.app', name: '示例应用', version: '1.0.0', buildNumber: 1 },
  env: 'dev',
  api: {
    baseUrl: 'https://api.example.com',
    timeout: 10000,
    retry: 2,
    cache: { defaultTTL: 300000, enabledEndpoints: [] },
  },
  features: { glassEffect: false, skeletonScreen: false, memorialGray: false, newHomePage: 'control' },
  theme: { default: 'system', allowUserToggle: true },
  font: { defaultScale: 1, allowUserAdjust: true },
  safeArea: { islandGlass: false },
})
`

/** 生成 app.config.ts 骨架到目标路径（已存在 → 抛错不覆盖；返回写入路径） */
export function generateAppConfigSkeleton(file: string): string {
  if (fs.existsSync(file)) {
    throw new Error(`文件已存在：${file}（不覆盖，请直接编辑或删除后重试）`)
  }
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true })
  fs.writeFileSync(file, SKELETON)
  return file
}
