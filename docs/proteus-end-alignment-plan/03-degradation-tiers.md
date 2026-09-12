# 03 · 属性降级声明与端 Tier 矩阵

## 1. 为什么需要降级声明（G-31.2 / CMP006）

**问题**：属性在 A 端支持、B 端不支持时，若静默失败 → 开发者到真机才发现。

**G-31 铁律**：> 每一个组件属性都必须声明其在各 Tier 下的降级行为（supported / fallback / unsupported）。

**现状**：`packages/component-ir/src/schema.ts` 已定义能力属性的降级字段（CMP006），但**组件属性尚未逐条声明**（M6 里程碑补齐）。

## 2. 降级三态

| 状态 | 含义 | 实现要求 |
|---|---|---|
| `supported` | 本端原生支持 | 直接映射原生属性 |
| `fallback` | 本端无原生支持，但有语义等价降级 | 须给出降级实现 + 声明（不静默） |
| `unsupported` | 本端无法实现 | 编译期警告/报错（fail-closed），或 `@conditional` 显式分支 |

## 3. 端 Tier 矩阵（按属性类型）

| 属性类型 | MP（微信） | Web | iOS | Android | 鸿蒙 |
|---|---|---|---|---|---|
| **T1 核心**（disabled/loading/value） | supported | supported | supported | supported | supported |
| **T2 宿主**（camera/map/bluetooth） | supported | fallback | supported | supported | supported |
| **T3 私有**（open-type/session-from） | supported | fallback（触发同名事件） | unsupported | unsupported | unsupported |
| **样式**（hover-class/hover-*） | supported | fallback（CSS :hover/:active） | fallback | fallback | fallback |

**规则**：矩阵中**不允许空白格**——每格必须是三态之一（缺格 = 违反 EA-5）。

## 4. 降级声明形态（组件属性）

在 IR 层声明（`primitives.ts` 或独立的 degradation 表）：

```ts
// 形态 A：内联在 PrimitiveDef（简单场景）
{ id: 'U1', semantic: 'ui.button', tag: 'p-button',
  props: ['openType'],
  degradation: { openType: { mp: 'supported', web: 'fallback', ios: 'unsupported' } } }

// 形态 B：集中式降级表（复杂场景，推荐——便于审计）
```

### fallback 的诚实要求（★反黑盒）

`fallback` **必须给可观察的降级行为**，不能只是"不报错"：

| 属性 | Web fallback（正确） | Web fallback（❌ 错误） |
|---|---|---|
| `open-type="contact"` | 触发 `@contact` 事件 + console 提示"Web 无客服会话，请自定义" | 什么都不做 |
| `hover-class` | 映射 CSS `:active` 类 | 忽略 |

**已验证先例**：Web `proteus-button` 的 `open-type` 降级实现（触发同名事件 + 明确提示），即本要求的参考。

## 5. 与能力（capability）降级的统一

`packages/api` 的能力 Hook 已用 `CapResult<T>` = `{ok:true;data:T} | {ok:false;error:CapError}` 表达降级；
组件属性降级**复用同一诚实原则**：

- 能力：`{ok:false, error}` 显式失败
- 属性：`fallback` 显式降级行为 / `unsupported` 编译期拦截

## 6. 验收（EA-5）

- 降级门禁：每个 `props` 里的属性都必须在降级表中有声明
- `unsupported` 属性在业务侧使用时：编译期报 `PROP_NO_DEGRADATION`（M6 实现）

## 7. 现状与待办

| 项 | 状态 |
|---|---|
| `schema.ts` 能力属性降级字段 | ✅ 已有 |
| Web `proteus-button` open-type 降级实现 | ✅ 参考实现 |
| 组件属性降级表（全量） | ⬜ M6 |
| `PROP_NO_DEGRADATION` 编译期门禁 | ⬜ M6 |
