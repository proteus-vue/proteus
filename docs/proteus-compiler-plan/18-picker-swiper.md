# 18 - picker / swiper 复杂组件专项（14-mp-first-semantics 批次 4 收尾）

> 状态：📋 规划中（2026-08-30）
> 前置：规划 14（MP 优先语义）+ 规划 17（weui-io-alignment 视觉对齐方法论）
> 目标：把能力矩阵里"待专项"的两个复杂组件（picker/swiper）补齐到 `full`——MP 端原生、Web 端对齐微信视觉与交互

## 一、为什么复杂（区别于已覆盖的简单组件）

已覆盖的 12 个组件（view/text/button/input/textarea/image/scroll-view/switch/slider/icon/progress/navigator）都是**单节点 + 少量属性**。picker/swiper 不同：

| 复杂度维度 | picker | swiper |
|---|---|---|
| 多模式 | selector（单选）/ multiSelector（多列）/ time / date / region（5 种） | 单模式但属性多 |
| 弹层 UI | 半屏滚动选择器（复用 actionsheet 弹层思路） | 无弹层 |
| 手势交互 | 滚动 + 惯性 + 取消/确定 | 滑动切换 + autoplay + 循环 |
| 数据流 | value 受控 + range/range-key + change 事件 | current 受控 + change 事件 |
| 视觉对齐 | 弹层列表、选中高亮、toolbar 按钮 | 指示点样式、切换动画 |

## 二、picker 设计

### 2.1 模式与属性（对齐微信）

| 模式 | 属性 | Web 实现 |
|---|---|---|
| selector | `range`（数组）/ `range-key`（对象字段）/ `value`（索引） | 半屏弹层：滚动列表 + 选中高亮 + 取消/确定 |
| multiSelector | `range`（二维数组）/ `value`（索引数组） | 多列滚动，列间联动 |
| time | `value`（'HH:mm'） | 时/分两列 |
| date | `value`（'YYYY-MM-DD'）/ `start`/`end`/`fields`（year/month/day） | 年/月/日三列，fields 裁剪列 |
| region | `value`（省市区数组）/ `custom-item` | 省/市/区三列（内置行政区划数据） |

### 2.2 交互对齐

- 触发：点击 picker 子元素（默认显示 slot 或 value 文本）
- 弹层：底部半屏（复用 proteus-web-actionsheet 结构：hairline 分割线、取消/确定 8px 间距、:active 反馈）
- 滚动列：滚轮 + 惯性 + 边界回弹（CSS scroll-snap 或 wheel 处理）；选中项居中高亮（加粗 + FG-0，其余 FG-1）
- 确定/取消：resolve `{ value, index }` 载荷对齐微信 change 事件
- 遮罩点击 = 取消（复用 mask）

### 2.3 Web 组件

```ts
// packages/web/src/components/picker.ts
export const WebPicker = defineComponent({
  props: { mode, range, rangeKey, value, start, end, fields, customItem, ... },
  emits: ['change', 'cancel', 'columnchange'],
  // 点击 → 弹层（DOM 挂 body）；滚动列选中；change 载荷 { value, index } 对齐微信
})
```

### 2.4 MP 端

原生透传（NATIVE_TAGS 已有 picker）——零改动。

## 三、swiper 设计

### 3.1 属性对齐

| 属性 | 微信默认 | Web 实现 |
|---|---|---|
| indicator-dots | false | 底部指示点（对齐微信：灰点/当前绿点 #07c160） |
| autoplay | false | setInterval 自动切换 |
| interval | 5000 | 自动切换间隔 |
| duration | 500 | 切换动画时长 |
| circular | false | 循环（首尾衔接） |
| vertical | false | 垂直切换 |
| current | 0 | 当前索引（受控，v-model 风格） |
| previous-margin / next-margin | 0 | 前后露出（translate 偏移） |
| display-multiple-items | 1 | 每屏多张 |

### 3.2 Web 实现

- 结构：`overflow: hidden` 容器 + flex 横向（或纵向）轨道 + 每项 `flex: 0 0 100%`
- 切换：`transform: translateX(-current * 100%)` + transition
- 手势：pointerdown/move/up 计算滑动距离 → 阈值切换（对齐小程序 swipe 手感）；touch-action: pan-y 避免垂直滚动冲突
- autoplay：interval 定时 + 鼠标悬停暂停（微信行为）；circular 首尾循环
- 指示点：`indicator-active-color`（默认 #07c160）/ `indicator-color`（默认 rgba(0,0,0,0.3)）——按规划 17 查 weui/微信默认值
- change 事件：`{ detail: { current } }` 对齐微信

### 3.3 视觉对齐（规划 17 流程）

- 指示点尺寸/间距/圆角：CDP 对照微信开发者工具或 weui.io
- 切换动画缓动：微信默认 ease
- swiper-item：仅作为 swiper 的直接子项（对齐微信约束，非直接子项警告）

## 四、批次拆分（防一次性撑满上下文）

| 批次 | 内容 | 验收 |
|---|---|---|
| B1 | picker selector（单选） | Web 弹层 + 滚动选中 + change 载荷；测试 + examples demo；CDP 视觉对齐 |
| B2 | picker multiSelector / time / date / region | 多列联动；区划数据内置（省市区精简版）；测试 |
| B3 | swiper 基础（指示点/切换/手势/current 受控） | Web 滑动 + 指示点 + change；测试 + demo；CDP 视觉对齐 |
| B4 | swiper 进阶（autoplay/circular/vertical/display-multiple-items/前后露出） | 全部属性 + 测试 |
| B5 | 双端实测 + 能力矩阵更新 + 规划 17 视觉对齐收尾 | examples 双端截图对比；能力矩阵 picker/swiper 转 full |

每批独立提交（verify 全绿），优先 B1。

## 五、风险与权衡

- **picker 弹层复用 actionsheet**：结构与交互相近（半屏 + 取消/确定 + hairline）——复用 `.proteus-web-actionsheet` 样式体系，避免重复视觉
- **swiper 手势**：Web 端 pointer 事件 + MP 端原生 swipe——两套实现但载荷统一（`{ current }`），与既有双端模式一致
- **region 数据**：内置完整行政区划过大（体积）——精简版（省 + 市 + 区首级）或按需加载，标注 `partial` 过渡
- **受控组件**：picker value / swiper current 需内部 ref 同步外部 props（slider 已有先例）

## 六、验收

- [ ] `<picker>` 5 种模式双端可用（MP 原生 / Web 弹层对齐）
- [ ] `<swiper>` 核心属性双端可用（指示点/手势/autoplay/circular/vertical）
- [ ] change 载荷对齐微信（picker `{ value, index }` / swiper `{ current }`）
- [ ] 视觉按规划 17 对齐（CDP 断言 + 测试 + examples demo）
- [ ] 能力矩阵 picker/swiper 转 ✅ full（region 可 partial 标注）
