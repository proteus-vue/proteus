# 与 Style Safety (G-16) 协同

## 产物合规闸门

Agent 生成的 `p-*` / `:style` 绑定，最终都经 G-16 Runtime Validator：

```
Agent apply
  → Compiler Plugin transform
  → emit 阶段产物
  → Style Safety Validator（G-16 三层防线）
  → JSI / 原生 API（绝无非法参数）
```

## 校验项

| 检查 | 来源 |
|------|------|
| 属性白名单（`p-*` + 直映射表） | G-16 语义层 |
| 值类型（Length/Color/Opacity 逐平台收窄） | G-16 类型系统 |
| 编译期 `:style` 推导覆盖率 | G-16 三层防线 |
| FLD001-006 | G-22 |

## 降级协同

若 Agent 生成的值被 Style Safety 拒绝（如非法颜色），Validator 按"宁可降级也不崩溃"哲学处理（G-16），同时 Agent 收到 `verify` 失败，自我修正。

## AI004 / AI005 落实

- AI004（破坏性写须审批）：Style Safety 把"新增/删除样式属性"识别为潜在破坏性，自动升为 PR 级；
- AI005（建议附依据）：Agent 每条建议标注命中的 FLD/CSS/StyleSafety 规则编号。

## 结论

> G-16 是 Agent 产物的**最后闸门**：即便模型臆测出错，非法值也到不了原生端（对齐 G-23.2 "产物必须校验"）。
