#!/usr/bin/env node
// website/scripts/gen-primitives.mjs —— 原语分区生成器（★#460）
//   SSOT = packages/desktop/src/*.ts（模块头注释 = 定位/语义，导出清单 = API 面）——与 gen-reference 同法（源码文本解析，零依赖）
//   产出：content/primitives/desktop-<模块>.md（每模块一页：定位 + 核心导出表 + 用法降级说明）
//   用法：node scripts/gen-primitives.mjs [--check]（--check 漂移检测：不一致 exit 1）
//   overview 页为手写（content/primitives/00-overview.md）——生成器不覆盖
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WEBSITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(WEBSITE, 'content', 'primitives')
const check = process.argv.includes('--check')

/** ★#460/#462 生成源（多包）：{ id, rel, group, prefix, orderBase }——desktop 模块 + gesture 接线 */
const SOURCES = [
  { id: 'desktop', rel: 'packages/desktop', group: '桌面原语', prefix: 'desktop-', orderBase: 10 },
  { id: 'gesture', rel: 'packages/gesture', group: '手势原语', prefix: 'gesture-', orderBase: 60 },
  { id: 'api', rel: 'packages/api', group: '工程原语', prefix: 'eng-', orderBase: 80, files: /(^|-|\/)?engineering\.ts$/, pkg: '@proteus-vue/api' },
]

const TITLE_OVERRIDES = {
  recognizers: 'Gesture 识别器（tap/pan/swipe/pinch/rotate）',
  'use-gesture': 'useGesture Hook + v-gesture 指令（Web 接线）',
  engineering: '基础工程原语（E1-E9：useState/useComputed/useWatch/useLifecycle…）',
  'router-engineering': '路由工程原语（E10-E18：useRoute/push/back/守卫…）',
  'animation-engineering': '动画工程原语（E19-E23：useAnimation/useScrollAnimation…）',
  'tooling-engineering': '工具工程原语（E24-E28：useDevTools/defineComponent…）',
  'request-engineering': '请求工程（R1-R4：request/useQuery/enqueue/runOnce）',
  'ownership-engineering': '所有权工程原语（PSS：useOwned/useBorrow…）',
  scroll: '滚动观测原语（页面滚动进度 / 滚动态）',
  'window-message': '跨窗消息原语（iframe postMessage 收口）',
  anchor: '锚点定位原语（scrollToId）',
  'page-url': '页面 URL 读写原语（location / history 收口）',
  directives: '桌面指令工厂（createDesktopDirectives：v-p-* 注册）',
}

