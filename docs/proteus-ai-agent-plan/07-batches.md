# 分批落地与协同

## 1. 批次

| 批次 | 内容 | 依赖 | 落点 |
|------|------|------|------|
| **B1** | MCP Server + design-token 工具 + search_primitives | G-32 原语库完备 | **M1** |

> **✅ B1 已落地（决策 #360）**：新包 **`@proteus-vue/mcp`**（34 包）——**传输无关 MCP Server 核心**（11 工具 + 5 Resources + 3 Prompts + CMP021 策略；`@modelcontextprotocol/sdk` stdio/HTTP 适配为后续薄壳）：**① 11 工具**（03-mcp-server §2 清单全量）：只读 10——search_primitives（原语目录子串匹配+分类+截断）/get_primitive/list_primitives（128 统计）/get_design_token（点路径/分组/全树——**tokens.ts 初版 SSOT**）/check_capability/get_capability_matrix（**六引擎 capabilities 运行时派生**，非手写）/lookup_miniprogram（G-32 对照矩阵）/validate_ir（G-31 契约）/run_conformance（**六端渲染 conformance**——ComponentIR→IRNode 适配 + renderComponentSnapshot + checkComponentSnapshot）/generate_code（json/ts 两格式+禁改注记）；写入 1——write_file（**双闸：server 级 writeEnabled + 调用级 confirmed**，缺一拒绝；**防路径逃逸**：workspaceRoot resolve 后必须在根内——绝对/相对均可、../ 穿越拒绝；写后读回自证）；**② CMP021 策略**——轻量 Schema 参数校验（required/type/maxLength/enum——拒绝超长注入）/滑动窗口限流（60/min）/unknown_tool 等错误码；**③ 5 Resources**（原语目录/token 树/能力矩阵/C-IR Schema/商品详情页 IR 范例 few-shot）+ **3 Prompts**（proteus-flex-layout/proteus-migrate-wx/proteus-token-only SOP）；数据源全 SSOT 消费（component-ir/render-backend 运行时派生）。测试 `tests/mcp-server.test.ts` 16 用例；全量 1855/179 无回归；check:pkg **34 包** 0 error。
| **B2** | Agent Kit SDK + intent-to-flex | B1 | M1 |

> **✅ B2 已落地（决策 #361）**：新包 **`@proteus-vue/agent`**（35 包）——**Agent Kit SDK**：**① IRBuilder**（不绑 LLM 构造 ComponentIR——链式 addNode/setDeviceAdaptation/build；**semantic→tag 反查基于 TAG_SEMANTIC_MAP**（G-31 SSOT 同源机器映射）；未知语义显式报错不臆造 tag（SSOT 纪律）；capabilities 强制 CMP006 degradation；产物 BuiltPage { name, ir, adaptation }——validate_ir 可直接校验）；**② generateCode 规则引擎**（IR→代码无需 LLM：sfc=p-* 模板（childless 自闭合+props 序列化）/ts=类型化模块+禁改注记）；**③ withProteusRules**（5 条系统约束：G-36.2/G-36.3/CMP017/G-31.1/G-29——LLM system prompt/规则引擎校验共用）；**④ intent-to-flex Skill（规则引擎版）**——意图五步：实体识别（**关键词规则引擎确定性**——BLOCK_RULES 中英词表：主图→ui.media/价格→ui.text emphasis/加购购物车→ui.button/扫码→capability.scan-qr+CMP006 降级声明等 8 组）→ 查原语库（经 MCP search_primitives——知识面协议化）→ 构造 IR（IRBuilder）→ 降级声明 → 输出 IR+代码；matchBlocks 可单测对账；空意图诚实兑底单文本区块；**⑤ AgentKit 门面**——generatePage 端到端（targetBackends→adaptation 空档声明 CMP020 不臆造约束；不支持 Skill 显式报错不静默）+ LlmLike 可注入契约（真模型属后续批次）+ rules 缺省注入 + 缺省内存 MCP（与 @proteus-vue/mcp 同源）；**G-36 降级策略成立：LLM 不可用时走 IR 模板，不绑 LLM 也能走 IRBuilder**（DoD 第 2 项达成）。测试 `tests/agent-kit.test.ts` 16 用例；全量 1871/180 无回归；check:pkg **35 包** 0 error。
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
