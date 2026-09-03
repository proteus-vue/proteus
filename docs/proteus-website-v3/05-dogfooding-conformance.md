# Dogfooding 与 Conformance 可视化

> `proteus-website-v3/` 附属文档 4/6 · 配套：原则 W-1（官网是第一个 Showcase App）+ 全部 Backend 的 conformance 机制
> 本文把「**我们用 Proteus 建了 Proteus 官网**」从口号落成**工程约束 + 可验证证据**。

---

## 0. 核心论点

> **"Dogfooding" 是 Proteus 官网相对于 uni-app / Taro / Lynx / Flutter 官网的、无法被复制的差异化优势。**
>
> 竞品官网自己**不是**用自家框架写的（uni-app 官网用 VuePress、Flutter 官网用普通 Web、Lynx 文档用 Docusaurus）。
> 所以他们的「框架能力」只能**描述**；Proteus 的「框架能力」是**正在渲染你眼前这个页面的东西**。

**这把方法论支柱③「验证先于运行」推到了极致**：
- 官网能跑 = 框架能用的最强活证据
- 官网跑在 `VueDomBackend` = 「渲染后端可插拔」的真实实例
- 官网的 `<p-grid>` 布局 = 「语义原语」的可检视源码
- 官网的暗色模式 = `useColorScheme()` 的真实调用

---

## 1. 工程约束（硬要求，CI 门禁）

### 1.1 monorepo 结构

```
proteus/
├── website/                ← 官网 = 一个标准 Proteus App
│   ├── app.config.ts       ← 声明式配置（G-32，与业务项目完全一致）
│   ├── backend.config.ts   ← 声明使用 VueDomBackend（dogfooding）
│   ├── src/
│   │   ├── app.vue         ← 用 <p-layout-root> 等语义原语
│   │   ├── pages/          ← /primitives / /backends / /playground ...
│   │   ├── composables/    ← useFetch / useColorScheme / useNative ...
│   │   └── assets/
│   ├── public/
│   └── package.json        ← @proteus/* 依赖（与业务项目一致）
├── packages/               ← 框架包
└── ...
```

### 1.2 四条不可违反的规则

| # | 规则 | 校验方式 |
|---|------|---------|
| **D-1** | 官网**必须**是一个合法的 Proteus App，可用 `proteus dev` 启动 | CI：`proteus dev --dry-run` 通过 |
| **D-2** | 官网布局**必须**全部使用 `<p-*>` 语义原语，**禁止**手写 `<view class="flex-col">` 式 div + CSS 模拟 | CI：AST 扫描，违例 = 构建失败 |
| **D-3** | 官网**必须**声明使用 `VueDomBackend`，且能在 Playground 里**切换为 Native/Flutter/Skia** 预览（即便只是录屏） | CI：backend.config.ts 校验 |
| **D-4** | 官网**必须**跑与业务项目**完全相同的 conformance test**，结果公开在 `/backends/conformance` | CI：conformance 报告自动发布 |
| **D-5** | **柔性框架优先（W-6，#374）**：官网响应式**必须**走 `@proteus-vue/fluid`（`v-p-fluid` clamp 表达式 + 柔性网格 auto-fill/minmax），**禁止**手写 `@media` 断点 / JS 宽度分支 / rpx 缩放 | CI：`verify-llm.js` **C8**（@media = error，存量 v3 静态页 legacy 白名单至 B4） |

**D-2 是关键**——如果官网自己都在写 `<view class="grid">`，那「消灭 view、语义优先」的说服力归零。这条用 AST 扫描强制，无可绕过。

### 1.3 AST 扫描规则（D-2 实现）

```yaml
# .proteus/website-lint.yaml
rules:
  no-div-for-layout:
    pattern: "div[class*=flex|grid|col|row]"   # 禁止用 div + class 做布局
    message: "Use <p-stack> / <p-grid> instead"
    fix: auto-replace-with-p-primitive
  no-inline-style-for-responsive:
    pattern: "@media|width.*px"
    message: "Use <p-fluid> / p-breakpoint tokens"
  no-platform-api-in-business:
    pattern: "wx\\.|uni\\.|my\\.createSelectorQuery"
    message: "Use useNative() / composables (G-28)"
  require-semantic-component:
    pattern: "scroll-view|swiper|movable-view"
    message: "These are eliminated; use <p-scroll>/<p-stack>/<p-draggable>"
```

**lint 跑在 CI + pre-commit**——官网源码是 Proteus 语义的最佳示范，任何回退立即被拦。

---

## 2. 官网作为「可检视的证据」

### 2.1 「View Source」功能（刻意设计）

官网每个页面右上角固定按钮 **「View Source」**，点击展开：

```vue
<!-- website/src/pages/primitives/[id].vue（真实源码） -->
<template>
  <p-layout-root>
    <p-header>...</p-header>
    <p-main>
      <p-grid :min-col-width="320" :gap="24">
        <p-card v-for="section in sections" :key="section.id">
          <p-heading level="3">{{ section.title }}</p-heading>
          <p-text>{{ section.body }}</p-text>
        </p-card>
      </p-grid>
    </p-main>
  </p-layout-root>
</template>

<script setup>
const { theme } = useColorScheme()   // ← 暗色模式，真实的 composable
const sections = usePageSections()
</script>
```

**说服力**：开发者看到「渲染我眼前页面的就是 `<p-grid>`」，且这段源码**就在 GitHub 上可查**——比任何 benchmark 文档都有力。

### 2.2 「Backend Switcher」彩蛋（首页）

首页右下角（开发环境 / `?debug=1`）显示：

```
当前渲染后端：VueDomBackend
  来自 backend.config.ts →  { render: { backend: 'vuedom' } }
[切换为 → Native | Flutter | Skia]（开发态热切换演示）
```