/** ★#466 一句话定位（页头说明——知道这个原语做什么；fallback = 模块头首行） */
const SUMMARY_MAP = {
  shortcut: '键盘快捷键语义：mod+s → ⌘S / Ctrl+S（PRIM005 平台惯例），绑定动作触发',
  'focus-trap': '弹层焦点圈闭：Tab 循环 / Shift+Tab 反向 / 关闭后恢复焦点',
  'context-menu': '右键 / 长按菜单：防溢出翻转定位 + 一步构建',
  hover: '悬停态语义（brighten/lift/underline）——触屏自动降级 tap 高亮',
  directives: '把 B1-B4 原语注册成 v-p-* Vue 指令（Web 接线薄层；MP 不注册天然降级）',
  'cursor-glow': '指针跟随环境光晕（品牌紫/青双光斑，lerp 插值拖尾）',
  notify: '系统通知：探测 / 权限 / 发送归一（Notification API；无实现诚实 Err）',
  permission: '权限门禁：六语义目录 + check/request 归一 + v-p-permission 拦截重放',
  clipboard: '剪贴板读写：Clipboard API → execCommand 降级 → 诚实 Err',
  deeplink: '深链解析与参数化匹配（scheme://host/path?query + :param）',
  'master-detail': '大屏三栏 / 窄屏独占布局状态机（UISplitViewController 语义）',
  tabs: '桌面标签关闭迁移：激活右邻优先 · 末位回退左邻',
  command: '⌘K 命令面板数据层：过滤排序 + 上下移动索引',
  breadcrumb: '路由栈推导面包屑链（kebab → 可读 label）',
  lifecycle: '前后台生命周期观测（visibilitychange/focus——app 相位）',
  'state-restoration': 'UI 状态恢复令牌：capture / restore / 过滤可恢复（永续场景）',
  network: '网络状态：online + 连接类型归一 + 变化订阅',
  'low-power': '低电量 / 省电模式探测（Battery API）',
  scroll: '页面滚动观测：rAF 节流 + y/max/progress（App 顶部进度条与 Home 联动在用）',
  'window-message': '跨窗消息订阅：origin 白名单 + type 过滤 + destroy（spirit iframe 气泡在用）',
  anchor: '按 id 锚点平滑滚动（SPA 新页 v-html 文档跳转，可延时）',
  'page-url': '页面地址读写：origin / pathname + replaceState 收口（分享链接同步在用）',
  recognizers: '手势识别器：Web Pointer / MP touch 归一 GestureInput → tap/pan/swipe/pinch/rotate 等语义事件',
  'use-gesture': '手势 Web 官方接线：useGesture Hook + v-gesture:<kind>="onX" 指令',
  engineering: '工程原语 E1-E9：注入式 useState/useComputed/useWatch/useLifecycle…（api 包零 vue 依赖）',
  'router-engineering': '路由工程原语 E10-E18：useRoute/push/back/守卫 + p-router-link',
  'animation-engineering': '动画工程原语 E19-E23：useAnimation/useGestureAnimation/useScrollAnimation + p-animate',
  'tooling-engineering': '工具工程原语 E24-E28：useDevTools/useInspector/defineComponent/defineCapability',
  'request-engineering': '请求工程 R1-R4：request 策略 / useQuery / enqueue / runOnce',
  'ownership-engineering': '所有权工程原语（PSS）：useOwned / useBorrow / 自动 drop',
}

/** ★#466 端兼容表（家族级口径——与组件/能力页同构；状态四档对齐 ENDS 注册表） */
const ENDS_FAMILY = {
  desktop: [
    ['Web SPA', '✅', '官方接线：Pure logic + env 回落全局；v-p-* 指令（createDesktopDirectives 注册）'],
    ['微信小程序', '🟡', '纯逻辑可单测；指令不注册（桌面交互无对等——编译剥离），页面接线由宿主决定'],
    ['Headless（SSR / 测试）', '✅', '纯逻辑 Node 可跑（工具/测试档）'],
    ['iOS 原生', '🟡', '映射规划——官方接线未开始（原生识别/系统 API 对应 G-24 规划）'],
    ['Android 原生', '🟡', '映射规划——官方接线未开始'],
    ['鸿蒙', '🟡', '映射规划——官方接线未开始'],
    ['Flutter 混合', '🟡', 'widget/系统映射未开始'],
    ['快应用', '⬜', '端未开始'],
  ],
  gesture: [
    ['Web SPA', '✅', '官方接线：v-gesture 指令 / useGesture Hook（Pointer Events）'],
    ['微信小程序', '🟡', '识别器映射由各端 Backend 承接（规划中）——纯识别器可在逻辑层单测'],
    ['Headless（SSR / 测试）', '✅', '识别器纯逻辑 Node 可跑（工具/测试档）'],
    ['iOS 原生', '🟡', 'UIGestureRecognizer 映射规划'],
    ['Android 原生', '🟡', 'GestureDetector 映射规划'],
    ['鸿蒙', '🟡', '手势系统映射规划'],
    ['Flutter 混合', '🟡', '手势映射未开始'],
    ['快应用', '⬜', '端未开始'],
  ],
  api: [
    ['Web SPA', '✅', '官方 demo 接线（examples/platform-api-demo 全工厂调用）'],
    ['微信小程序', '🟡', '注入式可在逻辑层跑（MP 产物安全子集）；组件形态接线部分先行'],
    ['Headless（SSR / 测试）', '✅', 'Node 注入 reactivity 等即可跑（工具/测试档）'],
    ['iOS 原生', '🟡', '原生端验证未开始（E 系注入面随宿主批次）'],
    ['Android 原生', '🟡', '原生端验证未开始'],
    ['鸿蒙', '🟡', '原生端验证未开始'],
    ['Flutter 混合', '🟡', '同一 JS 逻辑层——接线未开始'],
    ['快应用', '⬜', '端未开始'],
  ],
}

