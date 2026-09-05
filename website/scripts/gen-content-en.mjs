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
  // —— 批次 A（#481 续）——
  'p-action-sheet': {
    desc: 'Action sheet',
    notes: [
      'actions[{label,value?,color?}] + cancel + v-model visibility + select/cancel emit',
      'Dual-source for both targets: div → view; MP-safe (mask + panel; no platform API)',
    ],
    props: {
      modelValue: 'Visibility (v-model)',
      actions: 'Action items [{label,value?,color?}]',
      cancelText: 'Cancel text',
    },
    events: { select: 'An item is selected', cancel: 'Cancel / close' },
  },
  'p-adaptive': {
    desc: 'Adaptive container form',
    notes: [
      'Only the form ranges are declared: the container width → auto switch between sheet/dialog/popover (resolved by computeAdaptiveForm, pure B1 logic)',
      'Web-side form-layer styles come from resolveAdaptiveFormStyle (sheet: bottom, full width / dialog and popover: centered fallback -- 03 §6 fallback chain)',
      '★visible controls form-layer rendering (v-model style); MP: no ResizeObserver → the form always falls back to the first range (renderer decides)',
      '★Same semantics as the App-side B3 native containers (UISheet/BottomSheet/SideBarContainer): developers only write the form ranges',
    ],
    props: {
      modes: 'Form-range expression: `sheet(0, 600) | dialog(600, 840) | popover(840, ∞)`',
      visible: 'Whether the form layer is rendered (false → not rendered)',
    },
    events: { formChange: 'Active form changed' },
  },
  'p-animate': {
    desc: 'Animation declaration -- the CSS animation semantic surface',
    notes: [
      'keyframes: preset animation names (fade/bounce/pulse/shake/zoom-in/spin -- @keyframes p-animate-{keyframes})',
      'duration: animation duration in ms (default 600)',
      'loop: whether to loop (default true -- declarative decorative animation; false → plays once)',
      'delay: delay in ms (default 0)',
      '★Cross-target: native CSS animation on Web; Skyline supports animation (same as transition) -- pure CSS declaration semantics',
      'MP compiler-safe -- :class goes through a single computed expression body (the same p-scale- convention as p-scale)',
    ],
    props: {
      keyframes: 'Preset animation name (fade/bounce/pulse/shake/zoom-in/spin)',
      duration: 'Animation duration (ms)',
      loop: 'Loop playback (default true -- decorative animation; false plays once)',
      delay: 'Delay (ms)',
    },
  },
  'p-aspect': {
    desc: 'Aspect-ratio container',
    notes: [
      'Only the width/height ratio is declared: Web = CSS aspect-ratio (native since Chrome 88+); unsupported → padding-top hack fallback',
      "(height:0 + paddingTop:1/ratio% + absolutely positioned children -- a cross-target CSS2 technique, 'plain but correct', iron rule G-22.2)",
      'MP: Skyline only partially supports aspect-ratio; the logic layer has no CSS.supports → support is assumed (renderer decides)',
    ],
    props: {
      ratio: 'Width/height ratio (e.g. 16/9 = 1.777; default 1.777)',
      maxWidth: 'Max width (px; 0 = unlimited)',
    },
  },
  'p-avatar': {
    desc: 'Avatar',
    notes: [
      'Image avatar + shape (circle/square) + size + fallback (shows the first character when the image is missing)',
      'Dual-source for both targets: img → image; MP-safe (pure props/styles; binderror event normalization comes in a later batch)',
    ],
    props: {
      src: 'Avatar image source',
      shape: 'Shape: circle (round) / square (rounded corners)',
      size: 'Size (px)',
      fallback: 'Fallback text (shown when the image is missing or fails to load -- its first character is displayed)',
    },
  },
  'p-canvas': {
    desc: 'Canvas',
    notes: [
      'engine 2d/webgl/skia + resolution awareness',
      '★B2 Web-first: standard canvas element hosting + width/height (devicePixelRatio scaling in a later batch)',
      'The host context is exposed through slots/ref (frame rendering belongs to a capability batch)',
    ],
    props: {
      engine: 'Render engine: 2d / webgl / skia',
      width: 'CSS width in px (0 = auto)',
      height: 'CSS height in px (0 = auto)',
      resolution: 'Resolution multiplier (>1 renders at high definition; internal canvas resolution = CSS size times the multiplier)',
    },
  },
  // —— 批次 B（#481 续）——
  'p-checkbox': {
    desc: 'Multi-select',
    notes: [
      'checked is controlled (v-model) + indeterminate half-check + group normalization (v-model:group array)',
      '★Simplification: single-select state uses v-model (checked); the group-array state is held by the parent (enters group selection when modelValue is an array)',
    ],
    props: {
      modelValue: 'Checked state (controlled v-model)',
      indeterminate: 'Indeterminate state (undetermined parent - explicit control)',
      disabled: 'Disabled',
    },
  },
  'p-divider': {
    desc: 'Divider',
    notes: [
      'Horizontal/vertical divider: orientation controls the direction, inset controls the inset (horizontal = top/bottom margins, vertical = left/right margins)',
      'Same source for both ends: div → view; MP safe (border style computation)',
    ],
    props: {
      orientation: 'Direction: horizontal / vertical',
      inset: 'Inset distance in px (horizontal = top/bottom outer margins; vertical = left/right outer margins)',
      color: 'Line color (defaults to the theme variable)',
    },
  },
  'p-draggable': {
    desc: 'Draggable element',
    notes: [
      'Pan recognition based on useGesture (Web Pointer Events); ghost semi-transparent drag ghost + snapToGrid grid snapping + drag/drop emits',
      'Same source for both ends: div → view; recognizer mapping for MP/native ends lands in a later batch (no gesture → element stays static)',
      '★MP safe: a top-level function call bound to a const (useGesture({...})) breaks when compiled to runtime initialization - the call is moved into onMounted (verified pattern)',
    ],
    props: {
      ghost: 'Drag ghost (semi-transparent, follows the pointer)',
      snapToGrid: 'Grid snap step in px (0 = free drag)',
    },
    events: { drag: 'Dragging (gesture.draggable)', drop: 'Drag released' },
  },
  'p-drawer': {
    desc: 'Side drawer',
    notes: [
      'open is controlled (v-model:open ←→ modelValue) + side direction + width + overlay click-to-close',
      'Same source for both ends: div → view; CSS transform slide-in/out (MP safe)',
    ],
    props: {
      modelValue: 'Open state (v-model:open)',
      side: 'Side: left / right',
      width: 'Drawer width in px',
      overlay: 'Overlay (click to close)',
    },
  },
  'p-error-boundary': {
    desc: 'Error fallback',
    notes: [
      'Matrix 10: Vue errorCaptured catches descendant errors (Web); MP ends have no Vue runtime → onErrorCaptured is stripped by the compiler, degrading to a passthrough container (platform limitation noted)',
      'fallback: default copy or the #fallback named slot (slots are a Web capability; MP ends never trigger the error state, so it is not involved)',
    ],
    props: {
      pid: 'Component instance identifier (for debugging/observability/test targeting - D-2 dogfooding contract)',
      disabled: 'Disabled state (interaction disabled + visually de-emphasized; MP native disabled passthrough)',
      ariaLabel: 'Accessibility label (text read by screen readers)',
      fallbackText: 'Fallback copy for load failure/empty state',
    },
  },
  'p-fit': {
    desc: 'Intrinsic sizing',
    notes: [
      'Width is decided by content (fit-content) but never exceeds the container maxRatio (default 80%) - dynamic text/images adapt',
      'Same source for both ends: div → view (compile-time mapping)',
    ],
    props: {
      maxRatio: 'Max ratio of the container (0-1; default 0.8) - prevents dynamic content from overflowing the container',
    },
  },
  // —— 批次 C（#481 续）——
  'p-form': {
    desc: 'Form container',
    notes: [
      'model + rules (fields → validators) → validate() runs aggregated validation + submit event + errors state',
      '★B2 slim form: synchronous validation aggregation (Promise-based validation in a later batch) + horizontal/vertical layout',
      'Dual-source for both targets; MP-safe (no platform APIs)',
    ],
    props: {
      model: 'Form data model (the object being validated)',
      rules: 'Validation rules {field: (value) => string | null} (returns the error message; null = pass)',
      layout: 'Layout: horizontal (side-by-side) / vertical (stacked)',
    },
    events: { submit: 'Form submission' },
  },
  'p-heading': {
    desc: 'Heading',
    notes: [
      'Semantic headings (aligned with h1-h6): level drives the heading level → font size/weight — safe on both targets: div → view; the level is expressed via classes instead of dynamic tags (the MP compiler does not support dynamic tag names)',
    ],
    props: { level: 'Heading level 1-6 (font size decreases with level)' },
  },
  'p-icon': {
    desc: 'Icon',
    notes: [
      'Vector-first: built-in glyph mapping (self-contained unicode, zero assets); name/size/color/spin constraints',
      'Dual-source for both targets: span → text; MP-safe (plain-text glyph + styles)',
    ],
    props: {
      name: "Icon name (built-in glyph table; unknown → '?')",
      size: 'Size (px)',
      color: 'Color',
      spin: 'Rotation animation',
    },
  },
  'p-image': {
    desc: 'Image',
    notes: [
      'Matrix 01 §3: mode cropping (Web object-fit mapping / MP native mode passthrough) + lazy-load (Web loading=lazy / MP lazy-load) + placeholder',
      'Dual-source for both targets: img → image (compile-time mapping); @load/@error event normalization',
      'Note: no computed block bodies (the compiler only supports arrow-expression bodies); mode maps on Web via CSS classes (p-image--<mode>)',
    ],
    props: {
      pid: 'Component instance id (debugging / observation / test targeting -- D-2 dogfooding contract)',
      disabled: 'Disabled state (blocks interaction + de-emphasizes visuals; passes through to the native MP disabled)',
      ariaLabel: 'Accessibility label (text read aloud by screen readers)',
      src: 'Resource URL (network / local / temporary paths)',
      alt: 'Alternative text (image load failure / accessibility)',
      mode: 'Mode / crop method (per-component enums -- see the type column)',
      lazyLoad: 'Lazy loading (loads the resource only when it enters the viewport)',
      placeholder: 'Placeholder hint text',
    },
    events: { load: 'Load completed', error: 'Load / execution failed' },
  },
  'p-inline': {
    desc: 'Inline container',
    notes: [
      'Inline-box semantics (aligned with CSS inline-flex): content lays out in rows; wrap enables line wrapping',
      'Dual-source for both targets: div → view (compile-time mapping); MP-safe (pure class/style computation, no platform APIs)',
    ],
    props: {
      wrap: 'Allow line wrapping (no wrapping by default)',
      gap: 'Spacing between elements (px)',
      justify: 'Main-axis alignment (flex-start/center/end/space-between/space-around)',
      align: 'Cross-axis alignment (flex-start/center/end/stretch)',
    },
  },
  'p-input': {
    desc: 'Input',
    notes: [
      'Matrix 01 §6: value / type / maxlength / placeholder / focus / disabled + @input/@confirm/@focus/@blur',
      'Event contract: :value + @input (payload { value } normalized across targets, replacing v-model -- v-model on MP custom components only covers native input/textarea)',
      'Dual-source for both targets: native input passthrough (tag/passthrough); maxlength ≤ 0 = unlimited (both MP and Web ignore invalid negative values)',
    ],
    props: {
      pid: 'Component instance id (debugging / observation / test targeting -- D-2 dogfooding contract)',
      disabled: 'Disabled state (blocks interaction + de-emphasizes visuals; passes through to the native MP disabled)',
      ariaLabel: 'Accessibility label (text read aloud by screen readers)',
      value: 'Bound value',
      type: 'Type variant',
      maxlength: 'Maximum input length (≤ 0 = unlimited)',
      placeholder: 'Placeholder hint text',
      focus: 'Auto focus',
    },
    events: {
      input: 'Input changes (payload { value } normalized across targets -- v-model on MP custom components only covers native input/textarea, hence the explicit event contract)',
      confirm: 'Keyboard confirm (Enter / done key)',
      focus: 'Gained focus',
      blur: 'Lost focus',
    },
  },
}
