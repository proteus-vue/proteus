# 04 · 分批执行计划

## 0. 当前基线（2026-09-16 · 批次 3 宿主能力全部收口）

```
属性覆盖：294/325 = 90%（棘轮底线 294）
p-button 21/21 ✅（100%，范式参考实现）
★批次 1（高频表单）**全部 ✅**
★批次 2（容器与外壳）**全部 ✅**：p-view 4/4 · p-text 7/7 · p-icon 3/3 · p-image 7/7（含 cover-image）
  · p-page-container 9/9 · p-scroll-view 40/40 · p-router-link 13/13（navigator 语义纠偏）
  · p-nav-bar 6/6（navigation-bar 语义纠偏）
★批次 3（宿主能力）**全部 ✅**：p-media(video) 47/47 · p-map 29/29 · p-camera 5/5 · p-canvas 3/3
  · p-webview 1/1 · p-ad 4/4 · p-rich-text 4/4 · p-draggable(movable-view) 13/13
剩余（非本批）：p-input 12/26 🔶 · p-adaptive 0/7 · p-transition 1/8 · p-form 0/2 · p-list-view 0/1
下一批 = 批次 4（属性降级声明 M6）/ 批次 5（无对应组件评估）
```

> ★**标尺精度修复（2026-09-16）**：官方文档页把**子对象 schema**（map 的 marker/polyline/polygon/circle/
> control/position 字段、rich-text 的 node/text 字段）与组件属性**混在同页的不同 h2 区块**——此前**全页扫描**
> 把它们一并计入属性清单（map 61→43、rich-text 8→4；官方属性总数 793→771），制造**虚假缺口**，
> 且会诱导把端私有结构固化成框架语义（违反 G-31 铁律）。生成器改为只采四类区块
> （通用属性 / 属性说明 / Skyline 特有属性 / WebView 特有属性）。
> 连带修正：**棘轮阈值改由 `alignment-ratchet.json` 驱动**（此前 `package.json` 硬编码 `--min 128`
> 而 JSON 记 207 → 文档声称的底线从未真正执行，属软门禁）。

> ★**标尺语义纠偏（2026-09-14）**：官方 `<navigator>`（声明式**导航链接**）此前被错映射到 `p-nav`（导航**栏**）——
> 已按 SSOT `packages/component-ir/src/audit.ts` 纠正为 `engineering.router-link` = `p-router-link`（E18）；
> 官方 `<navigation-bar>`（导航条）→ `shell.nav` = `p-nav-bar`。同时 `worklet:*` 回调不再计入属性缺口。


## 1. 批次划分（按重要性/使用频率）

### 批次 1 · 高频表单控件（★已完成）
| 组件 | 官方属性 | 当前 | 目标 |
|---|---|---|---|
| `p-switch` | 3 | 3 | **3/3 ✅**（官方 type 登记为有意不沿用） |
| `p-slider` | 10 | 10 | **10/10 ✅** |
| `p-progress` | 9 | 9 | **9/9 ✅** |
| `p-checkbox` | 4 | 4 | **4/4 ✅** |
| `p-radio` | 4 | 4 | **4/4 ✅** |
| `p-textarea` | 21 | 21 | **21/21 ✅** |
| `p-picker` | 3 | 3 | **3/3 ✅** |
| `p-label` | 1 | 1 | **1/1 ✅** |

**理由**：表单是最常用的一组，且属性数中等（易一次做对）。

### 批次 2 · 容器与外壳（★已完成）
| 组件 | 官方属性 | 当前 | 目标 |
|---|---|---|---|
| `p-scroll-view` | 40 | 40 | **40/40 ✅** |
| `p-view` | 4 | 4 | **4/4 ✅**（含 cover-view 私有属性登记 INTENTIONAL_SKIP） |
| `p-page-container` | 9 | 9 | **9/9 ✅** |
| `p-router-link`（navigator） | 13 | 13 | **13/13 ✅**（语义纠偏：navigator 是链接，SSOT → engineering.router-link） |
| `p-nav-bar`（navigation-bar） | 6 | 6 | **6/6 ✅**（语义纠偏：navigation-bar → shell.nav） |
| `p-image` | 7 | 7 | **7/7 ✅**（含 cover-image 的 referrer-policy） |
| `p-text` | 7 | 7 | **7/7 ✅** |
| `p-icon` | 3 | 3 | **3/3 ✅** |

