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

> **✅ B2 已落地（决策 #353）**：`@proteus-vue/render-backend` 新增 `borrow-checker.ts`（`analyzeOwnershipSource(source, {mode})`——源码级借用检查器权威 TS 版）：**状态格分析**（Uninit/Alive/Moved/Dropped + activeBorrow——borrow-checker.md §3.2 的顺序流实现，完整 CFG 归 B5 编译器接入）+ **规则 B-01~B-08**（B-01 use-after-move（read/borrow × moved/dropped → G4001 error）/ B-02 double-move（G4002）/ **B-03 borrow 逃逸**（写入 globalCache/store/eventBus + 闭包捕获 setTimeout/箭头函数 → G4003）/ B-04 借用生命周期越界 / B-05 drop 活跃借用（G4005，force 跳过）/ B-06 未处置 Owned（G4006 warning）/ B-07 跨页强引用 / B-08 循环引用）+ **PSS 三级**（strict → error 阻断构建（blocksBuild）；loose → 主路径 error + 其余 warning；off → 跳编译期运行时兜底）+ `blocksBuild`/`ownedVars` 输出（G-38 transform 插件接入接口，文档 §5.1）；测试 `tests/borrow-checker.test.ts` 11 用例全过（B-01 transferTo 后 read/drop 后 read/合规零 error + B-02 double + B-05 活跃借用/force 跳过 + B-03 全局写入/闭包捕获 + B-06 未处置 + off/loose 分级 + ownedVars）；全量 1764 无回归。

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

**已完成**：✅ **B3 已落地（决策 #354）**：`@proteus-vue/render-backend` 新增 `page-ownership.ts`（**页面所有权上下文 `createPageOwnership(owner, { graph, quotaBytes? })`**——页面 = 所有权 scope：`alloc`/`register` 登记该页 Owned 资源（配额记账 + 所有权图），`destroy({ force })` = **Drop 协议 forceDrop 语义**（遍历该页资源逐个 Drop 五阶段——活跃借用被强制失效，Managed 框架代管资源 disposeAll，⑤ reclaim 与 G-42 releaseQuota 合并兜底归零；force:false drop 语义下活跃借用资源列入 leaked + 保留配额供重试——drop-protocol §6.3）+ **StackContainer 集成**（`StackContainerOptions.ownership` 启用 → 每页伴随所有权上下文，**五原子第 3 步 releaseResources 委托 Drop 协议**，freedBytes 计入 DestroyReport.reclaimedBytes，配额未归零即抛错不静默；`container.ownershipOf(pageId)` 业务登记入口）+ **SuperAppContainer ownership pass-through**；未启用 ownership 的容器零变化（向后兼容）。验收三连端到端通过：① 页面销毁后该页资源计数 = 0（graph/ctx 双口径）② 活跃借用被强制失效（borrow.valid=false）③ 配额归零（quotaRemaining=0）；测试 `tests/page-ownership.test.ts` 10 用例；全量 1774/172 无回归。

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

**状态**：✅ **数据层已落地（决策 #355）**；面板 UI 视图属后续批次（devtools 视图线——数据层已含 `formatOwnershipDiagnosis` 文本报告契约）

> **✅ B4 数据层（决策 #355）**：`@proteus-vue/render-backend` 新增 `ownership-observability.ts`（DevTools 所有权图数据层权威 TS 版）——**图 mutation 事件流**（`OwnershipGraph.subscribe` 动态订阅 + `OwnershipMutation`：register/state/edge，B1 图零破坏扩展）→ **① 历史时间线** `createOwnershipHistory(graph, { limit?, enabled? })`（alloc/drop/moved/borrow/weak/strong 记录含字节/源码行；环形缓冲裁剪 + clear/dispose；生产期 enabled=false 关闭）**② 计数器采样** `createOwnershipCounters(graph)`（V-07：O(1) 每资源、先快照存量再订阅、`consistent()` 与 stats 自证——V-01）**③ 四类检测** `diagnoseOwnershipIssues(graph, { destroyedScopes?, longBorrowMs=1000, now? })`（V-02 泄漏路径 = 已销毁 scope 仍存活资源 + 反向引用链 + 源码行 / V-03 长期借用 = borrows edge.since 距今超阈值（now 注入可测）/ V-04 跨页面强引用 = **GraphEdge.kind 新增 'strong'**（显式跨页强持有登记）且引用方 ≠ 资源 owner / V-05 无主资源 = owner null 存活节点）**④ alloc/drop 配对时间线** `buildOwnershipTimeline`（V-06：drop/moved 带 matchedAlloc 可点到源码行 + alive 未配对高亮，页面销毁 force-drop 后消失）+ `formatOwnershipDiagnosis` 可读报告（面板/CLI 展示契约）。测试 `tests/ownership-observability.test.ts` 11 用例（V-01 一致性×2（含图已有后挂载）/V-07 万级 alloc/drop 开销烟测 <2s + 历史关计数开/V-06 事件序+配对+裁剪+dispose/V-02~V-05 各检测/空诊断+报告）；全量 1785/173 无回归。面板 UI（Graph/Leaks/Timeline/Quota 视图）待 devtools 视图批次（可消费本数据层 + `formatOwnershipDiagnosis`）。

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
