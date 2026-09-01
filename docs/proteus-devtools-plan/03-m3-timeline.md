# M3 — 时间轴与泳道

> **★实现状态（2026-08-31）**：**数据层已落地**——`@proteus-vue/devtools-runtime` 新增 `createTimelineCollector`（start/end 配对构建 Span + 同 source 嵌套 children 树 + 孤儿 end/point/error 竖线 duration 0 + flushOpen 标 pending + query 过滤 source/name/minDurationMs/traceId + 缓冲上限 10000 + stats），TraceBus `on()` 订阅直喂，11 用例全绿；UI 渲染层（泳道/缩放/虚拟滚动）待面板工程（v1.0+）。

## 目标

把 TraceBus 事件渲染成多泳道时间轴，开发者一眼看到"哪一层在哪个阶段卡了多久"。

## 泳道布局

```
Lifecycle  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Router     ━━╲━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Store      ━━━━━━━━╲━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
API        ━━━━━━━━━━━━━━━━╲━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Capability ━━━━━━━━━━━━━━━━━━━━╲━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Compiler   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━╲━━━━━━━━━━━━━━━━━━━━━
```

每条横线段 = 一个 `phase: 'start'/'end'` span；点事件 = 竖线。

## 数据结构

```ts
interface Span {
  id: string
  source: Source
  name: string
  start: number
  end?: number
  children: Span[]
  meta?: Record<string, unknown>
}
```

由 `start`/`end` 事件配对构建；孤儿 `end` 记为耗时 0；未结束 span 在缓冲 flush 时标记 `pending`。

## 关键交互

- **点击 span → 看详情**：payload JSON + source map 定位到源码（调 Compiler 的 `locate(id)`）
- **跳转源码**：`file:line:col`，Web 打开 Vite 中间件，小程序打开本地 IDE（file scheme）
- **缩放 / 拖拽**：虚拟滚动，万级 span 不卡（分块渲染 + canvas 降级）
- **过滤**：按 source / name / 最小耗时 / traceId

## 性能预算（M7）

- 万级 span 首屏渲染 < 200ms
- 单 span 对象 < 200 bytes（复用字符串池）
- 离屏 span 不创建 DOM 节点

## 依赖

仅依赖 TraceBus（M1）事件流；UI 框架无关（可用 Vue / Preact / Lit）。

## 验收

- 注入 10000 个随机 span，时间轴渲染帧率 ≥ 50fps
- 点击 span 详情面板显示 payload 且源码定位准确（fixture 校验）
- 过滤后泳道只剩匹配 span，且无残留
