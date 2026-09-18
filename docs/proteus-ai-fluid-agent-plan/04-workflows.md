# 工作流

## W1 对话式生成

```
用户："把首页做成卡片网格，手机一列平板多列"
  → Agent 读上下文（已有 Card 组件、breakpoints）
  → 生成 <p-grid :min-col-width="160"><Card/></p-grid>
  → verify → 生成 Diff → 分支 commit
```

## W2 存量迁移

```
用户："把 src 里的硬编码宽度都改成柔性的"
  → scanHardcodedWidth(src/)
  → 遍历 issues：
      suggestFluidProp(issue) → replacement
      applyFluidRefactor(dryRun=true)
  → 汇总 Diff + 依据清单
  → verifyViaCompilerPlugin() → 全绿才 PR
```

## W3 DevTools 协同

```
开发者在 DevTools Inspector 点选节点
  → "为何此卡片在小屏溢出？"
  → Agent 读运行时 LayoutConstraint（来自 G-19）
  → 返回：宽度 320px 固定，建议 p-fluid(280,480)
  → 一键应用 → 热更新验证
```

## W4 约束跟随

任何 generate/migrate 产物最终都过 `verifyViaCompilerPlugin()`：
- 通过 → apply（受信任级别约束）；
- 未通过 → Agent 自我修正一次，仍失败则交人工。

## 示例会话（W2）

```
> proteus ai fluidize ./src --dry-run

[scan] found 37 hardcoded issues in 12 files
  src/views/Home.vue:42  width:320px     → p-fluid="width(280,480)"  (FLD004, FLD003)
  src/views/List.vue:15  @media(...)     → <p-grid min-col-width>    (FLD001)
  ...

[verify] 37/37 passed FLD + --strict-css

apply? [y/N/show-diff] ›
```
