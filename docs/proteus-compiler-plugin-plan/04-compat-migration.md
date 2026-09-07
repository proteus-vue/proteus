# 兼容与迁移：升级 `04-transform-plugin.md`（G-21）

> 本方案对现有 `proteus-compiler-plan/04-transform-plugin.md` 的升级策略——**保留 transform 子集，向后兼容，渐进迁移**。

## 一、现状（`04-transform-plugin.md`）

定义了：
- `TransformPlugin` 接口（`name` / `enforce` / `transform`）
- `TransformContext`（`warn` / `error` / `helpers` / `options` / `platform`）
- 规则文件规范（JSDoc + Input/Output + Constraints + Trace）
- 内置规则目录（`v-if.ts` / `v-for.ts` / `worklet.ts` ...）
- 配置驱动 `compiler.transforms`（可独立 disabled）
- 注册顺序 pre → default → post

**这些全部保留**，作为新系统的"规则级子集"。

## 二、升级映射

| 旧 (`TransformPlugin`) | 新 (`CompilerPlugin`) | 说明 |
|------------------------|----------------------|------|
| `name` | `name` | 保留 |
| `enforce` | `enforce` | 保留 |
| `transform(node, ctx)` | `hooks.transform(node, ctx)` | **方法搬到 hooks 对象** |
| `TransformContext` | `TransformContext`（继承 `BaseContext`） | 新增字段，向下兼容 |
| `compiler.transforms` | `compiler.plugins` | 旧字段保留 alias |
| 规则文件 `transforms/*.ts` | 规则文件（可独立导出为插件） | 渐进迁移 |

## 三、自动适配（零改动迁移）

Compiler 启动时检测插件形状：
```ts
function normalize(input: TransformPlugin | CompilerPlugin): CompilerPlugin {
  if ('hooks' in input) return input; // 已是新格式
  // 旧 TransformPlugin → 适配
  return {
    name: input.name,
    version: '0.0.0-legacy',
    enforce: input.enforce,
    hooks: { transform: input.transform },
  };
}
```

旧规则文件**无需任何修改**即可在新管线运行。

## 四、渐进迁移建议

### 阶段 1：兼容期（M1-M2）
- 同时支持 `TransformPlugin` 与 `CompilerPlugin`
- `compiler.transforms` 配置保留（内部转成插件）
- 文档标注旧 API 为 `@deprecated`，指向新 API

### 阶段 2：增强期（M3+）
- 鼓励新插件用完整 `CompilerPlugin`（六个钩子）
- 提供 `codemod`：`npx proteus migrate-plugin <file>` 自动把 `TransformPlugin` → `CompilerPlugin` 形状

### 阶段 3：稳定期（v1.0）
- `TransformPlugin` 仍可用（永久别名），但文档主推 `CompilerPlugin`

## 五、内置规则目录 → 插件化

旧目录中的规则可**渐进转为独立插件**（可选，非必须）：

| 规则文件 | 阶段钩子 | 说明 |
|---------|---------|------|
| `v-if.ts` | parse + transform | 已是规则级 |
| `v-for.ts` | parse + transform | 含 wx:key 校验 |
| `v-bind.ts` | transform | :class/:style → mustache |
| `v-on.ts` | transform | @click → bindtap |
| `worklet.ts` | transform + codegen | Worklet 桥 |
| `route-block.ts` | parse + buildIR | `<route>` → page meta |
| `appbar-wrapper.ts` | buildIR | rootComponents 包裹 |
| `scoped-style.ts` | transform + codegen | scoped CSS 哈希 |

> 内置规则**仍默认启用**，业务可按 `compiler.plugins` 配置 disabled 单条规则（沿用旧行为）。

## 六、破坏性变更清单（v1.0 前确认）

无强制破坏性变更——全程向后兼容。`TransformContext` 新增字段不删不改。

## 七、验收

- [ ] 旧 `TransformPlugin` 示例无需修改即可运行
- [ ] `compiler.transforms` 旧配置仍生效
- [ ] `codemod` 自动迁移脚本覆盖主要模式
- [ ] 内置规则目录回归测试全绿
