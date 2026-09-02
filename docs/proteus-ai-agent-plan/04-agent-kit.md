# Agent Kit（SDK）与 Skills

## 1. AgentKit 核心 API

```ts
import { AgentKit, withProteusRules } from '@proteus-vue/agent'

const kit = new AgentKit({
  provider: 'claude',       // AgentProvider
  mcp: 'proteus-mcp',      // MCP Server 地址
  rules: withProteusRules(), // 注入 G-31/32 约束
})

// 意图 → 标准页面
const { code, ir } = await kit.generatePage({
  intent: '商品详情页，主图+价格+SKU+加购，适配车机和手表',
  skills: ['intent-to-flex', 'adapt-device'],
  targetBackends: ['ios', 'android', 'harmony', 'web', 'car', 'tv', 'watch'],
})

// 小程序迁移
const { code, report } = await kit.migrate(miniprogramCode, {
  skill: 'migrate-miniprogram',
})
```

## 2. withProteusRules（系统约束注入）

```ts
function withProteusRules(): SystemRule[] {
  return [
    { id: 'G-36.2', text: '禁止生成 <view>/<scroll-view> 等小程序组件，改用 G-32 原语' },
    { id: 'G-36.3', text: '禁止裸写 wx.* / uni.*，改用 use* Hook 或 useMiniProgram()' },
    { id: 'CMP017', text: '颜色仅限 design-tokens.json 登记值' },
    { id: 'G-31.1', text: '组件必须以 p- 前缀，语义命名' },
    { id: 'G-29',   text: '输出须可序列化为 Component IR' },
  ]
}
```

## 3. IRBuilder（不依赖 LLM 也能构造 IR）

```ts
const ir = new IRBuilder('product-detail')
  .addNode({ type: 'layout.stack', props: { gap: 'md' } }, (stack) => {
    stack.addNode({ type: 'media', props: { kind: 'image', src: '{{cover}}' } })
    stack.addNode({ type: 'ui.text', props: { variant: 'title', content: '{{name}}' } })
    stack.addNode({ type: 'capability.payment', props: { action: 'pay' } })
  })
  .setDeviceAdaptation({
    car: { cols: 1, 'nav.topology': 'focus-tree', hotspots: 'xl' },
    watch: { cols: 1, glance: true },
  })
  .build()

// IR → 代码（规则引擎，无需 LLM）
const code = generateCode(ir, 'sfc')
```

**这实现 G-36 降级策略**：LLM 不可用时走 IR 模板。

## 4. Skill 详解

### Skill: intent-to-flex

```
输入：自然语言意图
步骤：
  1. 实体识别 → 页面类型 / 区块 / 交互
  2. 查原语库（search_primitives）→ 每个区块选原语
  3. 构造 Component IR
  4. 插入 @conditional 降级节点
  5. 输出 IR + 代码
```

### Skill: migrate-miniprogram

```
输入：小程序 SFC + wx.* 脚本
步骤：
  1. AST 扫描 wx.* / <view>/<scroll-view>/<swiper>
  2. 查 lookup_miniprogram 映射
  3. 替换：
     swiper        → <p-stack snap="mandatory" loop>
     scroll-view  → <p-scroll axis>
     movable-view → <p-draggable>
     wx.request   → useFetch()
     wx.navigateTo → router.push()
  4. 微信私有 → useMiniProgram()
  5. 生成映射日志（CMP019）
覆盖率目标：≥ 80% 自动，剩余语义还原由 Agent 辅助
```

### Skill: design-token-fix

```
输入：含裸色值代码
步骤：
  1. 扫描十六进制 / 裸 rgb
  2. 匹配 design-tokens 最接近语义色
  3. 替换为 var(--*)
  4. 跑 verify-llm.js → 0 error
```

### Skill: adapt-device

```
输入：已有页面 IR + 目标端
步骤：
  1. 读取目标端 capability + Tier
  2. 调整 cols / nav.topology / 热区尺寸
  3. 不改语义，只改布局约束（CMP020）
  4. 跑 conformance 六端
```

## 5. SkillRunner

```ts
class SkillRunner {
  async execute(name: string, input: any, ctx: AgentContext) {
    const skill = ctx.skills[name]
    const result = await skill.run(input, ctx)  // 可能调 LLM
    // 必经 Guardrails
    const validated = await ctx.guardrails.validate(result)
    if (!validated.ok) {
      return this.repair(result, validated.errors, ctx)  // 自修复
    }
    return result
  }
}
```
