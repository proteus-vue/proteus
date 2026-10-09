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
import { syncRuntimeUnits, syncShellTemplates } from '../packages/cli/src/host-scaffold'

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
    // ★保留当前屏（决策 #693）：重载前抓当前屏名，重建后 navigate 回去（与 Android hotReload 同语义）
    expect(src, '保留当前屏').toContain('navigate(to:')
  })
  // ★★★DevTools 上报三对齐（决策 #698）——iOS 此前缺这三点（面板四卡恒「—」/ 切屏树不更新 / Console 恒空）
  it('DevTools 上报对齐（决策 #698）：perf + 现取树 + 原生日志', () => {
    const src = fs.readFileSync(path.join(shellDir, 'ProteusApp.swift'), 'utf-8')
    // ① 性能读数上报（/ping?perf=）——面板"渲染耗时/逐帧/重排/PATCH"
    expect(src, '/ping 端点').toContain('/ping?screen=')
    expect(src, '/ping 带 perf').toContain('&perf=')
    expect(src, 'perf 读数构造').toContain('func perfJson()')
    expect(src, 'perf 含 renderMs').toContain('renderMs')
    expect(src, 'perf 含 relayout').toContain('"relayout"')
    expect(src, 'perf 含 patches').toContain('"patches"')
    // ② 每 tick 现取树（切屏/交互绕过 renderCurrent ⇒ 缓存会停在旧屏，与 Android #677 同坑）
    expect(src, '每 tick 现取树').toContain('d.liveTreeJson()')
    expect(src, '现取树实现').toContain('func liveTreeJson()')
    // ③ 原生日志（channel=native）——对齐 Android devLog；否则无 console.log 的项目 Console 恒空
    expect(src, '原生日志方法').toContain('func devLog(')
    expect(src, 'app ready 原生日志').toMatch(/devLog\("info",\s*"app ready/)
  })
  it('iOS 桥暴露 DevTools 性能计数（决策 #698，与 Android draw 同口径）', () => {
    const rt = fs.readFileSync(path.join(ROOT, 'hosts/ios/ProteusHost/runtime/selfdraw-scene.swift'), 'utf-8')
    expect(rt, 'mount 计数').toContain('var mountCalls')
    expect(rt, 'patch 累计').toContain('var patchAppliedTotal')
    expect(rt, '重排累计').toContain('var relayoutTotal')
    expect(rt, 'applyOps 累计 patch').toMatch(/patchAppliedTotal \+= applied/)
    expect(rt, '逐帧耗时读数').toContain('var frameCostMs')
  })
  // ★面板→设备命令通道 + 元素高亮 + REPL（决策 #701）
  it('面板→设备命令通道齐备（决策 #701）：/panelcmd 入队 + /cmd 轮询 + 宿主执行', () => {
    const server = fs.readFileSync(path.join(ROOT, 'packages/cli/src/app-dev-server.ts'), 'utf-8')
    expect(server, '命令端点 /panelcmd').toContain("url === '/panelcmd'")
    expect(server, '取命令端点 /cmd').toContain("url === '/cmd'")
    expect(server, 'one-shot 取走即清').toMatch(/pendingCmd = null/)
    const shell = fs.readFileSync(path.join(shellDir, 'ProteusApp.swift'), 'utf-8')
    expect(shell, '壳轮询 /cmd').toContain('"/cmd"')
    expect(shell, '命令执行器').toContain('func applyCommand(')
    expect(shell, 'highlight 分支').toMatch(/case "highlight"/)
    expect(shell, 'eval 分支').toMatch(/case "eval"/)
    expect(shell, 'REPL 求值').toContain('func evalExpr(')
    const rt = fs.readFileSync(path.join(ROOT, 'hosts/ios/ProteusHost/runtime/selfdraw-scene.swift'), 'utf-8')
    expect(rt, '桥高亮入口').toContain('func highlightNode(')
    const page = fs.readFileSync(path.join(ROOT, 'packages/cli/src/app-devtools-page.ts'), 'utf-8')
    expect(page, '面板下发 highlight').toContain('function sendHighlight(')
    expect(page, '面板 REPL 输入').toContain("$('repl')")
    // ★就地编辑 v1（决策 #702）
    expect(shell, 'edit 命令分支').toMatch(/case "edit"/)
    expect(rt, '就地编辑入口').toContain('func applyLiveEdit(')
    expect(page, '面板下发 edit').toContain('function sendEdit(')
    expect(server, 'edit 命令字段').toContain('cmd.key')
    // ★能力全面放开（决策 #706）：布局字段也走"改树+内核重排"通路
    expect(rt, '就地在桥（含 lastNodes）').toMatch(/func applyLiveEdit\(id: Int, key: String, value: String\) -> Bool \{\s*\n\s*guard key != "id"/)
    expect(rt, '值强转/校验').toContain('func coerceLiveEdit(')
    expect(rt, '布局枚举封闭集').toContain('["row", "column", "row-reverse", "column-reverse"]')
    expect(page, '面板可编辑集含布局字段').toMatch(/const EDITABLE = \[[\s\S]*?'width'/)
    expect(page, '面板可编辑集含 flex').toMatch(/EDITABLE = \[[\s\S]*?'flexGrow'/)
    // ★escapeHtml 必须转义引号（对象字段 padding/margin 的 JSON 带 " 会截断属性；决策 #706 修）
    expect(page, 'escapeHtml 转义引号').toMatch(/escapeHtml = .*replace\(\/\[<>&"'\]/)
  })

  // ★面板→设备命令（决策 #701/#702 安卓腿）：Android 宿主也接 /cmd + 元素高亮 + REPL
  it('Android 宿主接命令通道（决策 #701/#702）：/cmd 轮询 + highlight + eval', () => {
    const act = fs.readFileSync(path.join(ROOT, 'packages/cli/templates-host/android/src/dev/proteus/layoutcore/AppActivity.java'), 'utf-8')
    expect(act, '轮询 /cmd').toContain('"/cmd"')
    expect(act, '命令执行器').toContain('private void applyCommand(')
    expect(act, 'highlight 分支').toContain('"highlight".equals(type)')
    expect(act, 'eval 分支').toContain('"eval".equals(type)')
    const vrh = fs.readFileSync(path.join(ROOT, 'hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/VaporRenderHost.java'), 'utf-8')
    expect(vrh, 'Android 高亮入口').toContain('public void highlightNode(')
    const pv = fs.readFileSync(path.join(ROOT, 'hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/ProteusHostView.java'), 'utf-8')
    expect(pv, 'view 高亮矩形').toContain('setDevHighlight')
    // ★Android 宿主**模板**纳入编译门禁（此前无判据）
    const gate = fs.readFileSync(path.join(ROOT, 'hosts/android/check-host-compile.sh'), 'utf-8')
    expect(gate, '模板 src 纳入 javac').toContain('templates-host/android/src')
  })

  // ★决策 #704：失焦即生效 + 宿主 dev 菜单（状态提示 + 重置）
  it('就地编辑可用性（决策 #704）：失焦即提交 + dev 菜单重置 + 面板重置按钮', () => {
    const page = fs.readFileSync(path.join(ROOT, 'packages/cli/src/app-devtools-page.ts'), 'utf-8')
    expect(page, '失焦即提交').toContain('function commitEdit(')
    expect(page, '编辑中暂停树重渲染').toContain('boxEditing')
    expect(page, '面板重置按钮').toContain("sendCmd('reset'")
    const shell = fs.readFileSync(path.join(shellDir, 'ProteusApp.swift'), 'utf-8')
    expect(shell, 'reset 命令分支').toMatch(/case "reset"/)
    expect(shell, '重置实现').toContain('func restoreProject(')
    expect(shell, '编辑状态标记').toContain('markEdited()')
    const overlay = fs.readFileSync(path.join(shellDir, 'ProteusDevOverlay.swift'), 'utf-8')
    expect(overlay, '角标可点').toContain('toggleSheet')
    expect(overlay, '状态提示').toContain('setEdited')
    expect(overlay, '重置回调').toContain('onReset')
  })

  // ★决策 #705：边缘右滑返回（CLI dev 宿主此前缺失——只在框架宿主有）
  it('iOS CLI 宿主接边缘右滑返回（决策 #705）', () => {
    const src = fs.readFileSync(path.join(shellDir, 'ProteusApp.swift'), 'utf-8')
    expect(src, '边缘手势 target 类').toContain('class ProteusSwipeBackTarget')
    expect(src, '装边缘 pan').toContain('UIScreenEdgePanGestureRecognizer')
    expect(src, '左缘').toContain('edges = .left')
    expect(src, '触发返回').toMatch(/goBack\(\)/)
    expect(src, '右滑阈值 60pt').toMatch(/>\s*60/)
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

  it('★面板→设备命令通道（决策 #701）：/panelcmd 入队 ⇒ /cmd one-shot 取走 ⇒ 再取为空', async () => {
    const s = server!
    // 入队 highlight
    const q = await fetch(`${s.url}/panelcmd?type=highlight&id=42`).then((r) => r.json()) as { ok: boolean }
    expect(q.ok).toBe(true)
    // 取走（one-shot）
    const c1 = await fetch(`${s.url}/cmd`).then((r) => r.json()) as { type: string; nodeId: number }
    expect(c1.type).toBe('highlight')
    expect(c1.nodeId).toBe(42)
    // 再取 ⇒ 空（已清）
    const c2 = await fetch(`${s.url}/cmd`).then((r) => r.json()) as Record<string, unknown>
    expect(c2.type).toBeUndefined()
    // eval 命令入队覆盖式
    await fetch(`${s.url}/panelcmd?type=eval&expr=1%2B1`)
    const c3 = await fetch(`${s.url}/cmd`).then((r) => r.json()) as { type: string; expr: string }
    expect(c3.type).toBe('eval')
    expect(c3.expr).toBe('1+1')
    // edit 命令（决策 #702）
    await fetch(`${s.url}/panelcmd?type=edit&id=7&key=backgroundColor&value=%23ff0000`)
    const c4 = await fetch(`${s.url}/cmd`).then((r) => r.json()) as { type: string; nodeId: number; key: string; value: string }
    expect(c4.type).toBe('edit')
    expect(c4.nodeId).toBe(7)
    expect(c4.key).toBe('backgroundColor')
    expect(c4.value).toBe('#ff0000')
  }, 30_000)

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


describe('★#692 runtime/壳 自愈同步（框架改动同步进已存在宿主）', () => {
  it('syncRuntimeUnits：把框架 runtime 源同步进宿主（幂等；含 #685 momentum）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-sync-'))
    try {
      // 造一个"宿主"：只放 runtime/ + platform/ 空目录（模拟已 scaffold 的宿主）
      fs.mkdirSync(path.join(dir, 'runtime'), { recursive: true })
      fs.mkdirSync(path.join(dir, 'platform'), { recursive: true })
      const r = syncRuntimeUnits(dir, 'ios')
      // 框架仓存在 ⇒ ios 两单元都应同步（runtime + platform）
      expect(r.synced).toBe(2)
      // runtime 源文件已拷入（且含 #685 的 startMomentum —— 证明"框架改动进了宿主"）
      const scene = fs.readFileSync(path.join(dir, 'runtime/selfdraw-scene.swift'), 'utf-8')
      expect(scene).toContain('startMomentum')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
  it('syncShellTemplates：壳模板刷进宿主（覆盖式；补上 ProteusDevOverlay）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-shell-'))
    try {
      fs.mkdirSync(path.join(dir, 'shell'), { recursive: true })
      fs.writeFileSync(path.join(dir, 'proteus.host.json'), JSON.stringify({ appName: 'X', bundleId: 'com.x' }))
      const synced = syncShellTemplates(dir, 'ios')
      expect(synced).toContain('ProteusDevOverlay.swift')   // 新增的 dev 可视化层被补入
      expect(fs.existsSync(path.join(dir, 'shell/ProteusDevOverlay.swift'))).toBe(true)
      // 幂等：再跑一次不应有任何变化
      expect(syncShellTemplates(dir, 'ios')).toEqual([])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
