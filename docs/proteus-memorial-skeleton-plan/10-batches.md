# 分批策略（M1–M5）

执行位：**G-25（纪念日灰度）、G-26（骨架屏）**。依赖 G-01 地基、Compiler IR、G-22 App Renderer、Glass 滤镜管线。

## 依赖图

```
G-01 (Types/Compiler 地基)
    ├── G-25 纪念日灰度
    │     ├── M1: Web + Skyline（纯 Compiler + CSS）── 最先，零依赖
    │     ├── M2: iOS + Android 滤镜（复用 Glass 管线）
    │     ├── M3: 鸿蒙 grayscale
    │     ├── M4: 远端配置 + CLI
    │     └── M5: 真机验收矩阵
    └── G-26 骨架屏
          ├── M1: Web 骨架 IR + 内联注入 ── 最先，纯静态分析
          ├── M2: Skyline WXML
          ├── M3: App 原生占位 View（复用 AOT）
          ├── M4: <p-skeleton> 运行时 + refKey 过渡
          └── M5: 与 IFR 合并验证
```

**关键**：G-25 M1 与 G-26 M1 **互不依赖，可同期启动**；M2 起均复用既有资产（Glass / AOT / IFR）。

## M1（推荐最先落地，纯逻辑零依赖）

### M1a — 纪念日灰度（Web + Skyline）

**目标**：一份 `app.config.ts` 配置，构建后 Web/Skyline 自动灰度，业务零改动。

**验收**：
- [ ] `proteus build` 在 `<head>` 注入灰度 CSS + 日期判定脚本（<1KB）
- [ ] Skyline 产物根节点带 `proteus-memorial-root`，`page` 无 filter
- [ ] 日期命中/远端开关 → 五端同步切换
- [ ] `proteus doctor` 报 CSS016/017

**Prompt 模板**：

```
在 Compiler 新增 transform `memorial`：读取 app.config.ts 的 memorial 字段，
Web 目标向 index.html <head> 注入：
1) <style>.proteus-memorial,*proteus-memorial* { filter:grayscale(100%); -webkit-filter:grayscale(100%) }</style>
2) <script>（<1KB）读取 memorial.json + 本地日期表，命中则 document.documentElement.classList.add('proteus-memorial')
Skyline 目标在 IR 根节点追加 filter:grayscale(1) 指令，禁止写入 page 选择器。
新增 --strict-css 规则 CSS016(no-hardcode-filter)/CSS017(no-page-filter)。
写单测：构造 SFC + 配置，断言产物含注入、无 page filter。
```

### M1b — 骨架屏（Web 静态分析）

**目标**：Compiler 静态分析 SFC + Vue Router，产出 `dist/.proteus/skeleton/{route}.ir.json` 并内联注入 `<head>`。

**验收**：
- [ ] 解析 img/text/button/flex/list/glass 节点，推导骨架 IR
- [ ] `v-for` 按预估项数重复；动态分支取主分支/`fixtures`
- [ ] 产物 <2KB/路由；结构对齐真实 IR（SKL002）
- [ ] Web 首屏 FCP 前骨架可见

**Prompt 模板**：

```
新增 Compiler transform `skeleton`（在 AOT 之前，--trace-transform 可见）：
1) AST 遍历 SFC 模板，按节点类型映射骨架（img→block+尺寸, text→lines, button→圆角块, flex→保留结构, v-for→重复N项, pg-glass→降级普通块）
2) 尺寸来源：静态 width/height > aspect-ratio > 默认；动态值取 fixtures 指定状态
3) 输出 SkeletonIRNode 树到 dist/.proteus/skeleton/{route}.ir.json，含稳定 refKey
4) codegen 阶段把 IR 序列化为内联 HTML+CSS（shimmer 动画）注入 #app 之前
5) 新增规则 SKL001(no-screenshot)/SKL002(structure-align)/SKL004(refkey-stable)
写单测：给定 SFC fixture，断言产物 JSON 节点数/布局与真实 IR 一致，且不含 base64。
```

## M2 — Skyline + App 滤镜 / 骨架原生 View

### M2a 灰度

- iOS：`ProteusMemorial.apply(on)` JSI binding，覆盖层 + `compositingFilter`，禁私有 API（RNT001）
- Android：`setLayerType(HARDWARE, ColorMatrix(0))` + GrayManager 特殊容器排除
- 鸿蒙：`.grayscale()` 桥接到统一状态源

### M2b 骨架

- Skyline：骨架 IR → WXML 静态节点
- App：AOT 预编译骨架 IR → 原生占位 View（UIView/ArkUI/Android View）via JSI

**Prompt 模板**：

```
App Renderer 新增骨架渲染后端：消费 .proteus/skeleton/{route}.ir.json，
iOS 生成 UIView 树（p-block→UIView+shimmer CALayer，p-text→N 条细条），
鸿蒙生成 Stack/Column 组件树，Android 生成 FrameLayout 树。
全部通过 JSI 在 UI 线程 mount，先于 Vue 启动（与 IFR 共用 mount 入口）。
复用 AOT IR 反序列化与节点创建流水线，不另造。写真机单测验证首帧 <200ms。
```

## M3 — 运行时组合

- `<p-skeleton :for :loading>` + `<p-block>`/`<p-text>`/`<p-circle>` 语义原语
- refKey 对齐过渡（真实 View 接管时按 refKey 复用节点，淡出无闪屏）
- `pg-glass + memorial + skeleton` 组合验证

## M4 — 远端控制 + CLI

- `proteus memorial check`、`proteus skeleton generate`
- 远端配置拉取 + 进入前台刷新 + 降级（离线走本地日期表）
- 纳入 `proteus build` 管线顺序：memorial → skeleton → AOT → IFR → bundle

## M5 — 真机验收矩阵

按 `08-benchmark-budgets.md` 五端真机矩阵逐验收：
- Skyline 灰度后 flex 不失效（核心）
- iOS 覆盖层不阻断交互 + 避让灵动岛
- Android WebView/视频降级
- 骨架首帧（App Vue 启动前可见）+ 过渡无闪屏
- 全部性能预算达标，CI 硬性门禁

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| Skyline flex 失效 | M1 即验证根容器方案，规则 CSS017 阻断 page 直挂 |
| iOS 审核被拒 | 默认禁私有 API，静态扫描 RNT001 |
| 骨架与真实脱节 | SKL002 结构对齐 + refKey（SKL004） |
| 远端失败 | 本地日期表兜底，离线可用 |
| AOT 骨架体积 | 结构化 IR <2KB，CI 校验 |

## 执行建议

**M1a + M1b 同期启动**（都纯逻辑、零依赖、可单测，最快出可演示成果）→ **M2 复用 Glass/AOT/IFR 资产** → M3/M4/M5 收口。

M1 完成后即可在 Website Playground 演示"**一键置灰 + 自动骨架屏**"——这是极佳的对外话术素材。
