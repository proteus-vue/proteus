// vitest.config.ts
// vitest 独立配置：不加载 vite.config.ts，避免测试期间触发 mp 构建插件副作用
// （vite.config 的 mpTransform 会在 buildStart 输出产物到 dist/mp-weixin）
// e2e 测试（tests/e2e-web.test.ts）需要真实构建产物 + Chromium，由 npm run test:e2e:web 单独运行
import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  // ★G-22 柔性布局组件测试：启用 vue 插件（SFC 挂载测试；不影响既有非 SFC 测试）
  plugins: [vue()],
  test: {
    // ★并行 worker 上限：hmr-dev-server 等真实 fs.watch（macOS FSEvents）测试在满核并行 + 系统负载下事件延迟可超 15s
    //   （实测 8 核满载 4 连败 / 4 worker 全绿）→ 保守限流，单测稳定性优先于并行吞吐
    poolOptions: {
      threads: {
        maxThreads: 4,
        minThreads: 2,
      },
    },
  },
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
      // ★发布前收口（决策 #214）：测试统一走包名（去掉 packages 相对路径引入）——缺失 alias 补全
      { find: '@proteus-vue/api', replacement: fileURLToPath(new URL('./packages/api/src/index.ts', import.meta.url)) },
      { find: '@proteus-vue/built-in-components', replacement: fileURLToPath(new URL('./packages/built-in-components/src/index.ts', import.meta.url)) },
      // ★组件库未拆包（决策 #115）：@proteus-vue/components → src/components（examples alias 同源；测试统一走包名）
      { find: '@proteus-vue/components', replacement: fileURLToPath(new URL('./src/components/index.ts', import.meta.url)) },
      // ★Fluid System（fluid-system-plan）：@proteus-vue/fluid 包（tests/fluid-system.test.ts 直接引用）
      { find: '@proteus-vue/fluid', replacement: fileURLToPath(new URL('./packages/fluid/src/index.ts', import.meta.url)) },
      // ★G-27（render-backend-1-plan M1.4）：@proteus-vue/render-backend 包（tests/render-backend.test.ts 直接引用）
      { find: '@proteus-vue/render-backend', replacement: fileURLToPath(new URL('./packages/render-backend/src/index.ts', import.meta.url)) },
      // ★G-31（component-semantics-plan B1）：@proteus-vue/component-ir 包（tests/component-ir.test.ts 直接引用）
      { find: '@proteus-vue/component-ir', replacement: fileURLToPath(new URL('./packages/component-ir/src/index.ts', import.meta.url)) },
      // ★G-29（compiler-backend-1-plan B1）：@proteus-vue/compiler-backend 包（tests/compiler-backend.test.ts 直接引用）
      //   正则形式：精确匹配包根 + ./node 子路径（B4 官网 IR Tab 用浏览器安全单入口——字符串 alias 会前缀误吞 /node）
      { find: /^@proteus-vue\/compiler-backend$/, replacement: fileURLToPath(new URL('./packages/compiler-backend/src/index.ts', import.meta.url)) },
      { find: '@proteus-vue/compiler-backend/node', replacement: fileURLToPath(new URL('./packages/compiler-backend/src/node.ts', import.meta.url)) },
      // ★G-32 B4 ④ Gesture：@proteus-vue/gesture 包（tests/gesture.test.ts 直接引用）
      { find: '@proteus-vue/gesture', replacement: fileURLToPath(new URL('./packages/gesture/src/index.ts', import.meta.url)) },
      // ★G-31 B6：@proteus-vue/compat-miniprogram 兼容层包（tests/compat-miniprogram.test.ts 直接引用）
      { find: '@proteus-vue/compat-miniprogram', replacement: fileURLToPath(new URL('./packages/compat-miniprogram/src/index.ts', import.meta.url)) },
      // ★G-24 B1：@proteus-vue/desktop 桌面交互原语包（tests/desktop.test.ts 直接引用）
      { find: '@proteus-vue/desktop', replacement: fileURLToPath(new URL('./packages/desktop/src/index.ts', import.meta.url)) },
      // ★G-36 B1：@proteus-vue/mcp MCP Server 包（tests/mcp-server.test.ts 直接引用）
      { find: '@proteus-vue/mcp', replacement: fileURLToPath(new URL('./packages/mcp/src/index.ts', import.meta.url)) },
      // ★G-36 B2：@proteus-vue/agent Agent Kit SDK 包（tests/agent-kit.test.ts 直接引用）
      { find: '@proteus-vue/agent', replacement: fileURLToPath(new URL('./packages/agent/src/index.ts', import.meta.url)) },
      // ★G-36 B2/官网 B2：@proteus-vue/docs 文档引擎包（tests/docs-engine.test.ts 直接引用）
      { find: '@proteus-vue/docs', replacement: fileURLToPath(new URL('./packages/docs/src/index.ts', import.meta.url)) },
      // ★G-45 B2：@proteus-vue/dev-host 调试基座包（tests/dev-host.test.ts 直接引用）
      { find: '@proteus-vue/dev-host', replacement: fileURLToPath(new URL('./packages/dev-host/src/index.ts', import.meta.url)) },
      { find: '@proteus-vue/test-ir', replacement: fileURLToPath(new URL('./packages/test-ir/src/index.ts', import.meta.url)) },
      { find: '@proteus-vue/create-proteus', replacement: fileURLToPath(new URL('./packages/create-proteus/src/index.ts', import.meta.url)) },
      { find: '@proteus-vue/pinia-sync', replacement: fileURLToPath(new URL('./packages/pinia-sync/src/index.ts', import.meta.url)) },
      { find: '@proteus-vue/renderer-app', replacement: fileURLToPath(new URL('./packages/renderer-app/src/index.ts', import.meta.url)) },
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
      // devtools-plan UI 层：@proteus-vue/devtools 包（tests/devtools-panel.test.ts 直接引用）
      { find: '@proteus-vue/devtools', replacement: fileURLToPath(new URL('./packages/devtools/src/index.ts', import.meta.url)) },
      // devtools-plus G-34 M1：@proteus-vue/hmr 包（tests/hmr.test.ts 直接引用；★子路径在父路径前）
      { find: '@proteus-vue/hmr/style-gate', replacement: fileURLToPath(new URL('./packages/hmr/src/style-gate/index.ts', import.meta.url)) },
      { find: '@proteus-vue/hmr/cdp', replacement: fileURLToPath(new URL('./packages/hmr/src/cdp/index.ts', import.meta.url)) },
      { find: '@proteus-vue/hmr/dev-server', replacement: fileURLToPath(new URL('./packages/hmr/src/dev-server/index.ts', import.meta.url)) },
      { find: '@proteus-vue/hmr', replacement: fileURLToPath(new URL('./packages/hmr/src/index.ts', import.meta.url)) },
      // security-plan B1-B2：@proteus-vue/security 包（tests/security.test.ts 直接引用）
      { find: '@proteus-vue/security', replacement: fileURLToPath(new URL('./packages/security/src/index.ts', import.meta.url)) },
      // G-31 style-safety：@proteus-vue/style-safety 包（tests/style-safety-runtime.test.ts 直接引用）
      { find: '@proteus-vue/style-safety', replacement: fileURLToPath(new URL('./packages/style-safety/src/index.ts', import.meta.url)) },
      // devtools 远程查看中转：@proteus-vue/plugin-vite 包（tests/devtools-relay.test.ts 直接引用）
      { find: '@proteus-vue/plugin-vite', replacement: fileURLToPath(new URL('./packages/plugin-vite/src/index.ts', import.meta.url)) },
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
