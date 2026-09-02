# 分批落地与协同（G-32）

> 128 原语的落地顺序：**先冻结契约（B1），再按「业务价值密度」分层实现（B2-B6）**。  
> 关键路径与 G-27/G-29/G-30/G-31 的 B1 **完全并行**（都是「定义 schema」）。

---

## 1. 分批总览

| 批次 | 周期 | 范围 | 依赖 | 交付 | 工时估 |
|------|------|------|------|------|--------|
| **B1** | M1.1 | L1 清单冻结（128）+ C-IR schema 扩展 + `audit:coverage` | G-31 Component IR | ✅ 覆盖率报告 = 100%——`PRIMITIVE_CATALOG` SSOT（128 原语：12+18+10+10+50+28）+ SEMANTIC_ENUM 扩展至 53 + `proteus audit coverage` 门禁（G-32.1 100% + 闭环一致性 C1-C5） | 2 人月 |
| **B2** | M1.2-M2 | ① 布局 12 + ② UI 18（Web/DOM Backend） | G-27 VueDomBackend | ✅ **布局 12 + UI 18 双端全部落地（23 新组件）**：布局 6（p-inline/p-spacer/p-divider/p-scroll/p-virtual-list/p-masonry——p-fluid 为指令形态）+ UI 基础 4（p-heading/p-icon/p-switch/p-slider）+ UI 视图 5（p-rich-text/p-avatar/p-media/p-canvas/p-svg）+ UI 表单 5（p-select/p-checkbox/p-radio/p-picker/p-form）+ Shell 3（p-nav/p-tabbar/p-drawer）；演示页 semantic-primitives-demo（双端构建通过）；③ Shell 余 7/④ Gesture/⑤ Capability 后续批次 | 3 人月 |
| **B3** | M2 | ⑤ 能力 50（Native Backend iOS/Android） | G-28 NativeBackend | ✅ **能力 Hook 层两期落地（`@proteus-vue/api/capability.ts`）**：一期 10 useXxx + 二期 **useFetch（C26 迁移文档标题目标）/ usePermission（C16 web Permissions API）/ useStorage（C15 CompatStorage + createReactiveStorage 注入式响应式）** + CapabilityBridge 双桥（wx/web 全能力）+ probe 降级探测（含 fetch/permission/storage）——G-32.4 无回调/无全局对象/全类型/Result&lt;T&gt;；CMP007 门禁 `proteus api-check`；剩余 40 能力待续 | 6 人月 |
| **B4** | M2-M3 | ③ Shell 10 + ④ Gesture 10 | G-27 + G-30 | ✅ **③ Shell 10 全落地** + **④ Gesture 核心落地**：`@proteus-vue/gesture` 包（纯识别器 tap/longpress/pan/swipe/pinch/rotate/press——createGestureRecognizer 状态机 + useGesture Hook G10 + v-gesture 指令 G1-G7，Web Pointer Events 接线，原生识别器映射后续）+ p-draggable G8/p-scrollable G9（gesture.draggable/scrollable 入 implemented，42 语义 × 6 后端 conformance） | 4 人月 |
| **B5** | M3 | ⑥ 工程 28（路由/动画/生命周期） | G-17 + Vue | DevTools 集成 | 3 人月 |
| **B6** | M3 | 对照矩阵自动化 + codemod + conformance 全绿 | G-31 migration | 迁移工具链 | 2 人月 |

**总工时**：≈ 20 人月（可与既有 150 人月路线图并行，不新增关键路径）

---

## 2. B1 详解（关键，决定一切）

### 2.1 交付物

```
proteus/
  ├─ primitives/（落地：packages/component-ir/src/primitives.ts）
  │   ├─ registry.ts          ← ✅ PRIMITIVE_CATALOG（128 原语：id/semantic/tag/api/props/tier/status）
  │   ├─ categories.ts        ← ✅ 6 大类分组（kind 字段 + 选取器）
  │   └─ miniprogram-mapping.ts ← ✅ 落地：packages/component-ir/src/audit.ts MP_MAPPING_MATRIX
  ├─ schemas/
  │   ├─ component-ir.json    ← ✅ C-IR 扩展（SEMANTIC_ENUM 18 → 53：gesture/shell/engineering 入域）
  │   └─ capability.schema.json ← 随 G-30 扩展（B1 已冻结 50 能力语义入 list）
  └─ scripts/
      └─ audit-coverage.ts     ← ✅ 落地：packages/cli/src/coverage-audit.ts（proteus audit coverage）
```

### 2.2 `audit:coverage` 逻辑

```ts
function audit() {
  const spec = loadMiniprogramSpec()      // 官方 API + 组件清单
  const registry = loadPrimitiveRegistry() // 128 原语

  const missing = spec.filter(api =>
    !registry.some(p => p.covers.includes(api.name))
  )

  return {
    covered: spec.length - missing.length,
    total: spec.length,
    missing,
    percentage: ((spec.length - missing.length) / spec.length * 100).toFixed(2) + '%'
  }
}
// 输出: { covered: 162, total: 162, missing: [], percentage: '100.00%' }
```

**CI 门禁**：`percentage !== '100.00%'` → 构建失败。

### 2.3 Definition of Done

