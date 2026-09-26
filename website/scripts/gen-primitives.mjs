#!/usr/bin/env node
// website/scripts/gen-primitives.mjs —— 原语分区生成器（★#460）
//   SSOT = packages/desktop/src/*.ts（模块头注释 = 定位/语义，导出清单 = API 面）——与 gen-reference 同法（源码文本解析，零依赖）
//   产出：content/primitives/desktop-<模块>.md（每模块一页：定位 + 核心导出表 + 用法降级说明）
//   ★#482 双语输出：登记在 PRIM_EN 的模块额外产出 en/primitives/<同文件名>.md（文案字段由 gen-primitives-en.mjs 提供，
//     结构骨架与 zh 同源推导——生成器改了 zh 不会让 EN 静默漂移，重跑即同步）
//   用法：node scripts/gen-primitives.mjs [--check]（--check 漂移检测：不一致 exit 1）
//   overview 页为手写（content/primitives/00-overview.md）——生成器不覆盖
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PRIM_EN, FAMILY_EN, SHARED_PRIM_EN } from './gen-primitives-en.mjs'

const WEBSITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(WEBSITE, 'content', 'primitives')
const check = process.argv.includes('--check')

/** ★#460/#462 生成源（多包）：{ id, rel, group, prefix, orderBase }——desktop 模块 + gesture 接线 */
const SOURCES = [
  { id: 'desktop', rel: 'packages/desktop', group: '桌面语义原语', prefix: 'desktop-', orderBase: 10 },
  { id: 'gesture', rel: 'packages/gesture', group: '手势语义原语', prefix: 'gesture-', orderBase: 60 },
  // ★files 白名单（2026-09-19 修「官网静默缺页」）：api 包的工程原语模块有两类命名——
  //   `*-engineering.ts`（E/R 系工厂）与**单文件原语**（`mcp.ts` = E30 WebMCP）。
  //   实测：E30 落地后官网搜不到 useMCP，根因即此白名单未含 mcp.ts（页面是**生成物**，
  //   不在此列就永远不进 content/primitives → docs-registry 的 glob 收录不到 → 搜索无结果）。
  //   ⇒ 今后新增单文件原语必须同步此处。
  { id: 'api', rel: 'packages/api', group: '工程语义原语', prefix: 'eng-', orderBase: 80, files: /(^|-|\/)?engineering\.ts$|^mcp\.ts$/, pkg: '@proteus-vue/api' },
]

/**
 * ★EN 组名映射（2026-09-26）：rename 提交曾**手改生成页**的 group → 重跑生成器即回退（漂移根因）。
 *   组名随 SOURCES.group 走同一 SSOT——新增分区必须在此登记英文名，否则 EN 页发中文组名。
 */
const GROUP_EN = {
  桌面语义原语: 'Desktop semantic primitives',
  手势语义原语: 'Gesture semantic primitives',
  工程语义原语: 'Engineering semantic primitives',
}

