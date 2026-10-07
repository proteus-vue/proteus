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

类型契约 `ProteusConfig`（`@proteus-vue/types/config` 单一来源）。**必填 6 项**：`platform` / `skyline` / `appid` / `pagesDir` / `setDataBridge` / `style` + **路由字段**（`routesOutput` / `customRoute`——★#492 在 `router` 段声明，顶层写法为兼容别名），其余可选。

### 顶层字段

| 字段 | 类型 | 必填 | 归属层 | 说明 |
|---|---|---|---|---|
| `platform` | `'mp-weixin' 或 'web'` | 是 | compiler | 目标平台 |
| `skyline` | `boolean` | 是 | compiler | 是否启用 Skyline 渲染（仅 mp-weixin 生效） |
| `appid` | `string` | 是 | build | 小程序 AppID（模板占位 `wx0000000000`，上线前必须替换）。构建期写入 project.config.json / IDE 导入 / automator 体检。**≠ app.config 的 `app.id`**（那是运行时应用标识） |
| `pagesDir` | `string` | 是 | compiler | 页面根目录（主包路由扫描起点），默认 `src/pages` |
| `routesOutput` | `string` | 否 | router | ★#492 已收编 `router.routesOutput`——顶层写法保留为兼容别名 |
| `customRoute` | `object` | 否 | router | ★#492 已收编 `router.customRoute`——顶层写法保留为兼容别名 |
| `subPackages` | `array` | 否 | router | ★#492 已收编 `router.subPackages`——顶层写法保留为兼容别名 |
| `setDataBridge` | `object` | 是 | build | 响应式 → setData 桥接策略，见下表 |
| `style` | `object` | 是 | compiler | 样式换算策略，见下表 |
| `globalStyle` | `string` | 否 | compiler | ★全局样式（MP 端唯一全局入口）：相对 root 的 CSS 文件路径（缺省探测根/应用目录的 `app.wxss`）。见下表 |
| `compiler` | `object` | 否 | compiler | 编译器后端插拔，见下表 |
| `skylineLayout` | `object` | 否 | compiler | Skyline 布局对齐开关（消费官方对齐表），见下表 |
| `profileBoundary` | `object` | 否 | compiler | 编译期 Profile 边界校验（使用了某端不支持的样式即报），见下表 |
| `layout` | `object` | 否 | compiler | 柔性布局编译参数（p-fluid clamp 生成），见下表 |
| `rules` | `object` | 否 | compiler | 编译规则覆盖，见下表 |
| `page` | `object` | 否 | compiler | 页面模式（自动滚动容器 / WebView 降级），见下表 |
| `budget` | `object` | 否 | build | 包体积预算，见下表 |
| `router` | `object` | 否 | router | ★#492 **项目级路由管理**（统一路由配置面：结构 + tabBar + meta），见下表 |
| `vite` | `object 或 函数` | 否 | build | **vite 透传**（★#418）：vite 配置由框架组装（vue/mpTransform/别名/构建参数内建），此字段做开发者扩展——见下表 |
| `audit` | `object` | 否 | build | **D-2 页面门禁规则**（★#447）：off/warn/error 自选——见下表 |
| `gates` | `object` | 否 | build | **统一门禁开关**（★#456）：`gates.disabled` 自选关闭门禁/聚合域——见下表 |
| `native` | `object` | 否 | build | **★★原生项目配置**（★#635）：包名 / Bundle ID / 版本 / SDK / 方向 / 权限 / 图标——由 CLI 渲染进三端原生工程文件，见下表 |

### `vite`（透传——完全兼容 vite）

| 形态 | 说明 |
|---|---|
| 对象 | `{ plugins, server, resolve, build… }`——字段语义与 vite 完全一致（`plugins` 追加在框架插件之后，其余键覆盖框架默认） |
| 函数 | `({ command, mode }) => 对象`——按命令/模式返回不同扩展 |

```ts
// proteus.config.ts
const config: ProteusConfig = {
  // …必填字段…
  vite: {
    server: { port: 5173, open: true },          // dev server 偏好
    resolve: { alias: { '@lib': './src/lib' } }, // 追加别名
    plugins: [myVitePlugin()],                    // 任意 vite 插件
  },
}
```

> 遗留工程若仍持有 `vite.config.ts`，CLI 自动走旧兼容路径（仍可运行）；新工程无需也不该再建 vite.config.ts。

### 子字段明细

**`compiler`（编译器后端插拔）**

| 子字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `backend` | `'node' 或 'rust'` | 否 | 选 `'rust'` 时构建对每个 .vue 跑 Node/Rust **双编译语义等价校验**（G-29.1，不一致构建红）；产物仍由 Node 引擎生成。缺省 `'node'`（零开销）；CLI 可 `proteus build --compiler rust` 临时覆盖 |