- [x] 128 原语全部注册（name / semantic / props schema / covers / tier）——`PRIMITIVE_CATALOG`（128 项自检：id/semantic/tag 唯一）
- [x] `audit:coverage` 输出 100%——`proteus audit coverage`（实测：71 项 0 缺失，覆盖率 100% ✅）
- [x] C-IR schema 扩展通过校验——SEMANTIC_ENUM 18→53（gesture/shell/engineering 三新域）；`validateComponentIR` 全量可校验
- [x] 每个原语 conformance——26 个 implemented 语义 × 6 后端快照一致（G-31 B5 门禁）；planned 以待实现
- [ ] 文档（本目录）与 registry 自动同步（`scripts/gen-docs.ts`）——剩余：自动生成脚本（B6 对照矩阵自动化收口）

---

## 3. 单测策略

### 3.1 测试金字塔

```
        ┌─────────────┐
        │ E2E (Playground) │  ← B6：跨 Backend 视觉一致性
        └──────┬──────┘
       ┌───────┴───────┐
       │ conformance test │  ← B1-B6：IR 语义等价（G-30）
       └───────┬───────┘
  ┌────────────┴────────────┐
  │ 单元：registry / schema  │  ← B1：原语注册、属性约束校验
  └─────────────────────────┘
```

### 3.2 关键测试场景

| 测试 | 说明 | 批次 |
|------|------|------|
| `registry.has(128)` | 原语数量 = 128 | B1 |
| `mapping.coverage = 100%` | 小程序映射完整 | B1 |
| `schema.validate(props)` | 属性约束校验（如 `p-grid` min-col-width > 0） | B1 |
| `compile(<p-stack>) → semantic: 'layout.stack'` | C-IR 产出正确 | B2 |
| `backend.render(ir) → native` | 各 Backend 渲染一致 | B2-B4 |
| `useCamera().capture() → Result<Media>` | 能力原语返回类型正确 | B3 |
| `capability.nfc=false → fallback` | 降级路径生效 | B4 |
| `router.push() → page change` | 路由语义化 | B5 |
| `conformance.allGreen()` | 五套测试全绿 | B6 |

### 3.3 conformance 统一（与 G-27/28/29/30 一致）

```bash
# 一套命令，跑全部 conformance
proteus test:conformance --backend all --tier all

# 输出
✅ RenderBackend (G-27): 42/42
✅ CompilerBackend (G-29): 18/18
✅ PlatformBackend (G-30): 6/6 (Tier 1-4)
✅ ComponentIR (G-31): 128/128
✅ Capability (G-32): 50/50  ← 本轮新增
```

---

## 4. 跨 plan 协同矩阵

| G-32 提供 | 消费方 | 协同点 |
|-----------|--------|--------|
| ① 布局 12 | G-22（柔性布局算法）、G-27（Backend 映射） | `p-grid min-col-width` → Backend 选 Grid/UICollectionView |
| ② UI 18 | G-27、G-31（C-IR） | 组件 IR 属性约束 |
| ③ Shell 10 | G-17（路由）、G-24（系统集成） | `<p-nav>` 声明式映射路由 |
| ④ Gesture 10 | G-27（原生手势识别器） | `v-gesture:swipe` → UIGestureRecognizer 等 |
| ⑤ Capability 50 | **G-28（NativeBackend SPI）** | `useCamera()` → AVCapture/CameraX |
| ⑥ Engineering 28 | G-17、G-29（Compiler）、DevTools | 生命周期、路由守卫、动画 IR |
| `audit:coverage` | G-30（conformance）、CI | 覆盖率门禁 |
| 对照矩阵 | G-31（compat-miniprogram、codemod） | 翻译规则来源 |

---

## 5. 路线图落点（更新 proteus-roadmap）

### M1 新增 B1（与既有 B1 同批）

```
M1 地基（0-3 月）
  ├─ G-27 B1 nodeOps SPI
  ├─ G-29 B1 CompilerIR 契约
  ├─ G-30 B1 capabilities schema
  ├─ G-31 B1 C-IR
  └─ ★ G-32 B1 原语清单冻结 + audit:coverage  ← 新增
```

**理由**：B1 全是「定义契约」，无运行时依赖，可并行。原语清单是其余所有 plan 的**输入**——先冻结，Backend 才有实现目标。

### M2/M3 对齐

- G-32 B2/B3（布局/UI/能力）↔ G-28 B2（NativeBackend 实现）
- G-32 B4（Shell/Gesture）↔ G-27 B2（原生手势映射）
- G-32 B5/B6（工程/自动化）↔ G-29 B2（RustBackend）、G-31 B2（codemod）

---

## 6. Definition of Done（M3 发布门禁）

- [ ] **覆盖率 100%**：`audit:coverage` = 100.00%
- [ ] **五套 conformance 全绿**（G-27/28/29/30/G-32）
- [ ] **128 原语均有 ≥3 端实现**（Web/iOS/Android）
- [ ] **降级路径 100% 有测试**
- [ ] **codemod 迁移成功率 ≥ 90%**（小程序 → Proteus 自动转换）
- [ ] **文档完整**：本目录 11 文件 + 自动生成 API 文档
- [ ] **Playground 演示**：同一份代码在 5 端（Web/iOS/Android/小程序/鸿蒙）跑通全部 128 原语

---

## 7. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 128 过多，实现周期长 | 分层：B2 先做 30 核心（覆盖 80% 场景），其余 B3-B6 增量 |
| 小程序新增 API（如微信季度更新） | `audit:coverage` 自动检测缺口，归入 L2 或下个 minor |
| 某原语无法 3 端实现（如 `useNFC` 在 Web） | 允许 L2（Web NFC polyfill）或降级（G-30 Tier） |
| 过度设计（开发者只用 30 个） | 核心 34（G-31 骨架）+ 扩展 94；监控实际使用率，冷门降级 L2 |
