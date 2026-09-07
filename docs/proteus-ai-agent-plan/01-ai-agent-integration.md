# G-36 AI Agent 接入：让 AI 自动产出符合柔性 IR 的标准业务代码

> 状态：草案 · 依赖 G-29（Compiler IR）/ G-31（语义入口）/ G-32（128 原语）/ 柔性框架（G-22）
> 铁律：G-36.1 ~ G-36.7 · CMP017 ~ CMP022
> ★编号避让：入库前规划编号为 G-33，与 cli-plus（G-33 CLI & 工程化）冲突 → 避让为 **G-36**

## 1. 动机：柔性框架缺的最后一环是「代码从哪来」

柔性框架官网（website-v3）已经证明：**同一份 `<p-adaptive>` SFC，在手机/平板/PC/车机/TV/手表各自原生呈现**。

但有一个问题没解决——**这份"符合柔性 IR 的标准代码"是谁写的？**

| 来源 | 问题 |
|------|------|
| 开发者手写 | 要懂 128 原语 + 降级 + Backend 差异，学习成本高 |
| 传统 AI 自由生成 | 生成 `<div class="flex-col">`、`wx.request` 回调、裸色值——**直接破坏语义层** |
| **Proteus Agent（本方案）** | Agent 受约束于 IR 契约 + 原语库 + design-token，输出天然合规 |

**核心论点：柔性框架定义了"什么是标准代码"，Agent 负责"按标准自动写出来"。二者是闭环。**

```
设计期：开发者意图 → Agent → 符合 IR 的标准代码
                                    ↓
运行时：同一份代码 → 柔性框架 → 六端各自原生呈现
```

没有 Agent，柔性框架只是"好看的展示"；没有柔性框架，Agent 只是"又一个代码生成器"。**两者结合，才构成完整命题。**

## 2. 设计原则（方法论五支柱在 Agent 层的具体化）

### 支柱① 语义优先 → Agent 只产出语义原语
Agent 生成的组件**必须来自 G-32 的 128 原语清单**，禁止输出 `<view>` `<scroll-view>` 等小程序组件名。

### 支柱② 接口与实现解耦 → Agent 不绑死 LLM 厂商
Agent Kit 通过统一接口（`AgentProvider`）对接 LLM，**可换 Claude / GPT / 通义 / 本地模型**，业务逻辑不依赖具体模型。

### 支柱③ 验证先于运行 → Agent 输出必经 conformance
Agent 每生成一次代码，**自动跑三层校验**：
1. IR Schema 校验（结构合法）
2. `verify-llm.js`（design-token / 原语命名 / 裸色值）
3. 柔性框架 conformance（六端渲染一致）

**任一失败 → Agent 自修复循环，不交付。**

### 支柱④ 渐进式覆盖 → Skills 分层
| 层级 | 内容 | 来源 |
|------|------|------|
| L1 内置 | intent-to-flex / design-token-fix / migrate-miniprogram | 框架官方 |
| L2 官方 | 行业模板（电商/IM/出行） | Proteus 团队 |
| L3 社区 | 业务专属 Skill | 生态贡献 |

### 支柱⑤ 方法论可泛化 → Agent 操作的是 IR，不是字符串
Agent 的核心动作是**构造/变换 Compiler IR / Component IR**，不是"拼接文本"。这让 AI 介入有确定边界，也为 G-23（AI 层）奠定基础。

## 3. 架构：4 层

```
┌──────────────────────────────────────────────────┐
│ L0  MCP Server (proteus-mcp)                     │
│     AI 工具标准协议，一次实现多客户端复用           │
│     tools: search_primitives / get_token /        │
│            check_capability / run_conformance     │
├──────────────────────────────────────────────────┤
│ L1  Agent Kit (SDK)                              │
│     withProteusRules / generatePage / runGuardrails│
│     SkillRunner / IRTransformer                   │
├──────────────────────────────────────────────────┤
│ L2  Skills (可复用能力单元)                       │
│     intent-to-flex                                │
│     migrate-miniprogram                           │
│     design-token-fix                              │
│     adapt-device (phone→car/watch)                │
├──────────────────────────────────────────────────┤
│ L3  Guardrails (护栏)                            │
│     JSON Schema / conformance / token 白名单       │
│     失败自修复循环                                 │
└──────────────────────────────────────────────────┘
```

