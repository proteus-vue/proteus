# 首页（Home）

## 目标

让用户 **30 秒内理解 Proteus 的三个核心差异**：
1. 透明编译（编译产物可审计）
2. AI-native（transforms 对 AI 可读）
3. 一份内容双端（Web + Skyline）

## 页面结构

### 1. Hero 区
- 标题：`The self-evolving Vue framework for Web + WeChat Skyline`
- 副标题：`透明编译 · AI-native · 产物可审计`
- CTA：`快速开始`（→ /docs/guide） + `在线体验`（→ /playground）
- 背景：抽象节点树动画（IR → 三端产物）

### 2. 三大卖点（核心价值主张）
```
┌─────────────────────────────────────────┐
│  透明编译                               │
│  每条 transform 独立可关，产物可审计      │
│  --trace-transform 看完整链路            │
├─────────────────────────────────────────┤
│  AI-native                              │
│  transforms/ 模块化，AI 能读能改能排查    │
│  配套 llms.txt 供 agent 消费            │
├─────────────────────────────────────────┤
│  一份内容双端                            │
│  .vue → Web SPA + Skyline 原生四件套     │
│  app.json / pages.json 自动派生          │
└─────────────────────────────────────────┘
```

### 3. 实时 Transform 演示（杀手功能）⭐

**这是全站最核心的交互**——别的框架官网只放静态代码块，Proteus 放**真实可跑的 transform 过程**：

```
┌──────────────────────────────────────────────┐
│ 左侧：可编辑 .vue                             │
│ ┌──────────────────────────────────────────┐ │
│ │ <template>                               │ │
│ │   <view v-if="show">                     │ │
│ │     {{ msg }}                            │ │
│ │   </view>                                │ │
│ │ </template>                               │ │
│ └──────────────────────────────────────────┘ │
│  ↓ 实时编译                                  │
│ 右侧 Tab：IR | Web | Skyline | Trace         │
│ ┌──────────────────────────────────────────┐ │
│ │ IR：                                     │ │
│ │ { type:'Element', tag:'view',            │ │
│ │   directives:[{name:'if',...}] }         │ │
│ │                                          │ │
│ │ Skyline (.wxml)：                         │ │
│ │ <view wx:if="{{show}}">{{msg}}</view>    │ │
│ │                                          │ │
│ │ Trace：                                  │ │
│ │ transformVIf (pages/home:3) → wx:if      │ │
│ └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

**技术实现**：
- 浏览器内跑 Compiler（见 `05-playground.md`）
- IR 导出 + TraceBus 采集 trace（复用 devtools-plan TraceBus）
- 防抖 300ms，避免频繁重编译

### 4. 数字背书区
从 Blueprint 验收结果取数（mock → 真实）：
- `150+` 页面验证
- `12s` 全量审计
- `60fps` 万级长列表
- `0` 编译黑盒

### 5. 快速开始（3 步）
```bash
npm create proteus@latest my-app
cd my-app && npm i
npm run dev
```

## 设计系统接入（dogfooding）

首页**全部用 `p-*` 组件**：
- `p-hero` `p-feature-card` `p-code-editor` `p-tabs` `p-cta`

**禁止引入第三方 UI 库**——这是 dogfooding 的底线，也是最好的案例。

## 验收

- [ ] 实时演示在低端机也能 60fps（用 Web Worker 跑 Compiler）
- [ ] 首屏不加载 Compiler WASM（懒加载，交互时才拉）
- [ ] 三大卖点文字 ≤ 20 字/条，一眼可读
- [ ] 全站主题切换（暗色/亮色）无闪烁

## 依赖

- `08-design-system.md`（p-* 组件）
- `05-playground.md`（Compiler WASM）
- `10-analytics-feedback.md`（演示交互埋点）
