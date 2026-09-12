# 00 · 校准原理与三层绑定

## 1. 核心命题

> **端能力对齐 = 用最全的端做「覆盖度标尺」，用我们的 IR 做「对齐基座」，产出可门禁的三层绑定。**

三个关键词缺一不可：

- **覆盖度标尺**（Completeness Ruler）：必须有**外部权威源**，否则自证同义反复（手写矩阵不登记就永不红——本项目已踩过此坑）。
- **对齐基座**（Alignment Substrate）：必须有**自己的语义层**，否则"对齐"= 抄 API，锁死在别人的设计里（违反 G-31）。
- **三层绑定**（Three-Layer Binding）：必须**分层可演进**，否则加新端要动业务代码。

---

## 2. 覆盖度标尺：为什么选小程序

| 候选标尺 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **微信小程序官方文档** | 能力最全（77 组件/793 属性）· 有稳定文档结构可抓 · 团队/用户最熟悉 | 是"一个端"的实现细节 | ✅ **选它**（覆盖度维度） |
| Web 标准（MDN） | 规范权威 | 端能力窄（无相机/蓝牙/小程序私有能力） | 辅 |
| 我们的手写清单 | 贴合自身 | **自证同义反复**（不登记即永不红） | ❌ 禁用 |

**关键**：小程序作为标尺，**只用于回答"有没有"**，不用于回答"叫什么/怎么实现"。

### 标尺的两级粒度（★本计划的起点）

| 粒度 | 产物 | 能回答 | 状态 |
|---|---|---|---|
| 组件名级 | `miniprogram-official-spec.json`（84 组件名） | 「有没有 `p-button`」 | ✅ 已有（但**不够**） |
| **属性级** | `miniprogram-component-attrs.json`（77 组件 / 793 属性） | 「`p-button` 覆盖了官方 22 属性中的几个」 | ✅ 本计划新增 |

**教训**：只有组件名级标尺时，`p-button` 声明 2 个属性也算"已覆盖"——**门禁粒度不足 = 缺口不可见 = 不会被修**。

---

## 3. 对齐基座：Component IR

对齐**必须经 IR**（`packages/component-ir`，SSOT）：

```ts
// primitives.ts —— 语义原语清单（唯一事实源）
{ id: 'U10', kind: 'ui', semantic: 'ui.input', tag: 'p-input',
  props: ['type', 'mask', 'validation', 'clearable'],   // ← 语义约束（非平台属性名）
  mpEquiv: '<input>', tier: 'L1', status: 'implemented' }
```

**`props` 是语义约束描述**（G-32.5），不是平台属性名清单。这带来三个好处：

1. **可归一**：官方 `value`（slider）/`checked`（switch）/`value`（input）→ 我们的 `modelValue` 约束（一个语义，三处复用）
2. **可合并**：官方 `active-color`+`selected-color` → 我们的 `activeColor`（语义等价，去重）
3. **可演进**：iOS/Android/鸿蒙 各自映射 `ui.input` 语义，**IR 不变**

---

## 4. 三层绑定（★本计划的核心机制）

```
        ┌──────────────────────────────────────────────┐
Layer 1 │ IR props（语义约束）                          │  ← SSOT，跨端稳定
        │ primitives.ts: props: ['modelValue','type']   │
        └──────────────────────────────────────────────┘
                          ↕ 编译期绑定 + 门禁校验
        ┌──────────────────────────────────────────────┐
Layer 2 │ 组件 props（开发者书写面）                     │  ← 每端同一套（同源码）
        │ defineProps({ modelValue, type, ... })        │
        └──────────────────────────────────────────────┘
                          ↕ 编译期发射（模板绑定）
        ┌──────────────────────────────────────────────┐
Layer 3 │ 原生属性（各端实现）                          │  ← 端专属，可自由变化
        │ MP:  <input value="{{...}}" type="{{...}}">   │
        │ Web: <input v-model ...>                      │
        │ iOS: UITextField.text / .keyboardType         │
        └──────────────────────────────────────────────┘
```

### 分层演进规则（铁律）

| 变化类型 | 允许改动的层 | 例子 |
|---|---|---|
| 新端接入 | **只改 Layer 3** | iOS 后端的 `ui.input` → `UITextField` |
| 新增能力属性 | Layer 1 → 2 → 3（自顶向下） | 官方新版加 `input.enableNative` → 先登记 IR，再声明 props，再绑各端 |
| 语义归一/改名 | Layer 1（+ 兼容别名） | `value`/`checked` 统一为 `modelValue` |
| 平台 bug 修复 | **只改 Layer 3** | MP 端 input 高度异常 → 只改 p-input 样式 |

**禁止**：跳过 Layer 1 直接从 Layer 3 加属性（会形成"端私有属性泄漏到开发者面"，破坏跨端一致性）。

---

## 5. 能力等级（Tier）

复用 G-30/G-31 的 Tier 模型：

| Tier | 含义 | 属性支持要求 |
|---|---|---|
| **T1 核心** | 跨端语义核心（layout/ui/shell 基础） | 全端 supported |
| **T2 宿主** | 端原生能力（相机/地图/蓝牙） | 本端 supported，异端 fallback/unsupported（须显式声明） |
| **T3 私有** | 某端专属（小程序 `open-type` 的微信开放能力） | 仅本端 supported，**必须标 private** |

> **T3 属性必须显式标注**（如 `open-type` 的 `getRealtimePhoneNumber`）——不标则视为跨端承诺，会误导开发者。

---

## 6. 铁律（新增，纳入 CI 检查清单）

| 编号 | 铁律 | 违反后果 |
|---|---|---|
| **EA-1** | 覆盖度标尺必须有**外部权威源**（禁止手写清单自证） | 缺口不可见 |
| **EA-2** | 对齐必须**经 IR 登记**（`props` 语义约束先于 props 声明） | 端私有形态泄漏 |
| **EA-3** | 属性缺失**编译期可见**（属性覆盖门禁 ≤ 阈值即红） | 静默失效 |
| **EA-4** | 端私有属性**必须标 Tier**（private 不承诺跨端） | 跨端语义欺骗 |
| **EA-5** | 每个属性**须声明降级行为**（supported/fallback/unsupported） | 异端静默失败（对齐 G-31.2） |
| **EA-6** | 标尺快照**可复现**（生成器 + `--check` 漂移检测） | 标尺与官方脱节 |

---

## 7. 里程碑

| 里程碑 | 内容 | 验收 |
|---|---|---|
| **M1 标尺机制** ✅ | 属性级生成器 + 审计 + 门禁 | `gen-mp-component-attrs` + `audit` + test 落地 |
| **M2 参考实现** ✅ | `p-button` / `p-input` 属性全量对齐 | 21/22 · 12/27，门禁绿 |
| **M3 高频表单** | `p-switch`/`p-slider`/`p-progress`/`p-checkbox`/`p-radio`/`p-picker`/`p-textarea` | 覆盖 ≥ 80% |
| **M4 容器与外壳** | `p-view`/`p-scroll-view`/`p-page-container`/`p-nav`/`p-image`/`p-text` | 覆盖 ≥ 80% |
| **M5 宿主能力** | `p-media`/`p-map`/`p-camera`/`p-canvas`/`p-webview`/`p-ad`/`p-rich-text` | 覆盖 ≥ 70%（含降级声明） |
| **M6 降级声明** | 全组件属性补 `degradation`（EA-5） | 降级门禁绿 |
| **M7 新端 Playbook** | 沉淀 `06-new-end-playbook.md`（iOS 起验证） | iOS 按 Playbook 对齐一遍通过 |
