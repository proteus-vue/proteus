# 测试 + 迁移 + 分批策略

## 一、测试（对齐 Testing plan）

### 测试层级
| 层 | 内容 | 工具 |
|----|------|------|
| L1 单元 | Vite 插件各 hook、manualChunks 逻辑 | vitest |
| L2 集成 | 完整 build 跑通 → 校验产物结构 | vitest + tmp dir |
| L3 快照 | `dist/mp/**` 进 git，diff 即回归 | Testing plan B3 |
| L4 E2E | `pnpm build && pnpm preview` 真机验证 | Playwright + miniprogram-ci |

### 产物契约测试（核心，对齐 Testing plan B5）
```ts
// tests/contract.build.test.ts
import { readJson } from './helpers'

describe('build contract', () => {
  beforeAll(async () => {
    await runBuild({ platforms: ['web', 'mp', 'app'] })
  })

  it('produces three platform outputs', () => {
    expect(existsSync('dist/web/index.html')).toBe(true)
    expect(existsSync('dist/mp/app.json')).toBe(true)
    expect(existsSync('dist/app/main.js')).toBe(true)
  })

  it('subPackages match Router + Module config', () => {
    const appJson = readJson('dist/mp/app.json')
    const expected = expectedSubPackages(routerConfig, moduleConfig)
    expect(appJson.subPackages).toEqual(expected)
  })

  it('shared chunks are deduped', () => {
    const chunks = readdirSync('dist/mp/common')
    const vueChunks = chunks.filter((c) => c.includes('vue'))
    expect(vueChunks.length).toBe(1)  // 不重复打包
  })

  it('source maps are valid', () => {
    const map = readJson('dist/web/assets/index.js.map')
    expect(map.version).toBe(3)
    expect(map.sources).toContain(expect.stringContaining('App.vue'))
  })
})
```

### Build Artifact 测试
- 产物体积断言（不超过 budget）
- 分包映射一致性
- 入口文件存在性
- 压缩后仍可运行（smoke test）

## 二、迁移（从现有 Vite 工程）

### 迁移步骤
1. 安装：`pnpm add -D @proteus-vue/vite-plugin`
2. 替换 vite.config.ts：
   ```ts
   // before
   import { defineConfig } from 'vite'
   export default defineConfig({ /* ... */ })

   // after
   import { proteus } from '@proteus-vue/vite-plugin'
   export default proteus({
     platform: 'web',  // 或 'mp' / 'app'
   })
   ```
3. 迁移配置到 `proteus.config.ts`（字段来自 Types plan schema）
4. 分包：把 `manualChunks` 逻辑迁到 Module plan 的 `proteus-module.config.ts`
5. 跑 `pnpm build` → 对比产物快照（git diff `dist/`）
6. 逐端验证，遇到问题走 `proteus audit`（CLI M3）

### 兼容性
- 保留 Vite 原生配置透传（`defineConfig({ ...viteOptions })`）
- 渐进迁移：先 web 端，再 mp/app
- 不破坏现有 Rollup 插件生态（proteus 插件可与其他插件共存）

## 三、分批策略（B1-B10）

| 批 | 内容 | 依赖 | 文件 |
|----|------|------|------|
| B1 | Vite 插件骨架 + config 加载 | Compiler M3, Types M2 | 01 |
| B2 | 多入口 + 依赖图复用 | Compiler M6 | 01 |
| B3 | 代码分割 + 分包 + 校验 | Router M7.1, Module B5 | 01 |
| B4 | 压缩 + treeshake | Compiler M1 (IR sideEffects) | 02 |
| B5 | source map + assets + 缓存键 | Compiler M6 | 02 |
| B6 | CI 矩阵 | CLI | 03 |
| B7 | 发布（changeset/canary） | CLI | 03 |
| B8 | 缓存 + 并行 | B1-B5 | 02 |
| B9 | 超级应用加固 | B1-B5 | 04 |
| B10 | 可观测性 + 测试迁移 | DevTools, Testing | 04 + 本文件 |

### 执行原则
- 每批 = 1 PR = LLM 单次 ≤ 3 文件
- B1-B5 可并行（只依赖下层稳定接口）
- B6-B10 依赖 B1-B5 产物
- 每批验收见各模块文档末尾

### 依赖图（关键约束）
```
Compiler → Types → CLI → Testing → DevTools → Build
              ↑______________|
```
Build 依赖**所有层**（要打包它们、跑契约测试、走 audit 规则），故最后落地。

## 四、Prompt 模板（喂 LLM）

```
你正在实现 Proteus Build Pipeline 的 [B?]。
上下文：00-overview + 本批对应文件（[01/02/03/04]）。
依赖已稳定：[Compiler M3/M6, Types M2, CLI, Testing, DevTools]。
要求：
1. 只改本批文件，不碰其他层
2. 每个函数带 JSDoc + 对齐 --trace-transform
3. 写配套单测（对齐 Testing plan L1）
4. 产出后跑契约测试（05 的 build contract）
```

## 验收（全局）

- 16 份文档全部落地后：`pnpm build` 一键产出三端
- CI 全绿 ≤ 15 分钟
- 分包/体积/快照/契约 四道门禁
- 任意层改动 → 契约测试即时报错
- 可 1 键回滚任意版本
