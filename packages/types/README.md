# @proteus-vue/types

Proteus 框架级共享类型单一来源（types-plan B3）。零运行时依赖。

## 导出

```ts
import type { Platform, PlatformTarget, ProteusConfigSchema } from '@proteus-vue/types'
import { proteusConfigSchema } from '@proteus-vue/types'

// Platform：'web' | 'skyline' | 'app'（capabilities.CapabilityPlatform 对齐）
// PlatformTarget：'mp-weixin' | 'web'（ProteusConfig.platform）
// proteusConfigSchema：ProteusConfig JSON Schema（编辑器补全 / CI 校验）
```

## JSON Schema 生成

```bash
proteus generate types                       # 输出 .proteus/proteus.config.schema.json
proteus generate types --out path/out.json   # 自定义输出路径
proteus generate types --check               # 校验已生成文件与当前 schema 一致（CI 防漂移，exit 1）
```

VS Code 接入：`settings.json` 配 `"json.schemas": [{ "fileMatch": ["proteus.config.json"], "url": ".proteus/proteus.config.schema.json" }]`

## 铁律 #5

schema 字段变更必须同步：`packages/plugin-vite/src/config.ts`（ProteusConfig 类型）+ `packages/cli/src/config-validate.ts`（校验器）——CI `--check` 拦截生成文件漂移。