### 批次 3 · 宿主能力（含降级声明）（★已完成 2026-09-16）
| 组件 | 官方属性 | 当前 | 要点 |
|---|---|---|---|
| `p-media`（video） | 47 | **47/47 ✅** | 播放控制 + show-* 控件显隐族 + 手势族 + 弹幕族 + 画中画族 + 投屏/截屏/后台播放 + DRM 族 |
| `p-map` | 29 | **29/29 ✅** | 缩放族 + 图层族（polyline/circles/polygons/include-points）+ 个性化 + 视角 + 交互族 + setting |
| `p-camera` | 5 | **5/5 ✅** | mode / resolution / device-position / flash / frame-size（+ stop/scancode 事件） |
| `p-canvas` | 3 | **3/3 ✅** | type→engine 归一 + canvas-id + disable-scroll |
| `p-webview` | 1 | **1/1 ✅** | src 已验证；补 load 事件（跨端同名） |
| `p-ad` | 4 | **4/4 ✅** | unit-id / ad-intervals / ad-type / ad-theme |
| `p-rich-text` | 4 | **4/4 ✅** | nodes / space / user-select / mode（source 为 nodes 别名） |
| `p-draggable`（movable） | 13 | **13/13 ✅** | ★由 Web-only 升级为双端：MP 原生 movable-area/movable-view（含 area 侧 scale-area） |

**★本批要点（与批次 1/2 的差异）**：
- **宿主能力组件多为「MP 原生 + Web 降级」双分支**——Web 端无标准 API（地图/相机/广告/DRM/画中画）
  时**诚实占位或明确降级**，不伪造行为（延续 p-webview 既有纪律）。
- **属性归一按 tag 限定**（`SEMANTIC_ALIAS_BY_TAG`）：官方 `canvas.type` → 框架 `engine`（含 skia）、
  官方 `rich-text.nodes` → 保留 nodes（`source` 为别名）、官方 `movable-view.scale`（布尔）→ `scaleEnabled`
  （避免与 `scaleMin/Max/Value` 数值族混读）。**同名不同义**不能进全局别名表。
- **子对象 schema 不算组件属性**（标尺精度，见 §0 注）——marker/node 字段属数组元素结构。

### 批次 4 · 属性降级声明（M6）
全组件属性补 `degradation`（EA-5）+ `PROP_NO_DEGRADATION` 门禁。

### 批次 5 · 无对应组件评估
43 个官方组件框架无对应，逐类判定：
- **应新增**：`swiper`/`checkbox-group`/`radio-group`/`open-data`/`page-meta`/`navigation-bar`（语义有价值）
- **归入已有语义**：`swiper-item`/`sticky-header`/`root-portal`（并入现有原语属性）
- **不纳入（NA）**：`channel-live`/`voip-room`/`store-*`/`grid-builder`/`list-builder`（微信商业/内测能力，写明理由）

## 2. 每批的标准作业流程（SOP v2 · ★p-button 范式）

> **本 SOP 是「推进范式标准」**——★参考实现 = **p-button**（首个走完全流程的组件：属性 21/21 = 100%、
> 双端事件契约打通、主题通道接入、API 表全量、4 类回归锁 + 破坏性验证、Web Playwright + MP 真机双端验证）。
> 后续每个组件按此 13 步执行，**不得跳步**。

### 2.1 属性对齐（能力面）

```
① 抓属性   node scripts/gen-mp-component-attrs.mjs --only <tags>
② 看缺口   node scripts/audit-component-attrs.mjs   → 目标 100%（或文档化例外）
③ 逐属性判定  语义归一 / 保留 / 标 private（对齐 02 命名策略）
④ 改三层   IR props 登记（primitives.ts）→ defineProps 声明 → 模板绑定
```

**★踩坑铁律**：
- **事件按 schema `type === 'eventhandle'` 过滤**，不要只看 `bind:`/`catch:` 前缀——官方存在
  **无值事件**（如 `button.createliveactivity`、`movable-view.htouchmove/vtouchmove`），仅看前缀会误算为属性缺口。