**`skylineLayout`（Skyline 布局对齐）**

消费官方《Skyline WXSS 样式支持与差异》的 5 个对齐开关（版本要求见 `docs/generated/css-capability-alignment.json`）——**仅 `defaultDisplayBlock` 默认 `true`**（本仓真机验证过），其余默认**不注入**（未在本仓验证的开关不由框架替项目做主）：

| 子字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `defaultDisplayBlock` | `boolean` | 否 | 节点默认 block 布局，对齐 WebView/Web（表单元素不再被 stretch 占满居中）；**默认 true** |
| `defaultContentBox` | `boolean` | 否 | 默认 `content-box` 盒模型，对齐 Web |
| `tagNameStyleIsolation` | `boolean` | 否 | tag 选择器全局匹配，对齐 WebView（★开发者工具会拒——平台限制） |
| `enableScrollViewAutoSize` | `boolean` | 否 | `scroll-view` 自动撑开 |
| `keyframeStyleIsolation` | `boolean` | 否 | `@keyframes` 样式全局共享 |

**`profileBoundary`（编译期 Profile 边界校验）**

编译期静态校验「使用了某端不支持的样式」——数据源为官方 Skyline 属性支持表的纯枚举（VC2-b）。**Web 端构建同样执行**（否则问题会延迟到 App 端才暴露）。逃生舱：样式块内注释 `proteus-allow-profile: <理由>`（理由非空才生效；豁免计入统计）。

| 子字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `level` | `'error' 或 'warn' 或 'off'` | 否 | 违规级别（缺省 `'error'`——阻断构建） |

**`layout`（柔性布局编译参数）**

| 子字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `designWidth` | `number` | 否 | 设计稿宽度（p-fluid clamp 生成基准） |
| `fluidViewport` | `{ min?, max? }` | 否 | 视口范围（clamp 上下界） |

**`customRoute`（顶层兼容别名——★#492 已收编 `router.customRoute`；wx.router 自定义路由）**

| 子字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `registerPresets` | `boolean` | 否 | 是否注册内置预设 builders（缺省 true） |
| `builders` | `Record<string, string>` | 否 | 预设 builders 注册表：name → 预设源码文件 |

**`setDataBridge`（setData 桥接策略）**

| 子字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `batchWindow` | `number` | 是 | 合并窗口（ms）——窗口内的响应式变更批量推送（16ms 窗口见运行时文档） |
| `perComponent` | `boolean` | 是 | 是否按组件粒度 setData（组件级隔离，避免整页推送） |

**`style`（样式换算）**

| 子字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `px2rpx` | `boolean` | 是 | px → rpx 转换开关（**仅编译期生效**，Web 端永不转换——Web 保持标准 CSS，由编译器吸收差异） |
| `rpxRatio` | `number` | 是 | 换算比例（默认按 375 设计稿 2:1，见 [样式转换](/docs/framework/compile-style)） |

**`globalStyle`（全局样式入口）**

MP 端**唯一全局样式入口**：相对 root 的 CSS 文件路径（缺省探测根/应用目录的 `app.wxss`）。构建期编译（px→rpx）后产出产物根 `app.wxss`（微信自动全局生效）——用于设计 token / 全局重置；Web 端同一文件在入口 import（单源）。★页面级 wxss 各自 scoped，变量无法跨页继承，**故需此全局通道**。

**`subPackages`（顶层兼容别名——★#492 已收编 `router.subPackages`）**

| 子字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `root` | `string` | 是 | 分包根目录（独立扫描树） |
| `name` | `string` | 否 | 分包名（app.json 展示用） |

**`rules`（编译规则覆盖——AI/人改写或禁用规则）**

| 子字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `disabled` | `string[]` | 否 | 禁用的规则 ID 列表（规则 ID 见 `npx proteus rules`） |
| `mapping` | `object` | 否 | 标签映射覆盖 |
| `customTags` | `object` | 否 | 自定义标签注册 |

**`page`（页面模式）**

| 子字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `autoScrollContainer` | `boolean` | 否 | 页面自动包滚动容器（Skyline 页面本身不滚动，滚动必须 scroll-view；默认 `true`） |
| `webviewPages` | `string[]` | 否 | ★Skyline iOS 白屏兜底：把白屏高风险页列出，该页强制走 WebView 渲染（不全局降级），见下方说明 |

> **`page.webviewPages`（页面级 WebView 降级通道）**：Skyline 渲染器在 iOS 真机有已知偶发白屏（微信平台问题，动效/canvas 场景高发）。列出高风险页后，命中页的 `page.json` 不写 `renderer: skyline`，其余页不受影响。键匹配宽松（页面名 `home` / `pages/home` / 分包内相对路径均可）；建议仅对**真机复现过白屏**的页启用，未复现不预先降级。

**`budget`（包体积预算）**

