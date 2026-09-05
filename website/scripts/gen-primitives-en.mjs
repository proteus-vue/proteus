// website/scripts/gen-primitives-en.mjs —— 原语分区英文字段（★#482：生成器双语输出，与 zh 同源推导）
//   PRIM_EN[模块名] = { title?, summary, notes[], exports{…}, usage[{code,src}] }——未登记模块 zh-only（EN 态 #noEn 回退）
export const FAMILY_EN = {
  desktop: [
    ['Web SPA', '✅', 'Official wiring: pure logic + env fallback to globals; v-p-* directives (registered via createDesktopDirectives)'],
    ['WeChat Mini Program', '🟡', 'Pure logic unit-testable; directives not registered (desktop interactions have no counterpart — stripped at compile time); page wiring is up to the host'],
    ['Headless (SSR/testing)', '✅', 'Pure logic runs on Node (tooling/testing tier)'],
    ['iOS native', '🟡', 'Mapping planned — official wiring not started (native recognition / system API per the G-24 plan)'],
    ['Android native', '🟡', 'Mapping planned — official wiring not started'],
    ['HarmonyOS', '🟡', 'Mapping planned — official wiring not started'],
    ['Flutter hybrid', '🟡', 'Widget/system mapping not started'],
    ['Quick App', '⬜', 'target not started'],
  ],
  gesture: [
    ['Web SPA', '✅', 'Official wiring: v-gesture directives / useGesture Hook (Pointer Events)'],
    ['WeChat Mini Program', '🟡', 'Recognizer mapping is carried by each target\'s Backend (planned) — pure recognizers unit-testable on the logic layer'],
    ['Headless (SSR/testing)', '✅', 'Recognizer pure logic runs on Node (tooling/testing tier)'],
    ['iOS native', '🟡', 'UIGestureRecognizer mapping planned'],
    ['Android native', '🟡', 'GestureDetector mapping planned'],
    ['HarmonyOS', '🟡', 'Gesture system mapping planned'],
    ['Flutter hybrid', '🟡', 'Gesture mapping not started'],
    ['Quick App', '⬜', 'target not started'],
  ],
  api: [
    ['Web SPA', '✅', 'Official demo wiring (examples/platform-api-demo — all factories called)'],
    ['WeChat Mini Program', '🟡', 'Injectable subset runs on the logic layer (MP artifact-safe); component-form wiring partially rolled out first'],
    ['Headless (SSR/testing)', '✅', 'Inject reactivity etc. on Node to run (tooling/testing tier)'],
    ['iOS native', '🟡', 'Native validation not started (E-series injection surface follows host batches)'],
    ['Android native', '🟡', 'Native validation not started'],
    ['HarmonyOS', '🟡', 'Native validation not started'],
    ['Flutter hybrid', '🟡', 'same JS logic layer — wiring not started'],
    ['Quick App', '⬜', 'target not started'],
  ],
}