- audit 的语义别名（`SEMANTIC_ALIAS`）已覆盖常见归一（`value`↔`modelValue`、`checked`↔`modelValue`、
  `active-color`↔`activeColor`、`show-value`↔`showInfo`…）；新归一需同步该表。

### 2.2 双端实现（行为面）

```
⑤ 平台分支  两端行为不同时：`v-if="isMp"` 原生标签 / Web 实现（★参考 p-camera / p-switch）；
             或平台变体文件 `.mp.vue`/`.web.vue`（见 platform-variant-plan）
             ★isMp 必须 computed(() => isMpRuntime())——直调会成实例属性，模板读不到（真机踩坑）
⑥ 事件契约  ★事件名与 MP 原生 `bind:<name>` 对齐（Web 发**同名**降级事件）——
             跨端一个 `@change`/`@contact` 通吃。★查权威源 docs/generated/*.json，勿凭印象命名
             （反例：曾把 open-type 事件编成 opencontact，官方根本没有 bindopencontact）
⑦ 多词属性  ★Web 模拟层（inheritAttrs:false 且未声明 props）必须兼容 **kebab 键**：
             `:open-type` 到达时是 `attrs['open-type']`，不是 `attrs.openType`（单字属性无此问题，会掩盖）
⑧ 主题通道  有色彩语义的组件接 `p-theme--*` 单类变体（编译器通道，见 component-theme-plan）
```

### 2.3 演示与文档

```
⑨ 演示页   showcase/subpackages/components/pages/<tag>.vue —— 基础/禁用/官方属性/主题 演示块
             ★演示页须能真交互（输出区回显真实事件/状态），不摆静态图
⑩ API 表   ★Props/Events/Slots 表 ⊇ defineProps/defineEmits（门禁 tests/showcase-api-table.test.ts）
```

### 2.4 验证与门禁

```
⑪ 回归锁   单测覆盖：属性映射 + 事件契约 + 关键行为；★每条锁必须做**破坏性验证**（改坏 → 应变红）
⑫ 两端验证  Web（Playwright 真实交互）+ MP（模拟器截图 + automator evaluate）
             ★MP 端 assert 用「产物独有标记」，别用基础样式的巧合值（假阳性来源）
⑬ 门禁     check:mp-attrs（棘轮）/ tests/showcase-api-table / test:e2e:showcase
```

> **Skyline 全部坑的单一总账见 [`docs/skyline-pitfalls.md`](../skyline-pitfalls.md)**（S1-S29，含实测依据与已落成防护）；下表是本 SOP 的流程级陷阱索引（T 序）。

### 2.5 关键陷阱索引（p-button 实战沉淀）

