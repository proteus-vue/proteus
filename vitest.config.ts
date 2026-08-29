// vitest.config.ts
// vitest 独立配置：不加载 vite.config.ts，避免测试期间触发 mp 构建插件副作用
// （vite.config 的 mpTransform 会在 buildStart 输出产物到 dist/mp-weixin）
// e2e 测试（tests/e2e-web.test.ts）需要真实构建产物 + Chromium，由 npm run test:e2e:web 单独运行
import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  test: {},
  resolve: {
    alias: [
      // 拆包后 src/runtime、src/router import @proteus/shared/runtime（vitest 不加载 vite.config，需独立别名）
      { find: '@proteus/shared', replacement: fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)) },
      { find: '@proteus/runtime', replacement: fileURLToPath(new URL('./packages/runtime/src/index.ts', import.meta.url)) },
      { find: '@proteus/router', replacement: fileURLToPath(new URL('./packages/router/src', import.meta.url)) },
      // 插件/编译引擎（plugin.test 加载 plugin.ts 时 import @proteus/compiler 需解析）
      { find: '@proteus/compiler', replacement: fileURLToPath(new URL('./packages/compiler/src/index.ts', import.meta.url)) },
      // module-plan B1：@proteus/module 包（module-contract.test 经 CLI module-check 引用）
      { find: '@proteus/module', replacement: fileURLToPath(new URL('./packages/module/src/index.ts', import.meta.url)) },
      // platform-plan B1：@proteus/capabilities 包（capabilities.test 经 CLI capability-manifest 引用）
      { find: '@proteus/capabilities/scan', replacement: fileURLToPath(new URL('./packages/capabilities/src/scan.ts', import.meta.url)) },
      { find: '@proteus/capabilities/check', replacement: fileURLToPath(new URL('./packages/capabilities/src/check.ts', import.meta.url)) },
      { find: '@proteus/capabilities', replacement: fileURLToPath(new URL('./packages/capabilities/src/index.ts', import.meta.url)) },
      // i18n-plan B1：@proteus/i18n 包（tests/i18n.test.ts 直接引用）
      { find: '@proteus/i18n', replacement: fileURLToPath(new URL('./packages/i18n/src/index.ts', import.meta.url)) },
    ],
  },
})
