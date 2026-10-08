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
import { startAppDevServer, resolveWatchRoots } from '../packages/cli/src/app-dev-server'
import { renderDevtoolsPage } from '../packages/cli/src/app-devtools-page'
import { resolveAppRoutes } from '../packages/cli/src/app-routes'

const ROOT = path.resolve(__dirname, '..')
const SUPERAPP = path.join(ROOT, 'superapp')
const hasSuperapp = fs.existsSync(path.join(SUPERAPP, 'proteus.config.ts'))
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-apphost-'))

afterAll(() => { fs.rmSync(TMP, { recursive: true, force: true }) })

describe('★完整宿主 · auto-routes 路径解析（honor router.routesOutput）', () => {
  // ★用户实测（决策 #664 D1）：App 三处此前硬编码 `<root>/router/auto-routes.ts`，而 create-proteus
  //   模板缺省 `src/router/auto-routes.ts` ⇒ 新工程 `build --target android --package` 当场失败。
  const mk = (cfg: string) => {
    const d = fs.mkdtempSync(path.join(TMP, 'proj-'))
    fs.writeFileSync(path.join(d, 'proteus.config.ts'), cfg)
    return d
  }
  it('按配置的 routesOutput 解析（模板缺省 src/router/…）', async () => {
    const d = mk(`export default { router: { routesOutput: 'src/router/auto-routes.ts' } }`)
    expect((await resolveAppRoutes(d)).file).toBe(path.join(d, 'src/router/auto-routes.ts'))
  })
  it('自定义 routesOutput 生效（主仓形态 router/…）', async () => {
    const d = mk(`export default { router: { routesOutput: 'router/auto-routes.ts' } }`)
    expect((await resolveAppRoutes(d)).file).toBe(path.join(d, 'router/auto-routes.ts'))
  })
  it('无配置 / 未声明 routesOutput ⇒ 回退 router/auto-routes.ts（不抛）', async () => {
    const dNoCfg = fs.mkdtempSync(path.join(TMP, 'proj-'))
    expect((await resolveAppRoutes(dNoCfg)).file).toBe(path.join(dNoCfg, 'router/auto-routes.ts'))
    const dNoField = mk(`export default { pagesDir: 'src/pages' }`)
    expect((await resolveAppRoutes(dNoField)).file).toBe(path.join(dNoField, 'router/auto-routes.ts'))
  })
})

describe('★完整宿主 · 随包发布（决策 #666 彻底打通：纯 npm 安装免框架 checkout）', () => {
  it('vendored 桥源与真源逐字节一致（无漂移 —— 门禁 sync-host-bridge 的 vitest 侧）', () => {
    const src = fs.readFileSync(path.join(ROOT, 'hosts/shared/bridge/entry-superapp.ts'), 'utf-8')
    const vend = fs.readFileSync(path.join(ROOT, 'packages/cli/templates-host/shared/bridge/entry-superapp.ts'), 'utf-8')
    const mark = vend.indexOf('// ===== AUTO-SYNCED BODY BELOW')
    expect(mark, '随包副本须带 AUTO-SYNCED 头').toBeGreaterThanOrEqual(0)
    const body = vend.slice(vend.indexOf('\n', mark) + 1)
    expect(body, '真源 ⇄ CLI 随包副本必须逐字节一致').toBe(src)
  })
  it('随包桥源 + Android runtime AAR 在场（外部用户无框架也能 build --package）', () => {
    const bridge = path.join(ROOT, 'packages/cli/templates-host/shared/bridge/entry-superapp.ts')
    expect(fs.existsSync(bridge), 'vendored 桥源随包').toBe(true)
    expect(fs.readFileSync(bridge, 'utf-8')).toContain('__proteusSuperappBootJson')
    const aar = path.join(ROOT, 'packages/cli/templates-host/prebuilt/android/proteus-runtime.aar')
    expect(fs.existsSync(aar), '随包 runtime AAR 在场').toBe(true)
    expect(fs.readFileSync(aar).subarray(0, 2).toString('latin1'), 'AAR 是 ZIP 容器').toBe('PK')
  })
})

