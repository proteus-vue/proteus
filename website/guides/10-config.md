---
title: 编译器配置与页面配置
order: 10
group: 代码构成
---

# 编译器配置与页面配置

Proteus 的配置分**两个正交的面**，由**消费时机**划定边界（决策 #211）：构建期消费的字段进 `proteus.config.ts`，运行时消费的进 `app.config.ts`。

| 配置面 | 文件 | 时机 | 管什么 | 消费方 |
|---|---|---|---|---|
| **编译器配置** | `proteus.config.ts` | **构建期** | 怎么构建：目标端 / 编译规则 / 样式换算 / 路由扫描 / 原生工程身份 | 编译器、CLI、Vite 插件 |
| **运行时配置** | `app.config.ts` | **运行时** | 怎么表现：应用标识 / API 地址 / 功能开关 / 主题字体 | 业务代码（`useAppConfig`） |

> 一句话：**`proteus.config` = 编译器配置（构建期固化，改完需重新构建）；`app.config` = 运行时配置（启动读取 + 可选远端热更新）**。

本页讲**编译器配置**与**页面配置**（页面 `<route>` 块——管单个页面的元信息，同样由**编译期**的 `gen-routes` 消费）；运行时配置见 [运行时配置 app.config](/docs/11-app-config)。

## 编译器配置：proteus.config.ts

类型契约 `ProteusConfig`（`@proteus-vue/types/config` 单一来源）。★**v4（决策 #641）按端分区**：目标端是一级键 `targets.{web,mp,ios,android,harmony}`，每个端自持配置（含原生工程身份）；**跨端共享面**留在顶层。

```ts
// proteus.config.ts（v4）
export default {
  version: 4,
  targets: {
    web:     { output: 'dist' },
    mp:      { appid: 'wx…', renderer: 'skyline' },
    ios:     { bundleId: 'com.acme.app' },
    android: { applicationId: 'com.acme.app', minSdk: 26 },
    harmony: { bundleName: 'com.acme.app' },
  },
  pagesDir: 'src/pages',
  router: { routesOutput: 'src/router/auto-routes.ts' },
}
```

> **为什么按端分区**：旧模型把小程序/Skyline 专属字段平铺在顶层（`skyline`/`appid`/`setDataBridge`/`style.px2rpx`/`page`/`globalStyle`/`rules`…），那是「小程序编译器」时代的形状；且旧的 `platform: 'mp-weixin' | 'web'` 二选一根本表达不了 App 三端。目标端成为一级键后，各端配置不再互相污染，**目标端真源 = CLI `--target`**。
>
> **迁移**：v3 旧配置（平铺形态）在加载期**自动迁移**（`resolveProteusConfig`），无需手改即可继续构建；`proteus migrate types` 可注入 `version: 4` 标记。

### 顶层字段（跨端共享）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `version` | `number` | 否 | 配置 schema 版本（v4 起为 4；显式 `<4` 时加载期自动迁移） |
| `targets` | `ProteusTargets` | **是** | 目标端集合（键 = `web` / `mp` / `ios` / `android` / `harmony`），至少声明一个 |
| `pagesDir` | `string` | **是** | 页面根目录（主包路由扫描起点），默认 `src/pages` |
| `app` | `{ name?, version?, buildNumber? }` | 否 | **共享应用身份**（构建期写进各端原生工程文件；缺省回退 app.config 的 `app.*`） |
| `router` | `RouterSection` | 否 | ★#492 **项目级路由管理**（路由相关配置唯一声明处）：结构 + tabBar + pages |
| `compiler` | `object` | 否 | 编译器后端插拔（`backend: 'node' \| 'rust'`） |
| `layout` | `object` | 否 | 柔性布局编译参数（`designWidth` / `fluidViewport`） |
| `budget` | `object` | 否 | 包体积预算（`mainPackageKB` / `strict`） |
| `vite` | `object 或 函数` | 否 | **vite 透传**（★#418）：vite 配置由框架组装，此字段做开发者扩展 |
| `audit` | `object` | 否 | **D-2 页面门禁规则**（★#447）：off/warn/error 自选 |
| `gates` | `object` | 否 | **统一门禁开关**（★#456）：`gates.disabled` 自选关闭门禁/聚合域 |

### `targets` 各端

**`targets.web`（浏览器 SPA）**

| 子字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `output` | `string` | 否 | 构建产物输出目录（缺省由框架推导 `dist/web`） |

**`targets.mp`（微信小程序 · Skyline / WebView 同一管线）**

