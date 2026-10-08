// tests/app-host-cli.test.ts —— ★★★完整宿主 · CLI 打包闭环 + dev server 判据（2026-10-08 · 决策 #662）
//
// 【本项修的是什么】用户「dist/app 里三端只有三个简单文件，没有完整宿主项目；包名用项目自己的；
//   CLI 一条命令出包；dev 模式实时刷新」。本测试钉住其中的**纯逻辑判据**（不需设备、不需工具链）：
//   ① targets SSOT：`dist/app/<端>/host` 与安装包命名
//   ② `buildAppBundle` 产**项目侧** bundle（内容含项目运行期入口；`app-screen-content.generated` 被重定向到
//      项目 dist、**不污染框架目录**）
//   ③ dev server：`/health` / `/version` / `/bundle` 三端点 + 源码变更 ⇒ version 递增（**有界条件等待，非盲等**）
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { appHostDir, appBundleFile, APP_PACKAGE_NAME, isAppPlatform } from '../packages/cli/src/targets'
import { buildAppBundle } from '../packages/cli/src/app-bundle'
import { startAppDevServer } from '../packages/cli/src/app-dev-server'

const ROOT = path.resolve(__dirname, '..')
const SUPERAPP = path.join(ROOT, 'superapp')
const hasSuperapp = fs.existsSync(path.join(SUPERAPP, 'proteus.config.ts'))
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-apphost-'))

afterAll(() => { fs.rmSync(TMP, { recursive: true, force: true }) })

describe('★完整宿主 · targets SSOT', () => {
  it('宿主目录/安装包命名在 dist/app/<端>/ 下', () => {
    expect(appHostDir('/p', 'android')).toBe('/p/dist/app/android/host')
    expect(appHostDir('/p', 'ios')).toBe('/p/dist/app/ios/host')
    expect(appHostDir('/p', 'harmony')).toBe('/p/dist/app/harmony/host')
    expect(appBundleFile('/p', 'android')).toBe('/p/dist/app/android/bundle-superapp.js')
    expect(APP_PACKAGE_NAME).toEqual({ android: 'proteus-host.apk', ios: 'proteus-host.app', harmony: 'proteus-host.hap' })
  })
  it('isAppPlatform 认三端、不认 web/skyline（dev --target 分流用）', () => {
    expect(['android', 'ios', 'harmony'].every(isAppPlatform)).toBe(true)
    expect(['web', 'skyline', 'all'].some(isAppPlatform)).toBe(false)
  })
})

describe.skipIf(!hasSuperapp)('★完整宿主 · app-bundle（项目侧 bundle）', () => {
  it('产出项目侧 bundle，含运行期入口，且不污染框架生成物', async () => {
    const fwGen = path.join(ROOT, 'hosts/shared/bridge/app-screen-content.generated.ts')
    const before = fs.existsSync(fwGen) ? fs.statSync(fwGen).mtimeMs : null
    const out = path.join(TMP, 'bundle-superapp.js')
    const r = await buildAppBundle({ projectRoot: SUPERAPP, platform: 'android', outFile: out })
    expect(r.bytes).toBeGreaterThan(50_000)
    expect(r.compiled).toBeGreaterThan(0)
    const src = fs.readFileSync(out, 'utf-8')
    expect(src, '运行期启动入口在').toContain('__proteusSuperappBootJson')
    expect(src, '运行期渲染入口在').toContain('__proteusSuperappRender')
    // ★不污染框架生成物（重定向到项目 dist ⇒ 框架 shared/bridge 的 generated.ts 未被改）
    const after = fs.existsSync(fwGen) ? fs.statSync(fwGen).mtimeMs : null
    expect(after, '框架 app-screen-content.generated.ts 未被改动').toBe(before)
    // ★项目侧临时生成物构建后即清理（不残留）
    expect(fs.existsSync(path.join(SUPERAPP, 'dist/app/android/app-screen-content.generated.ts')), '临时生成物已清理').toBe(false)
  }, 120_000)
})

describe.skipIf(!hasSuperapp)('★完整宿主 · dev server（热刷核心）', () => {
  let server: Awaited<ReturnType<typeof startAppDevServer>> | null = null
  const probeFile = path.join(SUPERAPP, 'pages', 'index.vue')
  let orig = ''

  beforeAll(async () => {
    orig = fs.readFileSync(probeFile, 'utf-8')
    server = await startAppDevServer({ projectRoot: SUPERAPP, platform: 'android', host: '127.0.0.1', port: 0 })
  }, 120_000)

  afterAll(async () => {
    if (server) await server.close()
    fs.writeFileSync(probeFile, orig)   // 还原探针文件
  })

  it('/health 与 /version 与 /bundle 三端点可用', async () => {
    const s = server!
    const health = (await fetch(`${s.url}/health`).then((r) => r.json())) as { ok: boolean; version: number }
    expect(health.ok).toBe(true)
    expect(typeof health.version).toBe('number')
    expect(await fetch(`${s.url}/version`).then((r) => r.text())).toBe(String(s.version()))
    const bundle = await fetch(`${s.url}/bundle`).then((r) => r.text())
    expect(bundle.length).toBeGreaterThan(50_000)
    expect(bundle).toContain('__proteusSuperappBootJson')
  }, 60_000)

  it('改源码 ⇒ version 递增（真 watch；有界条件等待，非盲等）', async () => {
    const s = server!
    const v0 = s.version()
    // ★真实改动（加一个模板注释，内容确定、可还原）
    fs.writeFileSync(probeFile, orig.replace('<template>', '<template>\n  <!-- DEV-HOT-RELOAD-PROBE -->'))
    // 有界条件等待（最长 20s；命中即退出——不是固定 sleep）
    const deadline = Date.now() + 20_000
    while (Date.now() < deadline && s.version() === v0) {
      await new Promise((r) => setTimeout(r, 200))
    }
    expect(s.version(), '改了源码后 version 应递增（watch 生效）').toBeGreaterThan(v0)
  }, 30_000)
})