export const SHARED_PRIM_EN = {
  sourceCallout: (pkg) =>
    `> Source module \`@proteus-vue/${pkg}\` (pure logic + Web wiring — env-injected for testing, falls back to real globals when absent). Platform mapping / degradation chain → see the module header source.`,
  apiCallout:
    '> Source module `@proteus-vue/api` (engineering primitive factories — **injection-based**: the consumer injects reactivity/driver/routerLike etc., the api package has zero vue dependency; MP artifact-safe subset: no `?.`/`??`/array destructuring).',
  legend:
    '> Status scale: ✅ target shipped & this primitive usable · 🟡 prototype mapping — wiring not started · ⬜ target not started. Family-level mechanism coverage (not a per-target on-device verification matrix); target architecture matrix (engine / runtime / persistence) → [Ends & maturity](/docs/framework/ends-matrix).',
  familyNotes: {
    desktop: [
      '- pure-logic functions: env-injected for testing; browser defaults fall back (`typeof` guards — wrapping lives only inside framework packages, pages keep zero raw platform APIs)',
      '- directive/component forms: `v-p-*` registered via `createDesktopDirectives()` (not registered on MP → degrades naturally)',
      '- official-site dogfooding usage: violation quick-fix table in [Quality gates](/docs/29-quality-gates) and [Desktop primitives](/docs/30-desktop-primitives); G-24 series examples in `examples/pages/semantic-primitives-demo.vue`',
    ],
    gesture: [
      '- recognizers are pure logic with zero dependencies: Web Pointer / MP touch normalized into `GestureInput` → semantic gesture events (tap/pan/swipe/pinch/rotate/longpress…) — unit-testable',
      '- official Web wiring: `useGesture()` Hook and `v-gesture:<kind>="onX"` directives; MP/native mapping carried by each target\'s Backend — "events are a Backend implementation detail"',
      '- real example: `examples/pages/semantic-primitives-demo.vue` (v-gesture:tap)',
    ],
    api: [
      '- **factory injection**: `createXxxEngineering({ reactivity, driver, routerLike… }) → instance` — the consumer injects reactivity (api package has zero vue dependency); instance methods are the E-series primitives',
      '- component forms (e.g. E20 p-animate / E18 p-router-link) enter the C-IR at compile time; injectable Hooks (E1-E28/R1-R4) wire up at runtime per the injected surface',
      '- real example: `examples/pages/platform-api-demo.vue` (E/R factory calls — see the "Real usage" origins)',
    ],
  },
}

/**
 * 模块级 EN 字段：键 = packages/desktop|gesture|api src 的模块 basename（如 hover/shortcut/scroll/window-message/anchor/cursor-glow/engineering…）。
 * title = 页面标题（zh humanName 的英文对应，标识符类照抄）；summary = 页头一句话；notes = 模块头注释块英文逐行；
 * exports = { 导出名: 一句话英文 }（readExports 提取的 doc 对应）；usage = 真实用法 EN（仅当 zh USAGE_MAP 该模块有条目；code 行内注释已译英）。
 */
