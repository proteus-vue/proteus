# API 参考（API Reference）

## 目标

**自动从 TypeScript 类型定义生成 API 参考**，不手写——保证文档与代码永远同步。

## 数据来源

```
packages/*/src/**.ts（含 TSDoc 注释）
  → api-codegen/（复用 types-plan 03 的 codegen 派发）
  → 生成 reference/*.json
  → 文档站渲染
```

**对齐 types-plan**：Config Schema、Platform 判别联合、全局 Registry 的 `.d.ts` 是唯一真相源，API 页从中派生。

## 生成内容

每个导出的 API 包含：
- 名称 + 签名（重载展开）
- TSDoc 描述
- 参数表（name / type / required / default / description）
- 返回值
- 示例（从 ```` ```ts ```` 代码块提取）
- 所属包（`@proteus/core` / `@proteus/compiler` ...）
- `since` / `stability`（对齐 03-guide 版本标记）
- 平台支持矩阵（Web / Skyline / App，来自 Platform capability）

## 页面结构

```
/reference
  /core
    createApp
    defineApp
    mountMpApp
  /compiler
    defineTransform
    compile
  /router
    defineRoute
    ...
```

## 分组与导航

- 按 package 分组（对应 monorepo `packages/*`）
- 侧边栏自动从 codegen 输出生成
- 支持按平台过滤（`?platform=skyline` 只显示 Skyline 可用 API）

## 示例嵌入（对齐 Playground）

每个 API 示例旁有"在 Playground 运行"按钮 → 打开 `05-playground.md` 并注入代码。

## 版本与废弃

- 从 `since` 字段生成"最低版本"标记
- `deprecated` API 显示迁移提示 + 替代方案
- 破坏性变更自动在 `/blog/changelog` 生成条目（见 `07`）

## 搜索

- API 名 + 参数名 + 描述进搜索索引
- 支持模糊匹配（`creatApp` → 提示 `createApp`）

## llms 结构化输出

每个 API 额外生成 JSON：
```json
{
  "name": "mountMpApp",
  "signature": "(root: Component, options?: MpOptions) => AppInstance",
  "params": [...],
  "example": "...",
  "platforms": ["skyline"]
}
```

汇总为 `/docs/reference/llms-full.txt`，供 AI agent 精确引用（对齐 02 的 AI 可读性）。

## 校验（`proteus audit api`）

- 代码里导出的 public API 是否都在 reference 有文档
- reference 里声明的 API 是否代码里真的存在（防止过期文档）
- 示例是否能通过 Compiler 校验

## 验收

- [ ] 16 份 plan 的所有 public API 全覆盖
- [ ] 代码改签名 → 文档自动更新（CI 检查 diff）
- [ ] `proteus audit api` 零违规
- [ ] 每个 API 至少 1 个可运行示例

## 依赖

- `types-plan` 03（codegen 派发 + Registry）
- `02-docs-system.md`（渲染 + llms.txt）
- `05-playground.md`（示例运行）
- `build-plan`（构建期 codegen 集成）
