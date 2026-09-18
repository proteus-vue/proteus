# 分批执行（Execution Batches）

## 原则

对齐前面 16 份 plan 的分批规格：
- 每批 = 1 PR = LLM 单次 ≤ 3 文件 + overview
- 每批有明确**输入 / 输出 / 验收**
- 依赖下层先稳定，可并行则并行
- **防上下文撑爆**：执行某批只喂 `00-overview + 当前批文件 + 直接依赖文件`

## 依赖图

```
Compiler ──┐
Types ─────┤
Component ─┼──→ Website
Router ────┤
DevTools ──┘
Blueprint ─→（M4 起消费成果数据）
```

Website 内部依赖：
```
08 设计系统 ← 所有页面（dogfooding）
02 文档系统 ← 03/04/07
05 Playground ← 01/03/04/06
09 i18n ← 02/08
11 小程序 ← 02/05/08/09
12 SEO ← 08/09
13 测试 ← 全部
```

## 批次规划（B1-B8）

### B1 · 项目骨架 + 设计系统（地基）
**文件**：`00-overview` `08-design-system` `README`
**输入**：Component plan 的 `p-*` 组件定义
**输出**：`apps/website` + `packages/design-tokens` + p-* 基础组件
**验收**：
- [ ] `npm run dev` 能起一个用 p-* 的空页面
- [ ] 暗色切换无闪烁
- [ ] `proteus audit website` 无第三方 UI

### B2 · 文档系统 MVP
**文件**：`02-docs-system` `03-guide-tutorial` `04-api-reference`（仅渲染）
**输入**：16 份 plan 的 README 作初稿
**输出**：`packages/docs-loader` + `/docs/guide` 可浏览
**验收**：
- [ ] 10 篇指南页 SSG 渲染
- [ ] 侧边栏自动生成
- [ ] codegen 从 .d.ts 生成 1 个 API 页

> **✅ 引擎件落地（决策 #365）**：新包 **`@proteus-vue/docs`**（36 包，零依赖）——**Markdown → Docs IR（语义块 AST）→ HTML/Vue SFC**：块级解析（标题锚点 kebab+中文/代码围栏/列表一层嵌套/表格对齐/引用/分隔线）+ 行内（code/strong/em/link/image）+ YAML-lite frontmatter（块式/行内数组、布尔数字归一）+ **零依赖轻量高亮器**（js/ts/vue/json/bash/css/html；内容全转义防注入）+ TOC（平铺/嵌套 h2-h3 可配）+ 搜索索引（构建期条目 + 子串评分检索）+ **toSfc**（DocsCode v-pre 包裹 + {{}} 实体化 + p-page 语义根 + 恒 script setup）；**核心证据**：md → toSfc → **框架编译器 compileVueSfc 编译通过** → mountWebComponent 真实渲染（docs-* 语义类在 DOM）——「文档也是编译产物」（第九次泛化叙事）；vite md 虚拟模块接入待下一批。测试 tests/docs-engine.test.ts 17 用例；全量 1904/181 无回归。

> **✅ B2 部分落地（决策 #374）**：`website/` 官网应用落地——① docs 引擎（#365）消费接线：10 篇指南 md（guides/*.md，frontmatter title/order）构建期编译（docsMdPlugin），运行时零解析；② **侧边栏自动生成**（`import.meta.glob` 收集 md 模块 → frontmatter 排序——新增指南零改动）；③ Home（Hero + 六大能力卡 + 快速开始）+ Guide（侧边栏 + 正文 + TOC + 上下篇）；④ **★柔性框架优先（W-6/D-5）**：响应式全走 v-p-fluid clamp + 柔性网格 auto-fill/minmax，**全站零 @media**（`.llmrules` 原_BREAK 断点规则改写 + `verify-llm.cjs` **C8** error 门禁 + 存量 v3 三页 legacy 白名单至 B4）；⑤ 桌面原语 v-p-hover（G-24）；验证：vue-tsc 零错误 + vite build 135KB（gzip 53KB）+ verify-llm 31→（C8 后）全绿；诚实边界：路由用 vue-router（@proteus-vue/router 路由模型面向双端页面工程——差距登记，B4 评估回填）；SSG/sitemap 归 B7；codegen 从 .d.ts 生成 API 页待 types 集成

