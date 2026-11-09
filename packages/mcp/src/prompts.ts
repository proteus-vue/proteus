// packages/mcp/src/prompts.ts
// ★G-36 B1（proteus-ai-agent-plan 03-mcp-server §4）：MCP Prompts（可复用提示词模板）
export interface McpPrompt {
  readonly name: string
  readonly description: string
  /** 模板消息（role=user） */
  messages: ReadonlyArray<{ role: 'user'; content: string }>
}

const FLEX_LAYOUT_PROMPT = [
  '你在为 Proteus 框架构造柔性布局（G-22 Fluid System）。规则：',
  '1. 只使用 p-* 语义原语（p-grid/p-stack/p-split/p-fit/p-fluid），禁止手写 media query / 硬编码断点',
  '2. 尺寸一律经过 p-fluid 表达式（如 p-fluid="font-size(20, 32)"）或 p-* 约束属性（min-col-width 等）',
  '3. 颜色/间距/字号只用 design token（get_design_token 查询），禁止硬编码',
  '4. 断点判断交给容器（createContainerQuery），禁止 if (width > 768) 手动分支（铁律 G-22.5）',
  '5. 产出后用 validate_ir 自校验，再 run_conformance 过六端',
].join('\n')

const MIGRATE_WX_PROMPT = [
  '你在把微信小程序页面迁移到 Proteus（G-31 Layer 1 兼容层策略）。SOP：',
  '1. 先用 lookup_miniprogram 查询每个 wx API / 组件的 Proteus 对等物',
  '2. 1:1 组件（view/text/button…）自动替换为 p-* 原语（proteus migrate mp 可批量）',
  '3. 回调式 API（wx.request）改写为 Hook（useFetch/useStorage），无法自动的标注 [proteus-migrate:manual]',
  '4. 同步存储 wx.setStorageSync → useStorage().set',
  '5. 产出后 validate_ir + run_conformance 验证，人工只处理 manual 标注项',
].join('\n')

const TOKEN_ONLY_PROMPT = [
  '你在为 Proteus 页面赋样式值。强制规则：',
  '1. 所有颜色/字号/间距/圆角必须来自 get_design_token 返回的 token',
  '2. 生成代码中出现任何字面色值（#fff 等）即为违规——先查 token 再写',
  '3. 语义色（primary/danger/success）优先于裸色名',
].join('\n')

/** ★决策 #1473：写插件的 SOP。
 *
 * 【为什么需要一条 prompt】四个插件工具本身不会阻止 AI 犯三类错：
 *   ① **编能力名**（凭印象写 `readFile` / `fs.read`，install 时才炸）；
 *   ② **要太多**（"以后可能用到"于是把写权限、终端全申请上）；
 *   ③ **以为能自己装**（MCP 里根本没有 install，它会开始编别的路子）。
 *   这三类都不是工具能拦的——工具只会回 error，而 AI 拿到 error 常常换个姿势继续蒙。
 *   ⇒ 用 prompt 把**顺序**和**禁止项**提前写死，比事后纠正便宜得多。
 */
const PLUGIN_AUTHOR_PROMPT = [
  '你在为 Proteus Studio 写插件。严格按这个顺序做，不要跳步：',
  '1. 先调 plugin_list_capabilities（带上你要用的 tier）——**能力 id 必须来自它返回的列表**，不许自己编名字。',
  '2. 只申请**跑得起来的最小集**：能只读就别要写；能用声明式（Tier 0，纯 JSON）就别写代码。',
  '3. 写 manifest：name 必须带 @proteus-studio/ 或 proteus-studio-plugin- 前缀；engines.studio 必填；',
  '   凡 grant=user 的能力**必须**写 reason——这段会原样展示给用户，写人话（"调用本机 rustfmt 格式化 Rust 源码"），',
  '   不要写术语（"需要 spawnProcess 能力以便执行"）。',
  '4. 调 plugin_validate_manifest 自检；有 error 就改到没有，不要带着 error 交付。',
  '5. 通过后再调 plugin_scaffold 拿骨架（它只返文本，不落盘；写盘由人决定）。',
  '',
  '硬规则（违反任何一条都会被安装闸拒掉，或者装上也不工作）：',
  '· implemented=false 的能力**不要用**——宿主没有对应实现，validate 会报 E_NOT_IMPLEMENTED。',
  '· 第三方插件拿不到 system.* / spawnProcess / terminal / device.* / clipboard.*',
  '  （它们要求 trusted 或 builtin tier，validate 会报 E_TIER_TOO_LOW / E_SYSTEM_SCOPE）。',
  '· **你不能安装或启用插件**——这里没有 install / enable 工具。安装与授权必须由人完成，',
  '  不要尝试绕过、也不要伪造"已安装"的状态。',
  '· 不要为了"以后可能用到"多申请能力。每多一项，用户在安装页就多一个看不懂的勾；',
  '  权限模型的价值全靠"申请得少"，申请得多等于没有。',
  '· status=proposed 的能力目前还没进正式 API 版本，可以用但要在交付说明里点出来（将来可能改名）。',
].join('\n')

/** ★G-36 B1：3 个可复用提示词模板 + #1473 插件开发 SOP（共 4 个） */
export const MCP_PROMPTS: readonly McpPrompt[] = [
  { name: 'proteus-flex-layout', description: '柔性布局构造指引（G-22 原语 + 禁手动断点）', messages: [{ role: 'user', content: FLEX_LAYOUT_PROMPT }] },
  { name: 'proteus-migrate-wx', description: '小程序迁移 SOP（lookup_miniprogram + 自动/手动分层）', messages: [{ role: 'user', content: MIGRATE_WX_PROMPT }] },
  { name: 'proteus-token-only', description: '强制只用 Token 取色（禁硬编码色值）', messages: [{ role: 'user', content: TOKEN_ONLY_PROMPT }] },
  {
    name: 'proteus-plugin-author',
    description: '写插件的 SOP（先查能力 → 最小集 → 自检 → 出骨架；禁编能力名/禁多申请/禁自行安装）',
    messages: [{ role: 'user', content: PLUGIN_AUTHOR_PROMPT }],
  },
]