const COMMENT_LINE = /^\s*(\/\/|\*|\/\*|\s*\*\/)/
const EXPORT_RE = /^export\s+(?:async\s+)?(?:default\s+)?(function|const|interface|type|class)\s+([A-Za-z_$][\w$]*)/

/** 模块头注释（import 前的连续注释块——定位/语义/映射/降级都在这里） */
function readHeader(src) {
  const lines = []
  for (const raw of src.split('\n')) {
    const t = raw.trim()
    if (/^import\s/.test(t)) break
    if (!COMMENT_LINE.test(t) && t !== '') break
    let text = t.replace(/^(\/\/|\/\*|\*|\*\/)\s*/, '').trim()
    if (!text || text.startsWith('packages/')) continue // 文件路径行
    if (/^[=—\-·\s]+$/.test(text)) continue
    lines.push(text)
  }
  return lines
}

/** 导出清单：name + 类型 + 紧邻上一行注释（一句话） */
function readExports(src) {
  const lines = src.split('\n')
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const t = (lines[i] || '').trim()
    const m = t.match(EXPORT_RE)
    if (!m) continue
    let doc = ''
    for (let j = i - 1; j >= 0; j--) {
      const prev = (lines[j] || '').trim()
      if (!prev) break
      if (!COMMENT_LINE.test(prev)) break
      const text = prev.replace(/^(\/\/|\/\*|\*|\*\/)\s*/, '').trim()
      if (text && !text.startsWith('packages/')) {
        doc = text.replace(/\s*\*\/\s*$/, '').trim().replace(/^\*+\s?/, '')
        break
      }
    }
    out.push({ name: m[2], kind: m[1], doc: doc.slice(0, 90) })
  }
  return out
}

function humanName(file, header) {
  const base = file.replace(/\.ts$/, '')
  if (TITLE_OVERRIDES[base]) return TITLE_OVERRIDES[base]
  const alias = header.map((l) => l.match(/(p-[a-z][a-z0-9-]*)/)?.[1]).find(Boolean)
  if (alias) return alias
  return base
    .split('-')
    .map((s) => (s ? s[0].toUpperCase() + s.slice(1) : s))
    .join(' ')
}