| # | 陷阱 | 后果 | 处置 |
|---|------|------|------|
| T1 | 事件名凭印象编（`opencontact`） | 跨端契约断裂、事件静默失效 | 查 `docs/generated/*.json` 权威清单 |
| T2 | 多词属性 kebab/camel 不兼容 | `open-type`/`hover-class` Web 端静默失效 | `pick(camel)` camel 优先 + kebab 回退 |
| T3 | 父级 hover-class 覆盖框架默认类 | Web 按下无反馈 | 框架默认类恒在，自定义类作**附加** |
| T4 | 改框架源码未重建 dist | 基于陈旧产物得出错误结论 | 每次改 src 先 `pnpm --filter <pkg> build` |
| T5 | CSS 注释含 `{` | 编译器选择器正则吞声明 | 注释内禁花括号（已根治，见 compiler/style.ts） |
| T6 | E2E 用绝对坐标未滚动 | 页面变长后假阴性 | `scrollIntoViewIfNeeded()` 后再操作 |
| T7 | `<style src>` 变体解析漏 `?query` | Web 构建 ENOENT | resolveId 剥离 query |
| T8 | **状态视觉两端不一致**（原生 disabled 灰化强弱不一） | 同状态两端看起来不同 | 由**组件包装层**统一表达状态视觉（淡化/指示器），不依赖原生默认 |
| T9 | **loading 与 disabled 视觉相同**（都只淡化） | 用户无法区分「加载中」与「已禁用」 | 加载须有**独有指示**（旋转 spinner），且淡化值区别于禁用 |
| T10 | 原生 `type` 变体在 Web 只改圆角 | 两端形态不一致（如 checkbox 方框 vs 开关体型） | Web 侧须渲染成**对应形态**（小方框+勾选），含尺寸 |
| T11 | **单边异色 border + 圆角**（`border-top-color` 画缺口弧） | Skyline 下 `border-radius` **失效 → 圆环变方块**（真机四组对照实验定论） | 用「**统一色 border 环 + 随转子元素点**」画 spinner；编译器已加 `border-*-color` 告警 |
| T12 | **模板动态拼接类名**（`` `p-switch--${shape}` ``） | 编译器无法静态后缀 scopeId → MP 端变体类**整体丢失**（Web 正常，故只在真机暴露） | `:class` 必须用**字面量键**（`'p-switch--square': shape === 'square'`） |
| T13 | **平台历史包袱形态**（官方 `switch type=checkbox`） | 「对齐官方」会把平台设计失误固化进框架（G-31 铁律禁止） | 平台私有形态登记为「**有意不沿用**」（`audit INTENTIONAL_SKIP` + 理由），改用语义更纯的框架属性（如 `shape`） |
| T14 | 状态指示器位置（spinner 应随把手） | 指示器飘在组件中央、与滑块脱节 | 指示器放在**控件内部用 flex 居中**（两端天然一致），而非绝对定位估算 |
| T15 | **PascalCase 组件标签**（`<PSafe>`）或**缺连字符**（`<pgrid>`） | 编译器 kebabCase 旧实现产出 `psafe`/`pgrid` → gen-routes 找不到目录 → `usingComponents` 未注册 → **组件静默不渲染** | 框架组件标签**一律小写 kebab**（`<p-safe>` `<p-grid>`）；`kebabCase` 已修 Vue 标准（`/\B([A-Z])/`）；`tests/component-tag-hygiene.test.ts` 门禁扫描 |
| T16 | **新增页面只跑 build:showcase:web** | `runGenRoutes` **仅在 MP 目标执行**（`needsGenRoutes = isMp`），而 `auto-routes.ts` 是 Web/MP **共用**路由表 → 新页 Web 端 **404 / 产物缺路由**（无报错，静默） | 新增/删除页面后**先 `build:showcase:mp` 刷新路由表，再 `build:showcase:web`**（仅 Web 在跑时也要先补一次 MP 构建） |
| T17 | **中性标签组件**模板写自绘结构（如 picker 自绘滚轮） | 绕过仓库既有 weui 对齐实现（WebPicker），重复造轮子且视觉更差 | 组件模板写**原生标签**（`<picker>`/`<slider>`/`<progress>`/`<textarea>`）；Web 插件改写为框架自有实现、MP 保留原生（复用两端标准件，零重复） |
| T18 | **模板表达式内函数调用**（`{{ list.join(', ') }}` / `{{ actLabel(act) }}` / `:style="actStyle(act)"`） | WXML 不支持函数调用 → 真机运行期抛 `Cannot convert undefined or null to object`，**中断子节点创建/绑定更新 → 该页事件链整体失效**（如 picker 确认后不更新），且**编译器此前不告警 = 静默** | 改为 **computed 派生数据**（或方法内预计算）；编译器已加 `warnTemplateMethodCall` 告警 + `tests/mp-transform.test.ts` 回归锁 |
| T19 | **computed 体内 `obj.value`**（点号取属性，如 `act.value`） | 编译器 ref 剥离规则误伤为 `this.data.value`（同 `props.value` 坑，已第二次踩） | computed 体里的属性取值用**方括号** `obj['value']`；编译器「未在顶层 data 定义」告警可辅助发现 |
| T20 | **真机 picker 问题先折腾模拟器自动化** | 元素选择器/坐标 tap/touch 序列在 p-* 组件与离屏窗口下**全部无效**，耗时极长；而问题本来一眼可见 | ① 先 `get_simulator_console --command 'grep -n .'` 读**真机报错**；② 形态/视觉问题**直接要/看两端截图**，不用自动化复现人眼一秒能看清的东西 |
| T21 | **擅自重构「已对齐」的实现**（如把 weui 对齐的 WebPicker 改成自认为的原生形态） | 改坏已正确的实现；且判断依据只是**自己一张旧版/非标准截图或直觉**，非权威规范 | **权威标准（weui 规格 / 官方示例 / 用户认可的实现）> 我的直觉**；用户说「差得很远」时**先确认哪一端是基准**；已对齐的实现要改**先对照规范或先问** |
| T22 | **把 weui/官方形态当「教条」无条件照搬**（含陈旧/非现代设计） | 固化过时形态（如原生 picker「取消/确定」顶栏），与两端一致的现代体验相悖 | **weui 是参考不是教条**：吸收**正确的（现代）**设计（如半屏弹层 × + 居中标题 + 灰 indicator + 底部主按钮），**陈旧/非现代的设计不必照搬**；判定依据是**「设计是否现代/正确」，不是「是否出自 weui」**（见 `docs/weui-spec-reference.md` §0，与 G-31 一致） |
| T23 | **组件根写原始 HTML 标签**（`<div>`/`<span>`/`<img>`） | Web 端保持原生元素 → **Web 模拟层不介入**（hover 反馈/长按菜单/scroll 事件全部静默失效）；MP 端正常 | 组件模板用**小程序标签**（`<view>`/`<text>`/`<image>`）——Web 插件改写为 `proteus-*` 复用模拟层（`docs/skyline-pitfalls.md` S50） |
| T24 | **组件 emit 直接透传 MP 原生事件对象** | `triggerEvent` 再包一层 detail → 父级 `e.detail.scrollTop` 恒 undefined（滚动数字不变化） | emit **裸载荷**：`emit('x', e?.detail ?? e)`；父级统一读 `e.detail.x`（S51） |
| T25 | **`<text>` 上写尺寸/flex/transform** | Skyline `<text>` 是行内文本节点，盒模型/transform 全失效（图标不显示、旋转中心偏） | 「盒 + 字形」用 `<view>` 盒承载（`transform-origin:50% 50%`），字形放内层 `<text>`（S52） |
| T26 | **URL-encoded SVG data-URI 给 `<image>`** | Skyline 只完整渲染 **base64** SVG → URL-encoded 落**灰色方块** | data-URI 一律 `data:image/svg+xml;base64,<b64>`（S53） |
| T27 | **父级手写 `@update:show`** | 编译器原样输出 `bind:update:show`（双冒号）与子组件单段 `update-show` **永不匹配** → 遮罩点遮关不掉 | 用 `v-model:show`；编译器已把 `@update:{arg}` 归一为 `update-{arg}`（S54） |