### B3 · Playground 内核
**文件**：`05-playground` + `compiler-plan` WASM 集成
**输入**：Compiler IR + TraceBus
**输出**：浏览器内 `.vue → 三端产物`，Monaco + Worker
**验收**：
- [ ] 输入 `v-if` → 实时出 `wx:if`
- [ ] Trace 链路与 `--trace-transform` 一致
- [ ] 分享链接可复现

> **✅ B3 内核落地（决策 #375）**：`website/src/playground/` + `/playground` 页——① **浏览器内实时编译**（@proteus-vue/compiler 零 node 内置依赖 + peer @vue/compiler-sfc browser-safe——**与本地 build 同一套 compiler**，v-p-fluid 同源公式已在编译器 fluid-layout.ts）；② 双栏柔性布局（W-6：auto-fit/minmax + v-p-fluid，零 @media）；③ 五 Tab：WXML / JS / WXSS / **Trace**（决策事件按 phase 分组：ruleId + 行号 + before→after）/ **规则目录**（listTransformRules AI 说明书入口）；④ **分享链接可复现**（源码 → UTF-8 → base64 → ?code=，编辑同步 replaceState）；⑤ 200ms debounce 实时编译 + 残缺源码容错不崩；⑥ 拆包：@vue/compiler-sfc 独立 chunk（624KB 按需），首屏 246KB（gzip 95KB）；验证：tests/website-playground.test.ts 6 用例（分享往返 + wx:if/wx:for/bind:tap 产物 + trace 结构 + 规则目录 ≥60）→ 全量 1986/186 + vue-tsc 零错误；诚实边界：编辑器 MVP textarea（Monaco B4 评估）、编译主线程（Worker 随大文档评估）、Trace 链路与 --trace-transform 同源（trace 事件结构一致——CLI 深度对账随 B4）

### B4 · 首页 + Showcase
**文件**：`01-home` `06-showcase-blueprint`
**输入**：Blueprint 验收数据（mock 起步）
**输出**：首页 Hero + 实时演示 + Showcase 矩阵/图表
**验收**：
- [ ] 首页 LCP < 2.5s（WASM 懒加载）
- [ ] Showcase 数字可追溯到脚本

> **✅ B4 部分落地（决策 #376）**：① **首页深化**（Home v2：**数据条 8 项**——数字单一来源 `stats.ts`，每项注明权威验证脚本 =「Showcase 数字可追溯到脚本」的 v1 形态 + **对标矩阵** 8 维（positioning v3 §6，Proteus 列 ✅/🟡/📋 状态诚实标注）+ **方法论节**（SPI-First 一句话 + 链接））；② **D-2 dogfooding AST 审计 CI**（`website/audit-d2.mjs` + 根 `npm run audit:website`）：@vue/compiler-sfc 模板 AST 扫描——第三方 UI import（D2-UI）/ 手写 @media（W-6/C8，★只扫 style 块真实代码排除注释误报）/ wx.* uni.* 直调（D2-PLATFORM）= error + 语义原语使用统计（v-p-fluid/语义指令/p-* 标签计数——覆盖率阈值随 B5）；官网自身审计 PASS；③ **Monaco/Worker 评估结论（诚实暂缓）**：编辑器 textarea + 200ms debounce 已满足小文档（编译 <10ms），Monaco ~2MB 依赖损害 LCP 预算、Worker 隔离随大文档真实场景——均 B5 按需评估；验证：tests/website-audit-d2.test.ts 5 用例（正向 PASS+统计 / 三类违规逐项 / 多文件聚合）→ 全量 1991/187 + vue-tsc 零错误；诚实边界：Showcase 页待 Blueprint 数据（B5+）、LCP 实测归 B7

