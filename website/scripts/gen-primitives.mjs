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
  if (rel === 'packages/api') {
    body.push('> 来源模块 `@proteus-vue/api`（工程原语工厂——**注入式**：消费方注入 reactivity/driver/routerLike 等，api 包零 vue 依赖；MP 产物安全子集：无 `?.`/`??`/数组解构）。')
  } else {
    body.push(`> 来源模块 \`@proteus-vue/${rel.replace('packages/', '')}\`（Pure logic + Web 接线——env 注入可单测，缺省回落真实全局）。平台映射 / 降级链见模块头原文。`)
  }
  body.push('')
  if (header.length) body.push(...header.map((l) => l.startsWith('★') ? `**${l}**` : l), '')
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
