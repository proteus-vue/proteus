# 长列表回收（Recyclable Views）

> 组件层不变量：**超过阈值即强制回收，禁止全量 VNode 假设。**

---

## 为什么必须强制回收

uni-app 的 `v-for` 为**所有**列表数据创建 VNode，即使节点未进视口 → 内存 = 数据量 × 每项错误节点数，线性数据集被放大为陡峭曲线。

`uni-recycle-view` 只创建有限 VNode 并循环复用，但**仅适用于单 `for` 场景，2.0 起要求 item 高度一致**——说明"有限 VNode"是有约束的架构方案，非万能渲染模式。

**Proteus 不能只提供单一 VirtualList**，须区分四种策略。

---

## 四种回收策略

| 策略 | 适用 | 核心机制 |
|------|------|---------|
| **RecycleView（定高）** | item 高度一致 | 固定尺寸池 + 绝对定位偏移 |
| **DynamicRecycleView** | item 高度未知 | 测量缓存 + 估算 + 滚动校正 |
| **WaterflowView** | 瀑布流 | LayoutProvider 分列 + 最小高度优先 |
| **KeyedStateCell** | 富交互（表单/播放器） | key 绑定状态，复用不丢输入 |

### 1. RecycleView（定高）

```vue
<pg-recycle-view :data="list" item-height="60" :threshold="50">
  <template #item="{ item, index }">
    <list-item :data="item" />
  </template>
</pg-recycle-view>
```

- 只创建**可见窗口 + 缓冲区**数量的 VNode（如视口 10 项 + 缓冲 5 项 = 15 个）
- 滚动时**复用 DOM/原生 View**，只更新数据绑定
- `threshold`（默认 50）：超过即强制回收，Compiler 构建期可配置

### 2. DynamicRecycleView（动态高）

- 首次渲染用**估算高度**，渲染后**实测并缓存**
- 缓存按 `key` 持久化，滚动回退不重测
- 高度突变时触发**局部重排**（仅受影响的后续项）

### 3. WaterflowView（瀑布流）

- 独立 `LayoutProvider` 计算分列，每列维护自身高度
- 新 item 插入**当前最矮列**
- Cell 回收与定高策略一致

### 4. KeyedStateCell（富交互）

- 用 `:key` 绑定业务 id，**复用池按 key 保留状态**
- 解决"复用导致输入框内容错位、播放器重置"等常见问题
- 状态超过池上限时按 LRU 淘汰到分页仓储

---

## list-data 与 list-view 分离

**关键设计**：数据源（领域模型）与视图（窗口数据）**解耦**。

```vue
<pg-list-data :source="repository" :page-size="20">
  <pg-list-view v-slot="{ window }">
    <pg-recycle-view :data="window" />
  </pg-list-view>
</pg-list-data>
```

- `repository`：管理**全量/分页数据**，可序列化、可缓存
- `window`：当前可视窗口的**切片**，视图只绑定它
- 图片 URL / 缩略图尺寸作为**数据契约**一部分（支持占位 + 分块解码，见 `06-image-memory.md`）

---

## 构建期强制（Compiler 集成）

Compiler 扫描模板，触发以下规则：

| 规则 | 触发 | 处置 |
|------|------|------|
| `V-FOR-NO-KEY` | `v-for` 无 `:key` | **报错**（阻断构建） |
| `V-FOR-FULL-RENDER` | `v-for` 数据来源为数组且 item 数 > threshold | **警告**，建议改用 `<pg-recycle-view>` |
| `LISTENER-NO-CLEANUP` | 全局 `on` / `setInterval` 未配对 cleanup | **警告** |
| `GLOBAL-HOLD-VIEW` | 全局 Map/Set 持有组件/View 引用 | **警告** |

> 对齐 Architecture 的 CI 门禁（`consistency.yml` + `proteus audit`），内存规则作为其扩展集。

---

## 验收场景

标准压测（见 `10-benchmark-budgets.md`）：
- **1000 / 5000 / 20000 项** × 固定随机图片
- 重复进出页面 + 滚动至底部
- 采集：Java/Native Heap、JS Heap、PSS/RSS、离屏 Bitmap、**活跃 cell 数**、**VNode 池大小**

**判定原则**：
- 退出页面 + GC 后，内存**回落至基线**
- 重复打开**不产生单调增长**
- 滚动峰值**不持续上升**
- 仅检查最终是否触发 `LowMemory` / OOM **不足以发现缓慢累积的泄漏**

> 注意：`uni-recycle-view` 的滚动计算使其流畅度低于 `list-view`，且不支持瀑布流、限制 item 高度一致——Proteus 通过**四种策略分离**规避这些限制。
