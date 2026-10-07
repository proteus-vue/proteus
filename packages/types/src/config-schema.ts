// packages/types/src/config-schema.ts
// ★types-plan B3：ProteusConfig JSON Schema（单一来源产物 2）——对齐 @proteus-vue/plugin-vite 的 ProteusConfig
// ★铁律 #5：schema 字段变更必须同步 config.ts + CLI config-validate.ts（CI `proteus generate types --check` 拦截生成文件漂移）
// ★★★2026-10-08 配置模型 v4（决策 #641）：**按端分区**——顶层 targets.{web,mp,ios,android,harmony}。
// 编辑器接入：VS Code settings.json → "json.schemas": [{ "fileMatch": ["proteus.config.json"], "url": ".proteus/proteus.config.schema.json" }]

const nativeApp = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    version: { type: 'string' },
    buildNumber: { type: ['string', 'number'] },
  },
} as const

const targetsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    web: {
      type: 'object',
      properties: { output: { type: 'string' } },
    },
    mp: {
      type: 'object',
      required: ['appid'],
      properties: {
        appid: { type: 'string' },
        renderer: { enum: ['skyline', 'webview'] },
        style: {
          type: 'object',
          properties: { px2rpx: { type: 'boolean' }, rpxRatio: { type: 'number' } },
        },
        setDataBridge: {
          type: 'object',
          properties: { batchWindow: { type: 'number' }, perComponent: { type: 'boolean' } },
        },
        globalStyle: { type: 'string' },
        page: {
          type: 'object',
          properties: {
            autoScrollContainer: { type: 'boolean' },
            webviewPages: { type: 'array', items: { type: 'string' } },
          },
        },
        skylineLayout: {
          type: 'object',
          properties: {
            defaultDisplayBlock: { type: 'boolean' },
            defaultContentBox: { type: 'boolean' },
            tagNameStyleIsolation: { type: 'boolean' },
            enableScrollViewAutoSize: { type: 'boolean' },
            keyframeStyleIsolation: { type: 'boolean' },
          },
        },
        profileBoundary: {
          type: 'object',
          properties: { level: { enum: ['error', 'warn', 'off'] } },
        },
        rules: {
          type: 'object',
          properties: {
            disabled: { type: 'array', items: { type: 'string' } },
            mapping: { type: 'object' },
            customTags: { type: 'object', additionalProperties: { type: 'string' } },
          },
        },
      },
    },
    ios: {
      type: 'object',
      properties: {
        bundleId: { type: 'string' },
        displayName: { type: 'string' },
        version: { type: 'string' },
        buildNumber: { type: 'string' },
        minimumOSVersion: { type: 'string' },
        deviceFamily: { type: 'array', items: { type: 'integer', minimum: 1, maximum: 6 } },
        orientations: {
          type: 'array',
          items: { enum: ['portrait', 'portrait-upside-down', 'landscape-left', 'landscape-right'] },
        },
        launchPage: { type: 'string' },
        userInterfaceStyle: { enum: ['light', 'dark', 'automatic'] },
        statusBarStyle: { type: 'string' },
        statusBarHidden: { type: 'boolean' },
        urlSchemes: { type: 'array', items: { type: 'string' } },
        privacyUsageDescriptions: { type: 'object', additionalProperties: { type: 'string' } },
        appCategory: { type: 'string' },
        appTransportSecurity: {
          type: 'object',
          properties: { allowArbitraryLoads: { type: 'boolean' }, allowLocalNetworking: { type: 'boolean' } },
        },
        requiresFullScreen: { type: 'boolean' },
        developmentRegion: { type: 'string' },
      },
    },
    android: {
      type: 'object',
      properties: {
        applicationId: { type: 'string' },
        label: { type: 'string' },
        versionName: { type: 'string' },
        versionCode: { type: 'integer', minimum: 1 },
        minSdk: { type: 'integer', minimum: 1 },
        targetSdk: { type: 'integer', minimum: 1 },
        orientation: { enum: ['portrait', 'landscape', 'unspecified'] },
        permissions: {
          type: 'array',
          items: {
            oneOf: [
              { type: 'string' },
              { type: 'object', required: ['name'], properties: { name: { type: 'string' }, maxSdkVersion: { type: 'integer', minimum: 1 } } },
            ],
          },
        },
        usesFeatures: {
          type: 'array',
          items: {
            oneOf: [
              { type: 'string' },
              { type: 'object', required: ['name'], properties: { name: { type: 'string' }, required: { type: 'boolean' } } },
            ],
          },
        },
        queryPackages: { type: 'array', items: { type: 'string' } },
        icon: { type: 'string' },
        launchPage: { type: 'string' },
        theme: { type: 'string' },
        allowBackup: { type: 'boolean' },
        largeHeap: { type: 'boolean' },
        hardwareAccelerated: { type: 'boolean' },
        supportsRtl: { type: 'boolean' },
        usesCleartextTraffic: { type: 'boolean' },
        networkSecurityConfig: { type: 'string' },
        appCategory: { type: 'string' },
      },
    },
    harmony: {
      type: 'object',
      properties: {
        bundleName: { type: 'string' },
        label: { type: 'string' },
        vendor: { type: 'string' },
        versionName: { type: 'string' },
        versionCode: { type: 'integer', minimum: 1 },
        compatibleSdkVersion: { type: 'string' },
        targetSdkVersion: { type: 'string' },
        deviceTypes: { type: 'array', items: { type: 'string' } },
        permissions: {
          type: 'array',
          items: {
            oneOf: [
              { type: 'string' },
              {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string' },
                  reason: { type: 'string' },
                  usedScene: {
                    type: 'object',
                    properties: { abilities: { type: 'array', items: { type: 'string' } }, when: { enum: ['inuse', 'always'] } },
                  },
                },
              },
            ],
          },
        },
        icon: { type: 'string' },
        appCategory: { type: 'string' },
        orientation: { type: 'string' },
      },
    },
  },
} as const

