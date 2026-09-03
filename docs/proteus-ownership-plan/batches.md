# G-43 分批落地计划

> **定位**：从 SPI 定义到生产就绪的六批演进
> **原则溯源**：#0 支柱④ 渐进式覆盖

---

## 1. 分批总览

| 批次 | 内容 | 依赖 | 可独立验证 |
|------|------|------|-----------|
| **B1** | 所有权核心类型 + Tracker | 无 | ✅ 纯逻辑可单测 |
| **B2** | 借用检查器规则集 | B1 | ✅ |
| **B3** | 与 G-42 五原子销毁集成 | B1, G-42 | ✅ |
| **B4** | DevTools 所有权图 | B1, G-19 | ✅ |
| **B5** | PSS 编译器支持 | B2, G-38 | ✅ |
| **B6** | 跨设备转移 | B1, G-42 分布式容器 | ⚠️ 需真机 |

---

## 2. B1：所有权核心类型 + Tracker

**内容**：
- `Owned<T>` / `Borrow<T>` / `Weak<T>` / `Managed<T>` 类型实现
- `OwnershipGraph` 数据结构
- `QuotaTracker` 记账
- Drop 五阶段协议

**验收**：`node ownership-reference.cjs` → PASS ≥ 33，FAIL = 0

**已完成**：✅ 参考实现已通过 33 项

> **✅ 权威 TS 版落地（决策 #352）**：`@proteus-vue/render-backend` 新增 `ownership.ts`——**Owned/Borrow/Weak/Managed + OwnershipGraph + QuotaTracker + Drop 五阶段**（对齐 ownership-reference.cjs 33 项语义 + ownership-spi.md）：`Owned<T>`（唯一所有权——`read`/`transferTo` Move 语义 G-43.2（use_after_move/double_move 拦截）/ `borrow` 借用 G-43.3 / `weak` 弱引用 / `drop` 五阶段 G-43.6）+ `OwnershipGraph`（register/resourcesOf/findOrphans/detectLeaks（反向引用链=泄漏定位）/backTrace/stats——G-43.5 可观测）+ `createQuotaTracker`（CMP073 记账）+ `Borrow<T>`（作用域临时借用，drop 后失效）+ `Weak<T>`（打破循环）/ `Managed` + `ManagedRegistry`（框架代管 G-43.4，disposeAll 批量释放）+ `OWNERSHIP_ERRORS`（use_after_move/use_after_drop/double_move/has_active_borrows/already_dropped 错误码）；Drop 五阶段：prepare → invalidate（借用失效）→ release（releaseHook）→ unregister（图移除）→ reclaim（配额）；测试 `tests/ownership.test.ts` 12 用例全过（Move 语义/借用作用域/drop 强制失效+重复拒绝/Weak upgrade 失效/Managed 批量释放/图孤儿+泄漏链+QuotaTracker 记账/错误码负向）；全量 1753 无回归。

---

## 3. B2：借用检查器规则集

**内容**：
- 编译期规则 B-01 ~ B-08
- CFG 构建 + 状态格分析（Owned 状态机）
- 逃逸分析（Borrow 引用流）
- 作为 G-38 transform 插件接入

**验收**：
- B-01/B-02/B-04/B-05 规则可拦截预设违规用例
- 编译器集成后 strict 模式阻断构建

**状态**：📋 待实施

---

## 4. B3：与 G-42 五原子销毁集成

**内容**：
- G-42 步骤 3「releaseResources」委托给 G-43 Drop 协议
- 页面销毁强制回收（forceDrop）
- 配额完全归还验证

**验收**：
- 页面销毁后该页资源计数 = 0
- 活跃借用被强制失效
- 配额归零

**已完成**：✅ 参考实现已演示（`destroyPage` 函数）

---

## 5. B4：DevTools 所有权图

**内容**：
- 所有权图可视化面板（G-19 新增）
- 泄漏路径定位算法
- 长期借用 / 跨页面强引用 / 无主资源检测
- 时间线视图
- 生产期采样模式

**验收**：
- V-01 ~ V-07 全通过
- 生产期开销 < 2%

**状态**：📋 待实施

---

## 6. B5：PSS 编译器支持

**内容**：
- PSS 三级模式（off / loose / strict）配置解析
- PSS strict 限制检查（P1~P9）
- 作用域级自动 drop 插入
- 与 Vue 响应式集成（`useOwned` / `useBorrow`）

**验收**：
- B-03 / B-06 / B-07 / B-08 规则生效
- strict 模式下业务不写 drop 也能正确释放
- Vue `ref(Owned)` 被正确拦截（CMP071）

**状态**：📋 待实施

---

## 7. B6：跨设备转移

**内容**：
- `transferToDevice()` 完整实现
- 分布式通道对接（依赖 G-42 分布式容器）
- 原子性保证（两阶段提交）
- 配额跨设备协调

**验收**：
- X-01 ~ X-06 全通过
- 真机验证（多设备环境）

**状态**：📋 待实施，需真机环境

---

## 8. 与路线图的对应

| 里程碑 | G-43 批次 |
|--------|----------|
| **M1**（0-3 月） | **B1**（与 G-27/35/36/37/38/39 B1 同批，都是"定义 SPI shape"） |
| **M2**（4-9 月） | B2 + B3 + B4 |
| **M3**（10-18 月） | B5 + B6 |

**为什么 B1 必须在 M1**：
所有权模型是 G-42 页面销毁的**依赖**（G-42 步骤 3 委托给 G-43）。
若 G-43 B1 不同批，G-42 的资源释放只能留空实现，后续返工。

---

## 9. Definition of Done

```
□ 所有权核心类型完整（Owned/Borrow/Weak/Managed）
□ Drop 五阶段协议实现且可验证
□ 所有权图数据完整（Owner/Borrow/Weak + 源码位置）
□ 泄漏路径可定位到具体源码行
□ 与 G-42 五原子销毁集成，页面销毁后资源归零
□ 配额记账与所有权图一致（CMP073）
□ Conformance ≥ 33 项通过
□ 编号避让检查通过（G-43.x + CMP067-073）
□ 三场景独立校验 VERIFY PASS
□ 负向测试：注入故障能被校验器抓到
```

---

## 10. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| PSS strict 表达力受限，业务不接受 | 采用率低 | 三级模式可选 + 新项目默认 strict + 迁移工具 |
| 借用检查误报 | 开发体验差 | 先 warnings 后 errors；误报可 `@proteus-pss-ignore` 豁免 |
| 所有权图维护开销 | 性能下降 | 生产期默认只维护计数，诊断模式才建图 |
| Vue 响应式与所有权冲突 | 语义被破坏 | CMP071 禁止 ref(Owned) + 提供 useOwned 替代 |
| 跨设备转移真实性能未验证 | 承诺落空 | B6 明确标注需真机验证，不提前宣称 |

---

**版本**：v1.0
**日期**：2026-09-03
