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
 /** 页面级 EN 字段：slug → { desc, notes?, props? }
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
  // —— 批次 D（#481 续）——
  'p-list-view': {
    desc: "Virtual list",
    notes: [
      "Matrix 01 §5: items / item-key / virtual / lazy-mount / buffer-size / item-size estimation",
      "High-performance design: only the visible window is rendered (data slicing + top placeholder), keeping a constant rendered-row count even with tens of thousands of items; scroll guard: setData is skipped when the window has not crossed a row (zero updates for intra-row scrolling)",
      "items changes (pagination / load-more) → watch recomputes the window: standard Vue watch on Web (fully reactive); on MP the compiler watches the props source → WeChat observers",
      "lazy: nothing renders on the first screen, computation happens only at the first scroll (saves the first frame when the list is below the fold / deeply nested); virtual=false: renders everything (saves slicing overhead for small lists)",
      "★B4 event normalization: onScroll uses eventScrollTop (MP e.detail.scrollTop / Web e.target.scrollTop)",
      "★Note: watch callbacks must use a braced body (the compiler only supports => { body }); a virtual window must be paired with scroll-view (Skyline forbids global scrolling)",
    ],
    props: {
      pid: "Component instance identifier (for debugging / observability / test targeting - D-2 dogfooding contract)",
      disabled: "Disabled state (blocks interaction and weakens the visuals; the native disabled is passed through on MP)",
      ariaLabel: "Accessibility label (text read aloud by screen readers)",
      items: "Array of data items",
      itemHeight: "Item height in px (basis of the virtual-window calculation)",
      height: "Height in px",
      bufferSize: "Number of buffer rows beyond the visible area (headroom for smooth scrolling)",
      virtual: "Virtualization toggle (false = full render; saves slicing overhead for small lists)",
      lazy: "Lazy mount (does not render on the first screen; renders on the first scroll / when it first becomes visible)",
    },
  },
  'p-loading': {
    desc: "Loading",
    notes: [
      "Matrix 01 §8: visible + text + spinner (CSS rotation animation); does not auto-close (controlled by the page)",
      "Transition: CSS animation; Worklet custom components flagged v0.6",
    ],
    props: {
      pid: "Component instance identifier (for debugging / observability / test targeting - D-2 dogfooding contract)",
      disabled: "Disabled state (blocks interaction and weakens the visuals; the native disabled is passed through on MP)",
      ariaLabel: "Accessibility label (text read aloud by screen readers)",
      visible: "Whether visible (show/hide is driven by reactive data - zero platform branching)",
      text: "Display text",
    },
  },
  'p-mask': {
    desc: "Mask",
    notes: [
      "Matrix 01 §8 overlay system: visible + close-on-tap + opacity; no animation (animation is choreographed by the overlay components themselves)",
      "Same source for both ends: view + fixed positioning; Skyline fixed support (base library 2.26+; falls back to absolute + a full-screen container when it misbehaves on real devices; v0.6 evaluates a compiler transform)",
    ],
    props: {
      pid: "Component instance identifier (for debugging / observability / test targeting - D-2 dogfooding contract)",
      disabled: "Disabled state (blocks interaction and weakens the visuals; the native disabled is passed through on MP)",
      ariaLabel: "Accessibility label (text read aloud by screen readers)",
      visible: "Whether visible (show/hide is driven by reactive data - zero platform branching)",
      opacity: "Opacity (0-1)",
      closeOnTap: "Whether to auto-close after a tap",
    },
    events: { close: "Close" },
  },
  'p-masonry': {
    desc: "Masonry",
    notes: [
      "CSS columns implementation (col-count/column-gap + break-inside:avoid on children + vertical gap via CSS variables)",
      "Same source for both ends: div → view; MP-safe (degrades to a single-column stack when columns is unsupported - plain but correct, G-22.2)",
      "★Gotcha: do not write v-bind() inside scoped styles (the compileVueSfc style transform does not process it) - gap is injected via CSS variables from the root style",
    ],
    props: { colCount: "Column count (default 2)", gap: "Column and row spacing in px" },
  },
  'p-media': {
    desc: "Unified media entry",
    notes: [
      "Unified entry for image/video/audio/live via kind (eliminates the separate video/audio components)",
      "★B2 Web-first: kind decides the element (img/video/audio with explicit v-if - the MP compiler does not support dynamic tags)",
      "Same source for both ends; no platform API (controls/autoplay/loop/muted are passed through as native attributes)",
    ],
    props: {
      kind: "Media type: image / video / audio / live",
      src: "Resource address",
      poster: "Poster (video/live)",
      controls: "Show the control bar",
      autoplay: "Autoplay",
      loop: "Loop",
      muted: "Muted",
      width: "Width in px (0 = auto)",
      height: "Height in px (0 = auto)",
    },
  },
  'p-modal': {
    desc: "Modal",
    notes: [
      "Single declaration: <p-modal v-model:visible p-adaptive=\"sheet(0,600) | dialog(600,840) | popover(840,∞)\" :anchor=\"triggerRef\">",
      "Viewport width → the form auto-switches (phone: Sheet slides in from the bottom / tablet: Dialog centered / desktop: Popover anchored to anchor - no anchor falls back to centered, 03 §6)",
      "★width override: when > 0, form resolution uses the specified width (to preview / validate / test different window sizes); 0 = follow the viewport (live reflow while dragging the window)",
      "Internal layout uses the p-stack/p-grid flexible primitives (FLD010: hardcoded fixed widths are forbidden); the sheet form automatically applies the bottom safe area (G-09 synergy)",
      "MP: no innerWidth on the logic layer → the form always lands in the first range (sheet as the fallback - the primary phone scenario, decided by the rendering end)",
      "Same semantics as the App-side B3 native containers (UISheet/BottomSheet/SideBarContainer)",
    ],
    props: {
      visible: "Modal visibility (v-model:visible)",
      pAdaptive: "★Form-range declaration: in the template write p-adaptive=\"sheet(0, 600) | dialog(600, 840) | popover(840, ∞)\" (planned API) → the pAdaptive prop",
      anchor: "Anchor to the trigger source for the popover form (an element reference; when omitted → the popover falls back to centered, the 03 §6 fallback chain)",
      width: "Width override for form resolution (0 = follow the viewport; > 0 = force a specified width - to preview / validate / test different window sizes)",
      title: "Title (the header slot takes precedence when present)",
      closable: "Close button in the top-right corner",
      maskClosable: "Close on mask tap",
      maskOpacity: "Mask opacity",
    },
    events: { formChange: "Form field changes" },
  },
  'p-nav': {
    desc: "Navigation bar",
    notes: [
      "Declarative navigation bar: centered title + left/right slots (back / action areas) + transparent mode",
      "Same source for both ends: nav → view; the MP compiler maps it to the native navigation (navigationStyle custom scenarios)",
    ],
    props: { title: "Title text (slot content takes precedence)", transparent: "Transparent mode (blends with the background)" },
  },
  'p-nav-bar': {
    desc: "Navigation bar",
    notes: [
      "Matrix 01 §9: title / back / fixed + left/right slots",
      "★appBar integration flagged v0.6 (Router B5 ⬜); this component is a plain view-level navigation bar",
      "C3: the component never calls routing directly - back only emits, and the page decides the navigation (until api.navigator A8 is implemented)",
    ],
    props: {
      pid: "Component instance identifier (for debugging / observability / test targeting - D-2 dogfooding contract)",
      disabled: "Disabled state (blocks interaction and weakens the visuals; the native disabled is passed through on MP)",
      ariaLabel: "Accessibility label (text read aloud by screen readers)",
      title: "Title",
      back: "Whether to show a back button (only emits the event; navigation is decided by the page - the component never calls routing directly)",
      fixed: "Whether to use fixed positioning (sticky top / sticky bottom)",
    },
    events: { back: "Back button tap (navigation is decided by the page - the component never calls routing directly)" },
  },
  'p-page': {
    desc: "Page root container",
    notes: [
      "The page root is the route component (G-17): title semantics + immersive statusBar + pullRefresh declaration",
      "★B2/B4 thin shell: the content slot is passed through; title/statusBar/pullRefresh are semantic declarations (to be wired up by the host navigation / scroll batches)",
      "Same source for both ends: div → view; MP-safe (no platform API)",
    ],
    props: {
      title: "Page title (semantic declaration of the navigation-bar / document title)",
      statusBar: "Immersive status bar (content extends into the status-bar area)",
      pullRefresh: "Pull-to-refresh (consumed by the page-level scroll integration batches)",
    },
  },
  // —— 批次 E（#481 续）——
  'p-picker': {
    desc: "Native date/time/city picker",
    notes: [
      "mode date/time/region + start/end boundaries",
      "★B2 Web-first: date/time use the native input (type=date/time); region awaits built-in compact administrative-division data (marked partial)",
      "Dual-end single source (input → compile-time mapping); no platform API",
    ],
    props: {
      mode: "Mode: date / time / region",
      modelValue: "Value (date=YYYY-MM-DD; time=HH:mm; region=geolocation/text)",
      min: "Minimum boundary (native min for date/time)",
      max: "Maximum boundary",
    },
  },
  'p-popover': {
    desc: "Bubble popover",
    notes: [
      "trigger click/hover/focus + placement (top/bottom/left/right)",
      "★B2/B4 thin shell: v-model controlled visibility + self-drawn positioning (smart positioning wired in a later batch)",
      "Dual-end single source: div → view; MP-safe (closes on mask tap, avoids document listeners)",
    ],
    props: {
      modelValue: "Visibility (v-model)",
      trigger: "Trigger mode: click / hover / focus (hover/focus wired in later batches - B4 thin shell: click only)",
      placement: "Placement: top / bottom / left / right",
    },
  },
  'p-popup': {
    desc: "Popup layer",
    notes: [
      "Matrix 01 §8: visible + position (bottom/center/top) + close-on-mask + transition animation",
      "Transition: CSS animation (enter auto-plays / leave emits close when finished) - Worklet applyAnimatedStyle marked v0.6",
      "Visibility driven by watch(() => props.visible) (B3 primitive: Web Vue watch / MP observers)",
      "Dual-end single source: view + fixed positioning; Skyline fixed requires base library 2.26+",
    ],
    props: {
      pid: "Component instance id (for debugging/observability/test targeting - D-2 dogfooding contract)",
      disabled: "Disabled state (blocks interaction + dims visuals; native disabled passed through on MP)",
      ariaLabel: "A11y label (text read aloud by screen readers)",
      visible: "Whether visible (visibility driven by reactive data, zero platform branching)",
      position: "Position/placement",
      closeOnMask: "Whether tapping the mask closes it",
      maskOpacity: "Mask opacity (0-1)",
      duration: "Duration (ms)",
    },
    events: { close: "Close" },
  },
  'p-radio': {
    desc: "Radio (single choice)",
    notes: [
      "value is this item's value + group is the currently selected value (held by the parent) → matched item is selected",
      "★B2 simple form: value + group are controlled; on switch emit('update:group', value)",
      "Dual-end single source; MP-safe (no platform API)",
    ],
    props: { value: "Value of this item", group: "Current selected value (held by the parent group)", disabled: "Disabled" },
  },
  'p-rich-text': {
    desc: "Rich text",
    notes: [
      "source HTML/markdown → rendered; Web renders directly with v-html, the MP compiler maps it to a rich-text node",
      "★B2 Web-first: source is passed through to v-html (MP side awaits rich-text node mapping in a later batch)",
      "Dual-end single source: div → view; no platform API",
    ],
    props: { source: "HTML/markdown source", schema: "Render schema (HTML/MARKDOWN - B2 pass-through, to be strictly enforced in later batches)" },
  },
  'p-router-link': {
    desc: "Declarative navigation",
    notes: [
      "to: navigation target (route name or path - createRouterEngineering.push({ name|path }) semantics, E11)",
      "replace: replaces the current page (E12 semantics)",
      "switchTab: switches to a Tab page (E14 semantics)",
      "Behavior: on click, emit('navigate', { to, replace, switchTab }) - the parent responds via createRouterEngineering (#320)",
      "Zero platform dependencies (no router import, no wx/document access - audit compliant); web role=\"link\" accessibility",
      "MP: @click → bindtap; aligned with the existing p-radio defineEmits + emit pipeline",
    ],
    props: {
      to: "Navigation target (route name or path) - createRouterEngineering.push({ name: to | path: to })",
      replace: "Replaces the current page (E12 semantics - push({...to, replace:true}))",
      switchTab: "Switches to a Tab page (E14 semantics - push({...to, switchTab:true}))",
    },
    events: { navigate: '—' },
  },
  'p-safe': {
    desc: "Safe-area avoidance",
    notes: [
      "Only the avoidance direction is declared: Web = env(safe-area-inset-*) (requires viewport-fit=cover) + foldable-screen hinge avoidance",
      "When display-mode is fold/span, content stays clear of the fold area via env(fold-left/fold-width) - bringing a system capability into the framework, principle #10",
      "Thin-shell component: displayMode state bridged from @proteus-vue/fluid (createDeviceEnv + resolveSafeAreaStyle pure logic)",
      "MP: Skyline only partially supports env(); the logic layer has no matchMedia → displayMode is always standard → hinge never applies (left to the renderer to decide)",
      "Same semantics as App-side SafeArea (G-09 safeAreaLayoutGuide/WindowInsets): developers just write <p-safe area=\"top\">",
    ],
    props: {
      area: "Avoidance direction: top / bottom / left / right / horizontal / all (defaults to top)",
      fold: "Foldable-screen hinge avoidance: when display-mode is fold/span, keep clear of the fold area on both sides (off by default)",
      fallback: "Fallback px: when env() is 0 on desktop/notch-less screens, force at least this value (wrapped in max(); 0 = no fallback)",
    },
  },
  'p-scale': {
    desc: "Dynamic font size / density",
    notes: [
      "Declares only the font-size level + density: container font-size = base × level multiplier × global font scaling (var(--proteus-font-scale, 1), injected by the host/system for foldable/tablet density adaptation); children inherit via em and scale along; density → line-height + the --proteus-density-gap spacing token",
      "Pure logic lives in @proteus-vue/fluid scale.ts (buildScaleStyle is unit-testable at the string level); MP-safe: no type annotations",
    ],
    props: {
      level: "Font-size level: 0 small / 1 standard / 2 large / 3 extra large (a11y levels)",
      density: "Density: compact / regular / comfortable (roomy, for a11y)",
      baseSize: "Base font size (px) - children inherit it via em and scale along",
    },
  },
  'p-scroll': {
    desc: "Explicit scroll container",
    notes: [
      "Use only when a scroll semantic is needed (aligned with scroll-view); axis controls the direction, CSS overflow implements Web scrolling",
      "★B2 scope: basic scroll container (paging/refresh/indicator are capability constraints - to be wired in later batches)",
      "Dual-end single source: div → view; Web scrolls via overflow",
    ],
    props: {
      axis: "Scroll axis: x horizontal / y vertical / both",
      paging: "Paging snap (capability constraint - B2 declaration only)",
      refresh: "Pull-to-refresh (capability constraint - B2 declaration only)",
      indicator: "Scroll indicator",
    },
  },
  // —— 批次 F（#481 续）——
  'p-scroll-view': {
    desc: "Scroll container",
    notes: [
      "Matrix 01 §4: Skyline must-have (page-level scrolling, global scroll disabled); scroll-x/y, scroll-top/left, refresher, lower-threshold",
      "Performance constraint (very-large-count reuse scenarios): thin wrapper -- no component-layer logic introduced, events passed through, no throttling/no state",
    ],
    props: {
      pid: "Component instance identifier (for debugging/observability/test targeting -- the D-2 dogfooding contract)",
      disabled: "Disabled state (interaction disabled + dimmed visuals; MP native disabled is passed through)",
      ariaLabel: "Accessibility label (text read aloud by screen readers)",
      scrollX: "Allows horizontal scrolling",
      scrollY: "Allows vertical scrolling",
      scrollTop: "Vertical scroll position (px)",
      scrollLeft: "Horizontal scroll position (px)",
      refresherEnabled: "Enables the custom pull-down refresher",
      lowerThreshold: "Distance in px from the bottom that triggers the scrolltolower event",
    },
    events: {
      scroll: "Scrolling (eventScrollTop normalization: MP e.detail.scrollTop / Web e.target.scrollTop)",
      scrolltolower: "Scrolled to the bottom (triggered by lowerThreshold)",
      refresherrefresh: "Custom pull-down refresher triggered",
    },
  },
  'p-scrollable': {
    desc: "Scrollable area",
    notes: [
      "Scroll container + bounce (elastic) + refresh (emit on pull-down refresher) + loadMore (emit load when scrolled to the bottom)",
      "Web implementation: overflow scrolling + scroll event detection (the refresher pull will be wired to native gestures in a later batch)",
      "Same source for both ends: div → view; refresh/bounce on MP/native are handled by the platform scroll component",
    ],
    props: {
      bounce: "Elastic scrolling (iOS rubber-band)",
      refresh: "Pull-down refresher (semantic declaration -- native implementation lands in a later batch)",
      loadMore: "Load more when scrolled to the bottom",
      loading: "Loading state (footer text toggling)",
      height: "Visible height in px (0 = inherit/adapt)",
    },
    events: { 'load-more': "Load more (pagination on reaching the bottom)", refresh: "Refresh triggered" },
  },
  'p-segment': {
    desc: "Segmented control",
    notes: [
      "options[{label,value?}] + controlled active (v-model:active) + select emit",
      "Same source for both ends: div → view; MP-safe (v-for + method to read fields -- S3 p-tabbar convention)",
    ],
    props: { options: "Segment items [{label,value?}?] (defaults to label when value is omitted)", active: "The value of the currently active item" },
    events: { select: "An item is selected" },
  },
  'p-select': {
    desc: "Selector / overlay type",
    notes: [
      "options[{value,label}] + multiple + searchable + cascader (B2 base: single/multi-select panel; searchable/cascader in later batches)",
      "★B2 Web-first: self-drawn dropdown panel (div); mapping to picker/overlay on the MP side comes in a later batch",
      "Same source for both ends; no platform APIs (document-level listeners are forbidden -- close via mask click, aligning with the p-drawer pattern)",
    ],
    props: {
      options: "Options [{value,label}?]",
      modelValue: "Single-select value or an array of multi-select values",
      multiple: "Multi-select mode",
      placeholder: "Placeholder text",
      searchable: "Search (B2 placeholder declaration -- implemented in a later batch)",
      cascader: "Cascade (B2 placeholder declaration -- implemented in a later batch)",
    },
  },
  'p-skeleton': {
    desc: "Skeleton",
    notes: [
      "Matrix 10 business component: bind the loading state (:visible=\"loading\"), no built-in timer (C4)",
      "lines is an array prop (width percentages) to work around the unavailable range-form v-for on MP (wx:for requires an array)",
      "Shimmer animation goes through CSS keyframes (both ends)",
    ],
    props: {
      pid: "Component instance identifier (for debugging/observability/test targeting -- the D-2 dogfooding contract)",
      disabled: "Disabled state (interaction disabled + dimmed visuals; MP native disabled is passed through)",
      ariaLabel: "Accessibility label (text read aloud by screen readers)",
      visible: "Whether visible (show/hide driven by reactive data, zero platform branches)",
      avatar: "Whether the header is avatar-shaped (skeleton)",
      lines: "Row count (number of skeleton placeholder rows)",
    },
  },
  'p-slider': {
    desc: "Slider",
    notes: [
      "min/max/step constraints + v-model (modelValue ←→ update:modelValue)",
      "Same source for both ends: Web input[type=range]; the MP compiler maps to the built-in slider in a later batch",
    ],
    props: {
      modelValue: "Two-way bound value (v-model; for MP custom component v-model restrictions, see the useInput event contract)",
      min: "Minimum value",
      max: "Maximum value",
      step: "Step",
    },
  },
  'p-spacer': {
    desc: "Spacer",
    notes: [
      "Flexibly fills the remaining space (equivalent to flex:1): pushes the layout open so subsequent elements sit at the edge; grow/shrink adjustable",
      "Same source for both ends: div → view; MP-safe (pure inline styles)",
    ],
    props: { grow: "Flex grow ratio (default 1 -- fills the remaining space)", shrink: "Shrink ratio (default 1)", minSize: "Own size lower bound in px (keeps it visible/tappable)" },
  },
  'p-svg': {
    desc: "SVG graphics",
    notes: [
      "path (SVG path d data) + viewbox rendering; vector-first (no bitmaps)",
      "★B2 Web-first: inline svg element (Skia vector mapping on the MP side in a later batch)",
    ],
    props: {
      path: "SVG path d data (no fill semantics -- follows currentColor)",
      viewbox: "View box \"x y w h\" (defaults to 0 0 24 24)",
      size: "Size in px",
      color: "Color",
    },
  },
  'p-switch': {
    desc: "Switch",
    notes: [
      "checked controlled v-model (modelValue ←→ update:modelValue); taps disabled while loading",
      "Same source for both ends: div → view (Web self-draws the switch; the MP compiler maps to the built-in switch in a later batch)",
    ],
    props: { modelValue: "Two-way bound value (v-model; for MP custom component v-model restrictions, see the useInput event contract)", loading: "Loading (switching disabled)" },
  },
  // —— 批次 G（#481 续）——
  'p-tabbar': {
    desc: "Bottom tab bar",
    notes: [
      "tabs ({key,label,badge?,icon?}[]) plus controlled active (v-model:active) plus select emit",
      "Dual-end same-source: nav → view; item fields are read via methods (MP-safe: avoids the generic array typing TS18046)",
    ],
    props: { tabs: "Tab items array ({key,label,badge?,icon?})", active: "Key of the currently active item" },
    events: { select: "An item is selected" },
  },
  'p-text': {
    desc: "Text",
    notes: [
      "Matrix 01 §2: selectable mapping — Web user-select: text (.is-selectable class); the selectable attribute of MP native text",
      "Dual-end same-source: span → text (compile-time mapping)",
    ],
    props: {
      pid: "Component instance id (debugging/observation/test targeting — D-2 dogfooding contract)",
      disabled: "Disabled state (blocks interaction and dims the visuals; MP native disabled is passed through)",
      ariaLabel: "Accessibility label (the text read aloud by a screen reader)",
      selectable: "Whether the text is selectable",
    },
  },
  'p-textarea': {
    desc: "Multiline textarea",
    notes: [
      "Matrix 01 §6: value / maxlength / placeholder / focus / disabled + @input/@confirm/@focus/@blur",
      "Event contract: :value + @input (payload { value } normalized cross-end, replacing v-model)",
      "Dual-end same-source: textarea native passthrough (tag/passthrough); MP textarea natively supports bindconfirm",
    ],
    props: {
      pid: "Component instance id (debugging/observation/test targeting — D-2 dogfooding contract)",
      disabled: "Disabled state (blocks interaction and dims the visuals; MP native disabled is passed through)",
      ariaLabel: "Accessibility label (the text read aloud by a screen reader)",
      value: "Bound value",
      maxlength: "Maximum input length (<= 0 = unlimited)",
      placeholder: "Placeholder hint text",
      focus: "Auto focus",
    },
    events: {
      input: "Input changes (payload { value } normalized cross-end — MP custom-component v-model only covers native input/textarea, hence the explicit event contract)",
      confirm: "Keyboard confirm (Enter/Done key)",
      focus: "Gains focus",
      blur: "Loses focus",
    },
  },
  'p-toast': {
    desc: "Toast",
    notes: [
      "Matrix 01 §8: text plus duration auto-close (0 = do not auto-close) plus enter fade-in; driven by visible (B3 primitive)",
      "Transition: CSS animation; Worklet custom component (bypassing the native showToast limitations) marked v0.6",
    ],
    props: {
      pid: "Component instance id (debugging/observation/test targeting — D-2 dogfooding contract)",
      disabled: "Disabled state (blocks interaction and dims the visuals; MP native disabled is passed through)",
      ariaLabel: "Accessibility label (the text read aloud by a screen reader)",
      visible: "Whether it is visible (visibility driven by reactive data, zero platform branching)",
      text: "Text to display",
      duration: "Duration (ms)",
      position: "Position",
    },
    events: { close: "Close" },
  },
  'p-toolbar': {
    desc: "Toolbar overflow fold",
    notes: [
      "Navigation items exceeding the container → overflow items are folded into 'More' (an expandable panel); calcVisibleToolbarItems is a pure computation (fluid package)",
      "Resolved against the container rather than the viewport (createContainerQuery); when the container is unmeasurable (MP has no ResizeObserver) → no folding, show all (iron rule G-22.2)",
      "★In-vehicle: drive-mode / prefers-reduced-motion → no-motion class (motion disabled via CSS)",
    ],
    props: {
      items: "Navigation items ({ key, label })",
      itemWidth: "Single navigation item width (px; used for overflow calculation)",
      moreWidth: "'More' button width (px)",
      moreLabel: "'More' label text",
    },
    events: { select: "An item is selected" },
  },
  'p-transition': {
    desc: "Transition (show/hide) — the semantics surface of CSS transition",
    notes: [
      "name: the transition preset (fade/slide-up/slide-down/slide-left/slide-right/zoom; CSS class p-transition-{name})",
      "mode: in (enter) / out (exit) / both (both by default)",
      "duration: transition duration in ms (300 by default)",
      "visible: the show/hide switch — when false with mode out/both → the p-transition-hidden class is added to trigger the exit transition",
      "★Cross-end: Web uses native CSS transition; Skyline supports transition — the same class toggle (plain but correct, G-22.2)",
      "Pure CSS with no JS dependency; MP-compiler-safe — :class uses a single computed expression body (following the same convention as the p-safe safeClass)",
    ],
    props: {
      name: "Transition preset name (fade/slide-up/slide-down/slide-left/slide-right/zoom)",
      mode: "Transition direction: in (enter only) / out (exit only) / both (both directions)",
      duration: "Transition duration (ms)",
      visible: "Show/hide switch (controlled by the parent)",
    },
  },
  'p-virtual-list': {
    desc: "Virtualized long list",
    notes: [
      "Thin forwarding layer (same pattern as virtual-list): API surface items/itemHeight/height → single p-list-view implementation",
      "Semantic naming aligned with G-32 (p-virtual-list); legacy tag virtual-list kept for compatibility",
    ],
    props: {
      items: "List data (the array of items to render)",
      itemHeight: "Fixed row height in px (prerequisite for virtualization)",
      height: "Height of the visible viewport in px",
    },
  },
  'p-zone': {
    desc: "Container-breakpoint zone",
    notes: [
      "Container breakpoints (sm/md/lg/xl, based on container width rather than the viewport) → renders the corresponding named slot (sm/md/lg/xl; the xl slot serves as the fallback by default)",
      "Thin shell referencing @proteus-vue/fluid (createContainerQuery)",
      "★MP-safe: generic ref fallback (no ResizeObserver on MP → always the sm slot)",
    ],
    props: { designWidth: "Design-spec width (baseline for deriving container breakpoints; 375 by default)" },
  },
}

// ════════════ capabilities EN（★#481 续：能力分区，CAP_EN 页面级字段表） ════════════

/** 能力页共享文案 EN（生成器镜像 zh 模板——标题/表头/图例/铁律/降级语义） */
export const CAP_SHARED_EN = {
  callout: (id, semantic, ret) =>
    `> Capability primitive ${id} · \`${semantic}\` · returns \`${ret}\` · **Hook implemented** (API ready — target bridges in the table below)`,
  hSignature: '## Signature',
  hParams: '## Parameters',
  hReturns: '## Returns',
  hErrors: '## Error codes',
  hCompat: '## Compat rollout',
  hUsage: '## Usage',
  paramCols: '| Parameter | Type | Required | Doc |',
  propCols: '| Property | Type | Required | Doc |',
  retCols: '| Property | Type | Doc |',
  errCols: '| code | Doc |',
  nestedPropsTitle: (name) => `#### Properties of \`${name}\``,
  paramsIntro: '',
  returnsIntro: '`Promise<CapResult<T>>` — iron rule: no callbacks, no try/catch duty; branch on `res.ok`:',
  retOk: 'Succeeded `true` / failed `false`',
  retDataGeneric: 'Success payload — generic, inferred from the response body (e.g. JSON auto-deserialized)',
  retDataVoid: 'No payload on success',
  retError: 'Present on failure: `code` (machine code) / `message` (human-readable reason) / `cause` (original exception)',
  unsupportedNote: '> Platform unsupported → the `*.unsupported` family; business branches on `code`, no try/catch needed.',
  directReturn: (t) => `Returns \`${t}\` (synchronous handle/state object).`,
  dataPropsTitle: (name) => `#### Properties of the \`data\` (\`${name}\`) object`,
  directPropsTitle: (t) => `#### Properties of \`${t}\``,
  noDataGeneric: '—',
  capLegend:
    '> Status scale: ✅ target shipped & this capability usable · ⚠️ target shipped but bridge missing → explicit `Err` degradation · 🟡 prototype mapping — capability bridge not wired · ⬜ target not started. Target architecture matrix → [Ends & maturity](/docs/framework/ends-matrix).',
  ironRule: '> Iron rule: every capability primitive returns `Result<T>` (no callbacks / no global objects); platform unsupported → explicit `Err` degradation, zero platform branches in business code.',
  // 兼容进度行逐端注记（镜像 zh switch）
  endNote: {
    mp: (missing, mpEquiv) =>
      missing.length
        ? `wx bridge missing ${missing.join('/')} → explicit Err degradation`
        : `wx bridge → ${mpEquiv}`,
    webNoRefs: 'webBridge platform bridge (injected by default when wx is absent)',
    webMissing: (missing) => `webBridge missing ${missing.join('/')} → explicit Err degradation (no direct platform API)`,
    webOk: 'webBridge implementation (direct platform API)',
    headless: 'mock bridge injected (testing / SSR tier)',
    flutter: 'same JS logic layer — capability bridge not wired',
    'quick-app': 'target not started',
    prototype: 'prototype mapping — capability bridge not wired',
  },
}