> **★B4 补强（#377，用户审查驱动）**：**① p-* 标签真实落地（D-2 兑现）**——首版官网模板是「原生 HTML + v-p-fluid 点缀」，D-2 审计暴露 p-* 标签 0 使用 → main.ts 全局注册 PView/PText/PHeading/PGrid/PStack/PButton/PDivider/PPage → App/Home/Guide/Playground 模板重写为 p-* 标签（审计 19/52 p-* 标签 + v-p-fluid 3 文件）；**② 内容对齐 01-home.md**——首页重排为 plan 结构：Hero（副标题「透明编译 · AI-native · 产物可审计」+ 双 CTA）→ 三大卖点（≤20 字/条）→ **★实时 Transform 演示内嵌**（新 `TransformDemo.vue` 组件：编辑器 + Skyline/**IR（G-29 NodeBackend 真实 CompilerIR JSON——新 `./node` 浏览器安全子入口，index 全量含 fs 仅 node 侧）**/Web/WXSS/Trace 五 Tab，首页 compact 形态与 /playground 全功能页复用）→ 数字背书（stats.ts）→ 对标矩阵 → 方法论 → 快速开始 3 步；**③ compiler-backend 加 `./node` 子路径 exports**（esbuild platform=neutral 独立构建）——vitest 字符串 alias 前缀误吞 /node 后缀 → 改正则 alias + 子路径 alias；IR 语义断言修正（标准 HTML 进 compat 计数、p-* 才进 semantic 树——G-31 语义映射的真实行为）；验证：playground 7/7 → 全量 1992/187 + vue-tsc 零错误 + D-2 审计 PASS

> **★B4 风格对齐（#386，用户审查「官网和 website-plan 风格没对齐」）**：**① token 体系补全**——style.css 补状态色（ok/warn/rec）/后端色（bk-*×6）/语法色（syn-*×6）/brand-soft/glass-bg/radius 语义化（chip6/sm7/md9/lg12/xl14/pill）/间距 scale，页面硬编码 radius/状态色/品牌 rgba 全部改 token；**② 语法高亮接线**——docs 引擎 docs-tok-* → --syn-*（指南页代码块首次有语法色）；**③ 布局归原语**——Home 三大卖点/数字区裸 div 网格 → p-grid（min-col-width 240/200），Playground 规则列表裸 div → p-stack（D-2：19→21/57 标签）；**④ 状态层用色**——对标矩阵 ✅→ok/🟡→warn/📋→dim（替代单色 brand2）；**⑤ a11y 对比度**——11–13px 小字去 dim（footer/cmp-note/stat-source/pg-meta/pg-dim/qs-dim 提级 muted）；**⑥ glass 校准**——nav blur 14→12px（llm-style-guide Glass-light）；**⑦ 规范回写**——08-design-system 新增「落地差距登记」（双主题 vs Dark-first 裁定：当前 Dark-first；缺失 p-* 组件清单归组件族批次；p-table 等落地前语义化 HTML 过渡）。验证：website build（vue-tsc 零错误 + vite 1.8s）+ D-2 审计 PASS + 定向测试 12/12

> **★B4 首页 v3 构图重构（#387，用户评审「v3 首页更专业」）**：**① 居中 Hero**——eyebrow chip（brand-soft 底）+ 渐变双行 H1「One semantic model. / Any engine — at every layer.」+ 双 CTA + **G 系 pills**（G-27/28/29/30/31-32 五钉子）；**② Mini Playground 面板化**——TransformDemo 加面板头（◆ 标题 + **LIVE 徽标** + 提示）+ 输出面板接 **docs 引擎 highlight 语法色**（json/html/css，同一套引擎非伪造）+ 面板头 tip；**③ 编号三支柱**（01 语义优先 / 02 全插层 SPI / 03 证明先于宣称，v3 三卡构图）替代原三大卖点；**④ 对标表 v3 化**——标题「与「翻译派」的本质分水岭」+ Proteus 列 brand-soft 着底 + 状态色（#386）；**⑤ dogfooding 金句收尾**（「我们用 Proteus 建了 Proteus 官网」+ 渐变 <p-grid>——替代原方法论节，链接保留）；**⑥ ★框架消费修复：p-split 双栏从未生效**——#384 迁移时两栏都写在默认插槽（p-split 第一栏 = 具名 #aside），桌面端一直单栏；改 #aside 用法 + 列宽样式归页面（flex 1 1 0 + min-width 0），CDP 实测 split/stacked 双态正常；**⑦ 数据回填**——stats.ts 1986→**1992**（npm test 官方口径实跑）、plan 60→**69**（#385 批次后）；**⑧ 手机横滚二次根因**——.qs-code margin:auto 令交叉轴 stretch 失效（回落 min-content 撞破容器）→ width:100%+max-width+min-width:0，scrollW 390=clientW。验证：build 零错误 + D-2 PASS（22/58）+ 定向 12/12 + CDP 双端零横滚截图

