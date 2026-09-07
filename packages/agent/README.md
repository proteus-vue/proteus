# @proteus-vue/agent

G-36 B2（proteus-ai-agent-plan 04-agent-kit）——**Agent Kit SDK**：意图 → 标准页面的 SDK 门面。**不绑 LLM 也能走 IRBuilder**（G-36 降级策略：LLM 不可用时走 IR 模板，规则引擎确定性产出）。

## 核心 API

### IRBuilder（不依赖 LLM 构造 ComponentIR）

semantic → tag 反查基于 `TAG_SEMANTIC_MAP`（G-31 SSOT 同源）；未知语义显式报错（不臆造 tag）：

```ts
import { IRBuilder } from '@proteus-vue/agent'

const page = new IRBuilder('product-detail')
  .addNode({ semantic: 'layout.stack', props: { gap: 'md' } }, (stack) => {
    stack.addNode({ semantic: 'ui.media', props: { kind: 'image', src: '{{cover}}' } })
    stack.addNode({ semantic: 'ui.text', props: { variant: 'title', content: '{{name}}' } })
    stack.addNode({ semantic: 'capability.scan-qr', capabilities: [{ name: 'scan-qr', degradation: '手动输入降级' }] })
  })
  .setDeviceAdaptation({ car: { cols: 1, 'nav.topology': 'focus-tree' }, watch: { cols: 1, glance: true } })
  .build() // { name, ir, adaptation } —— validate_ir 可直接校验
```

### generateCode（规则引擎，无需 LLM）

```ts
import { generateCode } from '@proteus-vue/agent'
const sfc = generateCode(page, 'sfc') // p-* 模板（childless 自闭合）
const ts = generateCode(page, 'ts')   // 类型化 ComponentIR 模块
```

### AgentKit（意图 → 标准页面）

```ts
import { AgentKit } from '@proteus-vue/agent'

const kit = new AgentKit({ provider: 'claude' }) // llm 可注入（LlmLike）；缺省规则引擎路径
const out = await kit.generatePage({
  intent: '商品详情页，主图+价格+加入购物车',
  name: 'product-detail',
  targetBackends: ['car', 'watch'],
})
// out: { name, code, ir, adaptation, blocks }
```

### withProteusRules（系统约束注入）

```ts
import { withProteusRules } from '@proteus-vue/agent'
withProteusRules() // [G-36.2, G-36.3, CMP017, G-31.1, G-29]
```

### intent-to-flex Skill（规则引擎版）

意图 → 五步：实体识别（关键词规则，确定性）→ 查原语库（MCP `search_primitives`）→ 构造 Component IR（IRBuilder）→ 降级声明（CMP006）→ 输出 IR + 代码。`matchBlocks(intent)` 可单独用于对账。

## 与 MCP 的关系

Agent Kit 的知识面走 `@proteus-vue/mcp`（缺省内存 server 同源；可注入外部 MCP 实例）——skill 步骤（查原语库）经 MCP 协议，与 LLM 版/规则引擎版行为一致。
