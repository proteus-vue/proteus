# 分批落地与协同

## 1. 批次

| 批次 | 内容 | 依赖 | 落点 |
|------|------|------|------|
| **B1** | MCP Server + design-token 工具 + search_primitives | G-32 原语库完备 | **M1** |
| B2 | Agent Kit SDK + intent-to-flex | B1 | M1 |
| B3 | migrate-miniprogram Skill | B2 + G-31 | M2 |
| B4 | Guardrails + 自修复循环 | B2 | M2 |
| B5 | adapt-device Skill（接柔性框架） | B4 + G-22 | M2 |
| B6 | 评测集 + Agent Playground 官网页 | B5 | M2-M3 |

**B1 与 G-32 B1 同批（M1）**：Agent 依赖原语库完备。

## 2. Definition of Done

- [ ] MCP Server 实现 11 工具，通过 conformance（G-29 IR 校验）
- [ ] Agent Kit SDK 可独立运行（不绑 LLM 也能走 IRBuilder）
- [ ] 4 Skill 均有端到端示例
- [ ] 生成代码 `verify-llm.js` 0 error
- [ ] 生成代码在柔性框架六端渲染一致（conformance）
- [ ] 评测集达标（见下）
- [ ] Agent Playground 集成进 website-v3，可在线演示

## 3. 评测集

| 指标 | 目标 |
|------|------|
| conformance 通过率 | ≥ 95% |
| `verify-llm.js` 0 error 率 | ≥ 98% |
| 小程序迁移自动覆盖率 | ≥ 80% |
| 六端渲染一致性 | 100% |
| 人工修改率 | ≤ 10% |

**CMP022：评测集必须含 ≥1 车机 + ≥1 手表场景。**

## 4. 跨 plan 协同矩阵

| 模块 | 关系 |
|------|------|
| G-29 编译层 | Agent 操作 Compiler IR（生成/优化/修复） |
| G-31 语义入口 | Agent 只产出 128 原语，禁小程序组件名 |
| G-32 原语库 | Agent 工具的数据源（search_primitives） |
| G-22 柔性框架 | Agent 代码的最终运行验证场（六端） |
| G-23 AI 层 | **G-36 是 G-23 的第一个具体落地** |
| Website v3 | Agent Playground 是官网核心交互 |

## 5. 风险与缓解

| 风险 | 缓解 |
|------|------|
| LLM 生成不合规 | Guardrails 三层 + 自修复 |
| MCP 工具被注入 | 参数 Schema 校验 + 白名单（CMP021） |
| Token 成本高 | 增量加载 + 缓存（第 5 节） |
| 迁移覆盖率不足 | 保留映射日志，人工兜底 |
| Agent 不可控 | IR 优先，规则引擎兜底（不依赖 LLM） |