## 3. 验收标准（每批 · v2）

| 项 | 要求 |
|---|---|
| 属性覆盖 | 该组件 **100%**（T3 私有属性可标 `unsupported` 并写明理由；不许静默缺） |
| 事件契约 | 事件名与 MP 原生 `bind:<name>` 对齐（跨端同名）；Web-only 降级事件显式标注 |
| 双端一致 | Web（Playwright 真实交互）+ MP（模拟器截图/evaluate）**结论一致** |
| 门禁 | `check:mp-attrs` 棘轮不退化 + `tests/showcase-api-table` 绿 + `test:e2e:showcase` 绿 |
| 演示 | showcase 详情页有该组件的演示块（真交互 + 输出回显） |
| API 表 | Props/Events/Slots 表 ⊇ defineProps/defineEmits |
| 回归锁 | 属性映射 / 事件契约 / 关键行为各有单测，**且破坏性验证过** |
| IR | `primitives.ts` 的 props 已同步（语义归一登记） |

## 4. 执行 Prompt 模板（供后续会话直接使用）

```
按 docs/proteus-end-alignment-plan/04-batches.md 批次 1 执行，选 <组件> ：
严格走 SOP v2（2.1-2.4 共 13 步，不得跳步）：
  属性对齐（audit → 100%，事件按 type 过滤）→ 双端实现（isMp 分支/变体；事件名对齐；kebab 兼容）
  → 演示页 + API 表 ⊇ defineProps/defineEmits → 回归锁（破坏性验证）→ 双端验证 → 门禁。
★参考实现：p-button（src/components/p-button/index.vue + showcase/.../p-button.vue）——
  它是唯一走完全流程的样本，照它的门禁与注释密度做。
```
