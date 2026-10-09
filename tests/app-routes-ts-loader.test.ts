// tests/app-routes-ts-loader.test.ts —— ★★★CLI 路由加载必须走 TS 加载器（2026-10-09 真缺陷）
//
// 【这张测试锁什么】`proteus build/dev --target ios|android` 的路由加载此前**直接**
//   `await import(pathToFileURL('router/auto-routes.ts'))`——而 **Node 的 ESM 加载器不认 `.ts`**
//   （Node 18/20/22.14 报 `Unknown file extension ".ts"`；仅 Node 23+/`--experimental-strip-types` 才行）
//   ⇒ `proteus dev --target ios` 首建 bundle 报「重建失败：Unknown file extension ".ts" for router/auto-routes.ts」
//   （`app-content.ts` 那处不在 try 内 ⇒ 直接冒泡；`app-bundle.ts` 那处被 catch 吞 ⇒ 屏注册表静默为空）。
//   ★用 `tsx src` 手测却正常 = 典型**假绿**（同 dist-freshness 记的形态）。
//
// 【判据】① `loadTsModule` 能加载 auto-routes 的**真实形态**（`import type` + `export const`）；
//   ② 三个消费文件**不含**裸 `import(pathToFileURL(...))`、**含** `loadTsModule(`（静态回归锁——
//   防有人改回裸 `.ts` import 又"tsx 手测绿"）。

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { loadTsModule } from '../packages/cli/src/config-loader'

const ROOT = path.resolve(__dirname, '..')

describe('★CLI 路由加载走 TS 加载器（loadTsModule）', () => {
  it('① loadTsModule 加载 auto-routes 形态（type import + export const）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'routes-ts-'))
    try {
      const f = path.join(dir, 'auto-routes.ts')
      fs.writeFileSync(
        f,
        `import type { RouteRecord } from '@proteus-vue/router/types'
export const routes: RouteRecord[] = [
  { name: 'index', path: 'pages/index', component: '../pages/index.vue' },
  { name: 'about', path: 'pages/about', component: '../pages/about.vue', meta: { title: 'About' } },
]
export const screens = { index: { name: 'index', path: '/index' } }
export const tabNames: string[] = []
`,
      )
      const mod = loadTsModule(f) as { routes?: Array<{ name: string }>; screens?: Record<string, unknown> }
      expect(mod.routes, 'routes 可读（Node ESM 会抛 Unknown file extension ".ts"）').toBeTruthy()
      expect(mod.routes!.map((r) => r.name)).toEqual(['index', 'about'])
      expect(Object.keys(mod.screens ?? {})).toEqual(['index'])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('② 三个路由消费文件必须用 loadTsModule、不得裸 import(.ts)——静态回归锁', () => {
    for (const rel of ['packages/cli/src/app-content.ts', 'packages/cli/src/app-runtime-content.ts', 'packages/cli/src/app-bundle.ts']) {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf-8')
      expect(src, `${rel} 应调用 loadTsModule（Node ESM 不认 .ts）`).toContain('loadTsModule(')
      expect(src, `${rel} 不应再出现裸 import(pathToFileURL(...))（.ts 会抛 Unknown file extension）`).not.toMatch(/import\(pathToFileURL/)
    }
  })
})
