# API 层代码分割 / 懒加载 / CI 集成

> 对齐 Router M7.1（chunk 分包）+ Pinia M7（按需 hydrate）

## 1. API 层按需加载

API 层整体体积小（主要是适配器和拦截器），但**部分能力域较重**（如 A7 Media、A10 Messaging 依赖原生 SDK），需支持懒加载：

```ts
// 业务层按需引入（不阻塞首屏）
const { media } = await import('@proteus/api/modules/media')
await media.chooseImage()
```

打包策略：
- 核心（`request` / `storage` / `auth` / `navigator`）→ 主包
- P1/P2 能力域 → 各自独立 chunk，按需加载
- App 端原生模块 → Bridge 懒注册（Router M5）

## 2. 适配器动态注册

```ts
// platforms 目录按端拆分，构建时只打包当前端
// vite.config.ts
const platform = process.env.PROTEUS_PLATFORM // 'web' | 'mp' | 'app'
resolve: {
  alias: {
    '@proteus/api/platform': `@proteus/api/platforms/${platform}`,
  },
}
```

→ 小程序包不含 `web/` `app/` 适配器，反之亦然（**tree-shake 彻底**）。

## 3. CI 集成（M7.1 门禁落地）

### 3.1 `proteus audit api`

```yaml
# .github/workflows/api-audit.yml
- name: API Audit
  run: pnpm proteus audit api --strict
```

检查项：
- 业务目录无平台全局引用（`wx.` `tt.` `my.` `fetch(` `localStorage.`）
- 无硬编码域名（应走 `api.configure({ baseURL })`）
- 无 `process.env.X` 直接读取（应走 `api.config`）
- Storage key 有 namespace 前缀
- `await api.xxx` 是否有未处理错误（fire-and-forget 审计）

### 3.2 ESLint 规则（开发期即时反馈）

```js
// .eslintrc.cjs
module.exports = {
  plugins: ['@proteus/eslint-plugin'],
  rules: {
    'proteus/no-platform-api': ['error', {
      zones: [{
        target: 'src/{views,stores,composables,components}/**',
        forbidden: ['wx', 'tt', 'my', 'swan', 'fetch', 'XMLHttpRequest'],
      }],
      allow: ['platforms/**', 'packages/api/**'],
    }],
  },
}
```

### 3.3 与 Pinia / Router 审计合并

统一入口：`proteus audit`（不加子命令时并行跑 `audit store` + `audit route` + `audit api`），一次性报告全部违规。

## 4. 构建产物结构

```
dist/
├── api/
│   ├── core.js          ← request/storage/auth/navigator
│   ├── media.js         ← 懒加载 chunk
│   ├── messaging.js     ← 懒加载 chunk
│   └── share.js         ← 懒加载 chunk
├── platforms/
│   ├── mp/              ← 仅小程序构建时存在
│   ├── web/             ← 仅 Web 构建时存在
│   └── app/             ← 仅 App 构建时存在
└── ...
```

## 5. 分包约束（微信小程序）

- 主包 ≤ 2MB（微信限制），API 核心必须控制在轻量
- A7 Media 等重能力 → 放到分包，使用时 `import()` 触发分包加载
- 适配器代码经 `proteus audit` 确认不误入主包
