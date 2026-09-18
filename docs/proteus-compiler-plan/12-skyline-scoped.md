# 12 - Skyline scoped CSS 重构：类名后缀拼接（单类选择器）

> 状态：✅ 批次 1-4 完成（2026-08-30）——单类选择器 + text 行内限制说明
> 关联：`f48460c`（属性选择器 → class 复合）、`0b16523`（单 class 属性合并）、`d907a1a`（root-class 透传）

## 附：Skyline 布局能力差异（行内布局不支持，2026-08 真机实测）

- **Skyline 引擎不支持 inline 布局**（官方 WXSS 文档：`Inline 布局 × 开发中`）——`display: inline` 在 Skyline 下无效
- text 等行内语义元素在 Skyline 下**默认 block/flex**（单独占一行是引擎行为，非样式问题）——
  `.proteus-text-inline { display: inline }` 类规则在 Skyline 无效（曾尝试 tag 选择器 + tagNameStyleIsolation: legacy，
  当前开发者工具校验拒绝该配置）
- **行内排布正确姿势**：外层 `display: flex` 容器（微信官方 Skyline 模式，用户实测有效）——如
  `<view class="row" style="display:flex;align-items:center"><switch/><text>文字</text></view>`
- **双端影响**：WebView/Web 的 inline 正常；Skyline 需 flex——框架文档透明化（示例 mp-semantics-demo 的 .msd-row 已用 flex）

## 一、背景与证据链

### 现状（class 复合选择器方案，f48460c 起）

```
模板：  <view class="data-v-f2bc39 cd">          ← scope class 与用户 class 同属性多值
样式：  .cd.data-v-f2bc39 { padding: 48rpx }     ← 复合类选择器（.a.b）
```

### 真机实测现象（Skyline 1.4.7 / 基础库 3.17.2）

1. 页面 `.box.data-v-f2bc39` → p-view 外层容器 box 样式（边框/内边距/margin）不生效
2. **组件自身 wxss `.p-button.data-v-e35be3` → p-button padding 不生效**（组件自己作用域内匹配自己的根节点都失效——排除样式隔离/apply-shared/root-class 穿透问题）
3. 无「选择器不支持」警告，仅属性级警告（user-select/object-fit）——Skyline 静默丢弃不支持的选择器规则（属性检查在规则解析阶段先行）

### 根因推断

Skyline（glass-easel 小程序实现）**不支持复合类选择器（`.a.b`）**，静默丢弃整条规则。
- 开源 glass-easel 的 `selector.ts`（`node.classList.contains` 无序匹配）与小程序 SDK 实现**不一致**（FAQ 明确小程序不可用开源子模块）
- Skyline WXSS 文档选择器表格：类选择器 ✓ / 后代 ✓ / 子代 ✓ / 分组 ✓ / 伪类 ✓ / 伪元素 ✓ / **属性 ×**——未列复合选择器
- 之前 `[data-v]` 属性选择器不兼容（文档 ×）→ 改 class 复合 → 仍不兼容 → **必须换「单类选择器」**

### 结论

**scoped 样式只能依赖 Skyline 确定支持的「单一类选择器」**——类名后缀拼接是唯一路径。

## 二、方案：scoped 类名后缀拼接

把 scope 信息**并入类名字符串**（而非并列 class）：

```
模板：  <view class="cd-data-v-f2bc39">            ← 用户类名 + '-' + scopeId 拼接为单一类
样式：  .cd-data-v-f2bc39 { padding: 48rpx }      ← 单一类选择器（Skyline ✓）
```

- 元素 class 值与选择器**同步后缀化**，单一类选择器匹配（确定性支持）
- scopeId 唯一（djb2 文件哈希）→ 类名全局唯一 → 无跨文件泄漏
- 与 Web 端 Vue scoped（`.cd[data-v-x]` 属性选择器）语义等价，只是机制不同

### 转换规则

