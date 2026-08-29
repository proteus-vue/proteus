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
```

## 消费方

- **AI 代理**：`listTransformRules()` 摸清能力边界 → `getTransformRule(id)` 查单条 → 按 `source` 跳读实现
- **文档生成**：`formatTransformCatalog()` 直出文档章节（`docs/compiler.md` 的映射表与此同源）
- **未来 CLI**（roadmap v0.2）：`proteus explain <rule-id>` 输出单条说明书
- **未来 trace**（阶段二）：`proteus explain <vue-file>` 输出该文件触发的全部规则

## 阶段二：从"描述层"升级为"分派层"（规划，不在此阶段实现）

当前注册表只**描述**规则，不**执行**。后续里程碑（随 `@proteus/compiler` 独立包一起）为每条规则增加：

```typescript
interface TransformRule {
  // ...现有 AI 说明书字段
  apply?: (ctx: TransformContext) => void   // 阶段二：规则成为可独立调用的转换单元
}
```

届时：

- 编译管线改为按注册表分派（`template.ts` 等瘦身为规则编排器）
- `explainTransform(source)` 输出决策 trace：`line 26: <h1> → <text class="proteus-h1">（tag/heading-to-text + semantic/base-class）`
- 插件体系（roadmap v2.0 编译期插件）天然落地：第三方注册自定义规则

**为何不现在拆实现**：编译管线已被 79 个单测 + golden fixtures 锁定，先以注册表形态落地"透明"，再以增量方式演进到分派层，避免一次性重构动摇已验证的产物。