const TITLE_OVERRIDES = {
  recognizers: 'Gesture 识别器（tap/pan/swipe/pinch/rotate）',
  'use-gesture': 'useGesture Hook + v-gesture 指令（Web 接线）',
  engineering: '基础工程原语（E1-E9：useState/useComputed/useWatch/useLifecycle…）',
  'router-engineering': '路由工程原语（E10-E18：useRoute/push/back/守卫…）',
  'animation-engineering': '动画工程原语（E19-E23：useAnimation/useScrollAnimation…）',
  'tooling-engineering': '工具工程原语（E24-E28：useDevTools/defineComponent…）',
  'request-engineering': '请求工程（R1-R4：request/useQuery/enqueue/runOnce）',
  'ownership-engineering': '所有权工程原语（PSS：useOwned/useBorrow…）',
  mcp: 'WebMCP 接入（E30：useMCP / capabilityToTool）',
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
  'cursor-glow': '指针跟随环境光晕（品牌双光斑，lerp 插值拖尾）',
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
  scroll: '页面滚动观测（进度/滚动态）+ 滚动高亮 createScrollSpy（文档目录 scroll-spy 在用）',
  'window-message': '跨窗消息订阅：origin 白名单 + type 过滤 + destroy',
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
  mcp: '把框架能力暴露为浏览器内 agent 可调用工具——能力派生自动归一（ok → 结果 / Err → isError + 错误码）；小程序端诚实降级',
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
    let text = t.replace(/^(\/\/|\/\*|\*\/|\*)\s*/, '').trim()
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
    // ★注释抽取（2026-09-19 修两处）：向**上**收集整段注释，取**最靠近 `/**` 的那行**作为摘要。
    //   ① 原地实现遇 ` */` 收尾行即当作内容 → 多行 JSDoc 的条目在官网显示为 `/`（垃圾值，
    //      实测 capabilityToTool/useMCP 等全受影响）；修法：正则把 `\*\/` 排在 `\*` 之前。
    //   ② 原地实现取「离 export 最近的一行」→ 拿到的是 JSDoc **末行**而非摘要行；
    //      本仓惯例首行是 `★xxx：一句话`，故改为取收集序列的最后一个（= 最上面的内容行）。
    const collected = []
    for (let j = i - 1; j >= 0; j--) {
      const prev = (lines[j] || '').trim()
      if (!prev) break
      if (!COMMENT_LINE.test(prev)) break
      const text = prev
        .replace(/^(\/\/|\/\*|\*\/|\*)\s*/, '')
        .trim()
        .replace(/\s*\*\/\s*$/, '')
        .trim()
        .replace(/^\*+\s?/, '')
      if (!text || text.startsWith('packages/')) continue
      collected.push(text)
    }
    const doc = collected.length ? collected[collected.length - 1] : ''
    // 去掉句末标点：摘要取的是 JSDoc 首行，常以「。」/「.」结尾（原文是完整句），
    // 表格「一句话」列带上标点显得脏——统一剥除
    out.push({ name: m[2], kind: m[1], doc: doc.replace(/[。.]$/, '').slice(0, 90) })
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
  'cursor-glow': [{ code: `<p-page v-p-cursor-glow="{ size: 520, color, accent, lerp: 0.14 }" …>`, src: 'tests/desktop-cursor-glow.test.ts' }],
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
  'window-message': [{ code: `subscribeWindowMessage({ types: ['app-event'], onMessage })`, src: 'tests/desktop-web-primitives.test.ts' }],
  mcp: [
    {
      code: `const cap = createCapabilityHooks()\n\nconst mcp = useMCP({\n  prefix: 'app_',\n  capabilities: [\n    { name: 'vibrate', description: '震动提示', run: () => cap.useVibrate(30) },\n    { name: 'clipboard_read', description: '读取剪贴板', run: () => cap.useClipboard() },\n  ],\n  onDispose: onScopeDispose, // 或 onUnmounted——生命周期交还调用方（零 vue 依赖）\n})\n\nmcp.isSupported  // 本环境是否实现 WebMCP（方法可调用判定）\nmcp.toolNames    // 实际注册的工具名（含前缀）`,
      src: 'examples/pages/platform-api-demo.vue:836',
    },
    {
      code: `// 能力 → 工具：ok → 结果；Err → isError + 错误码（CapResult 自动归一）\nconst t = capabilityToTool({ name: 'locate', description: '定位', run: () => capOk({ lat: 1, lng: 2 }) })`,
      src: 'tests/use-mcp.test.ts:120',
    },
  ],
}

/**
 * ★模块级「用法与降级」文案（2026-09-19 新增）：
 *   此前 `packages/api` 全族共用一段家族 boilerplate——对 E30 这类**非工厂式**原语，
 *   它写的是 `createXxxEngineering({ reactivity… })`，**句句无关**（E30 不注入 reactivity、
 *   不是工厂、与 C-IR 编译期形态无关）。本表按模块给出准确说明；未登记者回落家族口径。
 */
