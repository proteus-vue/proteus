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
      // 拆包后 src/runtime、src/router import @proteus-vue/shared/runtime（vitest 不加载 vite.config，需独立别名）
      { find: '@proteus-vue/shared', replacement: fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)) },
      // ★子路径 alias 必须在父路径之前（vite alias 前缀匹配：@proteus-vue/contracts 会吞掉 /style 后缀）
      { find: '@proteus-vue/contracts/style', replacement: fileURLToPath(new URL('./packages/contracts/src/style.ts', import.meta.url)) },
      { find: '@proteus-vue/contracts', replacement: fileURLToPath(new URL('./packages/contracts/src/index.ts', import.meta.url)) },
      // ★子路径 alias 必须在父路径之前（vite alias 前缀匹配：@proteus-vue/runtime 会吞掉 /style-safety 后缀）
      { find: '@proteus-vue/runtime/style-safety', replacement: fileURLToPath(new URL('./packages/runtime/src/style-safety/index.ts', import.meta.url)) },
      { find: '@proteus-vue/runtime', replacement: fileURLToPath(new URL('./packages/runtime/src/index.ts', import.meta.url)) },
      // ★子路径 alias 必须在父路径之前
      { find: '@proteus-vue/router/navigation', replacement: fileURLToPath(new URL('./packages/router/src/navigation.ts', import.meta.url)) },
      { find: '@proteus-vue/router', replacement: fileURLToPath(new URL('./packages/router/src', import.meta.url)) },
      // 插件/编译引擎（plugin.test 加载 plugin.ts 时 import @proteus-vue/compiler 需解析）
      { find: '@proteus-vue/compiler/style-safety', replacement: fileURLToPath(new URL('./packages/compiler/src/style-safety/index.ts', import.meta.url)) },
      { find: '@proteus-vue/compiler', replacement: fileURLToPath(new URL('./packages/compiler/src/index.ts', import.meta.url)) },
      // module-plan B1：@proteus-vue/module 包（module-contract.test 经 CLI module-check 引用）
      { find: '@proteus-vue/module', replacement: fileURLToPath(new URL('./packages/module/src/index.ts', import.meta.url)) },
      // platform-plan B1：@proteus-vue/capabilities 包（capabilities.test 经 CLI capability-manifest 引用）
      { find: '@proteus-vue/capabilities/scan', replacement: fileURLToPath(new URL('./packages/capabilities/src/scan.ts', import.meta.url)) },
      { find: '@proteus-vue/capabilities/check', replacement: fileURLToPath(new URL('./packages/capabilities/src/check.ts', import.meta.url)) },
      { find: '@proteus-vue/capabilities', replacement: fileURLToPath(new URL('./packages/capabilities/src/index.ts', import.meta.url)) },
      // i18n-plan B1：@proteus-vue/i18n 包（tests/i18n.test.ts 直接引用）
      { find: '@proteus-vue/i18n', replacement: fileURLToPath(new URL('./packages/i18n/src/index.ts', import.meta.url)) },
      // css-compat G-21：@proteus-vue/css-compat 包（★B2 数据层子路径在父路径前）
      { find: '@proteus-vue/css-compat/layout-semantics', replacement: fileURLToPath(new URL('./packages/css-compat/src/layout-semantics/index.ts', import.meta.url)) },
      { find: '@proteus-vue/css-compat', replacement: fileURLToPath(new URL('./packages/css-compat/src/index.ts', import.meta.url)) },
      // app-config G-35 M1：@proteus-vue/app-config 包（tests/app-config.test.ts 直接引用）
      { find: '@proteus-vue/app-config', replacement: fileURLToPath(new URL('./packages/app-config/src/index.ts', import.meta.url)) },
      // test-framework M3+B2：@proteus-vue/test-core 包（tests/test-core.test.ts 直接引用；★子路径在父路径前）
      { find: '@proteus-vue/test-core/snapshot', replacement: fileURLToPath(new URL('./packages/test-core/src/snapshot/index.ts', import.meta.url)) },
      { find: '@proteus-vue/test-core/driver', replacement: fileURLToPath(new URL('./packages/test-core/src/driver/index.ts', import.meta.url)) },
      { find: '@proteus-vue/test-core', replacement: fileURLToPath(new URL('./packages/test-core/src/index.ts', import.meta.url)) },
      // devtools-plan B1：@proteus-vue/devtools-runtime 包（tests/devtools-runtime.test.ts 直接引用）
      { find: '@proteus-vue/devtools-runtime', replacement: fileURLToPath(new URL('./packages/devtools-runtime/src/index.ts', import.meta.url)) },
      // security-plan B1-B2：@proteus-vue/security 包（tests/security.test.ts 直接引用）
      { find: '@proteus-vue/security', replacement: fileURLToPath(new URL('./packages/security/src/index.ts', import.meta.url)) },
      // types-plan B3：@proteus-vue/types 包（tests/generate-types.test.ts 直接引用）
      { find: '@proteus-vue/types/capabilities', replacement: fileURLToPath(new URL('./packages/types/src/capabilities.ts', import.meta.url)) },
      { find: '@proteus-vue/types/router-types', replacement: fileURLToPath(new URL('./packages/types/src/router-types.ts', import.meta.url)) },
      { find: '@proteus-vue/types/compiler-types', replacement: fileURLToPath(new URL('./packages/types/src/compiler-types.ts', import.meta.url)) },
      { find: '@proteus-vue/types/api-types', replacement: fileURLToPath(new URL('./packages/types/src/api-types.ts', import.meta.url)) },
      { find: '@proteus-vue/types/config', replacement: fileURLToPath(new URL('./packages/types/src/config.ts', import.meta.url)) },
      { find: '@proteus-vue/types/config-schema', replacement: fileURLToPath(new URL('./packages/types/src/config-schema.ts', import.meta.url)) },
      { find: '@proteus-vue/types/mp/component-schema', replacement: fileURLToPath(new URL('./packages/types/src/mp/component-schema.ts', import.meta.url)) },
      { find: '@proteus-vue/types/define-proteus', replacement: fileURLToPath(new URL('./packages/types/src/define-proteus.ts', import.meta.url)) },
      { find: '@proteus-vue/types', replacement: fileURLToPath(new URL('./packages/types/src/index.ts', import.meta.url)) },
    ],
  },
})