> **★B4 Mini Playground v2（#388，用户「太简单了，v3 是可以切换各种东西的」——W-3 可切换性可视化，全部真实调用零伪造）**：**① RENDER BACKEND × 6**——同一份 CompilerIR.render 喂 renderIRTree 真跑五官方后端：VueDom（真 DOM，semantic→proteus-* 类）· Headless（内存树）· Native iOS/Android/鸿蒙（G-27 B4 语义映射表 UIView/UIStackView/UICollectionView/UILabel…）· Flutter（G-27 B5 toWidgetTree：Container/Flex/FilledButton/GridView）；新增 **Render Tab**（设备框内递归盒图可视化 + JSON + Profile3D）与新组件 RenderBox；**② COMPILED BACKEND**——Node (TS) 真实 / Rust 诚实禁用（浏览器无 Rust 运行时，需本地 proteus-cc-rust CLI）；**③ DEVICE**——Web/平板/手机/车机/手表五档真宽高 + G-25 formForWidth 真档位（Profile3D 入 footer）；**④ CAPABILITY**——指向 IR bindings.capabilities（真实能力入口清单，完整能力后端切换归 G-28 浏览器演示批次）；**⑤ demo 源码语义化**——HTML 裸标签改 p-* 语义版（Skyline 产出 p-view/p-text 语义标签更正确 + semantic 树非空 + 各后端映射真视图）。验证：build 零错误 + D-2 PASS + 定向测试过 + 全量 1997/1997 官方绿 + CDP 实测六后端切换（native-ios→UIView 树/flutter→Widget 树/vuedom→语义 DOM）截图入档

> **★#389b 视觉体验升级：WebGL 语义粒子场 + 滚动显现（用户「webgl、粒子特效全上」——零第三方依赖 + 全降级链）**：**① WebGL 语义粒子场**（Hero）——新引擎 `playground/particles.ts`（手写 WebGL1 单文件，零依赖；粒子 = 语义节点，紫 brand → 青 brand2 加色混合 point sprite + 8% 强调大粒子 + 鼠标轻微扰动）+ 新组件 `ParticleField.vue`（Vue 壳）；性能纪律：DPR 封顶 1.5 · 粒子数按面积推算夹紧 [140,900] · IntersectionObserver 离屏暂停 · visibilitychange 隐藏页暂停 · destroy 全清理（含 loseContext）；降级链：WebGL 缺失 → null 回退静态辉光 · **prefers-reduced-motion → 静态单帧**；**② 滚动显现**——六个区块 data-reveal + IntersectionObserver（reduced-motion/无 IO 直接显现）；**③ 渐变流光**——Hero 渐变标题 background-position 流光（motion-ok 才启用）；**④ LIVE 脉冲**——TransformDemo 徽标接 **p-animate**（框架内置动画原语，reduced-motion 静态化）；测试：新增 tests/particles.test.ts（粒子数夹紧 + WebGL 缺失优雅回退，happy-dom 环境）；验证：全量 2000/2000 + D-2 PASS + CDP 粒子场/鼠标扰动/滚动显现实测截图入档

