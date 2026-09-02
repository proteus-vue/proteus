# G-31 附录：分批落地与跨 Plan 协同

> 配套 `G-31-component-api-semantics.md` §8。

---

## 1. 分批策略

| 批次 | 内容 | 依赖 | 交付 | 工时估 |
|------|------|------|--------|--------|
| **B1** | C-IR schema（`component-ir.schema.json`）+ 属性约束校验器 | G-27 SPI | `component-ir.spec.ts`（可单测，零依赖） | ✅ @proteus-vue/component-ir：schema/validate（GRID_CONFLICT/CMP006）/map（semantic→后端） |
| **B2** | 布局原语 6 个（box/stack/grid/fluid/adaptive/fit）+ VueDom Backend | B1 | Web 跑通 demo | ✅ toComponentIR（模板标签→C-IR）+ IRNode.semantic + VueDom 消费 semantic（proteus-* 语义类）+ C-IR→DOM 端到端 |
| **B3** | Native Backend 映射（UIKit / Android View） | B2, G-27 B4 | iOS/Android 跑通 | ✅ NativeBackend 消费 semantic（SEMANTIC_NATIVE_MAP：layout.grid→UICollectionView / ui.text→UILabel / ui.button→UIButton...——UIKit 基准，与 SEMANTIC_BACKEND_MAP native-ios 列同源）+ C-IR→Native 端到端（ops 含原生视图类型）；Android/鸿蒙映射同表扩展 |
| **B4** | 基础 UI 原语（text/button/image/input/list/nav） | B2 | 完整 L1 组件集 | ✅ 现有组件对齐：p-view→layout.box/p-list-view→ui.list/p-nav-bar→ui.nav/p-textarea→ui.input/p-modal→layout.adaptive；Fluid 扩展语义 layout.split/safe/sidebar（UISplitViewController/SafeArea/NavigationRail——原则 #10.8）+ 五端映射；其余叠加 UI（popup/toast/skeleton 等）标 L2 生态 |
| **C1**（G-28 侧） | 能力入口组件（p-scan-qr 等）对接 `useNative()` | G-28 | 能力组件可用 | 1 人周 |
| **B5** | conformance：三端渲染快照一致 | B3, conformance.md | CI 门禁 | ✅ 见 `conformance.md` 落地状态——渲染层 IR 级快照（6 后端 × 6 fixtures） |
| **B6** | `@proteus/compat-miniprogram` 兼容层 + codemod | B4 | 旧小程序可迁移 | 3 人周 |
| **B7** | API Hook 化（useFetch/useStorage/router）+ lint（CMP007） | B1 | ✅ **能力 Hook 层骨架 + CMP007 门禁**：`@proteus-vue/api/capability.ts`（CapResult&lt;T&gt; + createCapabilityHooks + CapabilityBridge 双桥 + 10 useXxx 核心 Hook + probe 降级）+ `proteus api-check`（回调式/同步存储/裸全局 → 平台桥/兼容演示豁免）；Layer 0 API 完整化随 G-32 B3 延续 | 2 人周 |

**关键路径**：B1 → B2 → B3 → B5（conformance）→ M2 验收

---

## 2. M1/M2 落点

| 里程碑 | G-31 交付 |
|--------|----------|
| **M1**（0-3 月） | B1（C-IR + 校验器）、B2（布局原语 + VueDom）、B7（API Hook 骨架） |
| **M2**（4-9 月） | B3/B4/B5（三端一致 + 完整 L1）、C1、B6（compat + codemod） |

与 G-27 B1（nodeOps）、G-28 B1（Native SPI）、G-29 B1（CompilerIR）**同期**——都是"定义 SPI shape"，可共享 conformance 基础设施。

---

## 3. 单测清单（B1 即可跑）

| 用例 | 验证点 |
|------|-------|
| `grid-conflict.spec.ts` | `min-col-width` 与 `max-cols` 冲突 → warning |
| `schema-valid.spec.ts` | 合法/非法 C-IR 通过/失败 JSON Schema |
| `degradation.spec.ts` | 缺 `degradation` 声明 → `CMP006` |
| `semantic-mapping.spec.ts` | Backend 用 `semantic` 字段映射，非 `tag` 字符串 |
| `tier-matrix.spec.ts` | Tier 2/3/4 降级产物正确 |
| `swiper-as-stack.spec.ts` | `<swiper>` → `p-stack(snap=mandatory,loop)` C-IR |
| `hook-api.spec.ts` | `useFetch` / `useStorage` 返回 Promise + 响应式 |
| `codemod.spec.ts` | `wx.request` → `useFetch` 转换正确 |

---

## 4. 跨 Plan 协同矩阵

| 维度 | Plan | G-31 的协同点 |
|------|------|--------------|
| 方法论 | PROTEUS-METHODOLOGY | 五支柱具体化（本 plan 是支柱在"入口"的投影） |
| 布局 | G-22 / G-22.5 | 布局原语语义来源 |
| 语义全景 | G-24 | C-IR 的 `semantic` 枚举扩展 |
| 渲染 | G-27 | Backend 消费 C-IR（`createElement(ir)`） |
| 能力 | G-28 | 能力入口组件底层 + CMP005 复用 |
| 编译 | G-29 | 源码 → C-IR 的生产端（Compiler Backend） |
| 任意端 | G-30 | Tier 降级 + capabilities + conformance 复用 |
| 路由 | G-17 | `<p-nav>` + `router.push` 命名路由 |
| AI | G-23 | AI Agent 操作 C-IR（生成/优化/修复组件） |

---

## 5. 定义完成标准（Definition of Done）

- [ ] C-IR schema 定稿 + JSON Schema 校验通过
- [ ] 12 个 L1 组件（6 布局 + 6 UI）在三端 Backend 渲染一致
- [ ] 能力入口组件 3 个对接 `useNative()`
- [ ] Layer 0 API 全部 Hook/Promise 化，lint 阻断回调式 API
- [ ] compat 层 + codemod 覆盖 ≥70% 小程序语法
- [ ] conformance CI 门禁生效（快照 diff 阈值）
- [ ] ≥3 端真实实现（G-31.4）验证通过

---

## 版本记录

| 版本 | 日期 | 变更 |
|------|------|------|
| v1 | 2026-09-02 | B1-B7 + M1/M2 落点 + 8 项单测 + 协同矩阵 + DoD |
