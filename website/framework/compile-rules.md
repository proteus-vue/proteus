---
title: 编译规则与决策链
order: 10
group: 编译期
---

# 编译规则与决策链

Proteus 的编译是**反黑盒**的：每条转换规则自带 AI 说明书，每次触发可追溯。

## 规则注册表

编译规则按阶段注册（`transforms/registry.ts`）：

| 阶段 | 规则数 | 示例 |
|---|---|---|
| template | 32 | `tag/div-to-view`、`tag/router-link` |
| script | 23 | computed 派生、watch 模拟、import 共享模块 |
| style | 8 | px→rpx、选择器重写 |
| validate | 3 | 产物自校验 |

每条规则携带：`id` / `description` / `when`（何时触发）/ `example`（before → after）/ `why`（为什么存在）/ `verify`（哪个测试守护）。

## 决策 trace

编译器在转换时收集**决策事件**（规则 ID + 行号 + before/after）：

```bash
npx proteus explain src/pages/index.vue   # 该文件触发的全部规则决策
npx proteus rules                         # 全部规则能力清单
npm run debug:mp                          # 全链路调试构建（产物注入决策链文件）
```

- `--trace-transform` 与官网 Playground 的 Trace Tab 同源（同一套决策事件结构）
- trace 落盘 `.transform-debug/`（决策链落盘，决策链可审计）

## 为什么重要

1. **反黑盒**：产物可枚举、可查询、可反查源码——「为什么被改写」永远有答案
2. **AI 说明书**：Agent 产码/排错时按规则 id 查询约束，而非自由发挥
3. **回归守护**：每条规则绑定测试（`verify` 字段指向用例文件）

## 下一步

- [运行期：Web 运行时](/docs/framework/runtime-web)