> **★#389g→h 形象迭代（用户「WebGL 太生硬→要拟人化形象+形态主题气泡」）**：**ProteusSpirit v2→v3**——WebGL metaball 水滴（v2）撤掉，改 **SVG 矢量 Q 版小海神**（水滴身体形态色渐变 + 三根呆毛摇摆 + 大眼白/黑瞳/高光 + 腮红 + 海流尾）+ **形态主题气泡**（点击变身时弹出：形态名 + 主题思想一句，3.2s 自动收起，Vue Transition 出入场）+ 变身瞬间 O 型嘴惊喜 + 瞳孔跟随鼠标（rAF 节流 ±2.6）+ 偶发眨眼；七形态循环（本体+六后端，theme 即各后端核心价值句）；**右下角 fixed 悬浮**（全站可见）；reduced-motion 静态化（气泡保留为信息性）；测试：全量 2006/2006 + build ✅ + D-2 PASS（29/90）

> **★#389i 3D 海神精灵（用户「用 Three.js 做真正的 3D 萌宠海神，iframe 嵌右下角」——SVG 简陋版升级 WebGL 实时渲染）**：**架构 = iframe 隔离**——新增 `website/spirit.html` 多页入口（vite rollupOptions.input）+ `src/spirit/main.ts`；three@0.160.0 **手动解包安装**到根 node_modules（registry 对 @proteus-vue/* 404，npm install 不可用；manualChunks 拆 `spirit-three` chunk——主应用 bundle 零增量，实测 main 322KB 不含 three / spirit-three 457KB 按需加载）；**3D 果冻质感** = MeshPhongMaterial 高光 + 每帧顶点谐波位移（CPU ~2.4k 顶点）+ 紫/青双点光 + squash & stretch 呼吸；**交互**：点击 iframe 循环 8 形态（颜色插值 + 变身弹跳 + 涟漪环 + O 嘴惊喜）+ 躯干/眼球朝向跟随鼠标（G-24）+ 偶发眨眼；**形态主题气泡**：iframe postMessage `{type:'proteus-spirit-morph', name, theme}` → 父页 App.vue 监听（同源校验）弹 pg-glass floating 玻璃气泡（3.4s 自动收起，Transition 出入场）；**降级链**：WebGL 缺失 → 内嵌 2D SVG（点击仍可变身+身体色同步）· reduced-motion → JS matchMedia 单帧静态渲染（变身立即重绘目标色）· document.hidden → 暂停 + visibilitychange 补启 rAF；八形态含小程序 Skyline 与 Universal；App.vue 改 iframe 嵌入（旧 SVG ProteusSpirit.vue 保留为 fallback 参考实现，不再被引用）；验证：build 零 TS 错误 + D-2 PASS + CDP 双档（1440/390）实测 WebGL 渲染/点击变身/父页气泡/零横滚/零 console 报错，截图 `.cdp-shots/spirit-3d-*.png` 入档；验证脚本 `website/cdp-spirit.mjs` 可重复回归。

> **★#389j 参考形象重制**（用户给图多轮迭代收敛）：**近正圆胖球身**（球体重排 taper 0.12，顶部浪花冠覆盖）+ MeshPhysicalMaterial clearcoat + RoomEnvironment PMREM 环境反射 + 自发光同体色（暗背景透亮）+ 深色内芯层；**头顶双大浪卷**：肥螺旋（管 0.135，250° 缠绕）骑在球顶两肩——起点 270° 深埋球内（横向距离 < 球半径，永不断开）、缺口扇区对中央露蓝、卷梢内下潜；**大眼**白 0.28 + 蓝虹膜/深瞳/双高光（虹膜组跟随指针）+ 眼下粉腮红 + 小微笑弧；**底部浪花腰带**：厚管 0.17 白浪环抱球底（前中下沉两侧上扬）+ 两端向上卷断小浪卷，下方露出形体色球底；iframe 内 2D SVG fallback 同款形象（变身同步体色）

