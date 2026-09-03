# 分批落地（G-41）

---

## B1 — 契约定义（M1，与 G-27/35/36/37 B1 同批）

| 项 | 内容 |
|----|------|
| 交付 | `ProteusNodeOpsDispatcher` 接口 + PRIMITIVE_TABLE 绑定 + 方案 B 定型 |
| 依赖 | G-27 RenderBackend SPI、G-32 原语表 |
| 验收 | H-03-04（两引擎 IR 快照一致）通过 |
| 工时 | 约 3 人日 |

**B1 是纯逻辑零依赖**，可单测，最快出原型。

## B2 — Host Conformance 套件（M1）

| 项 | 内容 |
|----|------|
| 交付 | H-01~H-08 共 32 项 + CI 门禁 |
| 依赖 | B1 |
| 验收 | `node host-reference.cjs` → PASS=32 FAIL=0 |
| 工时 | 约 5 人日 |

## B3 — Vue 绑定层实现（M1→M2）

| 项 | 内容 |
|----|------|
| 交付 | 真实 `createRenderer(proteusNodeOps)` 接入 Vue 3 |
| 依赖 | B1、B2 |
| 验收 | Vue SFC 在 `vue-dom` 后端完整渲染 |
| 工时 | 约 8 人日 |

## B4 — 五宿主接入指南落地（M2）

| 宿主 | 交付 | 工时 |
|------|------|------|
| Web | `WebHostRuntime` + `VueDomBackend` | 5 人日 |
| iOS | `iOSHostRuntime` + `UIKitRenderBackend` | 12 人日 |
| Android | `AndroidHostRuntime` + `AndroidViewRenderBackend` | 12 人日 |
| Flutter | `FlutterHostRuntime` + `FlutterRenderBackend` | 10 人日 |
| Harmony | `HarmonyHostRuntime` + `ArkUIRenderBackend` | 10 人日 |

**每宿主完成时跑对应 conformance，FAIL=0 才算完成。**

## B5 — 热切换与混合渲染（M2）

| 项 | 内容 |
|----|------|
| 交付 | `switchBackend` 生产级实现（rehydrate / rebuild / hybrid 三策略）+ 同页面多引擎 |
| 依赖 | B4 |
| 验收 | H-05、H-06 全过 |
| 工时 | 约 10 人日 |

## B6 — 宿主 × 引擎组合矩阵验证（M3）

| 项 | 内容 |
|----|------|
| 交付 | 6 宿主 × 6 引擎 = 36 组合中，Tier 1 组合全部验证 |
| 依赖 | B4、B5 |
| 验收 | 每一组合 `runConformance().failed === 0` |
| 工时 | 约 15 人日 |

---

## Definition of Done

- [ ] `ProteusNodeOpsDispatcher` 实现且单测覆盖
- [ ] H-01~H-08 全过（32/32）
- [ ] 五宿主接入指南含可运行代码骨架
- [ ] CMP052–CMP056 静态扫描纳入 CI
- [ ] 至少一个非 DOM 引擎完成热切换演示
- [ ] 跨 plan 编号零冲突

---

## 跨 plan 协同矩阵

| Plan | 依赖方向 | 说明 |
|------|---------|------|
| G-32 | G-41 ← G-32 | 128 原语表是 `toIRNode()` 的数据源 |
| G-27 | G-41 → G-27 | Dispatcher 调用 RenderBackend SPI |
| G-38 | G-41 ← G-38 | 第 7 步消费编译产物 |
| G-39 | G-41 ← G-39 | 第 2 步实例化 HostRuntime |
| G-40 | G-41 ← G-40 | 第 3 步选择执行载体 |
| G-28 | G-41 → G-28 | 第 5 步注册 CapabilityBackend |
| G-30 | G-41 → G-30 | 宿主接入是 Tier 模型的"接入侧"实现 |
| G-36 | G-41 → G-36 | Agent 生成的代码需在宿主中验证 |

---

## 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| Vue 版本升级破坏 nodeOps 契约 | 高 | 锁定 Vue 3.x minor，conformance 覆盖 nodeOps 签名 |
| 混合渲染纹理共享复杂 | 中 | B6 分阶段：先验证同页面双引擎，再验证共享 |
| 热切换状态丢失 | 中 | 生产期走 rehydrate，开发期允许 rebuild |
| 五宿主并行开发资源不足 | 中 | 按 Web → iOS/Android → Flutter → Harmony 顺序排期 |
