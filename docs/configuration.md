# 配置参考（proteus.config.ts）

> Proteus 采用**约定优于配置**：路由、分包、转场预设从目录结构与配置推导，编译期生成 `app.json` / `page.json` / 路由表。框架统一配置在项目根目录 `proteus.config.ts`。

## 完整字段

```typescript
// proteus.config.ts
export interface ProteusConfig {
  /** 目标平台 */
  platform: 'mp-weixin' | 'web'
  /** 是否启用 Skyline 渲染（仅 mp-weixin 生效） */
  skyline: boolean
  /** 小程序 AppID */
  appid: string
  /** 页面根目录（主包路由扫描起点） */
  pagesDir: string
  /** 路由输出文件（编译期生成，勿手动编辑） */
  routesOutput: string
  /** 分包配置（可选）：root 相对项目根目录，如 'src/subpackages/order' */
  subPackages?: Array<{ root: string; name?: string }>
  /** wx.router 自定义路由配置 */
  customRoute: {
    /** 是否注册内置预设路由（wx://bottom-sheet 等） */
    registerPresets: boolean
    /** 内置预设 builders 注册表：name → 预设源码文件（由 mp-transform 插件内联进 app.js 注册） */
    builders: Record<string, string>
  }
  /** 响应式 → setData 桥接策略 */
  setDataBridge: {
    /** 批量合并窗口（ms），防止高频更新风暴 */
    batchWindow: number
    /** 是否按组件粒度收集脏数据 */
    perComponent: boolean
  }
  /** 样式换算策略（跨端 CSS 一致性） */
  style: {
    /** MP 端是否 px → rpx（仅编译期生效，Web 端永不转换） */
    px2rpx: boolean
    /** px→rpx 比例，默认 2 */
    rpxRatio: number
  }
}
```

## 示例配置（当前仓库默认值）

```typescript
const config: ProteusConfig = {
  platform: 'mp-weixin',
  skyline: true,
  appid: 'wx0000000000', // 使用者替换为真实 AppID
  pagesDir: 'examples/pages',
  routesOutput: 'src/router/auto-routes.ts',
  subPackages: [{ root: 'examples/subpackages/order', name: 'order' }],
  customRoute: {
    registerPresets: true,
    builders: {
      halfScreen: 'src/router/presets/halfScreen.ts',
      slideUp: 'src/router/presets/slideUp.ts',
      scaleDown: 'src/router/presets/scaleDown.ts',
    },
  },
  setDataBridge: {
    batchWindow: 16, // ~1 帧
    perComponent: true,
  },
  style: {
    px2rpx: true,
    rpxRatio: 2,
  },
}
```

## 字段说明

### platform / skyline

- `platform: 'mp-weixin'`：当前主目标平台。`vite build --mode web` 或 `--mode mp-weixin` 可覆盖。
- `skyline: true`：页面默认以 Skyline 渲染（`page.json` 写 `"renderer": "skyline"`），并启用 `wx.router` 自定义路由。关闭则退回 WebView 渲染（仅保证可运行，不保证视觉一致）。

### appid

微信小程序 AppID，用于开发者工具导入与真机预览。默认占位 `wx0000000000`，**使用前必须替换**。

### pagesDir / routesOutput

- `pagesDir`：主包页面扫描起点。`scripts/gen-routes.ts` 递归扫描其中所有 `.vue`，按目录结构推导路由（`pages/user/index.vue` → 命名路由 `user`）。
- `routesOutput`：编译期生成的路由表输出路径（默认 `src/router/auto-routes.ts`），**勿手动编辑**。

### subPackages

```typescript
subPackages: [{ root: 'examples/subpackages/order', name: 'order' }]
```

- `root`：分包根目录（相对项目根）。其中的页面路径自动带 `root` 前缀（如 `subpackages/order/pages/list`）。
- `name`：分包名（可选，对应 `app.json` 的 `subPackages[].name`）。
- 主包 / 分包体积限制（主包 ≤ 2MB）由微信平台约束，分包可突破。

### customRoute（自定义路由转场）

```typescript
customRoute: {
  registerPresets: true,
  builders: {
    halfScreen: 'src/router/presets/halfScreen.ts',
    slideUp: 'src/router/presets/slideUp.ts',
    scaleDown: 'src/router/presets/scaleDown.ts',
  },
}
```

