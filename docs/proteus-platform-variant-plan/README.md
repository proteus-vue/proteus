# Proteus 平台变体解析（工程架构基础层）

> **状态**：已落地（四层全覆盖，双端 + 真机验证）
> **关联**：`packages/compiler/src/platform-variant.ts`（解析器 SSOT）· `packages/plugin-vite/src/plugin.ts`（MP 通道）· `packages/plugin-vite/src/vite-config.ts`（Web 通道）· `packages/router/src/variant.ts`（路由/组件）· `showcase/subpackages/components/pages/platform-variant*.vue`（演示）
> **一句话**：**不是 C 式条件编译（`#ifdef`），是 Go 式文件级分叉**——同一位置按平台放不同文件，构建期解析选一个。差异可见、各自类型检查、死文件不进产物。

---

## 1. 问题定性：为什么 `#ifdef` 会变成打地鼠

真实场景确实存在「同一位置，不同平台放不同东西」：不同内容、不同静态资源、不同页面。
uni-app 用 `#ifdef` 处理——**一个文件里塞 N 个平台分支**。这有三个结构性缺陷：

| 缺陷 | 后果 |
|------|------|
| 差异埋在同文件内 | 靠搜注释才能找到分叉；`ls` 看不出差异 |
| 预处理块对工具不可见 | TS/ESLint/IDE 看不到块内代码 → 无类型检查、无补全 |
| 分支共居互相污染 | 改 A 平台的块可能影响 B；diff 里平台差异与非差异混在一起 |

**打地鼠的机制**：`#ifdef` 把「机械差异」与「产品差异」收敛成同一种语法 → 所有差异看起来都像分支 → 到处都是 → 不可管理。

## 2. 优雅形态：文件级分叉（Go 式）

Go 的机制不是"条件编译功能"，而是**文件解析规则**（`foo_linux.go` / `foo_windows.go`）。平台上无分支语法可撒，故不会失控。

Proteus 采用同一形态，**统一覆盖四层**：

```
引用 "X" ──► 构建期查 "X.<platform>.<ext>" 存在？ → 用变体
                                    否 → 用 "X.<ext>"（共享基准）
```

业务代码**全程不出现平台名**。

| 层 | 业务写（零平台名） | 变体文件 |
|---|---|---|
| **1 业务代码** | `import { X } from './platform-info'` | `platform-info.web.ts` / `platform-info.mp.ts` / `platform-info.ts`(基准) |
| **2 组件/页面** | `<LoginForm />` 或路由指向 `page.vue` | `page.web.vue` / `page.mp.vue` / `page.vue`(基准) |
| **3 静态资源** | `<image src="/assets/logo.png">` | `logo.web.png` / `logo.mp.png` / `logo.ios.png` / `logo.native.png` / `logo.png`(基准) |
| **4 路由** | `<route> { platforms: ["mp"] }` | 构建期按白名单收录/剔除（泛化 `webOnly`） |
| **5 CSS 样式** | `<style src="./theme.css">` | `theme.web.css` / `theme.mp.css` / `theme.css`（含 scss/less 变体） |

## 3. 命名规范：两级平台模型

**单一 `native` 太粗**——iOS / Android / 鸿蒙是**完全不同的操作系统**（渲染体系、原生控件、资源格式都不同）。
小程序端同理有多厂商。故采用**两级模型**：

```
具体平台（ConcretePlatform）  web | mp | ios | android | harmony     ← 变体后缀可精确到 OS
平台族（PlatformFamily）      web | mp | native                      ← 可作后缀，回退给族内全部
```

**解析顺序**：`具体平台变体 → 族变体 → 共享基准`

```
settings.ios.ts      仅 iOS       （优先）
settings.native.ts   三端原生共用  （iOS 无专属时命中）
settings.ts          共享基准
```

于是既可写 `button.ios.ts`（iOS 专属），也可写 `button.native.ts`（三端原生共用一份）——
**按需选择粒度，不必为三端各写一份**。

### 与框架既有口径对齐（重要）