describe('★完整宿主 · dev 热刷监听根（决策 #667：按布局/配置，非硬编码根目录名）', () => {
  // ★用户实测：create-proteus 模板把页面放 `src/` 下，而旧 watchTargets 硬编码根级
  //   pages/router/App.vue ⇒ 候选全不存在 ⇒ **监听列表为空** ⇒ 热刷静默失效。
  const root = path.join(TMP, 'watch-proj')
  it('模板形态（src/ 布局）⇒ 监听到 src/', async () => {
    const d = path.join(root, 'tpl')
    fs.mkdirSync(path.join(d, 'src', 'pages'), { recursive: true })
    fs.writeFileSync(path.join(d, 'src', 'pages', 'index.vue'), '<template><view/></template>')
    fs.writeFileSync(path.join(d, 'proteus.config.ts'), `export default { pagesDir: 'src/pages', router: { routesOutput: 'src/router/auto-routes.ts' } }`)
    const roots = await resolveWatchRoots(d)
    expect(roots.map((r) => path.relative(d, r))).toContain('src')
    expect(roots.length, '模板⇒至少监听 src').toBeGreaterThan(0)
  })
  it('根形态（pages/ 布局）⇒ 监听到 pages/ + router/（且不含整棵根）', async () => {
    const d = path.join(root, 'flat')
    fs.mkdirSync(path.join(d, 'pages'), { recursive: true })
    fs.mkdirSync(path.join(d, 'router'), { recursive: true })
    fs.writeFileSync(path.join(d, 'pages', 'index.vue'), 'x')
    fs.writeFileSync(path.join(d, 'router', 'auto-routes.ts'), 'export const routes=[]')
    fs.writeFileSync(path.join(d, 'proteus.config.ts'), `export default { pagesDir: 'pages', router: { routesOutput: 'router/auto-routes.ts' } }`)
    const roots = await resolveWatchRoots(d).then((rs) => rs.map((r) => path.relative(d, r)))
    expect(roots).toContain('pages')
    expect(roots).toContain('router')
    expect(roots, '不该监听整个项目根（否则含 dist/node_modules）').not.toContain('')
  })
  it('空工程 ⇒ 返回空（调用方给告警，不静默）', async () => {
    const d = path.join(root, 'empty')
    fs.mkdirSync(d, { recursive: true })
    expect(await resolveWatchRoots(d)).toEqual([])
  })
})

