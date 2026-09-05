// website/scripts/gen-content-en.mjs —— 生成内容英文层（★#481 生成器双语输出）
//   与 zh 数据并列的英文字段：共享文案（域/端/状态/小节标题/图例）+ 页面级字段（COMP_EN slug → desc/notes/props）。
//   生成器对 COMP_EN 中登记的 slug 额外产出 website/en/components/<slug>.md（overlay 变体，路径/文件名与 zh 同源）。
//   未登记的页面在英文态走 #noEn 回退（诚实降级）；批次翻译 = 往 COMP_EN 加条目 + 重跑 node website/scripts/gen-content.mjs。
//   原则：EN 变体全部字段落地（前端零运行时翻译）；缺字段宁可不出页也不混排中文。

/** 域标签 EN（KIND_DOMAIN zh 键 → EN；总览/侧栏组名另由 GROUP_NAME 映射，此处只管页内文案） */
export const DOMAIN_EN = {
  布局: 'Layout',
  '内容与表单': 'Content & Forms',
  页面外壳: 'Page Shell',
  手势: 'Gestures',
  工程: 'Engineering',
  '能力入口': 'Capability Entry',
}

/** 小程序等价行的状态括注 EN（zh：L1 原语 / L2 兼容层 / 平台私有 / 缺失） */
export const MP_STATUS_EN = { ok: 'L1 primitive', compat: 'L2 compat layer', private: 'platform-private', missing: 'missing' }

/** 端名/引擎 EN（ends.ts 注册表 zh → EN——兼容进度表「端 / 说明」列） */
export const ENDS_EN = {
  web: { name: 'Web SPA', engine: 'vue-dom' },
  'mp-weixin': { name: 'WeChat Mini Program', engine: 'skyline (WebView fallback)' },
  headless: { name: 'Headless (SSR / testing)', engine: 'headless' },
  'app-ios': { name: 'iOS native', engine: 'native-ios (UIKit)' },
  'app-android': { name: 'Android native', engine: 'native-android (Jetpack)' },
  'app-harmony': { name: 'HarmonyOS', engine: 'native-harmony (ArkUI)' },
  flutter: { name: 'Flutter hybrid', engine: 'flutter' },
  'quick-app': { name: 'Quick App', engine: 'Quick App engine (TBD)' },
}

/** 组件兼容进度行的逐端注记 EN（与 genComponents 的 switch 一一对应；mp 行注记需要页面小程序等价文本） */
export const END_NOTE_EN = {
  web: 'dual-source compile target for both targets (compile-time mapping + event normalization)',
  'mp-weixin': (mpTextEn) => (mpTextEn ? `native control mapping → ${mpTextEn}` : 'Proteus extension component — no Mini Program equivalent'),
  headless: 'IR render test tier (tooling target)',
  flutter: 'widget-level mapping — component-level not yet verified',
  'quick-app': 'target not started',
  prototype: 'prototype mapping — component-level wiring not started',
}

/** 兼容进度表页脚图例 EN */
export const COMP_LEGEND_EN =
  '> Status scale: ✅ shipped & this component usable · 🟡 prototype mapping — component-level wiring not started · ⬜ target not started. Target architecture matrix (engine / runtime / persistence) → [Ends & maturity](/docs/framework/ends-matrix).'

/** 页面小节/表头等共享文案 EN */
export const SHARED_EN = {
  semanticCallout: (domainEn) => `> Semantic component (Layer 0) · domain **${domainEn}** · compiled to each target's native controls at build time — zero platform branches in business code.`,
  genericDesc: 'Generic semantic component (Layer 0) — compiled to each target\'s native controls at build time, zero platform branches in business code.',
  hCompat: '## Compat rollout',
  hProps: '## Props',
  hEvents: '## Events',
  hNotes: '## Implementation notes',
  hUsage: '## Usage',
  compatCols: '| Target | Status | Notes |',
  semanticCols: '| Semantic | Domain | Mini Program equivalent |',
  propsCols: '| Prop | Doc | Type | Default | Required |',
  eventsCols: '| Event | Doc |',
  usageSample: (tag, firstProp) => `<${tag}${firstProp ? ` :${firstProp}="…"` : ''}>\n  <p-text>content</p-text>\n</${tag}>`,
  requiredYes: 'Yes',
  requiredNo: 'No',
  andMore: (n) => ` and ${n} more`,
}

/** 总览页（00-components-overview）EN 文案 */
export const OVERVIEW_EN = {
  title: 'Components overview',
  group: '总览',
  order: 0,
  intro: (count, domains) =>
    `> ${count} semantic components (${domains} domains) — props/events generated from source SSOT (\`website/scripts/gen-content.mjs\`), always in sync with the framework implementation.`,
  cols: '| Component | Props | Events |',
}