> **★#390i 官网内容填充（用户「现在官网就差内容填充了……离真正的框架官网内容量差得远」）**：指南从 10 篇骨架扩到 **28 篇实质内容**（2741 行），按 frontmatter `group` 分六组（入门 3/布局与组件 7/渲染引擎 4/能力与平台 2/工程化 10/参考 2）；侧边栏分组导航（guides.ts 导出 guideGroups 组序=组内最小 order，Guide.vue 组标题+限高滚动，28 页长清单 sticky 卡片不溢出）；内容全部源码取证后撰写（7 个并行 sub-agent + 手工补齐，准确性契约：只写源文件能证实的内容、API/props/命令逐一读源码、诚实分级 ✅🟡📋——中途发现并修正旧 05 篇 useNative() 不存在的错误，改为真实的 createCapabilityHooks()+50 Hook）；新篇：组件总览/布局组件/反馈动效/桌面原语/液态玻璃/Flutter 后端/Headless 语义快照/能力系统/平台 API/编译管线/路由/状态管理/所有权工程/容器与宿主/CLI/一致性验证/语义版本与兼容性/FAQ；验证：build 28 篇全编译 + D-2 PASS + CDP 实测（6 组侧栏/长文页表格代码/锚点 TOC/移动端零横滚/零 console 报错），截图 docs-groups-*.png 入档，回归脚本 website/cdp-docs.mjs

> **★#390ii 文档 IA 重构 + 参考文档生成器（用户「所有内容都堆在一个 sidebar 拥挤；组件/能力需要逐个文档；柔性框架系统没体现出来」）**：**四区 IA**——指南 28 篇（/docs/:slug）+ **组件区 60 页**（/docs/component/:slug——总览 + 59 个 p-* 逐个参考页）+ **能力区 51 页**（/docs/capability/:slug——总览 + 50 能力原语逐个）+ **柔性系统区 5 页**（/docs/system/:slug——总览/容器查询/柔性网格/自适应侧边栏/断点与形态），共 144 页；DocsPage.vue 四区通用（区切换 tabs + 分区侧边栏 + 右栏导读），旧 Guide.vue/guides.ts 删除（docs-registry.ts 四区注册表取代）；**生成器 website/scripts/gen-content.mjs**（内容即数据——SSOT = 框架源码，勿手改产物）：组件页解析 defineProps（JSDoc 可选 + 花括号平衡提取 + 顶层键分割解析 type/default/required——踩坑：prop 自身尾花括号/外层}）双尾部剥离、JSDoc 可选正则 m[1] ?? ''）+ defineEmits + TAG_SEMANTIC_MAP + MP_MAPPING_MATRIX；能力页从 PRIMITIVE_CATALOG kind=capability + CapabilityHooks 接口 JSDoc；npm script: gen:content；柔性系统 5 页由 sub-agent 从 fluid-system-plan/fluid 包源码取证撰写（formForWidth 实际为 sheet/dialog/popover 三档——按源码诚实写，非 DEVICE 五档）；验证：build 144 页全编译 + CDP 实测四区切换/各区抽页 H1/移动端零横滚/零报错，截图 docs-four-sections.png 入档

### B5 · 博客 + 搜索 + i18n
**文件**：`07-blog-changelog` `09-search-i18n`
**输入**：changeset 流程 + i18n-plan
**输出**：博客列表/详情 + 搜索（Cmd+K）+ 中英文切换
**验收**：
- [ ] changeset → changelog 自动生成
- [ ] 搜索 1000 页 < 200ms
- [ ] 切换语言 URL 正确

> **★#389 框架能力全面落地（用户「官网是第一个能力展示验证场——所有东西都用框架内置能力」）**：**① G-07 液态玻璃首落地**——新组件 `pg-glass`（glass-plan B1：Web L1+L2，preset 七表 + intensity 三档 + tint/radius/border/noise + `prefers-reduced-transparency` 降级实色 + `@supports` 链）；官网接入：导航栏 preset=navigationBar（**消除手写 backdrop-filter——CSS017/GLS001 合规**）+ 数字背书 8 卡 preset=card（噪点 0.03）；★components:audit 门禁实测拦截裸 window.matchMedia → 改 globalThis 探测（MP 安全降级）；**② 全局注册**：main.ts +pg-glass/p-segment/p-toast；**③ TransformDemo 升级**：手写 Tab 按钮 → **p-segment** 分段控件（仅颜色主题化）+ **p-toast** 复制反馈；**④ 视觉质感**：Hero 双品牌辉光（brand/brand2 radial）、玻璃数据卡 hover 描边、支柱/能力卡 v-p-hover 全覆盖。验证：build + D-2 PASS（26/71）+ 全量 1998/1998（含 components:audit 三门禁）+ CDP 实测（navGlass/glassCards×8/blur(20px)/零报错）