切换时页面**不刷新**，通过 G-27 多 renderer 机制实时替换 nodeOps——这是「渲染后端可插拔」的**现场演示**，比录屏可信一万倍。

（生产环境默认隐藏，避免混淆；但文档页有完整说明 + 录屏。）

### 2.3 Showcase 页的 dogfooding 案例（首个案例永远是官网自己）

```
/showcase/proteus-website   ★ 置顶
  · 项目：proteus.dev（本官网）
  · 框架：Proteus（VueDomBackend）
  · 原语使用：<p-grid> <p-stack> <p-fluid> <p-modal> <p-nav> ...
  · composables：useFetch / useColorScheme / useMediaQuery
  · 性能：LCP 1.8s（自有性能门禁达标）
  · 源码：github.com/proteus/website
  · [View Source →] [Switch Backend Demo →]
```

---

## 3. Conformance 可视化（可信度的根基）

### 3.1 `/backends/conformance` 页面

**单一事实源**：CI 每次构建生成的 `conformance-report.json`，官网构建时拉取渲染。

```
Backend            Total  Pass  Fail  Skip  Coverage  Version
─────────────────────────────────────────────────────────────
Compiler (Node)     48    48    0     0    100%      0.1.0
Compiler (Rust)     48    46    0     2    95.8%     0.1.0-alpha
Compiler (WASM)     48    40    0     8    83.3%     0.1.0-alpha
Render (VueDom)     ALL   ✓     -     -    100%      0.1.0
Render (Native)     ALL   ✓     -     -    100%      0.1.0
Render (Flutter)    ALL   ⚠️    -     -    beta      0.1.0-alpha
Render (Skia)       ALL   🔶    -     -    alpha     0.1.0-alpha
Capability (iOS)    ALL   ✓     -     -    100%      0.1.0
Capability (Android) ALL  ✓     -     -    100%      0.1.0
Capability (Harmony) ALL  ⚠️    -     -    95%       0.1.0-alpha
Platform (Tier 1)    -    ✓     -     -    -         -
Platform (Tier 2-4)  -    🔶    -     -    -         -
```

**每行可点击展开**：具体跑了哪些 IR 契约测试、哪些原语不支持（及降级策略）、性能基准。

### 3.2 三层 conformance 体系（官网统一展示）

```
┌────────────────────────────────────────────────────────────┐
│ Layer 1：IR 语义等价（G-29 Compiler）                       │
│   · 同一 SFC → Node/Rust/WASM 产出等价 CompilerIR          │
│   · 测试：IR Golden Test（快照比对）                        │
├────────────────────────────────────────────────────────────┤
│ Layer 2：渲染一致性（G-27 Render）                          │
│   · 同一 RenderIR → 各 Backend 渲染视觉一致                 │
│   · 测试：截图 diff + 布局断言                              │
├────────────────────────────────────────────────────────────┤
│ Layer 3：能力协商（G-28 Capability + G-30 Platform）        │
│   · Backend 声明的 capabilities = 实际支持                   │
│   · 缺失能力降级行为符合 @conditional 规则                  │
└────────────────────────────────────────────────────────────┘
               ↓ 全部通过
      官网「All Systems Operational」徽章
```

**徽章**：官网页脚固定显示 `Backend Status: All Operational (48/48)`——数据实时取自 CI，绿/黄/红三态。

### 3.3 「证明先于宣称」（W-4）的强制对应

对标表（`/compare`）每一行的 ✅，都必须能在 conformance 页找到**具体测试**：

| 宣称 | 证据链接 |
|------|---------|
| 「渲染后端可插拔」 | → `/backends/conformance?layer=render` |
| 「编译器可插拔」 | → `/backends/conformance?layer=compiler` |
| 「任意端」 | → `/backends/conformance?layer=platform` |
| 「小程序能力 100% 覆盖」 | → `/backends/conformance?coverage=miniprogram` |

**CI 校验**：`/compare` 页面解析时，校验每个 `→` 链接目标确实存在对应测试记录；否则构建失败。这杜绝了「宣称了但点不进去」。

---

## 4. 性能自证（dogfooding 的量化维度）

官网**必须**过自家性能门禁（G-Performance），否则「框架快」不可信：

| 指标 | 目标 | 监控 |
|------|------|------|
| LCP（首页） | < 2.5s | Web Vitals + CI Lighthouse |
| TBT | < 200ms | Lighthouse CI |
| Playground 首屏 | < 4s | 性能测试 |
| 切换 Render（VueDom） | < 100ms | 性能测试 |
| 内存 | 无泄漏（页面切换） | Performance plan 门禁 |

**性能报告公开**：`/showcase/proteus-website#performance` 展示真实 Lighthouse 分数 + 与「同内容用 Next.js/Nuxt 写的对照组」对比——**自己测自己，且公开原始数据**。

---

## 5. 治理：官网与框架同步演进

**问题**：框架升级 → 官网是否跟着升级？容易漂移。

**方案**：官网是框架 monorepo 的一部分，**发版联动**：

```
框架发版 (packages/*)  →  CI 自动：
  1. 跑官网构建（D-1 ~ D-4 全校验）
  2. 跑官网 conformance（3.3）
  3. 重新生成 /primitives /backends/conformance 静态页
  4. 全绿 → 允许框架发版
```

**也就是说**：任何破坏官网的框架改动都无法合入。官网成为**框架的集成测试载体**——这是 dogfooding 的最高形态。

---

*本文是 `01-website-rearchitecture.md` 的附属规范，dogfooding 规则（D-1~D-4）+ conformance 可视化对齐原则 W-1/W-4 + G-27/28/29/30。*
*Architecture: `@proteus/architecture` · Status: v2 (2026-09-02)*