/** 用法示例 EN 覆盖（仅 zh 手写示例的 hook 需要；其余由生成器默认 EN 分支模板生成） */
export const CAP_USAGE_EN = {
  useFetch: [
    "const res = await useFetch<{ id: number; name: string }>('/api/user/1')",
    '',
    'if (res.ok) {',
    '  console.log(res.data.name) // response auto-deserialized from JSON',
    "} else if (res.error.code === 'fetch.unsupported') {",
    '  // bridge has no request → degradation path',
    '}',
  ],
  direct: (api, handle) => [
    `const ${handle} = ${api}`,
    `// ${handle} is a synchronous ${'handle'} — property/method structure in the Returns table (no await, no res.ok)`,
  ],
  generic: (call) => [
    `const res = await ${call}`,
    '',
    'if (res.ok) {',
    '  console.log(res.data)',
    "} else if (res.error.code.endsWith('.unsupported')) {",
    '  // platform unsupported → degradation path',
    '}',
  ],
}

/** 能力类别名 EN（总览/分区标题用；与侧栏 GROUP_NAME 一致） */
export const CAP_CAT_EN = {
  '网络与通信': 'Network & Communication',
  '设备与系统': 'Device & System',
  '存储与文件': 'Storage & Files',
  '位置与地图': 'Location & Maps',
  '媒体与扫码': 'Media & Scanning',
  '账号与支付': 'Account & Payment',
  '通知与分享': 'Notifications & Sharing',
  '应用与生命周期': 'App & Lifecycle',
  '可观测与调试': 'Observability & Debugging',
  '其他': 'Other',
}

