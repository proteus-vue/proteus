# 与 Fluid Layout (G-22) 协同

## 四原语映射

Agent 识别的反模式 → 生成的柔性原语：

| 反模式 | 生成原语 | 规则依据 |
|--------|---------|---------|
| `width:320px`（固定） | `p-fluid="width(280,480)"` | FLD004, FLD003 |
| 等宽重复子项 | `<p-grid :min-col-width="160">` | FLD004 |
| 横排可换行列表 | `<p-stack direction="row" :wrap="true">` | — |
| 内容驱动尺寸 | `<p-fit :max-ratio="0.8">` | — |
| `@media (min-width:768px)` | `p-grid` 断点自动（IR 推导） | FLD001 |
| `Dimensions.get().width` | `useBreakpoint()` | FLD006 |

## 断点推导

Agent 读 `app.config.layout.breakpoints`（G-20），不硬编码：

```ts
// scan 时收集容器宽度分布 → suggest 时选 clamp 区间
// 对齐 G-22 deriveBreakpoints()
```

## DesignSystem token

Agent 优先引用 token（AI002）：
- `width: 320px` → 若匹配 `--card-max`，则生成 `p-fluid="var(--card-max)"`；
- 未知值才退化为字面量 clamp。

## clamp 生成（对齐 G-22）

```
固定值 320px，断点 [375, 768, 1440]
  → clamp(280px, calc(...vw), 480px)
  → 对应 p-fluid="width(280, 480)"
```

## 收益

开发者写一次语义，Agent 自动完成"识别 + 推导 + 校验 + 写回"，五端自适应无需手动媒体查询（G-22 承诺）。