describe('★完整宿主 · App DevTools 面板（决策 #672：dev server 可视化）', () => {
  it('渲染自包含 DevTools 单页（含关键 UI 锚点 + 注入项目信息）', () => {
    const html = renderDevtoolsPage({ platform: 'android', projectName: 'my-app', projectRoot: '/x/my-app', url: 'http://192.168.1.2:1234' })
    expect(html).toContain('Proteus DevTools')
    expect(html).toContain('my-app')
    expect(html).toContain('设备在线')            // 宿主心跳状态
    expect(html).toContain('重建时间线')
    expect(html).toContain('Network')             // Network 面板（#673）
    expect(html).toContain('Console')             // Console 面板（#673）
    expect(html).toContain("EventSource('/events')")  // 走 SSE 实时
    expect(html).toContain('/ping')               // 心跳端点文案
    expect(html).toContain('/log')                // 日志上报端点文案
    expect(html).toContain('192.168.1.2:1234')    // 注入的 dev URL
  })
  it.skipIf(!hasSuperapp)('dev server：/ 出面板 · /events SSE 快照 · /ping 反映宿主态 · 404 兜底', async () => {
    // 用真实工程（superapp：含 auto-routes/screens）⇒ 首建产出初始重建事件（另有 skipIf 守卫，见文件头）。
    const server = await startAppDevServer({ projectRoot: SUPERAPP, platform: 'android', host: '127.0.0.1', port: 0 })
    try {
      const home = await fetch(`${server.url}/`).then((r) => r.text())
      expect(home, '/ ⇒ DevTools 页面').toContain('Proteus DevTools')
      // SSE：先拿到 snapshot 首帧（含初始重建事件）
      const sse = await fetch(`${server.url}/events`).then((r) => r.body!.getReader().read())
      const first = new TextDecoder().decode(sse.value)
      expect(first, 'SSE 首帧 = snapshot').toContain('"type":"snapshot"')
      expect(first, 'snapshot 含重建时间线').toContain('"reason":"initial"')
      // 宿主心跳：/ping?screen=x ⇒ 下次 snapshot 的 host.screen = x
      await fetch(`${server.url}/ping?screen=detail`)
      const sse2 = await fetch(`${server.url}/events`).then((r) => r.body!.getReader().read())
      expect(new TextDecoder().decode(sse2.value), '/ping 后 snapshot 反映宿主态').toContain('"screen":"detail"')
      // 控制台日志上报（#673）：/log ⇒ snapshot.console 含该条
      await fetch(`${server.url}/log?level=error&text=boom%20%E4%B8%AD%E6%96%87`)
      const sse3 = await fetch(`${server.url}/events`).then((r) => r.body!.getReader().read())
      expect(new TextDecoder().decode(sse3.value), '/log 后 snapshot 含控制台日志（含中文）').toContain('boom 中文')
      // Network（#673）：snapshot.net 记非噪声请求（/ping 已发）——证明 dev server 请求被捕获。
      const sse4 = await fetch(`${server.url}/events`).then((r) => r.body!.getReader().read())
      expect(new TextDecoder().decode(sse4.value), 'snapshot.net 记 dev server 请求').toContain('"path":"/ping?screen=detail"')
      expect(await fetch(`${server.url}/nope`).then((r) => r.text())).toContain('devtools')
    } finally {
      await server.close()
    }
  }, 120_000)
})

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

describe('★完整宿主 · iOS 宿主模板为运行期形态（决策 #683）', () => {
  const shellDir = path.join(ROOT, 'packages/cli/templates-host/ios/shell')
  it('壳走运行期（bundle-superapp + proteusHost + boot/render），非静态屏内容挂载', () => {
    const src = fs.readFileSync(path.join(shellDir, 'ProteusApp.swift'), 'utf-8')
    expect(src, '运行期启动入口').toContain('__proteusSuperappBootJson')
    expect(src, '运行期渲染入口').toContain('__proteusSuperappRender')
    expect(src, '注入运行期桥').toContain('SuperappRuntimeHost')
    expect(src, '读内嵌 bundle').toContain("forResource: \"bundle-superapp\"")
    // ★反例守卫：不得退回"静态屏内容挂载"形态（ProteusHostController.mountPage + fromScreenContent）
    expect(src, '不再用静态 mountPage(fromScreenContent:)').not.toContain('fromScreenContent:')
  })
  it('变体常量齐备（DEV / DEV_URL，供 CLI 覆写）', () => {
    const cfg = fs.readFileSync(path.join(shellDir, 'ProteusBuildConfig.swift'), 'utf-8')
    expect(cfg).toMatch(/static let DEV = (?:true|false)/)
    expect(cfg).toMatch(/static let DEV_URL = "[^"]*"/)
  })
  it('dev 通道齐备（HTTP 拉 bundle + /version 轮询 + 重载）', () => {
    const src = fs.readFileSync(path.join(shellDir, 'ProteusApp.swift'), 'utf-8')
    expect(src, '从 dev server 拉 bundle').toContain('/bundle')
    expect(src, '轮询版本').toContain('/version')
    expect(src, '重载标记').toContain('PROTEUS_DEV_RELOADED')
    expect(src, '保留当前屏').toContain('keepPage')
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
