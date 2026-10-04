// tests/module-npm-b1.test.ts
// ★★★B1（2026-10-04，用户点名）：「小程序没有模块化就直接判定我们也不支持模块化太一刀切了，
//   不支持导入外部 ts 这个会劝退大部分开发者的」——本文件锁 B1 的四个新能力面。
//
// 【B1 覆盖什么】
//   ① **npm 裸包**（业务代码 `import ms from 'ms'`）→ 构建期 esbuild 打包为 `_proteus/npm/<id>.js`（leaf，
//      BFS 不深入 node_modules），页面 require 该单例产物；
//   ② **路径别名**（`@/utils/x`）→ 复用 vite resolve.alias（与 Web 端同源）；
//   ③ **框架包子路径**（`@proteus-vue/router/scan`）→ exports 条件直解（此前只认 dist/index.js）；
//   ④ **node:path polyfill**（纯字符串函数——小程序无此模块但语义可实现）；其余 Node 内置**显式报错**。
//
// 【诚实边界（同 plugin 的 classifyUnresolvedImport 文案）】
//   · 依赖 Node 内置（fs/crypto…）且无 browser 分支的 npm 包 → 构建期显式报错（不做假实现）；
//   · 打进来的包进代码包体积——大包仍需按需 import 子路径。
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import {
  resolveSharedModule,
  classifyUnresolvedImport,
  isNodeBuiltinSource,
  normalizeModuleAliases,
  applyModuleAlias,
  npmModuleRelNoExt,
  splitNpmSource,
  findMissingExternalTargets,
} from '@proteus-vue/plugin-vite'

const ROOT = path.resolve(__dirname, '..')
const appDir = path.join(ROOT, 'examples')
const fromPage = path.join(appDir, 'pages', 'forms.vue')

describe('★★★B1 ①：npm 裸包构建期打包（leaf）', () => {
  it('真实 npm 包（ms）→ 解析到入口 + _proteus/npm/<id> + leaf 标记', () => {
    const r = resolveSharedModule(appDir, fromPage, 'ms', undefined, appDir, 'mp')
    expect(r, 'ms 应可解析（examples 已安装）').not.toBeNull()
    expect(r!.relNoExt).toBe('_proteus/npm/ms')
    expect(r!.leaf, 'leaf=true（BFS 不深入 node_modules）').toBe(true)
    expect(r!.file).toMatch(/ms@[\d.]+\/node_modules\/ms\/index\.js$/)
  })

  it('scoped 包名与子路径 → 产物 id 规范化（@scope/pkg/sub → scope-pkg-sub）', () => {
    expect(splitNpmSource('@scope/pkg/sub')).toEqual({ pkgName: '@scope/pkg', subpath: './sub' })
    expect(splitNpmSource('ms')).toEqual({ pkgName: 'ms', subpath: '.' })
    expect(npmModuleRelNoExt('@scope/pkg/sub')).toBe('_proteus/npm/scope-pkg-sub')
  })

  it('browser 条件优先（nanoid 无 browser 分支的 CJS 入口 require("crypto") —— 有则走 browser）', () => {
    // nanoid 3.x 的 exports.browser → index.browser.js（ESM，无 node 内置依赖）。
    // 若解析退回 require 条件会命中 index.cjs → require('crypto') → 构建失败（本仓实测）。
    const r = resolveSharedModule(appDir, fromPage, 'nanoid', undefined, appDir, 'mp')
    if (r) {
      expect(r.file, '应命中 browser 分支（index.browser.js）而非 index.cjs').toMatch(/index\.browser\.js$/)
    }
    // nanoid 未安装时不判红（examples 只装 ms）——能力由上面的 ms 用例守住
  })

  it('Node 内置 → 解析为空（原因由 classifyUnresolvedImport 给准确文案）', () => {
    expect(resolveSharedModule(appDir, fromPage, 'node:path', undefined, appDir, 'mp')).toBeNull()
    expect(isNodeBuiltinSource('node:path')).toBe(true)
    expect(isNodeBuiltinSource('fs/promises')).toBe(true)
    expect(isNodeBuiltinSource('./local')).toBe(false)
    expect(classifyUnresolvedImport('node:fs')).toContain('Node 内置模块')
  })
})