const routerSchema = {
  type: 'object',
  description: '★#492 项目级路由管理（统一路由配置面）：结构 + tabBar + pages 唯一声明处',
  properties: {
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
    tabBar: {
      type: 'object',
      required: ['list'],
      properties: {
        color: { type: 'string' },
        selectedColor: { type: 'string' },
        list: {
          type: 'array',
          items: {
            type: 'object',
            required: ['name', 'text'],
            properties: { name: { type: 'string' }, text: { type: 'string' }, icon: { type: 'string' } },
          },
        },
      },
    },
    pages: { type: 'object' },
    meta: { type: 'object', description: '★pages 的旧名别名（同义，建议用 pages）' },
  },
} as const

export const proteusConfigSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'ProteusConfig',
  type: 'object',
  required: ['targets', 'pagesDir'],
  properties: {
    version: { type: 'number', description: '配置 schema 版本（v4 起为 4；<4 加载期自动迁移）' },
    targets: targetsSchema,
    pagesDir: { type: 'string', description: '页面根目录（主包路由扫描起点）' },
    app: nativeApp,
    router: routerSchema,
    compiler: {
      type: 'object',
      properties: { backend: { enum: ['node', 'rust'] } },
    },
    layout: {
      type: 'object',
      properties: {
        designWidth: { type: 'number' },
        fluidViewport: {
          type: 'object',
          properties: { min: { type: 'number' }, max: { type: 'number' } },
        },
      },
    },
    budget: {
      type: 'object',
      properties: {
        mainPackageKB: { type: 'number' },
        strict: { type: 'boolean' },
      },
    },
    vite: { type: ['object', 'string'], description: '★#418/★#421 vite 透传（对象或函数——函数形态 schema 无法表达，此处放宽）' },
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
    gates: {
      type: 'object',
      properties: {
        disabled: { type: 'array', items: { type: 'string' } },
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