| 输入 | 输出 |
|---|---|
| 选择器 `.box` | `.box-data-v-abc123` |
| 选择器 `.box:hover` | `.box-data-v-abc123:hover`（伪类后不加后缀） |
| 选择器 `.box .title` | `.box-data-v-abc123 .title-data-v-abc123`（每个类 token 后缀） |
| 选择器 `.box, .a` | `.box-data-v-abc123, .a-data-v-abc123`（逗号列表逐条） |
| `:deep(.box)` | 去包装 + 后缀 → `.box-data-v-abc123`（MP 简化：仅本文件元素可达） |
| `@keyframes` 帧选择器 | 不处理（无类 token） |
| 模板 `class="box"` | `class="box-data-v-abc123"` |
| 模板 `:class="['box', {active: on}]"` | 字符串字面量/对象键后缀化 → `{{'box-data-v-abc123 ' + (on?'active-data-v-abc123 ':'')}}` |
| 模板 `:class="base"`（变量） | ⚠ 无法静态后缀 → 编译期警告（该动态类名无 scoped 匹配，Web 端有——已知降级差异） |
| 语义基础类 `proteus-h1` | `.proteus-h1-data-v-abc123`（BASE_SEMANTIC_WXSS 与模板同步后缀） |
| transition 动画类 `proteus-transition-fade` | 同步后缀 |
| 组件标签 class（root-class 透传） | `root-class="box-data-v-f2bc39"`（后缀后透传） |

### 动态 class 降级（已知差异）

- `:class="变量"`：运行时值无法后缀 → 该变量类名无 scoped 匹配（编译期警告，反黑盒）
- 静态 class / 字符串字面量 / 对象键：全覆盖后缀 ✓
- Web 端不受影响（Vue 原生 scoped）

## 三、影响面

| 位置 | 改动 |
|---|---|
| `packages/compiler/src/style.ts` | scoped 块：选择器类 token 后缀化（正则替换 `.name` → `.name-scopeId`；跳过伪类/伪元素/帧/@规则；:deep 联动） |
| `packages/compiler/src/template.ts` | scoped 块：class 值后缀化（静态/字符串字面量/对象键；变量警告）；语义基础类、transition 类联动 |
| `packages/compiler/src/script.ts` | 无（rootClass property 已注入） |
| `packages/compiler/src/transforms/{template,style}.ts` | AI 说明书更新（style/scoped-css、template/scope-attr、component/root-class） |
| `BASE_SEMANTIC_WXSS` | 与模板后缀联动（常量改为模板侧按 scopeId 后缀？或保持前缀 + 后缀拼接） |
| 测试 | scoped 相关全部断言更新 + 新用例（单类后缀/动态变量警告/伪类/root-class 联动） |

## 四、分批实施（每批全绿提交）

- **批次 1**：`style.ts` 选择器类 token 后缀化（含伪类/伪元素/帧/逗号/媒体/@规则处理）+ 注册表 AI 说明书 + 测试
- **批次 2**：`template.ts` class 值后缀化（静态/字符串字面量/对象键 + 变量警告）+ 语义基础类/transition 联动 + 测试
- **批次 3**：root-class 透传联动（组件标签 class 后缀后透传）+ 嵌套组件 + 应用组件验证
- **批次 4**：examples 全量构建产物验证（wxss 单类选择器 + wxml 后缀 class）+ 全量 verify + 真机实测确认

## 五、风险与回退

- **动态 class 变量降级**：编译期警告（透明），后续可考虑运行时映射（v2.0）
- **类名冲突**：用户同时写 `box` 与 `box-data-v-xxx`（罕见）；scopeId 唯一性降低概率
- **Web 端**：零影响（Vue 原生 scoped 路径）
- **回退**：rules.disabled 关闭 style/scoped-css（现有机制）
- **验证失败场景**（若单类后缀仍不生效）：需重新审视 Skyline 样式隔离（ownerSpace/apply-shared 编译产物），但单类选择器为文档明确支持，置信度高

## 六、验收标准

- [ ] 页面 `.box` scoped 样式在 Skyline 生效（p-view 外层容器边框/内边距/margin）
- [ ] 组件自身 wxss（p-button padding 等）生效
- [ ] `:class` 字符串字面量/对象键生效；变量类名编译期警告
- [ ] `:deep`、伪类（:hover）、逗号列表、@media 内规则正确后缀
- [ ] root-class 透传组件标签 class 正确后缀
- [ ] 700+ 测试全绿；examples build:mp 产物确认