/** ★#460 真实用法（dogfooding 出处——官网自身/示例工程真实调用，非示意图）：模块 basename → 用法条目 */
const USAGE_MAP = {
  'use-gesture': [{ code: `<div v-gesture:tap="onTapG" class="gesture-demo">{{ tapMsg }}</div>`, src: 'examples/pages/semantic-primitives-demo.vue:197' }],
  engineering: [{ code: `const eng = createEngineering({ reactivity: { ref, computed, watch } })\nconst engCount = eng.useState(0)`, src: 'examples/pages/platform-api-demo.vue:483·487' }],
  'router-engineering': [{ code: `const rx = createRouterEngineering({ routerLike: { … } })`, src: 'examples/pages/platform-api-demo.vue:505' }],
  'animation-engineering': [{ code: `const anim = createAnimationEngineering({ … })\nconst gestureAnim = anim.useGestureAnimation()`, src: 'examples/pages/platform-api-demo.vue:540·547' }],
  'tooling-engineering': [{ code: `const tool = createToolingEngineering({ reactivity: { ref, computed, watch } })`, src: 'examples/pages/platform-api-demo.vue:631' }],
  'request-engineering': [{ code: `const req = createRequestEngineering({ … })`, src: 'examples/pages/platform-api-demo.vue:736' }],
  anchor: [{ code: `scrollToId(hit.anchor, { behavior: 'smooth', delayMs: 60 }) // 等新页 v-html 渲染后再滚`, src: 'website/src/DocSearch.vue:106' }],
  breadcrumb: [{ code: `deriveBreadcrumb(['home', 'user', 'profile'])`, src: 'examples/pages/semantic-primitives-demo.vue:468' }],
  clipboard: [{ code: `void copyText(url) // Clipboard API + 降级`, src: 'website/src/components/TransformDemo.vue:179' }],
  command: [{ code: `const list = filterCommands(cmdItems, cmdQuery.value)`, src: 'examples/pages/semantic-primitives-demo.vue:456' }, { code: `cmdIdx.value = moveCommandIndex(cmdIdx.value, dir, list.items.length)`, src: 'examples/pages/semantic-primitives-demo.vue:457' }],
  'context-menu': [{ code: `<div v-p-context-menu="cardMenu" class="ctx-card">右键我</div>`, src: 'examples/pages/semantic-primitives-demo.vue:214' }],
  'cursor-glow': [{ code: `<p-page v-p-cursor-glow="cursorGlowOptions" …>` + ' // size/color/accent 品牌光晕', src: 'website/src/App.vue:67' }],
  deeplink: [{ code: `const dl = parseDeepLink('proteus://order/42?tab=detail')`, src: 'examples/pages/semantic-primitives-demo.vue:385' }, { code: `matchDeepLink('proteus://order/:id', 'proteus://order/42')`, src: 'examples/pages/semantic-primitives-demo.vue:386' }],
  directives: [{ code: `<button v-p-shortcut="{ expr: 'mod+k:open', handler: () => toggle(true) }">⌘K 搜索</button>`, src: 'website/src/DocSearch.vue:133（createDesktopDirectives 注册于 website/src/main.ts）' }],
  'focus-trap': [{ code: `trap = modalEl.value ? createFocusTrap(modalEl.value) : null`, src: 'website/src/DocSearch.vue:64' }, { code: `<div v-p-focus-trap class="trap-dialog">…</div>`, src: 'examples/pages/semantic-primitives-demo.vue:218' }],
  hover: [{ code: `<p-view v-for="p in pillars" v-p-hover class="pillar-card">…</p-view>`, src: 'website/src/pages/Home.vue:244' }],
  lifecycle: [{ code: `lifeTracker = createLifecycleTracker({ onChange: (phase) => … })`, src: 'examples/pages/semantic-primitives-demo.vue:477' }],
  'low-power': [{ code: `const p = await detectLowPower()`, src: 'examples/pages/semantic-primitives-demo.vue:490' }],
  'master-detail': [{ code: `computeSplitLayout({ width: viewW.value, detailOpen, inspector: inspectorOn })`, src: 'examples/pages/semantic-primitives-demo.vue:406' }, { code: `applySplitNav({ type: 'select' }, { layout: l, inspectorOn })`, src: 'examples/pages/semantic-primitives-demo.vue:411' }],
  network: [{ code: `const i = detectNetwork() // { online, kind, effectiveType }`, src: 'examples/pages/semantic-primitives-demo.vue:485' }],
  notify: [{ code: `const r = sendNotification({ title: 'Proteus 演示', body: '系统通知' })`, src: 'examples/pages/semantic-primitives-demo.vue:371' }],
  'page-url': [{ code: `replacePageUrl(playgroundUrl(currentPageOrigin(), currentPagePathname(), src))`, src: 'website/src/components/TransformDemo.vue:112' }],
  permission: [{ code: `const manifest = buildPermissionManifest(['notification', 'camera'])`, src: 'examples/pages/semantic-primitives-demo.vue:360' }, { code: `<p-button v-p-permission="{ semantic: 'notification' }" @click="onSendNotify">发送通知</p-button>`, src: 'examples/pages/semantic-primitives-demo.vue:232' }],
  scroll: [{ code: `const scrollObs = createScrollObserver({ immediate: true, onChange: (s) => { progress.value = s.progress } })`, src: 'website/src/App.vue:44' }],
  shortcut: [{ code: `<button v-p-shortcut="{ expr: 'mod+k:open', handler: () => toggle(true) }">`, src: 'website/src/DocSearch.vue:133' }, { code: `const kbd = shortcutLabel('mod+k', detectShortcutPlatform())`, src: 'website/src/DocSearch.vue:47' }],
  'state-restoration': [{ code: `const token = captureState('demo', 'view', { path, ts: Date.now() })`, src: 'examples/pages/semantic-primitives-demo.vue:495' }, { code: `restoreState('demo', 'view')`, src: 'examples/pages/semantic-primitives-demo.vue:499' }],
  tabs: [{ code: `resolveTabAfterClose(demoTabs.value, demoActive.value, id)`, src: 'examples/pages/semantic-primitives-demo.vue:436' }],
  'window-message': [{ code: `subscribeWindowMessage({ types: ['proteus-spirit-morph'], onMessage })`, src: 'website/src/App.vue:30' }],
}

