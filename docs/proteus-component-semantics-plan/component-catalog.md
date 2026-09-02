# G-31 附录：内置组件完整清单与规格

> 配套 `G-31-component-api-semantics.md` §3。所有组件须满足 `component-ir.schema.json` + `rules.md`。

---

## 1. 布局原语（L1，G-22 组件化）

### `<p-box>`
- **语义**：原子语义容器
- 属性：`as: 'div'|'section'|'article'|'card'`（默认 `div`）
- 降级：所有 Tier 均支持
- 映射：iOS `UIView` / Web `div` / Flutter `Container`

### `<p-stack>`
- **语义**：一维线性排列
- 属性：
  - `direction: 'horizontal' | 'vertical'`（必填）
  - `gap: number`
  - `wrap: boolean`（true → 超界换行，语义化为流式）
  - `snap: 'none' | 'mandatory' | 'proximity'`（分页/轮播语义）
  - `loop: boolean`（配合 snap = 轮播）
- **关键**：`swiper` = `<p-stack direction="horizontal" snap="mandatory" loop>`
- 映射：iOS `UIStackView` / Web Flexbox / Flutter `Row`/`Column`

### `<p-grid>`
- **语义**：二维网格（G-22 柔性布局核心）
- 属性：
  - `min-col-width: number`（最小列宽，驱动自适应列数）
  - `max-cols: number`
  - `gap: number`
- **约束（Compiler 校验）**：`max-cols >= 1`；若 `min-col-width` 导致冲突 → 警告 + 降级
- 映射：iOS `UICollectionView` / Android `GridLayoutManager` / Web CSS Grid `auto-fit` / Flutter `GridView`

### `<p-fluid>`
- **语义**：流式自适应（断点驱动）
- 属性：`breakpoints: Record<string, number>`, `cols: number`
- 映射：CSS Grid + container queries / UIKit `UIStackView` + size classes

### `<p-adaptive>`
- **语义**：容器宽度语义化（G-22.5）
- 属性：`mode: 'sheet' | 'dialog' | 'popover' | 'drawer'`
- 映射：iOS `UISheetPresentationController` / Web `<dialog>` / Harmony `showSheet`

### `<p-fit>`
- **语义**：内容自适应尺寸
- 属性：`mode: 'content' | 'intrinsic'`
- 映射：`intrinsicContentSize` / `fit-content`

---

## 2. 基础 UI 原语（L1）

| 组件 | 关键属性 | 降级 |
|------|---------|------|
| `<p-text>` | `variant`, `truncate: boolean`, `selectable` | 全支持 |
| `<p-button>` | `variant`, `size`, `loading`, `disabled` | `loading` 在 Tier 3 退化为 disabled |
| `<p-image>` | `fit`, `placeholder`, `lazy` | `lazy` 在 Tier 3 退化为立即加载 |
| `<p-input>` | `type`, `validation`, `mask` | `mask` 需 Backend 支持 |
| `<p-list>` | `item-size`, `strategy: 'virtual'|'window'` | **内置虚拟化**（核心差异点） |
| `<p-nav>` | 路由名映射（G-17） | Tier 4 退化为无 UI 路由 |

> **`<p-list>` 与 `scroll-view` 的本质区别**：虚拟化是语义内置的，不是开发者手动实现懒加载。

---

## 3. 能力入口组件（L1，G-28 封装）

| 组件 | 属性 | 底层能力 |
|------|------|---------|
| `<p-scan-qr>` | `on-result`, `reason` | `native.scanQR()` |
| `<p-pick-photo>` | `max-count`, `quality`, `source` | `native.pickPhoto()` |
| `<p-location>` | `accuracy`, `reason` | `native.getLocation()` |

**规则**：属性中的 `reason` 必填（G-28 NAT001 权限声明复用）。

---

## 4. 组件 conformance 要点

每个 Backend 实现组件时须通过：

1. **语义映射正确**：C-IR `semantic` 字段 → 原生控件（不是 `tag` 字符串）
2. **属性约束生效**：`min-col-width` 等约束在各端行为一致
3. **降级路径存在**：Tier 2/3/4 有显式 fallback（G-31.2）
4. **截图对比**：同一 C-IR 在三端渲染快照一致（像素差阈值）

---

## 5. 不在内置范围的组件（交给生态 L2/L3）

日历、富文本编辑器、图表、地图、视频播放器、3D 查看器、签名板……

**判断标准**（对照 G-31.4）：
- 能用布局原语 + 能力入口组合出来 → **不内置**
- 需要特定原生 SDK → **独立 Backend 包（L2）**
- 长尾/实验 → **社区 L3**

---

## 版本记录

| 版本 | 日期 | 变更 |
|------|------|------|
| v1 | 2026-09-02 | 布局 6 原语 + UI 6 原语 + 能力入口 3 组件 + conformance 要点 |
