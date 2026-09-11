# 组件 / API 文档颗粒度对齐台账

> **起因**：用户「对比小程序文档检查我们的内容颗粒度是否都已对齐，深度检查，重点是组件和 API」→「官网文档和实际能力全部和小程序覆盖的对齐」。
> **审计日期**：2026-09-11（三路并行深审 + 逐条验证）。**SSOT**：`website/scripts/gen-content.mjs`（生成器）+ `src/components/p-*/index.vue`（组件源）+ `packages/api/src/capability.ts`（能力源）+ `packages/component-ir/src/audit.ts`（覆盖度矩阵）。

---

## 1. 现状与缺口（实测）

### 组件页（63）—— 差距最大
| 小程序文档要素 | 我方现状 |
|---|---|
| 属性表（类型/默认值/必填/说明） | ✅ 有（但列序不同、40% 属性靠跨组件通用兜底、无逐属性详解） |
| 事件表（说明 + 回调参数） | 🟡 有汇总表；**`update:*` 全丢**（13 事件 / 8 页整段消失）；无载荷列 |
| **插槽** | ❌ **0 页**（40/63 组件有 slot，8 具名 + 1 作用域） |
| 示例代码 | ❌ 硬编码空壳（`<p-xxx :firstProp="…">`） |
| 逐属性/逐事件详解 | ❌ 0 页（能力页有逐方法详解） |

### 能力页（50）—— 详细化已做，仍有 bug
| 项 | 现状 |
|---|---|
| 逐方法详解 / 类型引用 | ✅ 有（但类型引用**只展一层**） |
| 错误码 | 🔴 源码 98 唯一 code → 页面仅 61 行；**network/orientation/device/auth 四页 0 行** |
| 扩展接口（useCameraContext 等） | 🟡 有签名+返回结构，**无参数表** |
| 参数/属性「默认值」列 | ❌ 无（微信必有） |

### 覆盖度门禁（假门禁）
- `audit.ts` 的 `MP_MAPPING_MATRIX` 是**手写常量**，`auditMiniprogramCoverage` 只统计写进去的行有无 `missing` → **永远 pass、不可失败**。
- 矩阵引用**不存在**的 primitive（`p-overlay/p-progress/p-label/p-camera/p-map/p-webview`、`capability.toast/capability.media/capability.element` 等，catalog/schema/组件目录 0 命中）却标 ok/compat。
- 真实覆盖：**微信内置组件 48** → ✅22 / 🟡17 / ❌9（矩阵漏 13 个真实组件）；**API 大组** → ✅26 / 🟡3 / ❌15。
- 文档声称的 `scripts/miniprogram-official-spec.json` + `coverage-audit.ts` **不存在**。

---

## 2. 批次计划

| 批 | 范围 | 内容 | 状态 |
|----|------|------|------|
| **A** | 生成器正确性 bug | ① parseEmits 支持 `:` → 恢复 `update:*`；② 组件页「插槽」段；③ 事件「载荷」列；④ 错误码补全（bridgeBodies per-method union + 扫 helper + throw）；⑤ 类型引用递归；⑥ 扩展接口参数表；⑦ 参数/属性「默认值」列 | 🟡 进行中 |
| **B** | 组件页详细化 | 逐属性详解 + 逐事件详解 + 真实示例（对齐能力页详细度；含源 JSDoc 补全） | ⬜ |
| **C1** | 覆盖度门禁重做 | 真实官方 spec 驱动、可失败（含 ghost 行一致性校验） | ⬜ |
| **C2** | 新增缺失组件 | p-progress/p-label/match-media/page-meta/snapshot/sticky-*/root-portal/p-map/p-camera/p-page-container/p-webview/p-ad… | ⬜ |
| **C3** | 新增缺失 API | useUpdateManager/useAlbum/useWorker/WiFi/微信运动/收货地址/卡券/发票/广告/解密/AI/数据预拉取… | ⬜ |

---

## 3. 诚实边界

- **C2/C3 部分需类目资质**（支付扩展/卡券/发票/广告/AI）——不做纯覆盖式铺开，按需驱动。
- **微信内置组件 48** 中部分为 Skyline 专属（`grid-view/list-view/sticky-*/double-tap-gesture/root-portal/snapshot/page-meta`），Proteus 侧已有等价能力（`p-grid/p-list-view/p-animate`）或有意不支持——C1 门禁须区分「有等价能力」与「真缺」。
- 覆盖度以**微信官方文档为准**（非我方手写矩阵）。