function renderPage(srcDirAbs, rel, file, order, group) {
  const src = fs.readFileSync(path.join(srcDirAbs, file), 'utf8')
  const header = readHeader(src)
  const exports = readExports(src)
  const title = humanName(file, header)
  const body = []
  body.push('---')
  body.push(`title: ${title}`)
  body.push(`order: ${order}`)
  body.push('group: ' + group)
  body.push('---')
  body.push('')
  body.push(`# ${title}`)
  body.push('')
  body.push(SUMMARY_MAP[file.replace(/\.ts$/, '')] || header[0] || '') // 页头一句话：这个原语做什么
  body.push('')
  if (rel === 'packages/api') {
    body.push('> 来源模块 `@proteus-vue/api`（工程原语工厂——**注入式**：消费方注入 reactivity/driver/routerLike 等，api 包零 vue 依赖；MP 产物安全子集：无 `?.`/`??`/数组解构）。')
  } else {
    body.push(`> 来源模块 \`@proteus-vue/${rel.replace('packages/', '')}\`（Pure logic + Web 接线——env 注入可单测，缺省回落真实全局）。平台映射 / 降级链见模块头原文。`)
  }
  body.push('')
  if (header.length) body.push(...header.map((l) => l.startsWith('★') ? `**${l}**` : l), '')

  // ★#466 端兼容进度（家族级口径——与组件/能力页同构；生成自 ENDS 注册表同名端序）
  const family = rel === 'packages/desktop' ? 'desktop' : rel === 'packages/gesture' ? 'gesture' : 'api'
  const endsRows = ENDS_FAMILY[family]
  if (endsRows) {
    body.push('## 兼容进度')
    body.push('')
    body.push('| 端 | 兼容 | 说明 |')
    body.push('|---|---|---|')
    for (const [name, mark, note] of endsRows) body.push(`| ${name} | ${mark} | ${note} |`)
    body.push('')
    body.push('> 状态口径：✅ 端已落地·本原语可用；🟡 端原型映射·接线未开始；⬜ 端未开始。本表为家族级机制口径（非逐端真机验证矩阵）；端架构对照（引擎 / 运行时 / 持久化）见 [端与成熟度](/docs/framework/ends-matrix)。')
    body.push('')
  }
  body.push(`## 核心导出（SSOT：\`${rel}/src/${file}\`）`)
  body.push('')
  if (exports.length) {
    body.push('| 导出 | 形态 | 一句话（源码注释） |')
    body.push('|---|---|---|')
    for (const e of exports) body.push(`| \`${e.name}\` | ${e.kind} | ${e.doc || '—'} |`)
  } else {
    body.push('> 无具名导出（纯模块/指令注册侧）——见源码。')
  }
  body.push('')

  const base = file.replace(/\.ts$/, '')
  const usage = USAGE_MAP[base]
  if (usage && usage.length) {
    body.push('## 真实用法（dogfooding 出处——官网自身/示例工程在跑，非示意图）')
    body.push('')
    for (const u of usage) {
      body.push('```ts')
      body.push(u.code)
      body.push('```')
      body.push(`> 出处：\`${u.src}\``)
      body.push('')
    }
  }
  body.push(`## 用法与降级`)
  body.push('')
  if (rel === 'packages/gesture') {
    body.push('- 识别器纯逻辑零依赖：Web Pointer / MP touch 归一为 `GestureInput` → 语义手势事件（tap/pan/swipe/pinch/rotate/longpress…）——可单测')
    body.push('- Web 官方接线：`useGesture()` Hook 与 `v-gesture:<kind>="onX"` 指令；MP/原生端映射由各端 Backend 承接——「事件是 Backend 实现细节」')
    body.push('- 真实示例：`examples/pages/semantic-primitives-demo.vue`（v-gesture:tap）')
  } else if (rel === 'packages/api') {
    body.push('- **工厂注入式**：`createXxxEngineering({ reactivity, driver, routerLike… }) → 实例`——消费方注入 reactivity（api 包零 vue 依赖），实例方法即 E 系原语')
    body.push('- 组件形态（如 E20 p-animate / E18 p-router-link）编译期进 C-IR；注入式 Hook（E1-E28/R1-R4）运行时按注入面接线')
    body.push('- 真实示例：`examples/pages/platform-api-demo.vue`（E 系/R 系工厂全调用，见「真实用法」出处）')
  } else {
    body.push('- 纯逻辑函数：env 注入测试、浏览器缺省回落（`typeof` 守卫——封装只在框架包内，页面零裸平台 API）')
    body.push('- 指令/组件形态：经 `createDesktopDirectives()` 注册的 `v-p-*`（MP 端不注册天然降级）')
    body.push('- 官网 dogfooding 用法见[质量门禁](/docs/29-quality-gates) 违规速查与[桌面端原语](/docs/30-desktop-primitives)；G-24 系列示例见 `examples/pages/semantic-primitives-demo.vue`')
  }
  body.push('')
  body.push(`<!-- generated by website/scripts/gen-primitives.mjs · SSOT：${rel}/src -->`)
  return body.join('\n')
}

const modules = SOURCES.flatMap((src) => {
  const dir = path.join(WEBSITE, '..', src.rel, 'src')
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && f !== 'index.ts' && (!src.files || src.files.test(f)))
    .sort()
    .map((f, i) => [
      `${src.prefix}${f.replace(/\.ts$/, '')}.md`,
      renderPage(dir, src.rel, f, src.orderBase + i, src.group),
    ])
})
const generated = new Map(modules)

fs.mkdirSync(OUT_DIR, { recursive: true })
let drifted = false
for (const [file, md] of generated) {
  const out = path.join(OUT_DIR, file)
  if (check) {
    if (!fs.existsSync(out) || fs.readFileSync(out, 'utf8') !== md) {
      console.error(`DRIFT: content/primitives/${file} 与源不一致——运行 npm run gen:primitives 并提交`)
      drifted = true
    }
  } else {
    fs.writeFileSync(out, md)
  }
}
if (check) {
  console.log(drifted ? '❌ 原语页漂移（--check）' : `OK: ${generated.size} 个原语模块页与源一致`)
  process.exitCode = drifted ? 1 : 0
} else {
  console.log(`generated: primitives ${generated.size} 个模块页（overview 手写不覆盖）`)
}