export const CAP_OVERVIEW_EN = {
  title: 'Capabilities overview',
  group: '总览',
  order: 0,
  intro: (count) =>
    `> ${count} capability primitives — SSOT = \`PRIMITIVE_CATALOG\` (capability kind) + \`CapabilityHooks\` interface. **All hooks implemented** (API ready — target bridges/degradation in each page's compat table).`,
  cols: '| # | Capability | API | Returns | Mini Program equivalent |',
}

/**
 * 能力页页面级 EN 字段：slug → { desc, params?, dataProps?, directProps?, errors?, statusCallout? }
 *  - desc: H1 下说明行（zh hook JSDoc 首行）
 *  - params: { 参数名: 说明 } + 嵌套接口属性用 `${参数名}.${属性名}` 扁平键
 *  - dataProps: 具名 data 类型（如非 T 泛型）的属性行说明 { 属性名 }
 *  - directProps: 同步句柄类型属性行说明 { 属性名 }
 *  - errors: { 错误码: 说明 }
 *  - statusCallout?: 覆盖默认 callout（如状态不是「Hook implemented」）
 */
export const CAP_EN = {
  // —— 网络与通信（★#481 首批）——
  fetch: {
    desc: '★ G-32 B3 (continued): communication / permission / storage — a missing bridge → Err instead of throwing (G-32.3 degradation semantics)',
    params: {
      url: 'Target URL (HTTPS)',
      config: 'useFetch configuration (aligned with RequestConfig high-frequency fields)',
      'config.method': 'HTTP method (defaults to GET)',
      'config.data': 'Request body (POST/PUT; objects are JSON-serialized automatically)',
      'config.params': 'URL query parameters (appended to the query string)',
      'config.headers': 'Custom request headers',
      'config.timeout': 'Timeout in ms (timeout → Err)',
    },
    errors: { 'fetch.unsupported': 'The bridge does not provide request (useFetch unavailable)' },
  },
  websocket: {
    desc: 'useWebSocket: WebSocket connection handle (wx.connectSocket / web WebSocket)',
    params: { url: 'Target URL (HTTPS)', protocols: 'WebSocket subprotocols (optional)' },
    errors: {
      'websocket.unsupported': 'The bridge does not provide connectWebSocket (useWebSocket unavailable)',
      'websocket.failed': 'WebSocket construction failed',
    },
  },
  upload: {
    desc: 'useUpload: upload files (wx.uploadFile / web fetch FormData)',
    params: {
      options: 'C29 upload options (wx.uploadFile / web fetch FormData)',
      onProgress: 'Progress callback (0-100; optional)',
      'options.url': 'Upload target URL (HTTPS)',
      'options.filePath': 'wx temporary file path (produced by wx.chooseMedia/chooseImage, etc.)',
      'options.file': 'Web file object',
      'options.name': "Form field name (defaults to 'file')",
      'options.formData': 'Additional form fields',
      'options.headers': 'Custom request headers',
      'options.timeout': 'Timeout in ms (timeout → Err)',
    },
    dataProps: {
      status: 'HTTP status code',
      data: 'Response body (text/JSON is decided by the server)',
      progress: 'Progress (0-100, if the platform supports onProgressUpdate)',
    },
    errors: { 'upload.unsupported': 'The bridge does not provide upload (useUpload unavailable)' },
  },
  download: {
    desc: 'useDownload: download files (wx.downloadFile / web fetch blob)',
    params: {
      url: 'Target URL (HTTPS)',
      options: 'C30 download options',
      onProgress: 'Progress callback (0-100; optional)',
      'options.headers': 'Custom request headers',
      'options.timeout': 'Timeout in ms (timeout → Err)',
      'options.responseType': 'Return data type: blob (web) / path (wx tempFilePath) / text / json',
    },
    dataProps: {
      status: 'HTTP status code',
      data: 'Response body (its form is determined by responseType)',
      path: 'wx tempFilePath (responseType=path)',
      progress: 'Progress (0-100)',
    },
    errors: { 'download.unsupported': 'The bridge does not provide download (useDownload unavailable)' },
  },
  'socket-task': {
    desc: 'useSocketTask: low-level SocketTask handle (wx.connectSocket → SocketTask / web WebSocket)',
    params: { url: 'Target URL (HTTPS)' },
    errors: { 'socket-task.unsupported': 'Bridge does not provide createSocketTask (useSocketTask unavailable)' },
  },
  'data-channel': {
    desc: 'useDataChannel: data channel (live/real-time — bridged by the host; honest Err fallback by default)',
    params: {
      options: 'C31 data channel (live/real-time — bridged by the host; honest Err fallback by default)',
      'options.channelId': 'Channel identifier (business-defined; used for cross-end routing)',
    },
    errors: { 'data-channel.unsupported': 'Bridge does not provide openDataChannel (useDataChannel unavailable)' },
  },
  bluetooth: {
    desc: 'useBluetooth: Bluetooth status (wx.openBluetoothAdapter / web feature detection)',
    dataProps: {
      supported: 'Whether the platform supports Bluetooth',
      available: 'The adapter is open (available)',
      devices: 'Names of paired/discovered devices (wx.getBluetoothDevices; on the web, listed only after a user gesture)',
    },
    errors: { 'bluetooth.unsupported': 'Bridge does not provide getBluetooth (useBluetooth unavailable)' },
  },
  nfc: {
    desc: 'useNFC: NFC status (wx.getHCEState / web NDEFReader feature detection)',
    dataProps: {
      supported: 'Whether the platform supports NFC',
      available: 'NFC is currently available (enabled)',
    },
    errors: { 'nfc.unsupported': 'Bridge does not provide getNfc (useNFC unavailable)' },
  },
  // —— 设备与系统（#481 批次 ②）——
  device: {
    desc: 'Device (wx.getSystemInfo / navigator.userAgent / mock)',
    dataProps: {
      platform: 'Platform identifier (ios / android / devtools / desktop …)',
      model: 'Device model (e.g. iPhone 15 Pro)',
      os: 'Operating system name (iOS / Android / Windows / macOS)',
      version: 'System version (e.g. 17.4)',
      browser: 'Browser/container name (present on the web; omitted in Mini Programs)',
    },
  },
  screen: {
    desc: 'Screen (wx.getSystemInfo / window.screen + matchMedia / mock)',
    dataProps: {
      width: 'Screen width (px, CSS pixels)',
      height: 'Screen height (px, CSS pixels)',
      dpr: 'Device pixel ratio (physical pixels / CSS pixels)',
      orientation: 'Current orientation',
    },
    errors: { 'screen.unsupported': 'window.screen does not exist (SSR)' },
  },
  battery: {
    desc: 'Battery (wx.getBatteryInfo / navigator.getBattery / mock)',
    dataProps: {
      level: 'Battery level (0-1, float)',
      charging: 'Whether charging is in progress',
      chargingTime: 'Seconds needed to fully charge (only present while charging; omitted when unsupported)',
      dischargingTime: 'Remaining usable seconds (only present while discharging; omitted when unsupported)',
    },
    errors: { 'battery.unsupported': 'navigator.getBattery is not supported', 'battery.failed': 'getBattery returned empty' },
  },
  orientation: {
    desc: 'Screen orientation (wx.onDeviceOrientationChange / matchMedia / mock)',
    dataProps: { type: 'Screen orientation', angle: 'Rotation angle (0/90/180/-90 degrees)' },
  },
  brightness: {
    desc: 'useBrightness: read the current brightness (0-1)',
    errors: { 'brightness.unsupported': 'The bridge does not provide getBrightness (useBrightness unavailable)' },
  },
  sensor: {
    desc: 'useSensor: one-shot sensor read (accelerometer/compass/gyroscope)',
    params: { kind: 'Sensor type (accelerometer / compass / gyroscope)' },
    dataProps: {
      kind: 'Sensor type (echoes the requested kind)',
      x: 'X-axis acceleration/component (accelerometer/gyroscope)',
      y: 'Y-axis acceleration/component',
      z: 'Z-axis acceleration/component',
      heading: 'Compass heading (0-360°, relative to true north; compass only)',
      timestamp: 'Sample timestamp (ms)',
    },
    errors: { 'sensor.unsupported': 'Bridge does not provide readSensor (useSensor unavailable)', 'sensor.timeout': 'Sensor event timed out (requires device support / user permission)' },
  },
  vibrate: {
    desc: 'Vibration (wx.vibrateShort / navigator.vibrate / mock)',
    params: { durationMs: 'Vibration duration (ms)' },
    errors: { 'vibrate.unsupported': 'navigator.vibrate is not supported' },
  },
  network: {
    desc: 'Network (wx.getNetworkType / navigator.onLine / mock)',
    dataProps: {
      online: 'Whether the device is online (normalized from navigator.onLine / wx.getNetworkType)',
      type: 'Network type (web has no finer granularity → unknown; offline → none)',
    },
  },
  keyboard: {
    desc: 'useKeyboard: keyboard lifecycle handle (wx.onKeyboardHeightChange / web visualViewport)',
    errors: { 'keyboard.unsupported': 'Bridge does not provide getKeyboard (useKeyboard unavailable)' },
  },
  clipboard: {
    desc: 'Clipboard (wx.getClipboardData / navigator.clipboard.readText / mock)',
    errors: {
      'clipboard.read.unsupported': 'navigator.clipboard.readText is not supported',
      'clipboard.read.failed': 'Clipboard read was rejected (requires permission / focus)',
    },
  },
  // —— 存储与文件 + 位置与地图（#481 批次 ③）——
  storage: {
    desc: 'useStorage: storage handle (see createReactiveStorage for the reactive enhancement)',
    errors: { 'storage.unsupported': 'Bridge does not provide getStorage (useStorage unavailable)' },
  },
  cookie: {
    desc: 'useCookie: cookie jar (web document.cookie / wx storage fallback)',
    errors: { 'cookie.unsupported': 'Bridge does not provide getCookieJar (useCookie unavailable)' },
  },
  'file-system': {
    desc: 'useFileSystem: file system handle (wx.getFileSystemManager / web in-memory fallback)',
    errors: { 'file-system.unsupported': 'Bridge does not provide getFileSystem (useFileSystem unavailable)' },
  },
  archive: {
    desc: 'useArchive: compress files (wx.compressFile; web → Err)',
    params: {
      options: 'C44 compression options (wx.compressFile; web has no standard API → degrades to undefined)',
      'options.src': 'source file path',
      'options.dest': 'destination path (defaults to the same directory as the source)',
      'options.quality': 'image compression quality 0-100 (supported by wx)',
    },
    errors: { 'archive.unsupported': 'Bridge does not provide compressFile (useArchive unavailable)', 'archive.failed': 'wx.compressFile failed' },
  },
  location: {
    desc: 'Location (wx.getLocation / navigator.geolocation / mock)',
    dataProps: {
      latitude: 'latitude (WGS84, in floating-point degrees)',
      longitude: 'longitude (WGS84, in floating-point degrees)',
      accuracy: 'positioning accuracy (radius in meters; smaller means more accurate)',
      altitude: 'altitude (meters; omitted when unsupported by the platform)',
      speed: 'speed (meters/second; omitted when unsupported by the platform)',
    },
    errors: { 'location.unsupported': 'geolocation not supported', 'location.failed': 'geolocation failed' },
  },
  map: {
    desc: 'useMap: map context handle (wx.createMapContext / web host integration; → Err when none is available)',
    params: { id: 'map instance ID (distinguishes instances in multi-map scenarios)' },
    errors: { 'map.unsupported': 'Bridge does not provide createMap (useMap unavailable)', 'map.failed': 'wx map region retrieval failed' },
  },
  // —— 媒体与扫码 + 账号与支付（#481 批次 ④⑤）——
  camera: {
    desc: 'useCamera: camera access (wx.authorize / web getUserMedia)',
    dataProps: { kind: 'Media device type', supported: 'Platform capability/device is present', granted: 'User has granted access' },
    errors: { 'camera.unsupported': 'The bridge does not provide getCamera (useCamera unavailable)' },
  },
  microphone: {
    desc: 'useMicrophone: microphone access (wx.authorize / web getUserMedia)',
    dataProps: { kind: 'Media device type', supported: 'Platform capability/device is present', granted: 'User has granted access' },
    errors: { 'microphone.unsupported': 'The bridge does not provide getMicrophone (useMicrophone unavailable)' },
  },
  live: {
    desc: 'useLive: live room (wx live component form / host bridge — Err by default)',
    params: {
      options: 'C49 live room (wx live component form / host bridge — Err by default)',
      'options.roomId': 'Live room ID',
      'options.mode': 'Stream mode',
    },
    errors: { 'live.unsupported': 'The bridge does not provide joinLiveRoom (useLive unavailable)' },
  },
  'qr-code': {
    desc: 'useQRCode: scan a QR code (wx.scanCode; web needs a camera capture source → Err fallback)',
    errors: { 'qr-code.unsupported': 'The bridge does not provide scanQR (useQRCode unavailable)', 'qr-code.failed': 'wx.scanCode failed' },
  },
  login: {
    desc: 'useLogin: login (wx.login → code / integrate a third-party provider)',
    params: { provider: 'Service provider identifier (wechat / web / host-defined)' },
    dataProps: {
      provider: 'Login channel (wechat / host-provider …)',
      code: 'Login credential (wx code; the server exchanges it for a session)',
      token: 'Token (when a third-party provider issues the token directly)',
    },
    errors: { 'login.unsupported': 'The bridge does not provide login (useLogin unavailable)', 'login.failed': 'wx.login failed' },
  },
  auth: {
    desc: 'useAuth: authentication state composition (token custody + login/logout + subscription) — business code never reads the raw token (iron rule 2)',
    directProps: {
      token: 'Current token (null when not logged in; reactive — bind directly in the UI)',
      isAuthenticated: 'Whether the user is logged in (true when the token is non-empty)',
    },
  },
  biometric: {
    desc: 'useBiometric: biometric support detection',
    errors: {
      'biometric.unsupported': 'The bridge does not provide checkBiometricSupport (useBiometric unavailable)',
      'biometric.failed': 'WebAuthn authentication failed / cancelled by the user',
    },
  },
  'face-id': {
    desc: 'useFaceID: facial recognition authentication (wx startSoterAuthentication facial / web WebAuthn)',
    params: { prompt: 'Authentication prompt text (shown by the native system UI)' },
    errors: { 'face-id.unsupported': 'The bridge does not provide authenticateFaceID (useFaceID unavailable)' },
  },
  permission: {
    desc: 'usePermission: Permission status (web Permissions API)',
    params: { name: 'Permission name (standard web Permissions API name)' },
    dataProps: {
      permission: 'Permission name (web Permissions API name, e.g. geolocation / camera)',
      state: 'Authorization state (prompt = not yet asked)',
    },
    errors: { 'permission.unsupported': 'Bridge does not provide getPermission (usePermission unavailable)' },
  },
  payment: {
    desc: 'usePayment: Launch payment (wx.requestPayment fields)',
    params: {
      config: 'C40 payment parameters (aligned with wx.requestPayment core fields — issued by the server after the order is placed)',
      'config.timeStamp': 'Timestamp (seconds-level string, generated by the server)',
      'config.nonceStr': 'Random string (server-generated, within 32 characters)',
      'config.package': 'prepay_id returned by the unified order API (format paySign=...)',
      'config.signType': 'Signature method (defaults to MD5/platform default when omitted; RSA recommended)',
      'config.paySign': 'Signature (computed by the server with the merchant private key)',
    },
    dataProps: {
      provider: 'Payment channel (wechat / alipay / host … — tagged by the host bridge)',
      transactionId: 'Transaction ID (returned by the channel; omitted when unsupported)',
    },
    errors: { 'payment.unsupported': 'Bridge does not provide requestPayment (usePayment unavailable)', 'payment.failed': 'wx.requestPayment failed' },
  },
  'in-app-purchase': {
    desc: 'useInAppPurchase: In-app purchase (wx — no public API → honest Err degradation)',
    params: { productId: 'In-app purchase product ID (registered in the app store)' },
    dataProps: {
      productId: 'In-app purchase product ID (registered in the app store)',
      transactionId: 'Transaction ID (returned by the store)',
      state: 'Transaction state (purchased = new purchase / restored = restored purchase)',
    },
    errors: { 'in-app-purchase.unsupported': 'Bridge does not provide requestIAP (useInAppPurchase unavailable)' },
  },
  // —— 通知与分享（#481 批次 ⑤）——
  notification: {
    desc: 'useNotification: Message subscription authorization (wx.requestSubscribeMessage / web Notification)',
    params: { templateId: 'Subscription message template ID (registered on the Official Platform)' },
    dataProps: {
      templateId: 'Template ID (for wx, must first be applied for on the Official Platform)',
      granted: 'Whether authorization was granted (wx: the status of this template in tmplIds; web: Notification.requestPermission granted)',
      status: "Raw status text (wx: 'accept'/'reject'/'ban'; web: 'granted'/'denied'/'default')",
    },
    errors: { 'notification.unsupported': 'Bridge does not provide subscribeMessage (useNotification unavailable)' },
  },
  share: {
    desc: 'Sharing (wx.shareAppMessage / navigator.share / mock)',
    params: {
      options: 'Options object (fields in the table below)',
      'options.title': 'Share title',
      'options.text': 'Share text (used by web navigator.share; omitted on Mini Program)',
      'options.url': 'Share link (must be an HTTPS URL on web)',
    },
    errors: { 'share.unsupported': 'navigator.share is not supported (requires HTTPS + a user gesture)' },
  },
  shortcut: {
    desc: 'useShortcut: Add a desktop shortcut (wx.addToDesktop; web → Err)',
    errors: { 'shortcut.unsupported': 'Bridge does not provide addShortcut (useShortcut unavailable)', 'shortcut.failed': 'wx.addToDesktop failed' },
  },
  sms: {
    desc: 'useSMS: Send SMS (wx restricted — no open API / web has no standard → Err)',
    params: { phone: "Recipient's phone number", message: 'Message content text' },
    errors: { 'sms.unsupported': 'Bridge does not provide sendSMS (useSMS unavailable)' },
  },
  contact: {
    desc: 'useContact: Contact picking (wx.chooseContact; web has no standard → Err degradation)',
    errors: { 'contact.unsupported': 'Bridge does not provide chooseContact (useContact unavailable)', 'contact.failed': 'wx.chooseContact failed' },
  },
  'phone-call': {
    desc: 'usePhoneCall: Make a phone call',
    params: { phoneNumber: 'Phone number' },
    errors: { 'phone-call.unsupported': 'Bridge does not provide makePhoneCall (usePhoneCall unavailable)', 'phone-call.failed': 'wx.makePhoneCall failed' },
  },
  calendar: {
    desc: 'useCalendar: Add a calendar event (wx.addPhoneCalendar; web → Err)',
    params: {
      event: 'C20 calendar event (wx.addPhoneCalendar / web has no standard → degrades to undefined)',
      'event.title': 'Calendar event title',
      'event.startTime': 'Start timestamp (ms)',
      'event.endTime': 'End timestamp (ms)',
      'event.alarms': 'Advance reminders (minutes)',
      'event.location': 'Location',
      'event.description': 'Notes/description',
    },
    errors: { 'calendar.unsupported': 'Bridge does not provide addCalendarEvent (useCalendar unavailable)', 'calendar.failed': 'wx.addPhoneCalendar failed' },
  },
  // —— 应用与生命周期 + 可观测与调试（#481 批次 ⑥）——
  'app-lifecycle': {
    desc: 'useAppLifecycle: app lifecycle subscription handle (wx App hooks / web visibilitychange + load)',
    errors: { 'app-lifecycle.unsupported': 'The bridge does not provide getAppLifecycle (useAppLifecycle unavailable)' },
  },
  'page-lifecycle': {
    desc: 'usePageLifecycle: page lifecycle subscription handle (wx Page hooks / web load + visibilitychange)',
    errors: { 'page-lifecycle.unsupported': 'The bridge does not provide getPageLifecycle (usePageLifecycle unavailable)' },
  },
  background: {
    desc: 'useBackground: background/foreground switch subscription (wx onAppHide/onAppShow / web visibilitychange)',
    errors: { 'background.unsupported': 'The bridge does not provide getBackground (useBackground unavailable)' },
  },
  'mini-program': {
    desc: 'useMiniProgram: jump to a mini program (wx.navigateToMiniProgram / web → Err)',
    errors: { 'mini-program.unsupported': 'The bridge does not provide navigateMiniProgram (useMiniProgram unavailable)' },
  },
  embedded: {
    desc: 'useEmbedded: host embedding context (embedded scenario — host bridge; Err by default)',
    dataProps: {
      provider: 'Host channel identifier (wechat / web / studio …)',
      version: 'Host/base library version',
      capabilities: 'Set of capability names declared by the host',
    },
    errors: { 'embedded.unsupported': 'The bridge does not provide getHostContext (useEmbedded unavailable)' },
  },
  extension: {
    desc: 'useExtension: extension/plugin (G-21 extension point — host loadPlugin bridge; Err by default)',
    params: { extensionId: 'Extension/plugin ID (registered name of the G-21 extension point)' },
    errors: { 'extension.unsupported': 'The bridge does not provide loadExtension (useExtension unavailable)' },
  },
  analytics: {
    desc: 'useAnalytics: analytics tracking handle (wx.reportEvent; no web standard → track returns Err)',
    errors: { 'analytics.unsupported': 'The bridge does not provide track (useAnalytics unavailable)' },
  },
  log: {
    desc: 'useLog: log handle (console + reporting)',
    errors: { 'log.unsupported': 'The bridge does not provide log (useLog unavailable)' },
  },
}