describe('★★★B1 ②：路径别名（与 Web 端同源）', () => {
  const aliases = [{ find: '@', replacement: appDir }]

  it('别名归一化（含非法项过滤）与匹配语义（精确/前缀/RegExp）', () => {
    expect(normalizeModuleAliases([{ find: '@', replacement: '/x' }, { find: 42, replacement: '/y' }, 'nope'])).toEqual([
      { find: '@', replacement: '/x' },
    ])
    expect(applyModuleAlias('@/utils/format', aliases, appDir)).toBe(path.join(appDir, 'utils/format'))
    expect(applyModuleAlias('@', aliases, appDir)).toBe(appDir)
    expect(applyModuleAlias('@x/y', aliases, appDir), '前缀必须跟 /（@x 不该命中 @ 别名）').toBeNull()
    expect(applyModuleAlias('~/z', [{ find: /^~\//, replacement: appDir + '/' }], appDir)).toBe(path.join(appDir, 'z'))
  })

  it('解析器走别名（@/utils/format → examples/utils/format.ts 的共享模块产物）', () => {
    const r = resolveSharedModule(appDir, fromPage, '@/utils/format', undefined, appDir, 'mp', aliases)
    expect(r).not.toBeNull()
    expect(r!.relNoExt).toBe('utils/format')
  })

  it('未命中别名 → 走相对/裸包路径（不误吞）', () => {
    expect(resolveSharedModule(appDir, fromPage, '~/utils/format', undefined, appDir, 'mp', aliases)).toBeNull()
  })

  it('别名命中但目标不存在 → 准确原因（检查别名配置）', () => {
    const reason = classifyUnresolvedImport('@/missing/file', { aliases, absFrom: fromPage, projectRoot: appDir })
    expect(reason).toContain('别名命中但目标不存在')
  })
})

describe('★★★B1 ③：框架包子路径（exports 条件直解）', () => {
  it('@proteus-vue/router/scan → 解析到 dist/scan.js（子路径 id 化 _proteus/router-scan）', () => {
    const r = resolveSharedModule(appDir, fromPage, '@proteus-vue/router/scan', undefined, appDir, 'mp')
    expect(r, '子路径应可解析（exports["./scan"]）').not.toBeNull()
    expect(r!.file.endsWith(path.join('router', 'dist', 'scan.js'))).toBe(true)
    expect(r!.relNoExt).toBe('_proteus/router-scan')
  })

  it('@proteus-vue/router（主入口）行为不回归（_proteus/router）', () => {
    const r = resolveSharedModule(appDir, fromPage, '@proteus-vue/router', undefined, appDir, 'mp')
    expect(r!.relNoExt).toBe('_proteus/router')
  })
})

describe('★★★B1 ④：node:path polyfill（其余内置显式报错）', () => {
  it('polyfill 代码导出存在且覆盖常用面（join/resolve/relative/dirname/basename/extname/isAbsolute）', async () => {
    const mod = (await import('../packages/plugin-vite/src/path-polyfill')) as { MP_PATH_POLYFILL_CODE: string }
    const code = mod.MP_PATH_POLYFILL_CODE
    for (const fn of ['resolve', 'normalize', 'isAbsolute', 'join', 'relative', 'dirname', 'basename', 'extname']) {
      expect(code, `polyfill 缺 ${fn}`).toContain(fn + ':')
    }
    expect(code).toContain('module.exports = path')
  })

  it('polyfill 与 Node 原生 path 输出对拍（posix 语义——19 组）', async () => {
    const mod = (await import('../packages/plugin-vite/src/path-polyfill')) as { MP_PATH_POLYFILL_CODE: string }
    // 在隔离环境执行 polyfill 源码（CJS），取 module.exports
    const sandboxModule = { exports: {} as Record<string, unknown> }
    const fn = new Function('module', 'exports', mod.MP_PATH_POLYFILL_CODE)
    fn(sandboxModule, sandboxModule.exports)
    const mp = sandboxModule.exports as unknown as typeof path

    const cases: Array<[string, () => string, () => string]> = [
      ['join(a,b,c)', () => mp.join('a', 'b', 'c'), () => path.posix.join('a', 'b', 'c')],
      ['join(/,a,../b)', () => mp.join('/', 'a', '..', 'b'), () => path.posix.join('/', 'a', '..', 'b')],
      ['resolve(a,b)', () => mp.resolve('/a', 'b'), () => path.posix.resolve('/a', 'b')],
      ['resolve(a,../b)', () => mp.resolve('/a/x', '../b'), () => path.posix.resolve('/a/x', '../b')],
      ['relative(/a/b,/a/c/d)', () => mp.relative('/a/b', '/a/c/d'), () => path.posix.relative('/a/b', '/a/c/d')],
      ['relative(/a,/a)', () => mp.relative('/a', '/a'), () => path.posix.relative('/a', '/a')],
      ['dirname(/a/b/c)', () => mp.dirname('/a/b/c'), () => path.posix.dirname('/a/b/c')],
      ['dirname(a)', () => mp.dirname('a'), () => path.posix.dirname('a')],
      ['dirname(/)', () => mp.dirname('/'), () => path.posix.dirname('/')],
      ['basename(/a/b.ts)', () => mp.basename('/a/b.ts'), () => path.posix.basename('/a/b.ts')],
      ['basename(/a/b.ts,.ts)', () => mp.basename('/a/b.ts', '.ts'), () => path.posix.basename('/a/b.ts', '.ts')],
      ['extname(/a/b.tar.gz)', () => mp.extname('/a/b.tar.gz'), () => path.posix.extname('/a/b.tar.gz')],
      ['extname(/a/.hidden)', () => mp.extname('/a/.hidden'), () => path.posix.extname('/a/.hidden')],
      ['normalize(a//b/./c)', () => mp.normalize('a//b/./c'), () => path.posix.normalize('a//b/./c')],
      ['normalize(a/b/../c)', () => mp.normalize('a/b/../c'), () => path.posix.normalize('a/b/../c')],
      ['isAbsolute(/a)', () => String(mp.isAbsolute('/a')), () => String(path.posix.isAbsolute('/a'))],
      ['isAbsolute(a)', () => String(mp.isAbsolute('a')), () => String(path.posix.isAbsolute('a'))],
      ['sep', () => mp.sep, () => path.posix.sep],
      ['join(空)', () => mp.join(), () => path.posix.join()],
    ]
    for (const [name, got, want] of cases) {
      expect(got(), `对拍失败：${name}`).toBe(want())
    }
  })
})

describe('★★★B1 修复（2026-10-04）：external 闭包缺口扫描（CJS require 悬空）', () => {
  // 【真缺陷】B1 把 @vue/* 加入 vendor 单例后：vue 的 CJS 入口 `require('@vue/shared')`
  //   被外部化成 `require("./@vue/shared.js")`，而收集侧 BFS 只扫 ESM ⇒ 目标从未产出
  //   ⇒ 模拟器 `module '_proteus/@vue/shared.js' is not defined` ⇒ 所有页面挂。
  //   修法 = 扫产物相对 require 找缺口（本函数），消费方再反推源名补进 sharedModules。
  it('★真实缺陷形态：vue.js 产物里的 ./@vue/shared.js 缺口被抓出（未排期 ⇒ 报告）', () => {
    const code = `var x = require("./@vue/shared.js"); var y = require("./@vue/runtime-core.js");`
    const gaps = findMissingExternalTargets(code, '_proteus/vue', new Set(['_proteus/vue']))
    expect(gaps, '两个 @vue 子模块都在缺口里').toEqual(['_proteus/@vue/shared', '_proteus/@vue/runtime-core'])
  })

  it('已排期的目标不报（防重复产出）', () => {
    const code = `require("./@vue/shared.js"); require("./npm/ms.js");`
    const scheduled = new Set(['_proteus/@vue/shared', '_proteus/npm/ms'])
    expect(findMissingExternalTargets(code, '_proteus/vue', scheduled)).toEqual([])
  })

  it('页面目录的相对 require（../_proteus/...）同样归一命中', () => {
    const code = `require("../_proteus/global-layer.js")`
    const gaps = findMissingExternalTargets(code, 'pages/index', new Set())
    expect(gaps, '页面产物形态（../ 前缀）').toEqual(['_proteus/global-layer'])
  })

  it('业务相对模块（非 _proteus/ 前缀）不归本函数管（页面侧 own）', () => {
    // 页面目录出发的相对 require（业务模块）——归一后不以 _proteus/ 开头 ⇒ 过滤
    const code = `require("./helper.js"); require("../utils/format.js")`
    expect(findMissingExternalTargets(code, 'pages/index', new Set())).toEqual([])
    // 共享模块里的相对引入**不会出现**在产物 require 里（esbuild bundle 内联）——
    // 能出现在产物的相对 require 只有 externalResolvePlugin 的 `_proteus/**` 映射
  })

  it('去重保序：同一目标多次 require 只报一次', () => {
    const code = `require("./@vue/shared.js"); require("./@vue/shared.js"); require("./@vue/shared.js")`
    expect(findMissingExternalTargets(code, '_proteus/vue', new Set())).toEqual(['_proteus/@vue/shared'])
  })

  it('★真实产物核对：vue.js 实测缺口全部为 _proteus/@vue/*（构建期同判据）', async () => {
    const fs = await import('node:fs')
    // 用任一工程的 MP 构建产物（若存在）——验证"扫描函数对真实产物成立"
    const candidates = ['superapp', 'examples', 'showcase'].map((p) =>
      path.join(ROOT, p, 'dist', 'mp-weixin', '_proteus', 'vue.js'),
    )
    const real = candidates.find((f) => fs.existsSync(f))
    expect(real, '需要至少一个工程的 MP 构建产物（先 build:mp）').toBeTruthy()
    const code = fs.readFileSync(real!, 'utf-8')
    const gaps = findMissingExternalTargets(code, '_proteus/vue', new Set())
    expect(gaps.length, '★真实产物应含 @vue/* 外部引用（B1 单例化产物形态）').toBeGreaterThan(0)
    // 且缺口全部是 @vue/ 前缀（本产物形态）——不得混入业务模块
    for (const g of gaps) expect(g, '★缺口须为 _proteus/@vue/* 形态').toMatch(/^_proteus\/@vue\//)
  })
})
