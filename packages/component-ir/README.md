# @proteus-vue/component-ir

> **G-31 组件与 API 语义化**（`docs/proteus-component-semantics-plan/`）· B1-B5

## 一句话

**内置组件与 API 不由任何既有平台组件集"翻译"而来，而是由 Proteus 自己的语义 IR（C-IR）直接定义**——组件表达"意图"（semantic），属性表达"约束"，Backend 消费 semantic 而非 tag 字符串。

## 内容

| 模块 | 说明 |
|------|------|
| `schema.ts` | `ComponentIR` 类型 + `COMPONENT_IR_SCHEMA`（JSON Schema，对齐 plan component-ir.schema.json）+ `SEMANTIC_ENUM`（★G-32 扩展至 53 个语义：layout 15 / ui 21 / shell 9 / gesture 2 / engineering 3 / capability 3） + `TAG_SEMANTIC_MAP`（p-grid → layout.grid；★G-32 组件原语全量登记） |
| `validate.ts` | `validateComponentIR`（CIR_INVALID_TAG：p- 前缀铁律 G-31.1 / CIR_INVALID_SEMANTIC / **CMP006**：capabilities 缺 degradation 声明 G-31.2）+ `validateGridConstraints`（**GRID_CONFLICT**）+ `validateComponentTree`（递归） |
| `map.ts` | `SEMANTIC_BACKEND_MAP` + `mapSemanticToBackend`（semantic → 各端控件：layout.grid → UICollectionView / GridView / div.proteus-grid——**验证「Backend 用 semantic 映射而非 tag」**；★B5 与各后端实际产出对齐，是 conformance 门禁标准；★G-32 补至 26 implemented 语义） |
| `primitives.ts` | ★G-32 完整语义原语清单 SSOT：`PRIMITIVE_CATALOG`（128 原语——6 大类 12+18+10+10+50+28）+ 选取器（componentPrimitives/implementedPrimitives）+ 自检（checkPrimitiveCatalog：128/唯一性） |
| `conformance.ts` | `checkComponentSnapshot`（渲染快照 vs 参考表）+ `extractSemanticTree`（跨端结构同构）+ `checkSemanticCoverage`（★G-32：catalog-aware——仅 implemented 语义 ≥3 端门禁） |
| `audit.ts` | ★G-32 B1 audit:coverage：`auditMiniprogramCoverage`（G-32.1 小程序能力 100%——对照矩阵 0 缺失 CI 红）+ `auditCatalogConsistency`（闭环 C1-C5：catalog↔enum↔tag↔render-map 四向不漂移）+ `formatCoverageReport` |
| `to-ir.ts` | `toComponentIR` / `toComponentTree`（模板标签 → C-IR——G-29 生产端前置纯函数） |

## 用法

```ts
import { validateComponentTree, mapSemanticToBackend, TAG_SEMANTIC_MAP } from '@proteus-vue/component-ir'

const ir = { tag: 'p-grid', semantic: 'layout.grid', props: { minColWidth: 200, maxCols: 4 }, children: [] }
const diags = validateComponentTree(ir, 375)
// → GRID_CONFLICT：200 × 4 = 800 > 375——max-cols 永不达

mapSemanticToBackend('layout.grid', 'native-ios') // 'UICollectionView'
mapSemanticToBackend('layout.grid', 'flutter')    // 'GridView'
mapSemanticToBackend('layout.grid', 'vue-dom')    // 'div.proteus-grid'
```

## Conformance（B5）

```ts
import { renderComponentSnapshot, createControlReader } from '@proteus-vue/render-backend'
import { checkComponentSnapshot, checkSemanticCoverage } from '@proteus-vue/component-ir'

const snap = renderComponentSnapshot(backend, ir, createControlReader(backend.id))
const result = checkComponentSnapshot(backend.id, snap) // 控件 readback == 参考表？
checkSemanticCoverage(3) // G-31.4：每语义 ≥3 端映射
```

## 严格规则

- **G-31.1**：内置组件必须 `p-` 前缀 + 语义命名；禁止与小程序/HTML 组件同名（`<view>` 属兼容层）
- **G-31.2**：每个组件属性须声明 Tier 降级行为（CMP006 编译期拦截）
- **G-31.3**：Layer 0 API 全部 Promise/Hook 化，禁止回调式/全局对象式（无 `wx.xxx`）
- **G-31.4**：组件进 L1 前须 ≥3 端真实 Backend 通过 conformance

## 分层

```
Layer 0：Proteus 原生语义组件（p-* + useNative/useFetch）——本包
Layer 1：@proteus/compat-miniprogram（旧小程序兼容层，独立包）
```

## 路线

B1 C-IR + 校验器 ✅ → B2 布局原语 6 个 + VueDom ✅ → B3 Native 映射 ✅ → B4 UI 原语 + Fluid 扩展 ✅ → B5 conformance 三端快照 ✅ → **G-32 B1 完整语义闭环（128 原语 SSOT + audit:coverage 100% + 26 implemented 语义）✅** → B6 compat-miniprogram → B7 API Hook 化
