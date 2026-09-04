# @proteus-vue/website — Proteus 官网

> **dogfooding：官网用 Proteus 自身构建。** 竞品官网自己不是用自家框架写的——他们的框架能力只能"描述"；Proteus 官网的能力是"正在渲染你眼前这个页面的东西"。

## 本批落地（Website B2 · 决策 #374）

- **文档系统 MVP**：10 篇指南（`guides/*.md`）由 `@proteus-vue/docs` 引擎在 vite 构建期编译（frontmatter/title/html/toc），运行时零解析——**文档也是编译产物**
- **侧边栏自动生成**：`src/guides.ts` 用 `import.meta.glob` 收集全部 md 模块，按 frontmatter.order 排序——**新增指南 = 放一个 md 文件，侧边栏零改动**
- **柔性框架优先（W-6/D-5）**：响应式全部走 `v-p-fluid` clamp 表达式 + 柔性网格（auto-fill/minmax），**全站零 @media 断点**（`verify-llm.cjs` C8 机器门禁）
- **桌面交互原语**（G-24）：`v-p-hover` 卡片悬停语义

## 运行

```bash
npm run dev:website     # 根目录（或 cd website && npm run dev）
npm run build:website   # vue-tsc 类型检查 + vite 构建
```

## 结构

```
website/
├── guides/*.md          # 28 篇指南（frontmatter: title/order/group，六分组侧边栏）
├── content/             # ★生成的参考文档（gen-content.mjs 从源码 SSOT 生成，勿手改）
│   ├── components/      #   60 页：p-* 逐组件参考（props/events/语义映射/MP 等价）
│   ├── capabilities/    #   51 页：50 能力原语逐个参考 + 总览
│   └── system/          #   5 页：柔性系统专区（容器查询/柔性网格/自适应侧边栏/断点形态）
├── spirit.html          # ★#389i 3D 海神精灵 iframe 专页（透明背景——three 隔离在独立 chunk）
├── src/
│   ├── spirit/main.ts   # ★#389i Three.js 3D 萌宠（果冻质感/点击变身/鼠标跟随/postMessage 气泡）
│   ├── guides.ts        # 侧边栏自动生成（glob + frontmatter 排序）
│   ├── pages/Home.vue   # Hero + 能力矩阵 + 快速开始
│   ├── pages/Guide.vue  # 侧边栏 + 文档渲染 + TOC + 上下篇
│   └── style.css        # design tokens（深色优先，v3 tokens 子集）——零 @media
└── vite.config.ts       # vue + docsMdPlugin（md → 组件）+ 多页入口（main + spirit）
```

## dogfooding 清单（诚实边界）

| 层 | 用了什么 | 状态 |
|----|---------|------|
| 文档 | @proteus-vue/docs（md → Docs IR → 渲染） | ✅ |
| 柔性布局 | v-p-fluid（G-22 clamp 流式）+ 柔性网格 | ✅ |
| 桌面原语 | v-p-hover（G-24） | ✅ |
| 自适应侧边栏 | p-sidebar（G-22 Fluid System S3——容器查询按容器求解，≥720px 左侧栏 / 窄容器自动顶部导航 + 车机 d-pad 焦点） | ✅ |
| 双栏分屏 | p-split（G-22 Fluid System S1——容器查询 stacked/split；★#386 修复插槽用法：第一栏必须写 #aside；列宽样式归页面） | ✅ |
| 渲染后端切换 | **Mini Playground v2（#388）**：RENDER BACKEND × 6（renderIRTree 真跑五官方后端——VueDom 真 DOM/Headless 内存树/Native 三平台 UIKit·Jetpack·ArkUI 描述树/Flutter Widget 树）+ DEVICE（真宽高 + G-25 formForWidth 真档位）+ COMPILED BACKEND（Node 真实；Rust 诚实禁用——浏览器无 Rust 运行时）；demo 源码升级 p-* 语义版（语义树非空 → 各后端映射真视图） | ✅ |
| 液态玻璃 | **pg-glass（G-07 B1 首落地）**：导航栏 preset=navigationBar（blur 20 + tint + 高光边）+ 数字背书 8 卡 preset=card（噪点 0.03）；prefers-reduced-transparency 自动降级实色（铁律 4）；替代手写 backdrop-filter（CSS017 合规） | ✅ |
| 动效体系 | **WebGL 语义粒子场**（Hero，零依赖手写 WebGL1 引擎：DPR 封顶/离屏暂停/reduced-motion 静态化/WebGL 缺失回退）+ 六区块滚动显现（IO）+ 渐变流光 + p-animate LIVE 脉冲 | ✅ |
| 3D 海神精灵 | **Three.js 果冻萌宠（#389i）**：iframe 嵌入右下角（three 隔离在 `spirit-three` chunk，主 bundle 零增量）+ 顶点谐波果冻变形 + 点击循环 8 形态（变身弹跳/涟漪/O 嘴）+ 眼球躯干跟随鼠标 + postMessage 形态主题气泡（pg-glass floating）；降级链：WebGL 缺失 → 2D SVG · reduced-motion → 单帧静态（JS matchMedia）；※three.js 为零第三方 UI 库铁律的**用户点名例外**（渲染库非 UI 库） | ✅ |
| 分段控件/轻提示 | p-segment（TransformDemo 六 Tab 替代手写按钮）+ p-toast（复制分享链接反馈） | ✅ |
| p-* 使用须知 | p-view 默认 flex-column + **box-sizing: content-box**（Skyline 对齐——页面侧凡「width/width:100% + padding」组合必须显式 box-sizing: border-box，否则 padding 逐层外扩：容器击穿（#386e）与嵌套裁剪需手动滚动（#388 RenderBox 两处实测））；行向用 class 覆盖；p-heading level 用 :level 数字绑定；页面样式一律 scoped（防组件 scoped 级联）；p-page 深色经 --p-page-bg 变量钩子；flex item 内套宽内容（pre/table）必须 min-width:0 + 显式 width（margin:auto 会让 stretch 失效回落 min-content——#383/#386 两次踩坑） | ✅ |
| 设计 token | style.css 单一事实源（v3 design-tokens 对齐）：色板 + 状态/后端/语法色 + radius/间距 scale（#386 风格对齐，页面禁裸 px 圆角/硬编码状态色） | ✅ |
| 主题 | **Dark-first**（当前阶段裁定，见 website-plan/08 落地差距登记；浅色主题+切换器归后续批次） | ⚠️ |
| 表格/代码块/搜索等原语 | p-table/p-code-block/p-search 等框架尚未实现——语义化 HTML 过渡，差距已登记（08-design-system 落地差距登记节） | ⚠️ |
| 路由 | vue-router（@proteus-vue/router 路由模型面向双端页面工程——差距已登记，B4 评估回填） | ⚠️ |
| SSG / SEO | 构建期渲染已具备，sitemap/SSG 输出随 B7 | ⬜ |