| 子字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `mainPackageKB` | `number` | 否 | 主包体积上限（KB，超限告警/阻断） |
| `strict` | `boolean` | 否 | 严格模式：超限直接构建失败（非仅告警） |

**`router`（★#492 项目级路由管理——路由相关配置唯一声明处）**

> 三项路由结构字段（`routesOutput` / `subPackages` / `customRoute`）已从顶层收编至此；顶层写法保留为向后兼容别名（`router.*` 优先，双处同时声明时构建期提示收敛）。消费方（gen-routes / app 骨架）经 `resolveRouterConfig()` 取生效配置。

| 子字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `routesOutput` | `string` | 否 | 路由表产物路径（编译期 gen-routes 生成；缺省 `src/router/auto-routes.ts`）——与顶层 `routesOutput` 二选一（至少一处声明） |
| `subPackages` | `array` | 否 | 分包配置：`root`（独立扫描树）/ `name`（app.json 展示 + 模块映射），见下表 |
| `customRoute` | `object` | 否 | wx.router 自定义路由，见下表——与顶层 `customRoute` 二选一 |
| `tabBar` | `object` | 否 | tabBar 声明：`color` / `selectedColor` / `list`（`{ name, text, icon? }[]`，`name` 对应路由名）。**未声明时按 meta.isTab 推导**（list 顺序与文案优先） |
| `meta` | `Record<string, RouteMeta>` | 否 | 集中式 meta（决策 #113）：匹配优先级 精确路径 > 目录前缀 > 默认 |

**`audit`（D-2 页面门禁——开发者自选规则级别）**

> D-2（05-dogfooding-conformance）机器化门禁：页面不得裸写平台 API / 手写 `@media` / 引入第三方 UI 库——封装只在框架包，页面零裸写。官网作为「验证场」全规则 `error`；开发者工程可按需把某条降为 `warn`（报告不阻断）或 `off`（不启用）。**关/降级的规则在审计报告明示**——PASS = 启用规则集零违规，未声明的规则一律默认 `error`（fail-closed，防静默关闭）。

| 子字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `dir` | `string` | 否 | 被审计页面目录（相对工程根；缺省 `src`） |
| `rules` | `object` | 否 | 规则 → 级别（未列出的规则默认 `error`） |

`rules` 的四条规则 id（单一来源 `@proteus-vue/types` 的 `AUDIT_RULE_IDS`）：

| 规则 id | 拦什么 | 报告标记 |
|---|---|---|
| `no-third-party-ui` | 引入第三方 UI 库（element-plus/vant/antd/naive-ui/quasar…） | `[D2-UI]` |
| `no-media-query` | 手写 `@media` 断点（响应式归 v-p-fluid clamp + 柔性网格） | `[W-6/C8]` |
| `no-platform-api` | 小程序平台 API 直调（`wx.request` 等） | `[D2-PLATFORM]` |
| `no-web-platform-api` | Web 平台 API 裸调（`window.`/`document.`/`navigator.`/`location.`/`fetch` 等） | `[D2-PLATFORM-WEB]` |

```ts
// proteus.config.ts
const config: ProteusConfig = {
  // …必填字段…
  audit: {
    dir: 'src',
    rules: {
      'no-media-query': 'warn', // 允许手写 @media？降到 warn——报告但不阻断
      'no-web-platform-api': 'off', // 完全不启用 Web 平台裸调检查
      // 其余两条未声明 → 默认 error
    },
  },
}
```

> 豁免登记仍生效：Web 平台规则允许逐行 `// d2-exempt: <原因>` 与整文件标注（原生视觉资产页）——豁免原因随审计报告输出。运行方式：`proteus audit d2`（工程内省略目录参数 → 扫 `audit.dir ?? src`，规则来自本配置）；官网门禁 = `npm run audit:website`。

**`gates`（统一门禁开关——★#456，全部门禁一个配置面）**

> 门禁目录 = `proteus gate ls`（注册表单一来源）。`gates.disabled` 列出要关闭的门禁 id / preset id / 聚合域 id——`proteus gate run`、`proteus check`、`proteus audit all` 统一生效（缺省全部启用；禁用的门禁跳过并注记，不阻断 exit 0）。

| 子字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `disabled` | `string[]` | 否 | 关闭列表：门禁/preset id（`proteus gate ls` 目录：check/audit/d2/fluid/api-check/capabilities/i18n/router/module/css/style/config/components/coverage/devtools-budget…）+ 聚合域 id（audit 十域：route/module/config/i18n/capabilities/components/d2/api-check/fluid/devtools-budget · check：css/style/router/cli/app-config） |

```ts
// proteus.config.ts
const config: ProteusConfig = {
  // …必填字段…
  gates: {
    disabled: ['capabilities', 'devtools-budget'], // 演示页违规域与性能烟测暂不纳入门禁
  },
}
```