### 3.1 数据流

```
用户意图（自然语言）
    ↓
[Skill: intent-to-flex]  →  拆解为语义区块（layout/data/action）
    ↓
[Component IR 构造]      →  查 G-32 原语库，组装 IR 节点
    ↓
[Agent Kit]              →  调用 LLM 填充实现细节
    ↓
[Guardrails]             →  Schema + token + conformance 校验
    ↓ (失败 → 回到构造，最多 N 次)
[代码生成]               →  标准 SFC + IR 注释
    ↓
[柔性框架]               →  六端渲染
```

## 4. Agent 生成的代码长什么样

**对比：传统 AI vs Proteus Agent**

```html
<!-- ❌ 传统 AI 生成 -->
<div class="product-page flex-col">
  <img src="xxx" class="banner"/>
  <button onclick="buy()" class="btn">购买</button>
</div>
<script>
wx.request({ url:'/api', success(res){} })  // 回调 + 裸平台 API
</script>
```

```html
<!-- ✅ Proteus Agent 生成 -->
<p-adaptive breakpoint="auto" :columns="auto">
  <p-media kind="image" :src="product.cover" fit="cover"/>
  <p-stack gap="md">
    <p-text variant="title">{{ product.name }}</p-text>
    <p-button variant="primary" :loading="buying" @click="buy">
      {{ $t('buy') }}
    </p-button>
  </p-stack>
</p-adaptive>

<script setup>
// 能力调用走 Hook，Backend 无关
const { data: product } = useFetch('/api/product/:id')
const { execute: buy, loading: buying } = usePayment().pay
</script>
```

**关键差异**：Agent 输出**自动符合** G-31 语义组件 + G-32 原语 + design-token + G-28 Hook 化 API。

## 5. Skill 详解

### Skill 1：intent-to-flex
**输入**：`"做一个商品详情页，要有主图、价格、SKU、加购，要适配车机和手表"`
**动作**：
1. 拆解为语义区块（hero / info / actions / recommendations）
2. 为每个区块选原语（`<p-media>` / `<p-stack>` / `<p-button>`）
3. 插入 `@conditional` 降级（车机无摄像头 → 降级输入）
4. 输出 Component IR

### Skill 2：migrate-miniprogram
**输入**：既有小程序项目代码
**动作**：
1. 扫描 `wx.*` / `<view>` / `<scroll-view>`
2. 映射表查对应原语
3. 生成 `<p-grid>` 替代 swiper、`<p-stack snap>` 替代 scroll-view
4. 微信私有能力 → `useMiniProgram()`
5. **70-90% 可自动 codemod，剩余语义还原由 Agent 辅助**（与 G-31 B6 compat-miniprogram 的 `proteus migrate mp` 协同）

### Skill 3：design-token-fix
**输入**：含裸色值/非规范类名的代码
**动作**：替换为 `design-tokens.json` 中的语义变量，校验 0 error

### Skill 4：adapt-device
**输入**：已有手机端页面 + 目标端（车机/TV/手表）
**动作**：调整拓扑（`cols`、`nav.topology`、热区尺寸），**不改语义**，只改 IR 约束

## 6. Guardrails（护栏）

### 三层拦截

| 层 | 机制 | 失败处理 |
|----|------|---------|
| L1 结构 | Component IR JSON Schema | 拒绝生成，重试 |
| L2 风格 | `verify-llm.js`（C1-C7） | 自动 fix（token 替换） |
| L3 语义 | conformance（六端一致） | 回到 IR 构造 |

### 失败自修复循环

```
generate → validate → fail?
                ↓ yes
           diagnose (错误归类)
                ↓
           repair (修正 IR / 提示 LLM)
                ↓
           retry (最多 3 次)
                ↓
           still fail? → 标记 need-human-review
```