| 子字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `appid` | `string` | **是** | 小程序 AppID（构建期写 project.config.json / IDE 导入 / automator 体检）。**≠ app.config 的 `app.id`** |
| `renderer` | `'skyline' 或 'webview'` | 否 | 渲染器（★取代旧顶层 `skyline: boolean`；缺省 `'skyline'`） |
| `style` | `{ px2rpx?, rpxRatio? }` | 否 | 样式换算（MP 专属；缺省 `px2rpx: true` / `rpxRatio: 2`）。Web 端永不换算 |
| `setDataBridge` | `{ batchWindow?, perComponent? }` | 否 | 响应式 → setData 桥接策略（缺省 16ms / 按组件粒度） |
| `globalStyle` | `string` | 否 | ★全局样式（MP 端**唯一全局入口**）：相对 root 的 CSS 文件（缺省探测 `app.wxss`），构建期编译后产出产物根 `app.wxss` |
| `page` | `{ autoScrollContainer?, webviewPages? }` | 否 | 页面模式：自动包滚动容器（缺省 true）；`webviewPages` = Skyline iOS 白屏兜底（页面级 WebView 降级） |
| `skylineLayout` | `object` | 否 | Skyline 布局对齐开关（见下） |
| `profileBoundary` | `{ level? }` | 否 | 编译期 Profile 边界校验（`'error' \| 'warn' \| 'off'`，缺省 `error`） |
| `rules` | `object` | 否 | 编译规则覆盖（`disabled` / `mapping` / `customTags`） |

**`targets.mp.skylineLayout`（Skyline 布局对齐）**

消费官方《Skyline WXSS 样式支持与差异》的 5 个对齐开关——**仅 `defaultDisplayBlock` 默认 `true`**（本仓真机验证过），其余默认**不注入**（未在本仓验证的开关不由框架替项目做主）：

| 子字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `defaultDisplayBlock` | `boolean` | 否 | 节点默认 block 布局，对齐 WebView/Web；**默认 true** |
| `defaultContentBox` | `boolean` | 否 | 默认 `content-box` 盒模型，对齐 Web |
| `tagNameStyleIsolation` | `boolean` | 否 | tag 选择器全局匹配（★开发者工具会拒——平台限制） |
| `enableScrollViewAutoSize` | `boolean` | 否 | `scroll-view` 自动撑开 |
| `keyframeStyleIsolation` | `boolean` | 否 | `@keyframes` 样式全局共享 |

**`targets.ios`（→ Info.plist）**

| 子字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `bundleId` | `string` | 否 | CFBundleIdentifier（缺省 = 宿主默认 bundle id） |
| `displayName` | `string` | 否 | CFBundleDisplayName（缺省回退 `app.name`） |
| `version` / `buildNumber` | `string` | 否 | CFBundleShortVersionString / CFBundleVersion（缺省回退 `app.*`） |
| `minimumOSVersion` | `string` | 否 | 最底系统版本（缺省 15.0） |
| `deviceFamily` | `number[]` | 否 | UIDeviceFamily（1=iPhone / 2=iPad；缺省 `[1]`） |
| `orientations` | `string[]` | 否 | 支持方向（缺省 `['portrait']`） |

**`targets.android`（→ AndroidManifest.xml）**

| 子字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `applicationId` | `string` | 否 | applicationId / package（缺省 = 宿主运行时同包） |
| `label` | `string` | 否 | 桌面/应用名（缺省回退 `app.name`） |
| `versionName` / `versionCode` | `string` / `number` | 否 | 版本（缺省回退 `app.*`） |
| `minSdk` / `targetSdk` | `number` | 否 | SDK 范围（缺省 24 / 34） |
| `orientation` | `'portrait' \| 'landscape' \| 'unspecified'` | 否 | 屏幕方向（缺省 unspecified） |
| `permissions` | `string[]` | 否 | 追加 `<uses-permission>` |
| `icon` | `string` | 否 | 应用图标资源名（缺省不写） |

**`targets.harmony`（→ AppScope/app.json5 + entry/module.json5 + string.json）**

| 子字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `bundleName` | `string` | 否 | bundleName（缺省 = 宿主默认）——也是**签名绑定**的键（换它要换 profile） |
| `label` | `string` | 否 | 应用名（缺省回退 `app.name`） |
| `vendor` | `string` | 否 | vendor（缺省 proteus） |
| `versionName` / `versionCode` | `string` / `number` | 否 | 版本（缺省回退 `app.*`） |
| `compatibleSdkVersion` / `targetSdkVersion` | `string` | 否 | SDK（缺省 `5.0.5(17)`） |
| `deviceTypes` | `string[]` | 否 | 设备类型（缺省 `["phone","tablet","2in1"]`） |
| `permissions` | `string[]` | 否 | 追加 requestPermissions |

