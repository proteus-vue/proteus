# 分批执行计划

## 依赖图

```
Compiler(✅) ──┬──→ M1 Vitest + wx mock
               ├──→ M2 编译快照（需 Compiler M3）
Component(✅) ──→ M3 组件测试
CLI(✅) ────────→ M4 Web E2E（需 dev 命令）
Testing(✅) ────→ 复用 fixture / 跨层契约思路
Blueprint(✅) ──→ M6 集成
```

## 批次

| 批 | 内容 | 输入 | 输出 | 验收 |
|---|---|---|---|---|
| B1 | M1 Vitest + wx mock + setup | 01 | 单测绿 | store/composable 100% 跑通 |
| B2 | M2 编译快照 + `--update` 流程 | 02 | `.snap` 进 git | SFC→WXML diff 可阻断 PR |
| B3 | M3 组件 + createMockContext | 03, 07 | L3 绿 | p-* 映射有快照 |
| B4 | M4 Playwright + 关键路径 P1-P5 | 04 | Web E2E 绿 | trace 导出可复现 |
| B5 | M5 automator 本地跑通 | 05 | MP E2E 绿（本机） | 首页跳转断言通过 |
| B6 | M6 Blueprint 集成 + 覆盖矩阵 | 10 | 150 页门禁 | audit < 12s |
| B7 | 文档 + 迁移 | 06, 08, 09 | README | 占位章节明确 |
| B8 | CI 接入（**条件：§08 决策完成**） | 08 | CI 绿 | Mac runner / 云测打通 |

## Prompt 模板（喂 LLM）

```
你是 Proteus 测试框架的实现者。当前批次：{batch}。
输入文档：{files}。
约束：
- Vitest 是 L1-L3 唯一运行器
- wx 必须 mock，禁止真实引用
- 快照进 git，CI 不自动更新
- 复用 @proteus-vue/test-core 的 createMockContext
- 对齐文件：proteus-compiler/02-ir.md、proteus-component/*.md
输出：可运行代码 + 用例 + 快照文件，不写说明性文字。
```

## 执行顺序
B1 → B2 → B3（可并行启动）；B4/B5 依赖下层稳定；B6 最后；B8 等 §08 决策。

---