## 7. Token 优化（成本可控）

| 策略 | 说明 |
|------|------|
| 增量学习 | Agent 只加载当前 Skill + 相关原语子集，不全量塞 context |
| 缓存 | 相同意图的 IR 模板缓存复用 |
| 工具协议 | MCP 让 LLM 按需 query，而非预读全部文档 |
| 成本模型 | 简单页面 < 5K tokens，复杂迁移 < 30K tokens |

## 8. 评测（如何证明 Agent 达标）

| 指标 | 目标 |
|------|------|
| 生成代码 conformance 通过率 | ≥ 95% |
| `verify-llm.js` 0 error 率 | ≥ 98% |
| 小程序迁移自动覆盖率 | ≥ 80% |
| 六端渲染一致性 | 100%（conformance） |
| 人工修改率（越低越好） | ≤ 10% |

## 9. 分批落地（B1-B6）

| 批次 | 内容 | 依赖 |
|------|------|------|
| B1 | MCP Server + design-token 工具 | G-32 原语库完备 |
| B2 | Agent Kit SDK + intent-to-flex | B1 |
| B3 | migrate-miniprogram Skill | B2 + G-31 |
| B4 | Guardrails + 自修复循环 | B2 |
| B5 | adapt-device Skill（接柔性框架） | B4 + G-22 |
| B6 | 评测集 + 官网 Agent Playground | B5 |

**B1 与 G-32 B1 同批（M1）**——因为 Agent 依赖原语库完备。

## 10. 跨 plan 协同

| 模块 | 与 G-36 的关系 |
|------|---------------|
| G-29 编译层 | Agent 操作 Compiler IR |
| G-31 语义入口 | Agent 只产出 128 原语 |
| G-32 原语库 | Agent 工具的数据源 |
| G-22 柔性框架 | Agent 代码的最终运行验证场 |
| G-23 AI 层 | G-36 是 G-23 的第一个具体落地 |
| G-37 RenderBackend SPI | Agent 代码经 C-IR 交付各端 Backend 渲染 |

## 11. Definition of Done

- [ ] MCP Server 实现 11 个工具，通过 conformance
- [ ] Agent Kit SDK 可独立运行（不绑 LLM 也能走 IR 构造）
- [ ] 4 个 Skill 均有端到端示例
- [ ] 生成代码 `verify-llm.js` 0 error
- [ ] 生成代码在柔性框架六端渲染一致
- [ ] 评测集达标（见第 8 节）

---

## 铁律（进规约总表）

- **G-36.1**：Agent 输出**必须**通过 conformance + `verify-llm.js`，否则不得交付
- **G-36.2**：Agent **不得**生成小程序组件名（`<view>` 等），必须走 G-32 原语
- **G-36.3**：Agent **不得**裸写平台 API（`wx.*`），必须走 Hook / `useMiniProgram()`
- **G-36.4**：新增 Skill **必须**经"组合性审查"，能用现有 Skill 组合则不得新增
- **G-36.5**：Agent 上下文 **必须** 走 MCP 按需查询，禁止全量塞入 system prompt
- **G-36.6**：失败自修复 **必须** 有上限（≤3 次），超限转人工
- **G-36.7**：Agent 生成的代码 **必须** 可追溯到 Component IR（保留 IR 注释）

## 补充规则（CMP）

- **CMP017**：Agent 取色**仅限** `design-tokens.json` 登记值
- **CMP018**：Agent 生成的页面**必须**声明 `<meta name="proteus-page">` 标识页类型
- **CMP019**：小程序迁移 Skill **必须** 保留 `wx.*` → 原语的映射日志
- **CMP020**：`adapt-device` **不得** 改变语义，只能改 IR 布局约束
- **CMP021**：MCP Server **必须** 对工具调用做鉴权（防 prompt injection）
- **CMP022**：Agent 评测集 **必须** 包含至少 1 个车机 + 1 个手表场景