> **原生工程身份的注入**：`targets.{ios,android,harmony}` 的字段由 CLI（`proteus create host` / `proteus build --target <端> --package`）**渲染进**宿主工程的原生文件——此前它们硬编码在宿主工程里。**职责边界（G-35.1）**：`targets.*` = 构建期（写原生文件）；app.config 的 `app.*` = 运行期（业务读取）。缺值回退，但边界不变。

### `router`（★#492 项目级路由管理——路由相关配置唯一声明处）

> 跨端共享。旧顶层 `routesOutput` / `subPackages` / `customRoute` 已收编至此（顶层写法为兼容别名，`router.*` 优先）。

| 子字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `routesOutput` | `string` | 否 | 路由表产物路径（编译期 gen-routes 生成；缺省 `src/router/auto-routes.ts`；`''` = 显式关闭） |
| `subPackages` | `array` | 否 | 分包配置：`root`（独立扫描树）/ `name`（app.json 展示 + 模块映射） |
| `customRoute` | `object` | 否 | wx.router 自定义路由（`registerPresets` / `builders`） |
| `tabBar` | `object` | 否 | tabBar 声明：`color` / `selectedColor` / `list`（`{ name, text, icon? }[]`）。未声明时按 `isTab` 推导 |
| `pages` | `Record<string, RouteMeta>` | 否 | **页面配置**（`pages.json` 等价物）：每页的 title / isTab / 转场 / 守卫；`meta` 为同义旧名 |

### `compiler` / `layout` / `budget` / `vite` / `audit` / `gates`

| 字段 | 子字段 | 说明 |
|---|---|---|
| `compiler` | `backend` | `'node'`（缺省）或 `'rust'`（构建对每个 .vue 跑 Node/Rust 双编译语义等价校验） |
| `layout` | `designWidth` / `fluidViewport` | 柔性布局 p-fluid clamp 生成参数 |
| `budget` | `mainPackageKB` / `strict` | 主包体积上限（KB）/ 超限直接失败 |
| `vite` | 对象或函数 | vite 透传（`plugins` 追加、`resolve.alias` 拼接、`build` 深合并） |
| `audit` | `dir` / `rules` | D-2 门禁（`no-third-party-ui` / `no-media-query` / `no-platform-api` / `no-web-platform-api`，off/warn/error） |
| `gates` | `disabled` | 关闭的门禁 / preset / 聚合域 id 列表 |

### 校验与工具

```bash
proteus config:check proteus.config.ts   # 归一(v4) + 必填字段 + 跨层依赖（CONFIG_LAYER_VIOLATION）+ 迁移提示
proteus generate types                    # 生成 JSON Schema（.proteus/proteus.config.schema.json，IDE 补全）
proteus migrate types proteus.config.ts   # 存量配置迁移（注入 version: 4；形状由运行时归一）
```

## 页面配置：`<route>` 块

每个页面用 `<route>` 自定义块就近声明元信息，`gen-routes` 在编译期读取：

```vue
<!-- src/pages/user/profile.vue -->
<route>
{
  "name": "user-profile",
  "meta": { "title": "个人资料", "requiresAuth": true, "transition": "slideUp" }
}
</route>
```

### `meta` 字段（RouteMeta，`@proteus-vue/contracts` 单一来源）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `title` | `string` | 否 | 导航栏标题 |
| `isTab` | `boolean` | 否 | 是否 tab 页（tabBar.list 由 `router.tabBar` 声明） |
| `requiresAuth` | `boolean` | 否 | 登录守卫（路由跳转前校验） |
| `permissions` | `string[]` | 否 | 权限守卫（格式 `resource:action`，security M3） |
| `transition` | `'slideUp' 或 'slideDown' 或 'halfScreen' 或 'scaleDown' 或 'none'` | 否 | 转场动画 |
| `[key: string]` | `unknown` | 否 | 任意扩展字段（仅 JSON 可序列化——业务自定义守卫读取） |

集中式页面配置（`proteus.config.ts` 的 `router.pages`）与页面 `<route>` 就近声明**可并存**：匹配优先级 精确路径 > 目录前缀 > 默认；显式声明永远优先。

## 省略也合法

`<route>` 块完全可选——`path` / `name` 从文件位置推导（`pages/user/profile.vue` → path `pages/user/profile`、name `user-profile`；`index.vue` 归并为目录路径），无块页面也收录。**显式声明永远优先。**

## 下一步

- [运行时配置 app.config](/docs/11-app-config)：运行时配置的字段全表与 useAppConfig
- [路由与导航](/docs/16-router)：路由树与按端 codegen 的完整模型
- [CLI 与工程命令](/docs/28-cli)：`proteus` 命令行全家桶
