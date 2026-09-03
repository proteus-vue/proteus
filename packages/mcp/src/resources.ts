// packages/mcp/src/resources.ts
// ★G-36 B1（proteus-ai-agent-plan 03-mcp-server §3）：MCP Resources（被动上下文——LLM 按需拉取避免 token 浪费）
import { PRIMITIVE_CATALOG, COMPONENT_IR_SCHEMA, MP_MAPPING_MATRIX } from '@proteus-vue/component-ir'
import { DESIGN_TOKENS } from './tokens'
import { capabilityMatrix } from './tools'

export interface McpResource {
  readonly uri: string
  readonly name: string
  readonly description: string
  /** 返回 JSON 可序列化内容 */
  read(): unknown
}

/** 商品详情页 IR 范例（G-32 原语——Agent few-shot 素材） */
function productDetailExample(): unknown {
  return {
    _example: 'proteus://examples/product-detail',
    component: {
      tag: 'p-page',
      semantic: 'shell.page',
      props: { title: '商品详情' },
      children: [
        {
          tag: 'p-media',
          semantic: 'ui.media',
          props: { kind: 'image', src: 'https://cdn.example.com/product.jpg' },
        },
        {
          tag: 'p-box',
          semantic: 'layout.box',
          props: {},
          children: [
            { tag: 'p-text', semantic: 'ui.text', props: { content: 'Proteus 语义组件礼盒', variant: 'title' } },
            { tag: 'p-text', semantic: 'ui.text', props: { content: '¥ 299', variant: 'emphasis' } },
          ],
        },
        {
          tag: 'p-grid',
          semantic: 'layout.grid',
          props: { minColWidth: 160 },
          children: [
            { tag: 'p-box', semantic: 'layout.box', children: [{ tag: 'p-button', semantic: 'ui.button', props: { variant: 'primary', label: '加入购物车' } }] },
            { tag: 'p-box', semantic: 'layout.box', children: [{ tag: 'p-button', semantic: 'ui.button', props: { variant: 'secondary', label: '立即购买' } }] },
          ],
        },
      ],
    },
  }
}

/** ★G-36 B1：5 个被动资源（03-mcp-server §3 清单） */
export const MCP_RESOURCES: readonly McpResource[] = [
  {
    uri: 'proteus://primitives/catalog',
    name: '原语完整目录',
    description: 'G-32 128 原语完整目录（id/semantic/tag/api/props/status）',
    read: () => PRIMITIVE_CATALOG,
  },
  {
    uri: 'proteus://tokens/design',
    name: 'Design Tokens',
    description: 'design token 树（颜色/字号/间距/圆角——业务禁硬编码，G-36 铁律）',
    read: () => DESIGN_TOKENS,
  },
  {
    uri: 'proteus://capabilities/matrix',
    name: '端×能力矩阵',
    description: '六渲染引擎 × 后端能力（layout/glass/blur/animation/textureSharing/ssr/input）',
    read: () => capabilityMatrix(),
  },
  {
    uri: 'proteus://ir/schemas/component',
    name: 'Component IR Schema',
    description: 'C-IR JSON Schema（G-31 组件语义契约）',
    read: () => COMPONENT_IR_SCHEMA,
  },
  {
    uri: 'proteus://examples/product-detail',
    name: '商品详情页范例',
    description: '商品详情页 IR 范例（G-32 原语 few-shot 素材）',
    read: () => productDetailExample(),
  },
]

/** 小程序对照矩阵（lookup_miniprogram 的数据源——proteus://mp/mapping） */
export function mpMapping(): unknown {
  return MP_MAPPING_MATRIX
}