const USAGE_NOTES = {
  mcp: [
    '**两步注册**：`useMCP({ capabilities | tools })` —— `capabilities` 走**能力派生**（框架据 `CapResult` 自动归一响应）；`tools` 走**显式声明**（完全自定义 `execute`）。',
    '**能力派生（本原语的核心增量）**：只写「工具名 + 描述 + 参数 schema」，响应归一交给框架——`ok` → 工具结果、`Err` → `isError` + 错误码、实现抛错也不穿透到 agent 通道。',
    '**生命周期**：`onDispose` **注入式**（Vue 侧传 `onScopeDispose` / `onUnmounted`）；本包零 vue 依赖——同一份实现可进 MP 产物与 Node 测试。',
    '**注销语义**：规范无 `unregisterTool`，`dispose()` 即中断 `AbortSignal`（幂等）。',
    '**降级**：无 `document.modelContext`（小程序 / SSR / 未实现该标准的浏览器）→ `isSupported=false`、不注册、**不抛错**——如实反映而非静默假装成功。',
    '**探测纪律**：判 `registerTool` **可调用**而非对象存在（空对象会被误判为支持）。',
  ],
}

/**
 * ★模块级 API 明细（2026-09-19 新增）：补「怎么用 / 返回什么 / 边界」——
 *   核心导出表只有「形态 + 一句话」，对 useMCP 这类带返回契约与降级面的原语不够；
 *   本表按导出名补 2-3 行说明，未登记者不渲染该段（保持既有页不变）。
 */
