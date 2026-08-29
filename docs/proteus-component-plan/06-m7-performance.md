# 超级应用加固 — 性能与可靠性（M7）

> 组件层在超级应用下的主要故障面：**长列表卡顿、内存只涨不降、频繁 setData、全局组件阻塞首屏**。
> 本文给出约束 + 机制 + 验收基线。

---

## 1. 长列表（M3）

### 强制规范
- `p-list-view` 必须使用 `item-key`（Skyline `recycleManager` 强制）
- 默认开启虚拟滚动 + `lazy-mount`
- 动态高度：提供 `item-size-estimated`，列表初始化后校准（避免滚动跳动）

### 性能基线（验收）
| 场景 | Skyline | Web |
|------|---------|-----|
| 10,000 节点静态列表 | ≥ 60fps | ≥ 50fps |
| 1,000 节点动态更新 | 无掉帧 | 无掉帧 |
| 滚动到 5,000 项 | 首屏 < 200ms | 首屏 < 300ms |

### 反模式（CI 阻断）
- 在 `v-for` 中用 `p-view` 手撸长列表（不用 `p-list-view`）
- `item` 内含 `p-toast` / 高频动画

---

## 2. 内存管理

### 组件销毁
- `onUnmounted` 必须清理：定时器、`IntersectionObserver`、`audioContext` 引用
- 页面级组件（MPA 小程序）随页销毁；**全局组件（appBar）禁止持有页面引用**

### 图片回收
- `p-image` 的 `recycle` 在列表内必须开启
- 图片缓存上限可配（默认 100 张），LRU 淘汰

### 内存基线
- 连续进出页面 50 次 → 内存波动 < 10%
- 长列表滚动 5 分钟 → 无线性增长（DevTools Memory 快照对比）

---

## 3. 渲染与 setData 优化

- 高频更新（progress/scroll）走 Worklet 或 `requestAnimationFrame`，禁止每帧 `setData`
- `setData` 数据 diff：只传变化字段，不传整个 list
- 动态 style 合并：组件内部 batch（同一帧多次 style 变更合并一次提交）

---

## 4. 懒加载与代码分割

- 业务组件默认懒加载（`defineAsyncComponent` + Skyline 分包）
- `p-player-bar`（appBar）常驻，但内部子面板（播放列表、歌词）按需加载
- 对应 Router M7.1 `chunk` 字段：业务组件归属 chunk，构建自动分包

---

## 5. 降级与容错

- 能力缺失（Worklet/手势/WebP）→ 统一 fallback + warn（见 `02`）
- 组件渲染异常 → `p-error-boundary` 兜底，不白屏
- 关键组件（播放条、支付）提供 `fallback` 插槽

---

## 6. 可观测（M8 联动）

- 每个组件渲染耗时：`__PROTEUS_DEV__` 下 `componentRender(p-view, 1.2ms)`
- 与 API `traceId`、Router `navTrace` 同源上报
- DevTools 面板：组件树 + 渲染次数 + 内存占用（见 `07`）

---

## 7. 验收清单
- [ ] 10k 列表性能基线通过
- [ ] 50 次页面进出内存稳定
- [ ] 所有高频动画走 Worklet（CI 静态检测）
- [ ] 所有降级路径有单测 + 快照
- [ ] `proteus audit component` 通过（无违规 import / 无全局泄漏）