> 语义分层：`audit.rules` 管 **D-2 内部规则级别**（off/warn/error）；`gates.disabled` 管 **门禁/聚合域开关**（整域跳过）——两层可叠加。

**`native`（★★原生项目配置——★#635，把原生工程身份传给构建链）**

把**原生工程身份**（包名 / Bundle ID / 版本 / SDK / 方向 / 权限 / 图标）从项目传给构建链——CLI 在 `proteus create host` 与 `proteus build --target <端> --package` 时**渲染进**宿主工程的原生文件（此前这些值硬编码在宿主工程里，项目侧只能手改）：

| 字段 | 目标文件 | 说明 |
|---|---|---|
| `native.app.{name,version,buildNumber}` | 各端 · 共享 | 缺省回退 app.config 的 `app.*`（运行期身份，二者可互为镜像） |
| `native.android.{applicationId,label,versionName,versionCode,minSdk,targetSdk,orientation,permissions,icon}` | `AndroidManifest.xml` | applicationId 缺省 = 宿主运行时同包；activity 用 FQN 以便换包 |
| `native.ios.{bundleId,displayName,version,buildNumber,minimumOSVersion,deviceFamily,orientations}` | `Info.plist` | |
| `native.harmony.{bundleName,label,vendor,versionName,versionCode,compatibleSdkVersion,targetSdkVersion,deviceTypes,permissions}` | `AppScope/app.json5` + `entry/module.json5` + `string.json` | bundleName 也是**签名绑定**的键（换它要换 profile） |

```ts
// proteus.config.ts
const config: ProteusConfig = {
  // …必填字段…
  native: {
    app: { name: 'MyApp', version: '1.2.3', buildNumber: '45' },
    android: { applicationId: 'com.acme.myapp', orientation: 'portrait', minSdk: 26, permissions: ['android.permission.INTERNET'] },
    ios: { bundleId: 'com.acme.myapp', deviceFamily: [1], orientations: ['portrait'] },
    harmony: { bundleName: 'com.acme.myapp', deviceTypes: ['phone'] },
  },
}
```

> **职责边界（G-35.1）**：`native` = **构建期**（CLI 消费，写原生文件）；app.config 的 `app.*` = **运行期**（业务读取/上报）。缺值回退，但边界不变。**字段级补丁**：只改身份字段、保留工程其余内容（手改过的布局/能力不受影响）；**幂等**（重复应用结果一致）。

### 校验与工具

```bash
proteus config:check proteus.config.ts   # 必填字段 + 跨层依赖（CONFIG_LAYER_VIOLATION）+ 版本迁移提示
proteus generate types                    # 生成 JSON Schema（.proteus/proteus.config.schema.json，IDE 补全）
```

> ★#492 存量工程迁移：顶层 `routesOutput` / `subPackages` / `customRoute` 写法继续可用（向后兼容，双处同时声明时 `router.*` 优先并在构建期提示）；新工程直接在 `router` 段声明（create-proteus 模板已是统一形态）。配置版本 v3：显式声明 `version: 2` 的工程由迁移链自动收编。

字段归属表（compiler / router / build / pinia…）由 `CONFIG_FIELD_LAYERS` 单一来源驱动：**新增顶层字段必须标注归属层**，跨层语义（如 router 字段里写 pinia 键）报 `CONFIG_LAYER_VIOLATION`。

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
| `isTab` | `boolean` | 否 | 是否 tab 页（tabBar.list 由 proteus.config 的 `router.tabBar` 声明） |
| `requiresAuth` | `boolean` | 否 | 登录守卫（路由跳转前校验） |
| `permissions` | `string[]` | 否 | 权限守卫（格式 `resource:action`，security M3） |
| `transition` | `'slideUp' 或 'slideDown' 或 'halfScreen' 或 'scaleDown' 或 'none'` | 否 | 转场动画 |
| `[key: string]` | `unknown` | 否 | 任意扩展字段（仅 JSON 可序列化——业务自定义守卫读取） |

集中式 meta（`proteus.config.ts` 的 `router.meta`）与页面 `<route>` 就近声明**可并存**：匹配优先级 精确路径 > 目录前缀 > 默认；显式声明永远优先。

## 省略也合法

`<route>` 块完全可选——`path` / `name` 从文件位置推导（`pages/user/profile.vue` → path `pages/user/profile`、name `user-profile`；`index.vue` 归并为目录路径），无块页面也收录。**显式声明永远优先。**

## 下一步

- [运行时配置 app.config](/docs/11-app-config)：运行时配置的字段全表与 useAppConfig
- [路由与导航](/docs/16-router)：路由树与按端 codegen 的完整模型
- [CLI 与工程命令](/docs/28-cli)：`proteus` 命令行全家桶
