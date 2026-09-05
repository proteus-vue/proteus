// packages/types/src/config-schema.ts
// ★types-plan B3：ProteusConfig JSON Schema（单一来源产物 2）——对齐 @proteus-vue/plugin-vite 的 ProteusConfig
// ★铁律 #5：schema 字段变更必须同步 plugin-vite/config.ts + CLI config-validate.ts（CI `proteus generate types --check` 拦截生成文件漂移）
// 编辑器接入：VS Code settings.json → "json.schemas": [{ "fileMatch": ["proteus.config.json"], "url": ".proteus/proteus.config.schema.json" }]

export const proteusConfigSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'ProteusConfig',
  type: 'object',
  required: ['platform', 'skyline', 'appid', 'pagesDir', 'routesOutput', 'customRoute', 'setDataBridge', 'style'],
  properties: {
    platform: { enum: ['mp-weixin', 'web'] },
    skyline: { type: 'boolean' },
    appid: { type: 'string' },
    pagesDir: { type: 'string' },
    routesOutput: { type: 'string' },
    subPackages: {
      type: 'array',
      items: {
        type: 'object',
        required: ['root'],
        properties: { root: { type: 'string' }, name: { type: 'string' } },
      },
    },
    customRoute: {
      type: 'object',
      properties: {
        registerPresets: { type: 'boolean' },
        builders: { type: 'object', additionalProperties: { type: 'string' } },
      },
    },
    rules: {
      type: 'object',
      properties: {
        disabled: { type: 'array', items: { type: 'string' } },
        mapping: { type: 'object' },
        customTags: { type: 'object', additionalProperties: { type: 'string' } },
      },
    },
    // ★G-29 编译器后端插拔（compiler-backend-1-plan §5）：backend 'node' | 'rust'（缺省 node）
    compiler: {
      type: 'object',
      properties: {
        backend: { enum: ['node', 'rust'] },
      },
    },
    setDataBridge: {
      type: 'object',
      properties: {
        batchWindow: { type: 'number' },
        perComponent: { type: 'boolean' },
      },
    },
    style: {
      type: 'object',
      properties: {
        px2rpx: { type: 'boolean' },
        rpxRatio: { type: 'number' },
      },
    },
    budget: {
      type: 'object',
      properties: {
        mainPackageKB: { type: 'number' },
        strict: { type: 'boolean' },
      },
    },
    router: {
      type: 'object',
      properties: { meta: { type: 'object' } },
    },
    // ★#447 D-2 dogfooding 门禁（audit-d2）：规则级可配——rules 子键 severity 枚举；未列规则默认 error
    audit: {
      type: 'object',
      properties: {
        dir: { type: 'string' },
        rules: {
          type: 'object',
          propertyNames: { enum: ['no-third-party-ui', 'no-media-query', 'no-platform-api', 'no-web-platform-api'] },
          additionalProperties: { enum: ['off', 'warn', 'error'] },
        },
      },
    },
  },
} as const

export type ProteusConfigSchema = typeof proteusConfigSchema

/** 序列化 JSON（generate 命令落盘内容；含扩展字段） */
export function proteusConfigSchemaJson(): string {
  return JSON.stringify(getConfigSchema(), null, 2)
}

// ============ B6 Schema Registry（可扩展，零 zod） ============

/** 注册的扩展字段：key → JSON Schema 片段（插件/业务扩展配置，不修改核心 schema） */
const schemaExtensions: Record<string, unknown> = {}

/**
 * 注册自定义配置字段（B6：插件/业务扩展 ProteusConfig，不修改核心 schema）
 * fragment 为 JSON Schema 片段（如 { type: 'string' }）；generate types 输出时自动合并
 */
export function extendConfigSchema(key: string, fragment: unknown): void {
  schemaExtensions[key] = fragment
}

/** 合并后的完整 schema（基础 + 扩展）；generate types / 校验消费 */
export function getConfigSchema(): Record<string, unknown> {
  return {
    ...proteusConfigSchema,
    properties: {
      ...proteusConfigSchema.properties,
      ...schemaExtensions,
    },
  }
}
