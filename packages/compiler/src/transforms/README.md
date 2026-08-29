# 编译规则注册表（transforms）—— AI-native 透明定位的核心

> 本目录是 Proteus **透明编译**的落地点：把散落在 `template.ts` / `script.ts` / `style.ts` / `validate.ts` 里的
> 所有转换规则，抽成**自描述的规则注册表**。每条规则 = 一份结构化 AI 说明书
> （what / why / when / example / verify / source / 决策号），人可读 + 机器可读。

## 为什么需要这一层（定位）

AI 代理（LLM）要驱动一个编译器，必须先能"看懂"它：

1. **枚举能力**：`listTransformRules()` → 编译器到底支持哪些转换（能力清单）
2. **查询单条**：`getTransformRule('tag/div-to-view')` → 为什么 div 变成 view、何时触发、如何验证、实现在哪
3. **反查源码**：每条规则的 `source` 字段直接指向实现位置，AI 可跳读确认
4. **（阶段二）决策 trace**：规则增加 `apply()` 后，注册表升级为分派层，可输出 `explainTransform(source)` —— 某份源码触发了哪些规则

## 模块边界（必须遵守）

| 允许 | 禁止 |
|---|---|
| import `./types` / `../tags`（映射表同源引用） | import `vite` / `proteus.config.ts` |
| import 同阶段规则文件（registry 聚合） | 读写文件系统 / 网络（纯数据） |
| 引用实现位置字符串（source 字段） | **执行任何转换**（本层只描述，不实现） |

- **映射表同源引用防漂移**：`tag/*` 规则的 `mapping` 直接取自 `../tags.ts` 的 `TAG_MAP` / `EVENT_MAP` / `SEMANTIC_CLASS`——改映射表自动生效；`tests/transforms.test.ts` 校验映射表每个键都被规则覆盖，杜绝"规则文档与实现脱节"。
- 本层是**纯数据**：零运行时开销、不参与编译管线（编译仍走 `template.ts` / `script.ts` / `style.ts` / `validate.ts`）。

## 公开 API（经 src/compiler/index.ts 导出）

```typescript
listTransformRules(phase?: 'template' | 'script' | 'style' | 'validate'): TransformRule[]
getTransformRule(id: string): TransformRule | undefined
formatTransformRule(rule: TransformRule): string   // 单条 AI 说明书（markdown 文本）
formatTransformCatalog(): string                    // 全量目录（按阶段分组）

// 阶段二：决策 trace（已实现）
explainTransform(source: string, options?): ExplainResult   // 一份 Vue SFC → 触发的全部规则
formatTransformTrace(result): string                        // 渲染决策 trace（按阶段 + 行号）
```

## 阶段二已实现：决策 trace（explainTransform）

转换函数（template/script/style）内嵌可选 trace 收集器（`src/compiler/trace.ts`）：

- **零副作用**：trace 是可选注入（`options.trace`），默认不存在则零开销，产物与既有 97 个单测锁定行为完全一致
- **防漂移**：template 侧 trace 键引用 `TAG_RULE_BY_TAG`（由规则 mapping 反推），`tests/explain.test.ts` 校验每个 trace 事件的 ruleId 都能在注册表解析——改规则 ID 而漏改实现侧 trace 当场报错
- **用法**：AI 改完编译器 / 写完页面 → `explainTransform(src)` 看转换链路 → 对照注册表理解每个决定

## 消费方

- **AI 代理**：`listTransformRules()` 摸清能力边界 → `getTransformRule(id)` 查单条 → 按 `source` 跳读实现 → `explainTransform()` 验证自己写的页面/改动
- **文档生成**：`formatTransformCatalog()` 直出文档章节（`docs/compiler.md` 的映射表与此同源）
- **未来 CLI**（roadmap v0.2）：`proteus explain <vue-file|rule-id>` 输出决策 trace / 单条说明书

## 阶段三：从"描述层"升级为"分派层"（规划，尚未实现）

当前注册表**描述**规则 + 转换函数内嵌 trace；后续里程碑（随 `@proteus/compiler` 独立包一起）为每条规则增加：

```typescript
interface TransformRule {
  // ...现有 AI 说明书字段
  apply?: (ctx: TransformContext) => void   // 阶段三：规则成为可独立调用的转换单元
}
```

届时：

- 编译管线改为按注册表分派（`template.ts` 等瘦身为规则编排器）
- `explainTransform` 从"内嵌 trace"升级为"分派即 trace"（天然完整，无遗漏）
- 插件体系（roadmap v2.0 编译期插件）天然落地：第三方注册自定义规则

**为何分两步走**：先以"内嵌 trace"形态落地可观察性（已实现、零风险），再演进到"分派层"（重构编译管线，需 golden 回归保护）；避免一次性重构动摇已验证的产物。