/**
 * 页面级 EN 字段：slug → { desc, notes?, props? }
 *  - desc: 页面首行说明（对应 zh extractComponentDesc.short）
 *  - notes: 「实现要点」子弹（对应 zh desc.notes）
 *  - props: { 属性名: 说明EN } —— 仅覆盖需翻译的 props 行文案（缺省回退 SHARED prop 词典）
 *  - mpExtra?: 小程序等价行追加语（缺省用状态括注）
 */
export const COMP_EN = {
  // —— 布局/基础组件（★#481 首批试点）——
  'p-view': {
    desc: 'Generic container',
    notes: [
      'Matrix 01 §1: display unified to a flex column; box-sizing unified to content-box (the Skyline default, aligned on the Web side)',
      'Dual-source for both targets: div → view (compile-time mapping); native Web div + slot',
    ],
    props: {
      pid: 'Component instance id (debugging / observation / test targeting -- D-2 dogfooding contract)',
      disabled: 'Disabled state (blocks interaction + de-emphasizes visuals; passes through to the native MP disabled)',
      ariaLabel: 'Accessibility label (text read aloud by screen readers)',
    },
  },
  'p-stack': {
    desc: 'Flex stack',
    notes: [
      'Direction + gap + smart wrapping: Web = flex + gap (children wrap automatically when space runs out while wrap is enabled)',
      'Dual-source for both targets: div → view (compile-time mapping)',
    ],
    props: {
      direction: 'Main-axis direction: row (horizontal) / column (vertical)',
      wrap: 'Wrap automatically when space is insufficient (row only)',
      gap: 'Spacing between children (px)',
    },
  },
  'p-grid': {
    desc: 'Adaptive grid',
    notes: [
      'Only the minimum per-column width + gap are declared; the column count resolves itself: Web = CSS Grid repeat(auto-fill, minmax(minColWidth, 1fr))',
      '(320px→1 / 768px→4 / 1440px→8 columns; the calcColumns pure algorithm lives in compiler/fluid-layout.ts)',
      'Dual-source for both targets: div → view (compile-time mapping); MP webview rendering supports grid, while Skyline falls back to a plain container',
      '★G-22.2 fallback rule, plain but correct: on the Web side, CSS.supports probes that grid is unsupported → flex-wrap emulates auto-fit',
      '(The MP logic layer has no CSS.supports → support is assumed → always grid mode; the renderer decides the fallback itself)',
    ],
    props: {
      minColWidth: 'Minimum column width (px) -- the column count is derived automatically',
      gap: 'Column gap (px)',
    },
  },
  'p-split': {
    desc: 'Adaptive panes',
    notes: [
      'Container width < minSplitWidth → stacked (column); ≥ → side-by-side (row) -- resolved by the container, not the viewport',
      'Thin shell referencing @proteus-vue/fluid (the createContainerQuery container-query runtime)',
      '★MP safety: generic ref falls back (no ResizeObserver on MP → keeps the stacked default); the as in the method body can be stripped',
    ],
    props: {
      minSplitWidth: 'Container width reaches this value → side-by-side panes (px; below it → stacked)',
      gap: 'Spacing between panes / stacked sections (px)',
      designWidth: 'Design width (baseline for deriving the container breakpoint)',
    },
  },
  'p-sidebar': {
    desc: 'Adaptive navigation bar',
    notes: [
      'Container width < minSidebarWidth → bottom horizontal nav bar (the primary mobile scenario); ≥ → left vertical sidebar (tablet / in-car / desktop)',
      'Resolved by the container, not the viewport (createContainerQuery -- in-car split-screen / multi-window layouts resolve against their own container)',
      '★In-car: Arrow keys move focus between nav items (d-pad mapping; listened for in Web onMounted -- skipped on MP, which has no real DOM)',
      'drive-mode / prefers-reduced-motion → no-motion class (motion effects disabled via CSS)',
      '★MP safety: no ResizeObserver → bottom-bar always; no DOM for focus listening → skipped',
    ],
    props: {
      minSidebarWidth: 'Container width reaches this value → side-rail sidebar; below it → collapsed (px)',
      navWidth: 'Navigation bar width in side-rail mode (px)',
      designWidth: 'Design width (baseline for deriving the container breakpoint)',
      toggleLabel: '★Collapsed-mode toggle bar copy (#384)',
    },
  },
  'p-button': {
    desc: 'Button',
    notes: [
      'Matrix 01 §7: native mapping of disabled/loading + throttle prevents duplicate clicks (built into the runtime)',
      'Dual-source for both targets: native button passthrough (tag/passthrough); @click → bindtap',
    ],
    props: {
      pid: 'Component instance id (debugging / observation / test targeting -- D-2 dogfooding contract)',
      disabled: 'Disabled state (blocks interaction + de-emphasizes visuals; passes through to the native MP disabled)',
      ariaLabel: 'Accessibility label (text read aloud by screen readers)',
      loading: 'Loading state',
      throttle: 'Click throttle interval (ms; prevents repeated triggers -- built into the runtime)',
    },
    events: {
      click: 'Click / tap (fires after throttling)',
    },
  },
}
