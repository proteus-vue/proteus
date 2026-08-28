// vitest.config.ts
// vitest 独立配置：不加载 vite.config.ts，避免测试期间触发 mp 构建插件副作用
// （vite.config 的 mpTransform 会在 buildStart 输出产物到 dist/mp-weixin）
// e2e 测试（tests/e2e-web.test.ts）需要真实构建产物 + Chromium，由 npm run test:e2e:web 单独运行
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {},
})
