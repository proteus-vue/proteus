// packages/types/src/config-schema.ts
// ★types-plan B3：ProteusConfig JSON Schema（单一来源产物 2）——对齐 @proteus/plugin-vite 的 ProteusConfig
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
  },
} as const

export type ProteusConfigSchema = typeof proteusConfigSchema

/** 序列化 JSON（generate 命令落盘内容） */
export function proteusConfigSchemaJson(): string {
  return JSON.stringify(proteusConfigSchema, null, 2)
}
