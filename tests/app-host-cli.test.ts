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
      // ★★CPU Profiler 接线回归（决策 #715）：dev bundle 必须**真的**开 profile——esbuild 的
      //   `define: { __DEV__ }` 只替换**裸标识符**（`globalThis.__DEV__` 替换不到 ⇒ 运行时 undefined
      //   ⇒ profile 永不生效，本仓实测）。用真 dev 构建产物验"门是开的"，防该类静默复发。
      const bundle = await fetch(`${server.url}/bundle`).then((r) => r.text())
      expect(bundle, 'dev bundle 应开 CPU Profiler（__DEV__ 裸标识符被 define 替换）').toContain('profile: true')
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
    // ★网络详情（决策 #707）
    expect(server, '网表带 contentType/preview').toContain('netContentType')
    expect(server, '网表预览截断').toContain('preview: netPreview.slice')
    expect(server, '原始响应用量上限').toContain('RAW_CAP')
    expect(server, '原始体按需端点').toContain("url === '/netbody'")
    expect(server, '原始体另存（不进 SSE）').toContain('netBodies.set(')
    expect(page, '面板网络详情').toContain('function showNetDetail(')
    expect(page, '点行看详情').toMatch(/addNet[\s\S]*?showNetDetail\(e\)/)
    expect(page, '详情含原始响应').toContain('原始响应')
    expect(page, '面板按需取原始体').toContain('/netbody?id=')
    // ★性能时间线 Profiler（决策 #709）
    expect(server, '性能采样历史').toContain('perfHist.push')
    expect(server, '快照含性能时间线').toContain('perf: perfHist.slice')
    expect(page, '面板 Profiler 渲染').toContain('function renderProf(')
    expect(page, '掉帧预算 16.7').toContain('16.7')
    // ★逐帧真实采样（决策 #710）：CADisplayLink 采样器 + 桥转发 + 壳上报 fps
    const rtSampler = fs.readFileSync(path.join(ROOT, 'hosts/ios/ProteusHost/runtime/selfdraw-scene.swift'), 'utf-8')
    expect(rtSampler, '逐帧采样器').toContain('func startDevFrameSampler(')
    expect(rtSampler, '逐帧窗口读取').toContain('func drainDevFrameStats(')
    const shSampler = fs.readFileSync(path.join(shellDir, 'ProteusApp.swift'), 'utf-8')
    expect(shSampler, '启动采样器').toContain('startDevFrameSampler()')
    expect(shSampler, '上报 fps').toContain('o["fps"]')
    // ★元素 → 模板源位置（决策 #713）：节点 loc 徽章 + 跳转编辑器
    expect(page, '面板渲染元素源位置').toContain('srcloc')
    expect(page, '面板跳转编辑器').toContain('vscode://file')
    expect(page, 'META 注入 projectRoot').toContain('projectRoot: info.projectRoot')
  })

  // ★高亮生命周期 + 掉帧归因（决策 #714）——静态锁：两处真机腿 + 面板
  it('高亮自动收起（决策 #714）：手势 / 重建时清高亮 + 设备点选不回发高亮', () => {
    const page = fs.readFileSync(path.join(ROOT, 'packages/cli/src/app-devtools-page.ts'), 'utf-8')
    // iOS：桥 clearHighlight（手势 + mount 各一处）
    const rt = fs.readFileSync(path.join(ROOT, 'hosts/ios/ProteusHost/runtime/selfdraw-scene.swift'), 'utf-8')
    expect(rt, 'iOS 清除高亮入口').toContain('func clearHighlight()')
    expect(rt, 'iOS 手势时清高亮').toMatch(/func emitGesture\(x: Double, y: Double, type: String\) \{\s*\n\s*guard handle != 0 else \{ return \}\s*\n\s*\/\/[^\n]*决策 #714[\s\S]*?clearHighlight\(\)/)
    expect(rt, 'iOS mount 时清高亮').toMatch(/func mount\(_ treeJson: String\) -> String \{[\s\S]*?clearHighlight\(\)/)
    // Android：VaporRenderHost 手势监听 + mount 时 clear
    const vrh = fs.readFileSync(path.join(ROOT, 'hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/VaporRenderHost.java'), 'utf-8')
    expect(vrh, 'Android 手势时清高亮').toMatch(/onGesture\(String type[\s\S]*?highlightNode\(0\);[\s\S]*?gestureDispatched\+\+/)
    expect(vrh, 'Android mount 时清高亮').toMatch(/public String mount\(String treeJson\) \{\s*\n\s*mountCalls\+\+;[\s\S]*?highlightNode\(0\);/)
    // 面板：设备点选**不回发** highlight（只点树才亮）
    expect(page, 'selectNode 可禁回发高亮').toContain('function selectNode(id, sendHl)')
    expect(page, '设备点选不亮').toMatch(/selectNode\(e\.id, false\)/)
  })

  it('掉帧详情 · 事件链归因（决策 #714）：面板可点掉帧柱 + Android 真 dropped', () => {
    const page = fs.readFileSync(path.join(ROOT, 'packages/cli/src/app-devtools-page.ts'), 'utf-8')
    // ★决策 #717：原 showJankDetail 已并入统一的 showWindowDetail（掉帧柱仍开它、并多带本窗口 CPU 明细）
    expect(page, '窗口详情入口（含事件链）').toContain('function showWindowDetail(')
    expect(page, '掉帧柱可点').toMatch(/pbar\.jank[\s\S]*?addEventListener\('click'/)
    expect(page, '事件日志缓冲').toContain('function logEvent(')
    expect(page, '归因窗口').toContain('前 ')
    expect(page, '事件链（不断言因果）').toContain('同时段，不断言因果')
    // Android 逐帧采样器（Choreographer）+ recordPerf 发 fps/frameMaxMs/dropped/frames（键名与 iOS 对齐）
    const pv = fs.readFileSync(path.join(ROOT, 'hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/ProteusHostView.java'), 'utf-8')
    expect(pv, 'Android 逐帧采样器').toContain('public void startDevFrameSampler()')
    expect(pv, 'Android 窗口读取').toContain('public double[] drainDevFrameStats()')
    expect(pv, 'Android Choreographer').toContain('Choreographer.getInstance()')
    const act = fs.readFileSync(path.join(ROOT, 'packages/cli/templates-host/android/src/dev/proteus/layoutcore/AppActivity.java'), 'utf-8')
    expect(act, 'Android 启动采样器').toContain('startDevFrameSampler()')
    expect(act, 'Android 上报 dropped').toContain('o.put("dropped"')
    expect(act, 'Android 上报 fps').toContain('o.put("fps"')
    // ★★★决策 #723：逐帧统计必须**每 tick（UI 泵）drain**，不能只在 render 时 drain——
    //   否则一次切屏的 dropped 被烤进缓存 devPerfJson ⇒ 之后每个心跳重发同一值 ⇒ **面板恒红**（用户实测）。
    expect(act, '每 tick drain 逐帧（pumpFrames）').toContain('private void pumpFrames()')
    expect(act, 'UI 泵调 pumpFrames').toContain('pumpFrames();')
    // 调用（`.drainDevFrameStats()`）只应出现 **1 次**（在 pumpFrames 里）——recordPerf 不再 drain（否则又会冻结）
    expect((act.match(/\.drainDevFrameStats\(\)/g) ?? []).length, 'drain 调用仅 1 处').toBe(1)
  })

  // ★CPU Profiler（决策 #715）——静态锁：桥暴露 + 两处真机腿取采样 + 面板渲染
  it('CPU Profiler（决策 #715）：桥暴露 profileStats + iOS/Android 取采样 + 面板渲染排行', () => {
    const page = fs.readFileSync(path.join(ROOT, 'packages/cli/src/app-devtools-page.ts'), 'utf-8')
    expect(page, '面板 CPU 排行渲染').toContain('function renderCpu(')
    expect(page, '面板消费 perf.profile').toContain('applyProfile(p.profile)')
    expect(page, '面板 CPU 区块').toContain('CPU · 运行期阶段耗时')
    // 桥：全局排空入口 + dev 开关
    const bridge = fs.readFileSync(path.join(ROOT, 'hosts/shared/bridge/entry-superapp.ts'), 'utf-8')
    expect(bridge, '桥暴露 profile 排空入口').toContain('__proteusSuperappProfile')
    expect(bridge, '桥按 __DEV__ 开 profiling').toContain('profile: true')
    // ★★回归锁（决策 #715 实测 bug）：esbuild 的 `define: { __DEV__ }` **只替换裸标识符**——
    //   写成 `globalThis.__DEV__`（属性访问）**不会被替换** ⇒ 运行时 undefined ⇒ profile 永不生效
    //   （面板 CPU 恒空，用户实测）。⇒ 必须用裸 `__DEV__`，且**不得**残留 `globalThis.__DEV__`。
    expect(bridge, '桥用裸 __DEV__（define 只替换裸标识符）').toMatch(/\.\.\.\(__DEV__ \? \{ profile: true \}/)
    // 反面：不得再出现"属性访问式"的坏写法 `globalThis as … { __DEV__`（注释里可提，但代码不得用）
    expect(bridge, '桥不得用 globalThis 属性访问取 __DEV__').not.toMatch(/globalThis as unknown as \{ __DEV__/)
    // iOS 壳：perfJson 嵌套 profile
    const shell = fs.readFileSync(path.join(shellDir, 'ProteusApp.swift'), 'utf-8')
    expect(shell, 'iOS 取 profile 采样').toContain('__proteusSuperappProfile')
    expect(shell, 'iOS perf 带 profile').toContain('o["profile"] = prof')
    // Android 壳：UI 泵排空 + recordPerf 并入 profile（走 pump 才能捕获点击/切屏）
    const act = fs.readFileSync(path.join(ROOT, 'packages/cli/templates-host/android/src/dev/proteus/layoutcore/AppActivity.java'), 'utf-8')
    expect(act, 'Android 排空 profile 采样').toContain('__proteusSuperappProfile')
    expect(act, 'Android profile 走 UI 泵').toContain('private void pumpProfile(')
    expect(act, 'Android perf 带 profile').toContain('o.put("profile"')
  })

  // ★★CPU ⇄ 掉帧事件链联动（决策 #717）：CPU 行可点 → 窗口详情（本窗口 CPU 明细 + 事件链）
  it('CPU ⇄ 事件链联动（决策 #717）：CPU 行可点 + 统一窗口详情 + 聚焦行', () => {
    const page = fs.readFileSync(path.join(ROOT, 'packages/cli/src/app-devtools-page.ts'), 'utf-8')
    expect(page, '统一窗口详情入口').toContain('function showWindowDetail(')
    expect(page, '旧掉帧详情已并入（不再单列 showJankDetail）').not.toContain('function showJankDetail(')
    expect(page, '窗口详情含本窗口 CPU 明细段').toContain('运行期 CPU 阶段（本窗口 · JS）')
    expect(page, '窗口→样本反查（CPU 行点击定位）').toContain('function latestSampleWithStage(')
    expect(page, 'CPU 行可点').toMatch(/class="craw clink/)
    expect(page, 'CPU 行点击打开窗口详情').toMatch(/latestSampleWithStage\(r0\.dataset\.label\)[\s\S]*?showWindowDetail\(/)
    expect(page, '掉帧柱也开同一窗口详情').toMatch(/pbar\.jank[\s\S]*?showWindowDetail\(Number\(b\.dataset\.i\)\)/)
    expect(page, '聚焦行高亮样式').toContain('.craw.cfocus')
  })

  // ★★原生渲染阶段进窗口详情（决策 #718）：切屏掉帧的大头在原生 mount（JS profile 覆盖不到）
  it('原生渲染阶段进窗口详情（决策 #718）：iOS/Android 上报 perf.render + 面板原生段', () => {
    const page = fs.readFileSync(path.join(ROOT, 'packages/cli/src/app-devtools-page.ts'), 'utf-8')
    expect(page, '面板渲染原生段').toContain('原生渲染阶段（本窗口')
    expect(page, '原生段数据源 perf.render').toContain('var rarr = p.render ||')
    expect(page, '原生条用暖色区分').toContain('cbar-native')
    // iOS 壳：lastTiming → perf.render
    const shell = fs.readFileSync(path.join(shellDir, 'ProteusApp.swift'), 'utf-8')
    expect(shell, 'iOS 上报原生分段').toContain('o["render"] = arr')
    expect(shell, 'iOS 排空式取原生分段（防陈旧读数）').toContain('bridge.consumeRenderTiming()')
    const rt718 = fs.readFileSync(path.join(ROOT, 'hosts/ios/ProteusHost/runtime/selfdraw-scene.swift'), 'utf-8')
    expect(rt718, 'iOS 消费口清脏').toContain('func consumeRenderTiming()')
    // ★顺带：删死代码 lastTreeJson（只写不读，占渲染热路径）——断言**代码**已无声明/赋值（注释里可提）
    expect(shell, 'iOS 死代码 lastTreeJson 已删').not.toMatch(/var lastTreeJson|lastTreeJson\s*=/)
    // Android 壳：内核回执分段 → perf.render（排空式 takePerfJsonForPing）
    const act = fs.readFileSync(path.join(ROOT, 'packages/cli/templates-host/android/src/dev/proteus/layoutcore/AppActivity.java'), 'utf-8')
    expect(act, 'Android 上报原生分段').toContain('devRenderJson = rarr.toString()')
    expect(act, 'Android 取内核分段').toContain('draw.lastLayoutMs')
    expect(act, 'Android 排空式取原生分段（防陈旧读数）').toContain('private String takePerfJsonForPing()')
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

  // ★★★决策 #724：Android 启动占位 + 不阻塞主线程（对齐 iOS #694）——用户实测「启动黑屏一下，iOS 有加载提示」
  it('Android 启动占位 + 后台拉 bundle（决策 #724，对齐 iOS #694）', () => {
    const act = fs.readFileSync(path.join(ROOT, 'packages/cli/templates-host/android/src/dev/proteus/layoutcore/AppActivity.java'), 'utf-8')
    // ① 启动占位层（App 名 + 转圈 + 状态文案；首帧后撤）
    expect(act, '挂启动占位').toContain('new LaunchPlaceholder(')
    expect(act, '撤占位（首帧后）').toContain('placeholder.remove()')
    // ② 后台拉 bundle（不阻塞主线程）——主线程同步拉 + sleep 盲等是"黑屏"根因
    expect(act, '后台拉 bundle').toContain('private void bootAsync()')
    expect(act, 'bundle 就绪回调').toContain('private void onBundleReady(')
    expect(act, '后台线程拉取').toContain('proteus-dev-bundle')
    expect(act, '主线程回调').toContain('runOnUiThread(')
    // ③ 窗口/根容器底色 = 页面同族浅色（首帧前不闪黑）+ 主题用 **Light** 变体（启动窗口不闪黑）
    expect(act, '窗口底色浅色').toContain('LaunchPlaceholder.PAGE_BACKGROUND')
    const mf = fs.readFileSync(path.join(ROOT, 'packages/cli/templates-host/android/AndroidManifest.xml'), 'utf-8')
    expect(mf, '主题用 Light 变体（浅色 windowBackground）').toContain('Theme.Material.Light.NoActionBar')
    // 打包期主题规范化：老宿主自愈到 Light（含深色 Material → Light）
    const pkg = fs.readFileSync(path.join(ROOT, 'packages/cli/src/host-package.ts'), 'utf-8')
    expect(pkg, '老宿主主题自愈到 Light').toContain('Theme.Material.Light.NoActionBar')
    // ④ 占位组件存在 + 对齐 iOS 的品牌色/文案 + **内容居中**（对齐 iOS centerX/centerY）
    const ph = fs.readFileSync(path.join(ROOT, 'packages/cli/templates-host/android/src/dev/proteus/layoutcore/LaunchPlaceholder.java'), 'utf-8')
    expect(ph, '占位失败态（保留占位）').toContain('void fail(')
    expect(ph, '品牌色对齐 iOS').toContain('0xFF5B5BD6')
    expect(ph, 'dev 文案').toContain('正在连接开发服务器')
    expect(ph, '内容居中（对齐 iOS centerX/centerY）').toMatch(/setGravity\(Gravity\.CENTER\)/)
    // iOS 侧同样有占位（两端对齐）
    const ios = fs.readFileSync(path.join(shellDir, 'ProteusApp.swift'), 'utf-8')
    expect(ios, 'iOS 占位层（基准）').toContain('class ProteusLaunchPlaceholder')
  })

  // ★★Android dev 命令集补齐（决策 #719）：edit/reset + 修 highlight 键名 + DevOverlay 扩展
  it('Android dev 命令集补齐（决策 #719）：highlight 键名修 + edit/reset + DevOverlay 菜单', () => {
    const act = fs.readFileSync(path.join(ROOT, 'packages/cli/templates-host/android/src/dev/proteus/layoutcore/AppActivity.java'), 'utf-8')
    // ① 键名 bug 修：highlight 必须读 dev server 下发的 nodeId（不是 id）
    expect(act, 'highlight 读 nodeId（对齐 dev server）').toContain('o.optInt("nodeId"')
    expect(act, 'highlight 不再误读 id').not.toContain('o.optInt("id", 0)')
    // ② edit（就地编辑）：★#722 下沉到**桥** `applyLiveEdit`（改树 + 全量重挂，对齐 iOS #706）——
    //   增量 `updatePatches` 只认字段子集，`flexDirection` 等被内核**静默忽略**（用户实测"改了 flex 不动"）。
    expect(act, 'edit 分支').toContain('"edit".equals(type)')
    expect(act, 'edit 委托桥 applyLiveEdit').toContain('draw.applyLiveEdit(id, key, value)')
    expect(act, '不再走增量 updatePatches').not.toContain('draw.updatePatches(')
    const vrh = fs.readFileSync(path.join(ROOT, 'hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/VaporRenderHost.java'), 'utf-8')
    expect(vrh, '桥 applyLiveEdit（改树+全量重挂）').toContain('public String applyLiveEdit(')
    expect(vrh, '桥值强转/校验').toContain('private static Object coerceLiveEdit(')
    expect(vrh, '保留原始树供重建').toContain('lastTreeJson = treeJson')
    expect(vrh, '改树后 mount 全量重建').toMatch(/target\.put\(key, coerced\)[\s\S]*?mount\(tree\.toString\(\)\)/)
    expect(vrh, '布局枚举封闭集').toContain('"row-reverse", "column-reverse"')
    expect(act, '编辑标记 setEdited').toContain('devOverlay.setEdited(true)')
    // ③ reset（重置为项目代码）：remount 透传渲染期（全量重挂）
    expect(act, 'reset 分支').toContain('"reset".equals(type)')
    expect(act, 'reset 实现').toContain('private void resetToProject(')
    expect(act, 'remount 形参').toContain('private void renderCurrent(String stateJson, boolean remount)')
    expect(act, 'remount 透传运行期').toMatch(/if \(remount\) args\.put\("remount", true\)/)
    // ④ DevOverlay 扩展：可点角标 + 重置注入 + 编辑状态
    expect(act, '注入重置动作').toContain('devOverlay.setResetAction(')
    expect(act, '注入面板 URL').toContain('devOverlay.setPanelUrl(')
    const ov = fs.readFileSync(path.join(ROOT, 'packages/cli/templates-host/android/src/dev/proteus/layoutcore/DevOverlay.java'), 'utf-8')
    expect(ov, '角标可点展开').toContain('setOnClickListener')
    expect(ov, '底部调试面板').toContain('private void buildSheet(')
    expect(ov, '重置按钮').toContain('重置为项目代码')
    expect(ov, '编辑状态标记').toContain('void setEdited(')
    expect(ov, '重置回调注入').toContain('void setResetAction(')
    // ★#722 对齐 iOS：① 高亮**填充 + 描边**（此前只有描边 ⇒ 与 iOS 视觉不一致）；
    //   ② 就地编辑**即时反馈**（toast——此前编辑后无"已应用"信号，用户实测"没提示、感觉延迟很高"）
    const pv = fs.readFileSync(path.join(ROOT, 'hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/ProteusHostView.java'), 'utf-8')
    expect(pv, '高亮填充（对齐 iOS alpha 0.18）').toContain('devHighlight')
    expect(pv, '高亮有 FILL').toMatch(/Paint\.Style\.FILL/)
    expect(act, '就地编辑即时提示').toContain('已就地编辑 #')
  })

  // ★★★决策 #721：Android「已生成宿主的 dev 壳源自愈」——android 壳在 src/dev/（不在 shell/），
  //   `syncShellTemplates` 显式跳过 ⇒ 用户实测「点节点树无高亮/就地编辑无效/宿主 dev 面板没有」（#719 全无）。
  it('Android dev 壳源自愈（决策 #721）：packageAndroidHost 调 syncAndroidShell + AAR 新鲜度门禁', () => {
    const pkg = fs.readFileSync(path.join(ROOT, 'packages/cli/src/host-package.ts'), 'utf-8')
    expect(pkg, 'packageAndroidHost 调壳源自愈').toContain('syncAndroidShell(hostDir)')
    const scaf = fs.readFileSync(path.join(ROOT, 'packages/cli/src/host-scaffold.ts'), 'utf-8')
    expect(scaf, 'syncAndroidShell 导出').toContain('export function syncAndroidShell(')
    // 覆盖式（不是只补缺）+ manifest 回落（老宿主无 proteus.host.json）
    expect(scaf, '覆盖式同步').toMatch(/相对路径|覆盖|fs\.writeFileSync\(dest, content\)/)
    expect(scaf, 'appName 回落 AndroidManifest').toContain('AndroidManifest.xml')
    // android 模板有 proteus.host.json（syncShellTemplates 靠它解析 {{var}}；android 此前缺）
    expect(fs.existsSync(path.join(ROOT, 'packages/cli/templates-host/android/proteus.host.json')), 'android 模板应有 proteus.host.json').toBe(true)
    // 新鲜度门禁在 verify + CI（接线不靠记忆）
    const pj = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8')) as { scripts: Record<string, string> }
    expect(pj.scripts['check:android-runtime-aar-fresh'], '门禁脚本已注册').toBeTruthy()
    expect(pj.scripts.verify, '门禁接入 verify 链').toContain('check:android-runtime-aar-fresh')
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
  // ★★文件系统级隔离（AGENTS.md 红线 · 决策 #711 修）：dev-watch 测试**改源码触发版本递增**——
  //   此前直接写**真实**的 `superapp/pages/index.vue` 并靠 `afterAll` 还原；实测**被中断的跑测会让还原不执行**
  //   ⇒ 真实源被 `<!-- DEV-HOT-RELOAD-PROBE -->` 污染（残留 5 次）。⇒ **在临时副本上测**（真实源零接触，
  //   "能靠隔离消除的副作用，不要靠记得还原来管理"）。
  let PROJ = ''            // 项目根 = 临时副本
  let probeFile = ''       // 探针文件（临时副本内）

  beforeAll(async () => {
    PROJ = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-devwatch-'))
    for (const f of ['pages', 'router', 'styles', 'shims']) {
      const src = path.join(SUPERAPP, f)
      if (fs.existsSync(src)) fs.cpSync(src, path.join(PROJ, f), { recursive: true })
    }
    for (const f of ['proteus.config.ts', 'app.config.ts', 'app-shell.ts', 'global-state.ts', 'package.json']) {
      const src = path.join(SUPERAPP, f)
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(PROJ, f))
    }
    probeFile = path.join(PROJ, 'pages', 'index.vue')
    server = await startAppDevServer({ projectRoot: PROJ, platform: 'android', host: '127.0.0.1', port: 0 })
  }, 120_000)

  afterAll(async () => {
    if (server) await server.close()
    if (PROJ) fs.rmSync(PROJ, { recursive: true, force: true })   // 删临时副本（真实源从未被写）
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

  it('★网络详情（决策 #707/#708）：网表带 content-type + 预览；原始响应按需经 /netbody 取', async () => {
    const s = server!
    await fetch(`${s.url}/bundle`)   // 触发一次网表记录（/bundle 非噪声）
    // 读 SSE 快照里的 net 表，找 /bundle 行（★原始体不在此——防 SSE 快照膨胀）
    const reader = (await fetch(`${s.url}/events`)).body!.getReader()
    const first = new TextDecoder().decode((await reader.read()).value)
    await reader.cancel()
    const snap = JSON.parse(first.replace(/^data: /, '')) as { net?: Array<{ id?: number; path: string; contentType?: string; preview?: string; raw?: string }> }
    const bundleEv = (snap.net ?? []).find((e) => (e.path ?? '').startsWith('/bundle'))
    expect(bundleEv, 'net 表含 /bundle 行').toBeTruthy()
    expect(bundleEv!.contentType, '带响应 content-type').toMatch(/javascript/)
    expect(bundleEv!.preview, '带响应预览（bundle 头部）').toMatch(/use strict|packages\//)
    expect(bundleEv!.raw, '★原始体不进 SSE（防快照膨胀）').toBeUndefined()
    // ★原始响应按需取（决策 #708）：/netbody?id= ⇒ 该条完整体（> 预览）
    const nb = (await fetch(`${s.url}/netbody?id=${bundleEv!.id}`).then((r) => r.json())) as { body: string | null }
    expect(nb.body, '取到原始响应').toBeTruthy()
    expect(nb.body!.length, '原始响应比预览（300）长').toBeGreaterThan(300)
    // ★source map（决策 #711）：bundle 带内联 sourceMap（看**完整** /bundle，非 64KB 截断的 netbody）+ /mapstack 把帧映射回源
    const fullBundle = await fetch(`${s.url}/bundle`).then((r) => r.text())
    expect(fullBundle, 'bundle 含内联 sourceMappingURL').toContain('sourceMappingURL=data:application/json')
    // 找**确实被映射**的生成位置（首行 1:1 可能无映射），用它组栈
    const { inlineMapOf, parseMappings } = await import('../packages/cli/src/sourcemap')
    const map = inlineMapOf(fullBundle)!
    const rows = parseMappings(map)
    let genLine = 0, genCol = 0
    for (let i = 0; i < rows.length; i++) { const s = (rows[i] ?? []).find((x) => x.srcIdx >= 0); if (s) { genLine = i + 1; genCol = s.genCol + 1; break } }
    expect(genLine, '找到被映射的生成位置').toBeGreaterThan(0)
    const stack = `Error: boom\n    at index (bundle-superapp.js:${genLine}:${genCol})`
    const mapped = await fetch(`${s.url}/mapstack?stack=${encodeURIComponent(stack)}`).then((r) => r.text())
    expect(mapped, `/mapstack 映射掉 bundle 帧（${genLine}:${genCol}）`).not.toContain('bundle-superapp.js')
    expect(mapped, '映射到源文件（.ts/.vue）').toMatch(/\.(ts|vue):\d+:\d+/)
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
    // ★真实改动（临时副本内加一个模板注释；真实源零接触）
    const cur = fs.readFileSync(probeFile, 'utf-8')
    fs.writeFileSync(probeFile, cur.replace('<template>', '<template>\n  <!-- DEV-HOT-RELOAD-PROBE -->'))
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

describe('★★★鸿蒙运行期宿主（决策 #725 · 与 Android/iOS 同级）', () => {
  const CLI = path.join(ROOT, 'packages/cli')
  const shell = path.join(CLI, 'templates-host/harmony/entry/src/main/ets/shell')
  const harCpp = path.join(ROOT, 'hosts/harmony/host-app/proteus_render/src/main/cpp')

  it('CLI 模板壳走运行期（eval bundle-superapp + hostAppRender），非静态屏内容挂载', () => {
    const src = fs.readFileSync(path.join(shell, 'MainPage.ets'), 'utf-8')
    expect(src, '读内嵌运行期 bundle').toContain("getRawFileContentSync('bundle-superapp.js')")
    expect(src, '运行期渲染入口（中性名）').toContain('hostAppRender(')
    expect(src, '命中链上屏').toContain('appScreenHitAt(')
    expect(src, '一次性 VM 状态回灌').toMatch(/snapshot/i)
  })

  it('CLI 模板壳对齐 dev 宿主（原生手势 + vsync 帧源 + edge-to-edge 安全区 + 返回栈 — 决策 #726/#731）', () => {
    const src = fs.readFileSync(path.join(shell, 'MainPage.ets'), 'utf-8')
    // ① edge-to-edge：状态栏/底部安全区不再黑（setWindowLayoutFullScreen + 窗口浅底 + 系统栏）
    expect(src, 'edge-to-edge').toContain('setWindowLayoutFullScreen(true)')
    expect(src, '窗口浅底透出').toContain('setWindowBackgroundColor(')
    expect(src, '系统栏（status+navigation）').toContain('setWindowSystemBarEnable(')
    // ② 安全区内边距 → env 传 appScreenCommands
    expect(src, '采安全区').toContain('getWindowAvoidArea(')
    expect(src, 'env 传 appScreenCommands').toContain("'env': this.envVars")
    // ③ ★vsync 帧源（displaySync）驱动惯性——与 Android/iOS dev 宿主同族（CADisplayLink/Choreographer）
    expect(src, 'vsync 帧源 displaySync').toContain('displaySync.create()')
    expect(src, '帧回调接线').toContain(".on('frame'")
    expect(src, '惯性减速').toContain('DECEL_RATE')
    // ★反例守卫：不得退回 setInterval 定时器（不与 vsync 对齐 ⇒ 攒批跳变"卡一下再瞬间过去"）
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    expect(codeOnly, '不用 setInterval 驱动惯性').not.toContain('setInterval(')
    // ★触摸：拖拽/点按在 .onTouch 里判别（不用原生 PanGesture——与 TapGesture 竞争会误判；见文件头）
    expect(src, '触摸回调接线').toContain('.onTouch((e: TouchEvent)')
    expect(src, 'tap-vs-drag 判别').toContain('touchMoved')
    // ④ 返回栈（系统边缘滑返 → onBackPress；本机系统手势不路由 ⇒ 显式左缘判别，对齐 iOS dev 宿主）
    expect(src, '返回栈').toContain('private goBack(')
    expect(src, 'onBackPress 消费返回').toContain('return this.goBack()')
    expect(src, '显式左缘滑返判别').toContain('edgeTracking')
    expect(src, '左缘阈值').toContain('this.touchStartX <= 20')
    // ★★★非触摸重建要"请求一帧"（决策 #726：返回键/滑返后 = 无触摸 ⇒ 无帧 ⇒ 画面停在旧树，"点一下才更新"）
    expect(src, '重建后请求一帧').toContain('postFrameCallback(this.nudgeCb)')
    expect(src, '帧回调实例（非闭包）').toContain('class NudgeFrameCallback extends FrameCallback')
    // C++ 侧标脏（RenderNode 重建后驱动重渲染）
    const renderCpp = fs.readFileSync(path.join(ROOT, 'hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_render.cpp'), 'utf-8')
    expect(renderCpp, 'RenderNode 重建后标脏').toContain('OH_ArkUI_RenderNodeUtils_Invalidate')
    // ★反例守卫：不叠横向手势（会抢系统边缘滑返）
    expect(src, '不叠横向手势').not.toContain('PanDirection.Horizontal')
  })

  it('runtime HAR 下沉驱动簇（中性名 hostAppBoot/Drive/Render；无 superapp 专名进 runtime）', () => {
    // 中性头在场，且**不含** superapp 字样（否则 check:host-layering 的 runtime 禁词必红）
    const impl = fs.readFileSync(path.join(harCpp, 'host_app_runtime_impl.h'), 'utf-8')
    expect(impl, '中性导出').toContain('HostAppRender')
    expect(impl, '中性别名协议全局').toContain('__proteusHostAppRender')
    const codeOnly = impl.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    expect(codeOnly, 'runtime 中性头代码里不得含 superapp 专名').not.toMatch(/superapp/i)
    // 桥注册三导出 + Index.ets/d.ts 暴露
    const host = fs.readFileSync(path.join(harCpp, 'proteus_host.cpp'), 'utf-8')
    for (const n of ['hostAppBoot', 'hostAppDrive', 'hostAppRender']) {
      expect(host, `桥注册 ${n}`).toContain(`{"${n}", nullptr,`)
    }
    const idx = fs.readFileSync(path.join(ROOT, 'hosts/harmony/host-app/proteus_render/Index.ets'), 'utf-8')
    expect(idx, 'Index.ets 导出 hostAppRender').toContain('hostAppRender,')
  })

  it('参考宿主壳改依赖 runtime（不再 import dev 装置 libproteus_bench）', () => {
    const sp = fs.readFileSync(path.join(ROOT, 'hosts/harmony/host-app/entry/src/main/ets/shell/Superapp.ets'), 'utf-8')
    expect(sp, '从 runtime 取 hostAppRender').toContain('hostAppRender')
    expect(sp, '不再 import libproteus_bench').not.toContain("from 'libproteus_bench.so'")
    const lay = fs.readFileSync(path.join(ROOT, 'scripts/check-host-layering.mjs'), 'utf-8')
    expect(lay, '棘轮登记已清零移除').not.toContain("entry/src/main/ets/shell/Superapp.ets'")
  })

  it('bridge 暴露中性协议别名（runtime 侧调 __proteusHostApp*）', () => {
    const bridge = fs.readFileSync(path.join(ROOT, 'hosts/shared/bridge/entry-superapp.ts'), 'utf-8')
    expect(bridge, '别名定义').toContain('__proteusHostAppRender')
    expect(bridge, '别名 = 同一实现').toMatch(/__proteusHostAppRender\s*=\s*__HOSTAPP\.__proteusSuperappRender/)
  })

  it('CLI 打包拷运行期 bundle 进 rawfile + 鸿蒙装/起走 hdc', () => {
    const pkg = fs.readFileSync(path.join(CLI, 'src/host-package.ts'), 'utf-8')
    expect(pkg, '拷 bundle-superapp.js 进 rawfile').toContain("path.join(rf, 'bundle-superapp.js')")
    // 自持 runtime：prebuilt/harmony 目录（无框架 checkout 也能装机）
    const scaf = fs.readFileSync(path.join(CLI, 'src/host-scaffold.ts'), 'utf-8')
    expect(scaf, 'prebuilt 目录型单元解析').toMatch(/templates-host'?, ?'prebuilt'?, ?platform, unit\.dest/)
    expect(
      fs.existsSync(path.join(CLI, 'templates-host/prebuilt/harmony/proteus_render/src/main/cpp/CMakeLists.txt')),
      'prebuilt/harmony runtime 目录应在场',
    ).toBe(true)
    const idx = fs.readFileSync(path.join(CLI, 'src/index.ts'), 'utf-8')
    expect(idx, 'runAppDev 鸿蒙 hdc install').toMatch(/hdc.*install|findHdc/)
    expect(idx, '鸿蒙 aa start EntryAbility').toContain("'-a', 'EntryAbility'")
  })

  it('鸿蒙打包把 hap 落 dist/app/harmony/proteus-host.hap（outHap，防"提示成功但找不到 .hap"）', () => {
    const pkg = fs.readFileSync(path.join(CLI, 'src/host-package.ts'), 'utf-8')
    expect(pkg, 'PackageHostOptions.outHap').toContain('outHap?: string')
    expect(pkg, '拷贝产物到 outHap').toMatch(/opts\.outHap/)
    const idx = fs.readFileSync(path.join(CLI, 'src/index.ts'), 'utf-8')
    // 两个调用点（build --package / dev）都要传 outHap（与 android outApk / ios outApp 同形）
    const calls = idx.match(/packageHarmonyHost\([^)]*\)/g) ?? []
    expect(calls.length, '两处 packageHarmonyHost 调用').toBeGreaterThanOrEqual(2)
    expect(calls.every((c) => c.includes('outHap')), '每处都传 outHap').toBe(true)
  })

  it('鸿蒙壳源自愈（syncHarmonyShell，防"模板升级老宿主拿不到"——同 #721 Android）', () => {
    const pkg = fs.readFileSync(path.join(CLI, 'src/host-package.ts'), 'utf-8')
    expect(pkg, 'packageHarmonyHost 调壳源自愈').toContain('syncHarmonyShell(hostDir)')
    const scaf = fs.readFileSync(path.join(CLI, 'src/host-scaffold.ts'), 'utf-8')
    expect(scaf, 'syncHarmonyShell 导出').toContain('export function syncHarmonyShell(')
  })

  it('平台适配头随 HAR 自持（与 platform/ 源逐字节一致——防两份漂移）', () => {
    const vendored = path.join(harCpp, 'proteus_text_platform.h')
    const source = path.join(ROOT, 'platform/harmony/proteus-platform/src/main/cpp/proteus_text_platform.h')
    expect(fs.existsSync(vendored), 'HAR 自持平台适配头（CLI 宿主深度无关）').toBe(true)
    expect(fs.readFileSync(vendored, 'utf-8'), '逐字节等于 platform/ 源').toBe(fs.readFileSync(source, 'utf-8'))
  })
})

describe('★★★三端宿主变体模型（dev-host = 宿主：单一壳 + DEV 门控 + release 不丢功能）', () => {
  const TH = path.join(ROOT, 'packages/cli/templates-host')
  it('每端**单一壳**：dev 与 release 共用同一份主壳文件 + 编译期 DEV 常量（android/ios）', () => {
    // android/ios：变体常量 = 单一分叉点
    expect(fs.readFileSync(path.join(TH, 'android/src/dev/proteus/layoutcore/ProteusBuildConfig.java'), 'utf-8'), 'android DEV 常量').toMatch(/static\s+final\s+boolean\s+DEV\b/)
    expect(fs.readFileSync(path.join(TH, 'ios/shell/ProteusBuildConfig.swift'), 'utf-8'), 'ios DEV 常量').toMatch(/static\s+let\s+DEV\s*=\s*(?:true|false)/)
    // dev 调试层以 DEV 早退（release 零残留）
    expect(fs.readFileSync(path.join(TH, 'android/src/dev/proteus/layoutcore/DevOverlay.java'), 'utf-8'), 'DevOverlay 以 DEV 早退').toMatch(/if\s*\(\s*!?\s*ProteusBuildConfig\.DEV\s*\)\s*return/)
    // 主壳内含 dev 门控（同一份壳里切 dev 件）
    expect(fs.readFileSync(path.join(TH, 'ios/shell/ProteusApp.swift'), 'utf-8'), 'iOS 壳内 DEV 门控').toContain('ProteusBuildConfig.DEV')
    // android release manifest 无 INTERNET（dev 变体才有）
    expect(fs.readFileSync(path.join(TH, 'android/AndroidManifest.xml'), 'utf-8'), 'release 无 INTERNET').not.toMatch(/android\.permission\.INTERNET/)
    expect(fs.readFileSync(path.join(TH, 'android/AndroidManifest.dev.xml'), 'utf-8'), 'dev 有 INTERNET').toMatch(/android\.permission\.INTERNET/)
  })
  it('变体一致性门禁已注册 + 接入 verify', () => {
    const pj = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8')) as { scripts: Record<string, string> }
    expect(pj.scripts['check:host-variant-parity'], '门禁已注册').toBeTruthy()
    expect(pj.scripts.verify, '门禁接入 verify 链').toContain('check:host-variant-parity')
  })
})

describe('★★★鸿蒙 dev 通道 · 批 2a 地基（热刷/心跳/日志 — 决策 #728）', () => {
  const TH = path.join(ROOT, 'packages/cli/templates-host/harmony')
  const CLI = path.join(ROOT, 'packages/cli')
  it('鸿蒙变体常量（ProteusBuildConfig.ets DEV/DEV_URL）——与 android/ios 同模型', () => {
    const cfg = fs.readFileSync(path.join(TH, 'entry/src/main/ets/shell/ProteusBuildConfig.ets'), 'utf-8')
    expect(cfg, 'DEV 常量').toMatch(/export\s+const\s+DEV\s*:\s*boolean\s*=\s*(?:true|false)/)
    expect(cfg, 'DEV_URL 常量').toMatch(/export\s+const\s+DEV_URL\s*:\s*string\s*=\s*'/)
  })
  it('INTERNET 权限 + dev 地址注入（want.parameters.proteusDev → AppStorage）', () => {
    expect(fs.readFileSync(path.join(TH, 'entry/src/main/module.json5'), 'utf-8'), 'INTERNET 权限').toContain('ohos.permission.INTERNET')
    const ea = fs.readFileSync(path.join(TH, 'entry/src/main/ets/shell/EntryAbility.ets'), 'utf-8')
    expect(ea, '读 proteusDev 参数').toContain("['proteusDev']")
    expect(ea, '写入 AppStorage').toContain("setOrCreate('proteusDev'")
  })
  it('packageHarmonyHost dev 变体（覆写 DEV/DEV_URL + 还原）+ runAppDev 传 dev/proteusDev', () => {
    const pkg = fs.readFileSync(path.join(CLI, 'src/host-package.ts'), 'utf-8')
    expect(pkg, 'PackageHostOptions.dev').toContain('dev?: boolean')
    expect(pkg, '覆写 ProteusBuildConfig').toContain('ProteusBuildConfig.ets')
    expect(pkg, '覆写 DEV=true').toMatch(/export const DEV: boolean = true/)
    const idx = fs.readFileSync(path.join(CLI, 'src/index.ts'), 'utf-8')
    expect(idx, 'runAppDev 鸿蒙 dev 变体').toMatch(/packageHarmonyHost\([^)]*dev:\s*true/)
    expect(idx, 'aa start 注入 proteusDev').toContain("'--ps', 'proteusDev'")
  })
  it('壳：dev 件门控创建（DevWatch/DevOverlay 仅 DEV）+ 热刷/心跳/日志接线', () => {
    const mp = fs.readFileSync(path.join(TH, 'entry/src/main/ets/shell/MainPage.ets'), 'utf-8')
    expect(mp, '变体常量导入').toContain("from './ProteusBuildConfig'")
    expect(mp, 'dev 门控创建').toMatch(/if\s*\(\s*DEV\s*\|\|\s*devBase\.length\s*>\s*0\s*\)/)
    expect(mp, '起 dev-watch').toContain('this.startDevWatch(')
    const dw = fs.readFileSync(path.join(TH, 'entry/src/main/ets/dev/DevWatch.ets'), 'utf-8')
    for (const ep of ["'/version'", "'/bundle'", "'/ping?", "'/log?", "'/tree'", "'/trace?'"]) {
      expect(dw, `dev-watch 端点 ${ep}`).toContain(ep)
    }
    expect(dw, '网络能力').toContain("from '@kit.NetworkKit'")
  })
  it('syncHarmonyShell 同步整个 ets/（含 dev 层，老宿主自愈）', () => {
    const scaf = fs.readFileSync(path.join(CLI, 'src/host-scaffold.ts'), 'utf-8')
    expect(scaf, '同步 ets/（非仅 shell/）').toContain("'entry', 'src', 'main', 'ets')")
  })
  it('hvigor 失败两个流都取（stderr 有 ERROR）+ bundleName/签名不符的定向归因', () => {
    const pkg = fs.readFileSync(path.join(CLI, 'src/host-package.ts'), 'utf-8')
    // ★stderr 也要纳入（否则只显示 stdout 的 Finished 行、看不到 ERROR——用户实测）
    expect(pkg, '取 stderr').toMatch(/stderr/)
    expect(pkg, '两流合并展示').toMatch(/eo\.stdout[\s\S]{0,120}eo\.stderr/)
    expect(pkg, '00303074 定向归因').toContain('00303074')
    expect(pkg, '归因含修复指引').toMatch(/signingConfigs.*\[\]|Automatically generate signature/)
  })
  it('鸿蒙 dev 命令集（决策 #729）：applyCommand(highlight/edit/reset/eval) + native 原语 + /cmd 轮询', () => {
    const mp = fs.readFileSync(path.join(TH, 'entry/src/main/ets/shell/MainPage.ets'), 'utf-8')
    expect(mp, 'applyCommand').toContain('private applyCommand(')
    for (const t of ["type === 'highlight'", "type === 'edit'", "type === 'reset'", "type === 'eval'"]) {
      expect(mp, `命令分支 ${t}`).toContain(t)
    }
    expect(mp, '高亮框走 appScreenNodeRect').toContain('appScreenNodeRect(')
    expect(mp, 'eval 走 hostAppEval').toContain('hostAppEval(')
    expect(mp, '就地编辑每轮重施').toContain('applyEditsToNodes(')
    const dw = fs.readFileSync(path.join(TH, 'entry/src/main/ets/dev/DevWatch.ets'), 'utf-8')
    expect(dw, 'dev-watch 轮询 /cmd').toContain("'/cmd'")
    // native 原语导出
    const host = fs.readFileSync(path.join(ROOT, 'hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_host.cpp'), 'utf-8')
    expect(host, '导出 appScreenNodeRect').toContain('{"appScreenNodeRect"')
    expect(host, '导出 hostAppEval').toContain('{"hostAppEval"')
    const idx = fs.readFileSync(path.join(ROOT, 'hosts/harmony/host-app/proteus_render/Index.ets'), 'utf-8')
    expect(idx, 'Index.ets 导出两者').toMatch(/appScreenNodeRect[\s\S]*hostAppEval/)
  })
  it('鸿蒙 dev 深化（决策 #730）：逐帧 perf + 被点元素 /inspect + 项目 console（channel=project）', () => {
    const mp = fs.readFileSync(path.join(TH, 'entry/src/main/ets/shell/MainPage.ets'), 'utf-8')
    expect(mp, '独立常驻逐帧采样器').toContain('startDevFrameSampler(')
    expect(mp, '帧统计排空').toContain('drainFrameStats(')
    for (const k of ["'fps'", "'frameMs'", "'dropped'", "'frames'"]) {
      expect(mp, `perf 含 ${k}`).toContain(k)
    }
    expect(mp, 'tap → 被点元素').toContain('pendingInspectId')
    expect(mp, '项目 console 入队').toContain('devProjectLog(')
    const dw = fs.readFileSync(path.join(TH, 'entry/src/main/ets/dev/DevWatch.ets'), 'utf-8')
    expect(dw, 'dev-watch 上报 /inspect').toContain("/inspect?id=")
    expect(dw, '日志 channel 三字段解析').toContain("channel=")   // /log?channel=…
    // native：项目 console 回收（垫片 → dev.console）
    const h = fs.readFileSync(path.join(ROOT, 'hosts/harmony/host-app/proteus_render/src/main/cpp/host_app_runtime_impl.h'), 'utf-8')
    expect(h, 'console 垫片').toContain('devInstallConsoleShim')
    expect(h, '回收 dev.console').toContain('dev.console')
  })
  it('鸿蒙 dev 四收口（决策 #731）：dev 胶囊 + 启动占位 + 高亮对齐(fill+stroke) + 编辑类型强转', () => {
    const mp = fs.readFileSync(path.join(TH, 'entry/src/main/ets/shell/MainPage.ets'), 'utf-8')
    // ① dev 胶囊（右上 DEV 角标 + 可点菜单）
    expect(mp, 'dev 胶囊状态').toContain('devCapsule')
    expect(mp, '角标文本含 DEV').toMatch(/this\.edited \? 'DEV ✎' : 'DEV'/)
    expect(mp, '胶囊点击开 sheet').toContain('toggleSheet(')
    // ② 启动占位（浅底 + App 名 + 转圈 + 首帧后撤）
    expect(mp, '占位状态').toContain('loading: boolean = true')
    expect(mp, '转圈组件').toContain('LoadingProgress()')
    expect(mp, '占位撤除（首帧后）').toContain('loading = false')
    expect(mp, '占位居中').toContain('justifyContent(FlexAlign.Center)')
    // ③ 高亮对齐 Android/iOS：fill 0x2E2F6BFF + stroke 0xFF2F6BFF(2×density)
    expect(mp, 'fill 十六进制字面量').toContain('0x2E2F6BFF')
    expect(mp, 'stroke 十六进制字面量').toContain('0xFF2F6BFF')
    expect(mp, '描边宽 2×density').toContain('2 * d')
    // ④ 编辑类型强转（黑屏根因）——edit 分支必须调用 coerceLiveEdit
    expect(mp, 'coerceLiveEdit 方法').toContain('private coerceLiveEdit(')
    expect(mp, 'edit 走强转').toContain('this.coerceLiveEdit(key, value)')
    expect(mp, '颜色 hex 校验').toMatch(/\^#\[0-9a-fA-F\]/)
    expect(mp, 'padding→对象').toContain("'top': d, 'right': d, 'bottom': d, 'left': d")
  })
})