- `registerPresets: true`：注册微信官方预设（`wx://bottom-sheet` 等）。
- `builders`：**内置预设注册表**，`name → 预设源码文件`。插件构建时把列出的预设源码**内联进 `app.js`** 并调用 `wx.router.addRouteBuilder(name, fn)` 注册——开发者无需手写注册代码。
- 手写覆盖：在 `examples/main.mp.ts`（应用入口，直出为 `app.js`）中同名 `wx.router.addRouteBuilder('halfScreen', ...)` 即可覆盖预设（插件检测同名后跳过自动注册，开发者优先）。
- **极简模式（★默认）**：`main.mp.ts` **不需要写 `App()` / `onLaunch` / 调试日志 / 错误捕获 / 预设注册**——app 骨架由框架自动生成（`src/runtime/appSkeleton.ts`，插件检测到入口不含 `App(` 时自动拼装），开发者只写自定义 builder；如需完全自定义 app 生命周期，写含 `App()` 的完整入口即可（全量模式，插件尊重原样）。
- 自定义新 builder：在 `main.mp.ts` 中编写具名函数 + `addRouteBuilder`（平台约束：同一文件内静态可分析，不得 import 其它模块）。
- 预设源码遵循微信 `RouteBuilder` 契约（`opaque` / `barrierColor` / `handlePrimaryAnimation` worklet 等），类型见 `src/shims/mp.d.ts`。

### setDataBridge（响应式 → setData 桥接）

- `batchWindow: 16`：高频更新合并窗口（约 1 帧）。页面内多次 `ref` 写入在窗口内合并为一次 `setData`，避免更新风暴。
- `perComponent: true`：按组件粒度收集脏路径（路径合并 + 值比较去重），减少小程序端渲染开销。

### style（跨端 CSS 一致性）

- `px2rpx: true`：小程序编译期把 CSS 中的 `px` 换算为 `rpx`（**仅编译期生效**，Web 端永不转换——Web 端保持标准 CSS，由编译器吸收差异）。
- `rpxRatio: 2`：px→rpx 比例，默认 2（对应 iPhone6 375px = 750rpx 基准）。
- 注意：`h1-h6/p/a` 的语义基础样式直接以 rpx / em 书写，不受此换算影响。

### rules（★规则覆盖：底线循环 ①③）

> **这是框架的底线能力之一**：改配置即改变编译行为，无需改框架代码。可用规则 ID 由 `listTransformRules()` 枚举（或见 `src/compiler/transforms/`）。

```typescript
rules: {
  disabled: ['directive/v-show-limit'],              // 禁用规则（对应输出退化为无转换 + 编译期警告）
  mapping: { 'tag/link-to-view': { a: 'text' } },    // 改写映射（a → text 而非默认 view）
  customTags: { 'my-widget': 'view' },               // 新增标签映射（AI 扩展新标签的入口）
}
```

- `disabled`：规则 ID 列表。支持 template（`tag/*` / `directive/*` / `event/*` / `nav/*` / `semantic/base-class`）、style（`style/*`）、script（`script/const-to-data` / `script/*-to-methods` / `script/lifecycle-map` / `script/ref-*` / `script/vmodel-handler` / `script/nav-handler` / `script/onload-params`）。
- `mapping`：按规则 ID 覆盖映射表——`tag/*` → 标签映射；`event/click-to-tap` → 事件映射；`semantic/base-class` → 语义基础类。值合并进 `tags.ts` 常量（customTags 优先级最高）。未知规则 ID 编译期警告（防笔误）。
- `customTags`：新增 HTML 标签 → 小程序标签。配合 `tag/unknown-kebab` 的逃生舱语义，AI 可随时扩展新标签而不动框架源码。
- 示例页配套：`examples/pages/showcase.vue` 的 `<demo-box>` 标签演示（config 中取消注释 `customTags: { 'demo-box': 'view' }` 即生效，重新 `npm run build:mp` 即可看到 WXML 变为 `<view>`）。

## 修改配置后

```bash
npm run build:mp   # 重新生成 app.json / page.json / 路由表
```

配置是编译期读取的，改完需重新构建。
