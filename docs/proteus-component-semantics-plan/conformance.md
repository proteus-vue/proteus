# G-31 附录：组件 Conformance 验证

> 配套 `G-31-component-api-semantics.md` §8。对齐 G-27 / G-28 / G-30 的 conformance 机制。

---

## 1. 验证目标

> **同一份 Component IR，在所有 Tier 1 Backend 上必须产出语义等价的结果。**

分三层：

| 层 | 验证内容 | 方式 |
|----|---------|------|
| **结构层** | C-IR 树形状、semantic 字段正确 | AST diff |
| **约束层** | 属性满足 schema + 降级声明存在 | JSON Schema 校验 |
| **渲染层** | 三端渲染快照一致 | 截图像素差阈值 |

---

## 2. CLI

```bash
proteus test:component --backend all
# 对每个 Backend（VueDom / Native-iOS / Native-Android / Flutter）：
#   1. 解析 fixtures/ 下 SFC → C-IR
#   2. 调用 Backend.createElement(ir)
#   3. 生成快照 / 截图
#   4. 与 golden 对比
```

---

## 3. 验证项清单

### 3.1 语义映射正确（核心）

```
断言：Backend.createElement 接收的是 C-IR.semantic，不是 tag 字符串
反例：if (tag === 'p-grid') → 必须用 semantic === 'layout.grid'
```

**这是 G-31 与"翻译派"的分界线**：翻译派对比字符串标签，Proteus 对比语义字段。

### 3.2 属性约束生效

```ts
// fixtures/grid-conflict.sfc
<p-grid :min-col-width="9999" :max-cols="2" />
```

预期：Compiler 产出 **warning**（约束冲突），Backend 按降级规则处理。

### 3.3 降级路径存在（G-31.2）

每个组件/属性必须提供 `degradation` 声明，否则 `CMP006`。

### 3.4 渲染快照一致

```
fixtures/grid-basic.sfc
  → VueDom 截图  (golden)
  → Native 截图  → diff < 阈值
  → Flutter 截图 → diff < 阈值
```

阈值：布局结构 100% 一致，像素差异 < 2%（允许字体渲染差异）。

---

## 4. 示例 fixture

```vue
<!-- fixtures/grid-basic.vue -->
<template>
  <p-grid :min-col-width="160" :max-cols="4" :gap="12">
    <p-box v-for="i in 8" :key="i" />
  </p-grid>
</template>
```

期望 C-IR：

```json
{
  "semantic": "layout.grid",
  "props": { "minColWidth": 160, "maxCols": 4, "gap": 12 },
  "children": [{ "semantic": "layout.box" }, "..."]
}
```

三端 Backend 消费同一份 C-IR → 各自渲染。

---

## 5. CI 门禁

| 检查 | 失败后果 |
|------|---------|
| C-IR schema 校验 | 阻断 |
| 属性降级声明齐全（CMP006） | 阻断 |
| 渲染快照 diff > 阈值 | 阻断（或需人工 approve 更新 golden） |
| 新组件不足 3 端 conformance（G-31.4） | 降级 L2，禁入 core |

---

## 6. 与 G-27/G-28/G-29/G-30 conformance 的统一

```
G-27 RenderBackend.createRenderer(nodeOps) → 渲染节点一致
G-28 NativeBackend.scanQR()                → 能力行为一致
G-29 CompilerBackend.compile()             → CompilerIR 语义等价
G-30 PlatformBackend（任意端）              → Tier 降级一致
G-31 ComponentBackend.createElement(ir)    → 组件渲染一致  ← 本 plan
```

**五套 conformance 共用同一套验证基础设施**（快照 + golden + diff 阈值）。

---

## 版本记录

| 版本 | 日期 | 变更 |
|------|------|------|
| v1 | 2026-09-02 | 三层验证 + CLI + 4 项验证清单 + fixture + CI 门禁 + 五套 conformance 统一 |
