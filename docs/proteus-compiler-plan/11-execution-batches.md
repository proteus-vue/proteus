# 分批执行策略

> 对齐整体 "防撑爆" 原则：每批 = 1 个可合并 PR = LLM 单次 ≤ 3 文件。

## 一、批划分

```
B1 (M1) parser + IR 定义 + 项目骨架         [地基，无依赖]
B2 (M2) transform 插件系统 + v-if/v-for 首批规则
B3 (M3) Web codegen 后端（透传，最快出活）
B4 (M3) Skyline codegen 后端（核心工作量）
B5 (M3) App codegen 后端（Custom Renderer 对接）
B6 (M4) 规则完整性：全局组件/appBar/route/worklet
B7 (M5+M6) source map + 增量编译 + HMR
B8 (M7) 循环检测 + 体积预算 + 死代码
B9 (M8) audit + CI 门禁 + trace 可视化
B10 (测试+迁移) 快照测试 + codemod + 文档定稿
```

## 二、依赖关系

```
B1 → B2 → B3 ∥ B4 ∥ B5 → B6 → B7 → B8 → B9 → B10
              ↑___________|
```

B3/B4/B5 可并行（三端后端独立）；B6 需三端后端稳定；B7-B9 依赖产物结构定型。

## 三、每批上下文预算

LLM 单次摄入：
- `00-overview.md`（快速回顾）
- 当前批次的 1-2 份模块文档
- 直接依赖的前置模块（已落地代码，引用即可，不重读）

**永远不把 12 份全塞进上下文。**

## 四、Prompt 模板（每批复用）

```
你是 Proteus 编译器的开发 AI。当前任务：{batch_id} {title}。

【架构铁律】
1. 源码 .vue → IR → 三端产物，全程可追溯（--trace-transform）
2. 每条 transform 规则一个文件 + JSDoc（Input/Output/Constraints）
3. 规则可独立 disabled，关闭后走原生写法
4. 平台差异只在 backend，业务源码零平台分支

【本次任务】
{具体文件清单 + 接口签名 + 验收清单}

【约束】
- 只产出本批次文件，不修改其他模块
- 每个 transform 必须含 JSDoc + 单测 snapshot
- 产物路径严格按 {path 规范}
```

## 五、进度追踪

| Batch | 模块 | 状态 | PR |
|-------|------|------|-----|
| B1 | parser/IR | ⬜ 待启动 | — |
| B2 | transform | ⬜ | — |
| ... | ... | ... | ... |

## 六、验收（全部批次完成后）

- [ ] 一份 `.vue` 三端产物均能运行
- [ ] `--trace-transform` 全规则覆盖
- [ ] 千级页面增量编译 < 2s
- [ ] `proteus audit compile` 通过 CI
- [ ] 迁移指南 codemod 可用