### B6 · 埋点 + 小程序版
**文件**：`10-analytics-feedback` `11-mp-version`
**输入**：DevTools TraceBus + 小程序 Skyline 约束
**输出**：TraceBus 埋点 + website-mp 可浏览文档
**验收**：
- [ ] 事件全走 TraceBus
- [ ] 小程序 30 页内可浏览全部文档
- [ ] 分享卡片正确跳转

### B7 · 性能 + SEO
**文件**：`12-performance-seo`
**输入**：Build plan SSG + 缓存策略
**输出**：全站 SSG + CWV 达标 + sitemap
**验收**：
- [ ] Lighthouse ≥ 95
- [ ] CWV 真实数据全绿
- [ ] sitemap 收录全部页

### B8 · 测试 + 上线
**文件**：`13-testing-e2e` + 全量审计
**输入**：testing-plan 矩阵
**输出**：单元/组件/契约/E2E 全绿 + CI 门禁
**验收**：
- [ ] `proteus audit all` 零违规
- [ ] Playwright 关键路径全过
- [ ] 小程序真机 E2E 通过

## LLM Prompt 模板（每批复用）

```
你是 Proteus 框架开发专家。当前任务：执行 Website B{n}。

【上下文】
- 只读：00-overview.md + {当前批文件} + {直接依赖文件}
- 不读：其他批次文件（防上下文撑爆）

【输入】
{依赖层产物路径}

【输出】
{本批应产出的文件/模块清单}

【验收】
{可勾选的验收标准}

【约束】
- 全站用 p-* 组件，禁第三方 UI
- 内容即数据，MDC 扩展
- 产物可审计（对齐 --trace-transform）
```

## 进度追踪

| 批 | 状态 | 依赖 | PR |
|----|------|------|-----|
| B1 | 🟡 部分（website/ 骨架落地，design tokens 沿用 v3） | - | #374 |
| B2 | 🟡 部分（文档系统 MVP：引擎 #365 + 10 指南/侧边栏/官网应用 #374；codegen API 页待） | B1 | #374 |
| B3 | 🟡 内核落地（#375；Monaco/Worker/CLI 深度对账随 B4） | Compiler | #375 |
| B4 | 🟡 部分落地（#376/#377：首页深化对齐 01-home + p-* 标签真实落地 + IR Tab + D-2 审计 CI；#386 风格对齐 + #387 v3 构图重构 + p-split 插槽修复；Showcase 页待 Blueprint） | Blueprint | #376/#377 |
| B5 | ⬜ | B2 + i18n-plan | - |
| B6 | ⬜ | B1 + DevTools | - |
| B7 | ⬜ | Build plan | - |
| B8 | ⬜ | 全部 | - |

## 与 16 份 plan 的执行顺序建议

```
Sprint 1: Compiler + Types + Build（地基）
Sprint 2: Blueprint（验证数据来源）
Sprint 3: Website B1-B3（骨架 + Playground）
Sprint 4: Website B4-B8（内容 + 双端 + 上线）
```

**Website 可边做边验证其他层**——写官网发现 Component/Router 不足时，回填对应 plan。

## 验收（整份文档完成）

- [ ] 首页实时 transform 演示可跑
- [ ] 150+ 文档页全量构建 < 60s
- [ ] Skyline 小程序版可浏览全部文档
- [ ] `proteus audit all`（docs/api/module/capability/website）零违规
- [ ] Lighthouse 四指标 ≥ 95
- [ ] llms.txt 被 LLM 工具正确抓取
