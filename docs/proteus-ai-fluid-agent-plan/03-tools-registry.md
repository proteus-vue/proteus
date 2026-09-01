# 工具注册表（Tool Registry）

所有工具入参出参均经 Zod 校验，Agent 不得绕过。

## T1: scanHardcodedWidth

```ts
const ScanInput = z.object({
  root: z.string().describe("扫描根目录，默认 src/"),
  include: z.array(z.string()).default(["**/*.vue", "**/*.tsx"]),
})
// 输出：HardcodedIssue[]
// { file, line, prop, value, kind: "fixed-width" | "media-query" | "dimensions-get" }
```

识别规则：
- `width:/height: = <number>px`（排除 `0`、`100%`、`auto`）；
- `@media (min-width|max-width)`；
- `Dimensions.get().width/height`。

## T2: suggestFluidProp

```ts
const SuggestInput = z.object({
  issue: z.object({ prop: z.string(), value: z.number(), context: z.any() }),
  breakpoints: z.array(z.number()),  // 来自 app.config.layout
})
// 输出：{ replacement: string, rationale: string }
// 例：width:320px → p-fluid="width(280, 480)"，依据 FLD003
```

映射：固定宽度 → `p-fluid`（clamp 推导）；重复等宽子项 → `p-grid :min-col-width`；横排可换行 → `p-stack :wrap`。

## T3: applyFluidRefactor

```ts
const ApplyInput = z.object({
  issue: z.any(),
  replacement: z.string(),
  dryRun: z.boolean().default(true),
})
// 仅 dryRun=false 且 verify 通过时写回；返回 Diff
```

## T4: verifyViaCompilerPlugin

```ts
const VerifyInput = z.object({ files: z.array(z.string()) })
// 调用 Compiler Plugin 的 check 钩子，跑：
//   --strict-css + FLD001-006 + Style Safety(G-16)
// 返回 { ok, violations: Violation[] }
```

## 安全约束

- 工具只读写工作区允许路径（沙箱）；
- `apply` 只在分支/临时副本执行；
- 每次调用写入 `ai-audit.json`（AI003）。