| 既有体系 | 取值 | 本方案 |
|---|---|---|
| `BackendId`（渲染后端） | `native-ios` / `native-android` / `native-harmony` | 归一为 `ios` / `android` / `harmony` |
| CLI `TARGETS` | `web` / `skyline` / `ios` / `android` / `harmony` | 直接对应 |
| `app-config` 的 `Platform` | `mp-weixin` / `web` / `ios` / `android` / `harmony` | `mp-weixin`→`mp` |
| `__TARGET__`（宏） | 本方案统一为 `'web'|'mp'|'ios'|'android'|'harmony'|'native'` | 同源 |

**别名兼容**（旧名保留）：`skyline`→mp、`mp-weixin`→mp、`app`→native、`native-ios`→ios、`native-android`→android、`native-harmony`→harmony。
故旧规划文档承诺的 `*.skyline.ts` / `*.app.ts` **仍可用**。

**文件后缀取无连字符形态**（`web`/`mp`/`skyline`/`ios`/`android`/`harmony`/`native`/`app`）——`a.web.config.ts` 的 `.web` 是业务名，不会被误拆。

### 对应宏（`platform-macros.ts`，同一模型）

| 宏 | 语义 | web | mp | ios | android | harmony |
|----|------|-----|----|-----|---------|---------|
| `__WEB__` | 仅 Web | ✅ | | | | |
| `__MP__` | 仅小程序 | | ✅ | | | |
| `__IOS__` / `__ANDROID__` / `__HARMONY__` | 精确到 OS | | | ✅ | ✅ | ✅ |
| `__NATIVE__` **族** | 任一端原生 | | | ✅ | ✅ | ✅ |
| `__TARGET__` | 当前目标字符串 | `'web'` | `'mp'` | `'ios'` | `'android'` | `'harmony'` |

`__NATIVE__` 是族宏：写一次覆盖 iOS/Android/鸿蒙，无需三处判断。

## 4. 实现（两条构建通道，同源解析器）

```
packages/compiler/src/platform-variant.ts  ← 解析规则 SSOT（纯函数）
  splitVariant / variantCandidates / resolvePlatformVariant(WithExts)
  effectiveVariants（扫描去重）/ mapPublicAssetVariants（资源）/ pickVariant
        │
  ┌─────┴──────────────────────────────┐
  │ MP 通道（自定义编译器 + 目录扫描）    │ Web 通道（标准 Vite）
  │ · collectMpEntries: effectiveVariants│ · platformVariantPlugin(resolveId, pre)
  │   → 他端变体不编译、产物 rel 去后缀   │   → 相对/@ 导入解析到 web 变体
  │ · resolveSharedModule: 变体优先      │ · platformPublicAssetsPlugin(generateBundle)
  │ · public 资源: mapPublicAssetVariants│   → public 变体按 web 解析
  │ · gen-routes: 页面变体去重 + platforms│ · RouterView: resolveVariantComponentKey
  │ · <style src>: loadStyleSrcWithVariant │ · resolveId 处理 ?query（vue style 子请求）
  └────────────────────────────────────┘
```

**关键约束**（实测确立）：

| # | 约束 | 原因 |
|---|------|------|
| V1 | 路由表 `component` 必须写**基准路径** | 路由表 Web/MP 共享；写变体路径会让 Web import 到 MP 变体（跨端串味） |
| V2 | 变体文件**产物路径去后缀**（`page.mp.vue` → `pages/page`） | 否则同名逻辑被当成两个页面/路由 |
| V3 | 扫描期须**排除他端变体**（`effectiveVariants`） | 否则 `page.web.vue` 在 MP 构建也被编译 |
| V4 | public 含变体时须关 Vite 默认逐字拷贝 | 默认会把他端变体也拷进产物 |
| V5 | 变体后缀须在**末扩展名前**且命中已知 id | 否则 `a.web.config.ts` 被误拆（其 `.web` 是业务名） |
| V6 | CSS：MP 走 `loadStyleSrc` 钩子（编译器无 fs）；Web 走 resolveId 且**须剥离 `?query`** | vue 插件为 `<style src>` 生成带 query 的子请求；不剥离则变体解析落空 → ENOENT |
| V7 | `<style src>` 此前被**静默忽略** | 加载失败现显式告警（不静默丢样式） |