const API_DETAIL = {
  mcp: [
    {
      name: 'useMCP',
      lines: [
        '签名：`useMCP(options: UseMCPOptions): UseMCPReturn`',
        '`options`：`tools`（显式工具）· `capabilities`（能力派生）· `prefix`（工具名前缀）· `document`（注入，测试用）· `enabled`（只探测不注册）· `onDispose`（作用域销毁钩子）',
        '返回：`{ isSupported, isRegistered, error, toolNames, ready, dispose }` —— ★状态为 **getter**（异步注册 / 注销后能读到最新值，而非创建时的快照）',
        '`ready`：Promise，等注册完成（含异步 `registerTool`）——需要确定性时 `await`',
      ],
    },
    {
      name: 'capabilityToTool',
      lines: [
        '签名：`capabilityToTool(spec: McpCapabilityToolSpec, prefix?: string): McpToolDescriptor`',
        '`spec.run` 返回 `CapResult<T>`（或 Promise 包装）→ 自动归一：`ok` → 工具结果；`Err` → `isError: true` + `code: message`',
        '实现抛错同样归一为工具响应（异常不穿透到 agent 通道）',
      ],
    },
    {
      name: 'toToolResponse',
      lines: [
        '值 → 工具响应：字符串直出；**空载荷（`undefined`/`null`）→ `ok（无返回数据）`**——★不能产出字面量 `"undefined"`（多数能力是 `CapResult<void>`，agent 会把该字符串当有效数据）；其余走 `JSON.stringify`',
        '循环引用 / BigInt 等序列化失败 → 降级为字符串（工具响应必须可序列化，不得抛给 agent）',
      ],
    },
    {
      name: 'toErrorResponse',
      lines: ['`Error` / 非 Error 值 → `{ content, isError: true }`——agent 据此重试或换策略，而非当成功解析'],
    },
  ],
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

  // ★模块级 API 明细（2026-09-19）：补「签名 / 返回 / 边界」——核心导出表只有一行一句话，
  //   对带返回契约与降级面的原语（如 useMCP）不足；未登记者不渲染本段（既有页零变化）。
  const apiDetail = API_DETAIL[file.replace(/\.ts$/, '')]
  if (apiDetail && apiDetail.length) {
    body.push('### API 明细')
    body.push('')
    for (const d of apiDetail) {
      body.push(`#### \`${d.name}\``)
      body.push('')
      for (const l of d.lines) body.push(`- ${l}`)
      body.push('')
    }
  }

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
  const usageNotes = USAGE_NOTES[base]
  if (usageNotes && usageNotes.length) {
    // ★模块级准确文案（优先）——家族 boilerplate 对非工厂式原语会写成「句句无关」
    for (const l of usageNotes) body.push(`- ${l}`)
  } else if (rel === 'packages/gesture') {
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

// —— ★#482 原语 EN overlay 渲染（骨架与 zh 同源推导，文案查 PRIM_EN） ——
function renderEnPage(srcDirAbs, rel, file, order, group) {
  const base = file.replace(/\.ts$/, '')
  const page = PRIM_EN[base]
  const groupEn = GROUP_EN[group] || group
  const src = fs.readFileSync(path.join(srcDirAbs, file), 'utf8')
  const header = readHeader(src)
  const exports = readExports(src)
  const body = []
  body.push('---')
  body.push(`title: ${page.title || base}`)
  body.push(`order: ${order}`)
  body.push('group: ' + groupEn)
  body.push('---')
  body.push('')
  body.push(`# ${page.title || base}`)
  body.push('')
  body.push(page.summary || '—')
  body.push('')
  if (rel === 'packages/api') body.push(SHARED_PRIM_EN.apiCallout)
  else body.push(SHARED_PRIM_EN.sourceCallout(rel.replace('packages/', '')))
  body.push('')
  if (page.notes?.length) body.push(...page.notes.map((l) => (l.startsWith('★') ? `**${l}**` : l)), '')
  const family = rel === 'packages/desktop' ? 'desktop' : rel === 'packages/gesture' ? 'gesture' : 'api'
  const endsRows = FAMILY_EN[family]
  if (endsRows) {
    body.push('## Compat rollout')
    body.push('')
    body.push('| Target | Status | Notes |')
    body.push('|---|---|---|')
    for (const [name, mark, note] of endsRows) body.push(`| ${name} | ${mark} | ${note} |`)
    body.push('')
    body.push(SHARED_PRIM_EN.legend)
    body.push('')
  }
  body.push(`## Core exports (SSOT: \`${rel}/src/${file}\`)`)
  body.push('')
  if (exports.length) {
    body.push('| Export | Kind | One-liner (source comment) |')
    body.push('|---|---|---|')
    for (const e of exports) body.push(`| \`${e.name}\` | ${e.kind} | ${page.exports?.[e.name] || '—'} |`)
  } else {
    body.push('> No named exports (pure module / directive registration side) — see the source.')
  }
  body.push('')
  // ★Per-module API detail (2026-09-19) — mirrors the zh section **and its order**
  //   （zh 侧顺序是「核心导出 → API 明细 → 真实用法」；EN 若把 API 明细放最后会触发
  //     check:en-drift 的结构漂移——该门禁按章节顺序比对，故两端须同序）
  if (page.apiDetail?.length) {
    body.push('### API detail')
    body.push('')
    for (const d of page.apiDetail) {
      body.push(`#### \`${d.name}\``)
      body.push('')
      for (const l of d.lines) body.push(`- ${l}`)
      body.push('')
    }
  }
  const usage = page.usage
  if (usage?.length) {
    body.push('## Real usage (dogfooding provenance — the official site itself / example projects run it live, not illustrative)')
    body.push('')
    for (const u of usage) {
      body.push('```ts')
      body.push(u.code)
      body.push('```')
      body.push(`> Origin: \`${u.src}\``)
      body.push('')
    }
  }
  body.push('## Usage & degradation')
  body.push('')
  // ★Per-module usage notes (2026-09-19) — family boilerplate is misleading for non-factory primitives
  if (page.usageNotes?.length) {
    for (const l of page.usageNotes) body.push(`- ${l}`)
  } else {
    body.push(...SHARED_PRIM_EN.familyNotes[family])
  }
  body.push('')
  body.push(`<!-- generated by website/scripts/gen-primitives.mjs (en overlay) · SSOT：${rel}/src -->`)
  return body.join('\n')
}

/**
 * ★分类覆盖度校验（2026-09-19 补，防「新模块静默不进官网」）：
 *   背景——E30 `mcp.ts` 落地后官网搜不到，根因是 SOURCES 白名单未含该文件；
 *   而 `--check` 只在「已生成页与源不一致」时报错，**首次遗漏是静默的**（页面不存在 → 无漂移可比）。
 *   本表显式登记「有意不在本分区」的模块及理由；未登记且不在白名单的模块 → FAIL。
 */
const COVERED_ELSEWHERE = {
  // api 包中的非「工程原语模块」——各有归属分区/用途
  adapters: '内部适配器（非原语面，随 client 实现）',
  auth: '认证实现（能力面见 capabilities/auth.md）',
  capability: '★能力原语由 gen-content.mjs 生成到 content/capabilities/（81 页）',
  client: 'API 客户端实现（非原语面）',
  platform: 'PlatformAPI 工厂（由 guides/reference 覆盖）',
  types: '类型定义（无运行面）',
}
let coverageIssues = 0
for (const src of SOURCES) {
  // ★仅对「定义了 files 白名单」的源做覆盖度校验——未定义白名单的源默认全收（desktop/gesture 即此类），
  //   对它们做校验会把「本就该全收」的模块误报为缺口（本校验初版即犯此错，实测报出 24 项假缺口）。
  if (!src.files) continue
  const dir = path.join(WEBSITE, '..', src.rel, 'src')
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.ts') || f === 'index.ts') continue
    const name = f.replace(/\.ts$/, '')
    if (src.files.test(f)) continue
    if (COVERED_ELSEWHERE[name]) continue
    console.error(
      `❌ 原语覆盖缺口：${src.rel}/src/${f} 既不在 SOURCES 白名单，也未在 COVERED_ELSEWHERE 声明归属——` +
        `新原语模块会被官网静默漏掉（搜索不到）。请二选一：加入 files 白名单 或 在 COVERED_ELSEWHERE 写明理由。`,
    )
    coverageIssues++
  }
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
      PRIM_EN[f.replace(/\.ts$/, '')] ? renderEnPage(dir, src.rel, f, src.orderBase + i, src.group) : null,
    ])
})
const generated = new Map(modules.map((m) => [m[0], m[1]]))
const generatedEn = new Map(modules.filter((m) => m[2]).map((m) => [m[0], m[2]]))

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
// ★#482 EN overlay 写盘（不在 --check 模式写；PRIM_EN 覆盖度由 tests/website-content-en 或人工 batch 校验）
if (!check) {
  const OUT_EN = path.join(WEBSITE, 'en', 'primitives')
  if (generatedEn.size) fs.mkdirSync(OUT_EN, { recursive: true })
  for (const [file, md] of generatedEn) fs.writeFileSync(path.join(OUT_EN, file), md)
}
if (check) {
  if (coverageIssues > 0) {
    console.log(`❌ 原语覆盖缺口 ${coverageIssues} 项（--check）——见上方清单`)
  } else {
    console.log(drifted ? '❌ 原语页漂移（--check）' : `OK: ${generated.size} 个原语模块页与源一致（覆盖度校验通过）`)
  }
  process.exitCode = drifted || coverageIssues > 0 ? 1 : 0
} else {
  if (coverageIssues > 0) console.log(`⚠ 原语覆盖缺口 ${coverageIssues} 项（生成已继续，但请补登记）`)
  console.log(`generated: ${generated.size} primitives zh + en ${generatedEn.size}`)
  if (coverageIssues > 0) process.exitCode = 1
}