export const PRIM_EN = {
  hover: {
    title: "p-hover",
    summary: "Hover-state semantics (brighten/lift/underline) — touch auto-degrades to tap highlight",
    notes: [
      "★G-24 B1 (proteus-semantic-primitives-plan 03 §1 p-hover): pointer-hover pure logic",
      "· resolveHoverClass(preset) → 'p-hover-brighten', etc. (CSS class — the render layer defines the transition)",
      "· isHoverPointer(pointerType) → mouse/pen → true; touch → false (p-hover degrades to tap highlight — plan §1)",
      "Pure logic with zero DOM dependency; MP artifact safe: no ?. / ??; no array destructuring",
    ],
    exports: {
      HoverPreset: "Pure logic with zero DOM dependency; MP artifact safe: no ?. / ??; no array destructuring",
      PointerKind: '—',
      resolveHoverClass: "Preset → CSS class name (the render layer's `<style>` defines the transition animation)",
      isHoverPointer: "Pointer classification: mouse/pen support hover (the cursor can hover); touch/remote degrade (plan: iOS compile-time stripping → tap highlight)",
      normalizePointerType: "Event pointerType normalization (Web PointerEvent.pointerType / test injection)",
      canHover: "Hover-state toggle decision (mouseenter/mouseleave semantics — whether the injected pointer can hover)",
    },
    usage: [{ code: '<p-view v-for="p in pillars" v-p-hover class="pillar-card">…</p-view>', src: 'website/src/pages/Home.vue:244' }],
  },
  scroll: {
    title: "Scroll observation primitive (page scroll progress / scroll state)",
    summary: "Page scroll observation: rAF throttle + y/max/progress (the App top progress bar and the Home linkage run on it)",
    notes: [
      "★#449 G-24 B5 (proteus-semantic-primitives-plan follow-up batch): page scroll observation primitive — converging \"scroll progress / scroll state\"",
      "Semantics: subscribes to page scroll → rAF throttle → state callbacks (y / viewport / docHeight / max / progress)",
      "Consumers: App top progress bar (progress) + nav scrolled state, Home hero scroll linkage (y) — pages keep zero raw window/document",
      "Layering: pure logic + Web wiring (env-injected for unit testing; defaults to falling back to real globals — the same convention as the network/lifecycle family)",
    ],
    exports: {
      ScrollState: "Layering: pure logic + Web wiring (env-injected for unit testing; defaults to falling back to real globals — the same convention as the network/lifecycle family)",
      ScrollObserverEnv: '—',
      ScrollObserver: '—',
      readPageScroll: "Real window/document geometry (SSR / no DOM → an all-zero honest state)",
      createScrollObserver: "★createScrollObserver: subscribes to page scroll (rAF-throttled — at most one callback per frame; immediate fires the callback on the first frame)",
    },
    usage: [{ code: 'const scrollObs = createScrollObserver({ immediate: true, onChange: (s) => { progress.value = s.progress } })', src: 'website/src/App.vue:44' }],
  },
  shortcut: {
    title: "p-shortcut",
    summary: "Keyboard-shortcut semantics: mod+s → ⌘S / Ctrl+S (the PRIM005 platform convention); bound actions fire on match",
    notes: [
      "★G-24 B1 (proteus-semantic-primitives-plan 03 §3 p-shortcut): keyboard-shortcut pure logic",
      '· parseShortcutExpr("mod+s:save") → { keys: [\'mod\',\'s\'], id: \'save\' } (the p-shortcut="mod+s:save" semantics)',
      '· normalizeMod("mod", platform) → \'meta\' (darwin) / \'ctrl\' (elsewhere) — follows PRIM005 platform conventions automatically',
      "· matchShortcut(e, keys) → keyboard event match test (mod/s/alt/shift + key/code normalization)",
      "· shortcutLabel(binding, platform) → '⌘S' (Mac) / 'Ctrl+S' (Win/Linux) — acceptance: \"mod+s → Mac ⌘S / Win Ctrl+S\"",
      "Pure logic with zero DOM dependency (event-shape injection is unit-testable); MP artifact safe: no ?. / ??; no array destructuring",
    ],
    exports: {
      ShortcutMod: "Pure logic with zero DOM dependency (event-shape injection is unit-testable); MP artifact safe: no ?. / ??; no array destructuring",
      ShortcutKey: '—',
      ShortcutBinding: "Parse result: key sequence + semantic id",
      KeyEventLike: "Keyboard-event shape (an injectable subset of the Web KeyboardEvent — mockable in tests)",
      detectShortcutPlatform: "★#445 platform-detection primitive (pure, injectable function; callers never touch navigator — for the short label: Darwin/mac/iPhone/iPad → 'Mac', everything else 'web')",
      parseShortcutExpr: "Parses \"mod+s:save\" / \"mod+shift+a\" / \"escape\" → binding (case/whitespace tolerant; invalid segments skipped)",
      normalizeMod: "Platform mod normalization: darwin/mac → 'meta' (⌘); the rest → 'ctrl' (PRIM005 automatically follows platform conventions)",
      matchShortcut: '/',
      shortcutLabel: "Shortcut label (menu-bar display — the PRIM005 acceptance): mod+s → '⌘S' (darwin) / 'Ctrl+S'",
    },
    usage: [
      { code: '<button v-p-shortcut="{ expr: \'mod+k:open\', handler: () => toggle(true) }">', src: 'website/src/DocSearch.vue:133' },
      { code: "const kbd = shortcutLabel('mod+k', detectShortcutPlatform())", src: 'website/src/DocSearch.vue:47' },
    ],
  },
  'window-message': {
    title: "Cross-window message primitive (iframe postMessage funnel)",
    summary: "Cross-window message subscription: origin allowlist + type filtering + destroy (used by the spirit iframe bubble)",
    notes: [
      "★#449 G-24 B5 (proteus-semantic-primitives-plan continuation batch): cross-window message primitive — postMessage funnel (source validation + type filtering)",
      "Semantics: same-origin / designated-origin iframe message subscription (origin validation happens inside the framework package — pages keep zero raw window.addEventListener('message'))",
      "Consumption: App-shell spirit iframe (same-origin morph message → form bubble) — reclaiming the cross-window message gap",
      "Layering: pure logic + Web wiring — env-injected for unit testing, falls back to real globals by default (the network/lifecycle family convention)",
    ],
    exports: {
      WindowMessage: "Layering: pure logic + Web wiring — env-injected for unit testing, falls back to real globals by default (the network/lifecycle family convention)",
      WindowMessageEnv: '—',
      WindowMessageOptions: '—',
      WindowMessageHandle: '—',
      subscribeWindowMessage: "★subscribeWindowMessage: cross-window message subscription (origin allowlist validation + type filtering; destroy cleanup)",
    },
    usage: [{ code: "subscribeWindowMessage({ types: ['proteus-spirit-morph'], onMessage })", src: 'website/src/App.vue:30' }],
  },
  anchor: {
    title: "Anchor positioning primitive (scrollToId)",
    summary: "Smooth-scroll to an id anchor (jump within v-html docs on a new SPA page; delayable)",
    notes: [
      "★#449 G-24 B5 (proteus-semantic-primitives-plan continuation batch): anchor positioning primitive — scrollIntoView funnel (element lookup inside the framework package)",
      "Semantics: locate the element by id and smooth-scroll (optional delay — for v-html content newly rendered after an SPA route change)",
      "Consumption: DocSearch result anchor jumps (v-html doc heading) — reclaiming the element-query gap",
      "Layering: pure logic + Web wiring — env-injected for unit testing, falls back to the real document by default (the network/lifecycle family convention)",
    ],
    exports: {
      AnchorScrollEnv: "Layering: pure logic + Web wiring — env-injected for unit testing, falls back to the real document by default (the network/lifecycle family convention)",
      scrollToId: '/',
    },
    usage: [{ code: "scrollToId(hit.anchor, { behavior: 'smooth', delayMs: 60 }) // scroll only after the new page's v-html has rendered", src: 'website/src/DocSearch.vue:106' }],
  },
  'cursor-glow': {
    title: "p-cursor-glow",
    summary: "Pointer-following ambient glow (brand purple/cyan dual blooms, lerp-interpolated trail)",
    notes: [
      "★G-24 B5 (proteus-semantic-primitives-plan continuation batch): pointer-following glow — desktop interaction semantics \"ambient light follows the pointer\"",
      "Semantics: a glow layer (primary purple + secondary cyan dual blooms) follows the pointer with lerp interpolation — AI-tech pointer ambient feedback;",
      "Degradation chain: prefers-reduced-motion → not enabled; touch (pointer: coarse) → not enabled; MP logic layer has no DOM → not enabled",
      "Layering: pure logic (this module, unit-testable) + thin directive (directives.ts v-p-cursor-glow)",
    ],
    exports: {
      CursorGlowOptions: '—',
      CursorGlowHandle: '—',
      CURSOR_GLOW_DEFAULTS: "Defaults (Proteus design-tokens: brand purple / brand2 cyan)",
      prefersReducedMotion: '—',
      hasFinePointer: "Whether the environment has a fine pointer (mouse/pen — not enabled on touch; no matchMedia environment = non-Web, disabled)",
      createCursorGlow: '/',
    },
    usage: [{ code: '<p-page v-p-cursor-glow="cursorGlowOptions" …> // size/color/accent brand glow', src: 'website/src/App.vue:67' }],
  },
}