## 5. 证据（showcase 落地，2026-09-13）

页面 `subpackages/components/pages/platform-variant`（含 `.mp.vue` 变体）：

| 层 | 检查项 | MP 产物 | Web 产物 |
|----|--------|---------|----------|
| 1 | 生效的实现文件 | `shared/platform-info.mp.js` | platform-info.web（入 bundle） |
| 1 | 文案 | 「微信小程序」 | 「Web 浏览器」 |
| 1 | 是否含他端文案 | ❌ 0 | ❌ 0 |
| 2 | 页面内容 | `platform-variant.mp.vue`（小程序专属页 + 客服会话） | 基准（共享基准） |
| 2 | 产物路径 | `pages/platform-variant.*`（无 `.mp`） | 基准路径 |
| 3 | 资源 | `assets/variant-chip.svg`（绿 #07c160「小程序资源」） | 同路径（紫 #7c5cff「Web 资源」） |
| 4 | `platforms:["mp"]` 页 | app.json 收录 + 编译产物 | **路由表过滤 → 404** |
| 5 | CSS（`<style src>`） | `.variant-card` → 绿 #e8f8ee / 26rpx | 同选择器 → 紫 #f3efff / 13px |

**两级模型端到端验证**（真实文件系统，`s.ts` / `s.ios.ts` / `s.native.ts` / `s.android.ts`）：

| 目标 | 解析结果 | 说明 |
|------|----------|------|
| `ios` | `s.ios.ts` | 具体平台优先 |
| `android` | `s.android.ts` | |
| `harmony` | `s.native.ts` | **族回退**（无 harmony 专属 → 落 native） |
| `web` | `s.ts` | 共享基准 |
| 资源 `ios` | `logo.ios.png` → `logo.png` | 产物去后缀 |

**真机**：MP 模拟器截图确认四层全部按小程序解析。

**测试**：`tests/platform-variant.test.ts`（22 用例）+ `tests/platform-variant-router.test.ts`（8 用例）。

## 6. 与 `v-if="__MP__"`（编译期宏）的分工

两层各司其职，**不是替代关系**：

| | 平台变体文件（本方案） | 编译期宏 `v-if="__MP__"` |
|---|---|---|
| 适用 | **结构性差异**（不同内容/资源/页面/整块 UI） | **内联微小差异**（一个属性、一句文案） |
| 形态 | N 个文件，构建期选一 | 一个文件内条件分支 |
| 优先 | ✅ **默认路径** | 兜底（应尽量稀有） |

**判断标准：能拆成文件的就拆文件**。变体层建好后，宏的使用量应显著下降——它回归"极少数内联例外"的定位。

## 7. 诚实边界

1. **`ios`/`android`/`harmony`/`native` 暂无构建目标**：解析规则、宏、路由门控**均已实现并测试**（32 个变体用例含族回退 + 14 个宏用例），但当前 CLI 只产出 `web`/`mp-weixin`——待 v0.6 原生后端接入即生效（无需改本层）。
2. **组件级变体（`.web.vue` 用于 `<p-xxx>` 标签）**：当前覆盖页面与业务代码；组件标签的变体解析需 MP 目录扫描 + gen-routes 同时支持，属后续。
3. ~~样式文件变体~~ **已覆盖（第 5 层）**：`<style src="./theme.css" scoped>` 经构建期解析 `theme.<platform>.css`（scss/less 同上）。仅 `<style>` 内联块不参与变体（那是同一个文件）。
4. **嵌套导入链**：变体文件内部再 import 的模块同样走变体解析（MP 共享模块 / Web resolveId），但需确保解析器对每级生效。
5. **`effectiveVariants` 按目录分组**：跨目录同名不冲突（分组按完整路径的 base）。
