---
title: Quality Gates: catch non-conforming code with one command
order: 29
group: 架构与工程
---

# Quality Gates: catch non-conforming code with one command

Proteus's gate system catches code that violates framework conventions **before build/CI**: raw platform APIs, callback-style calls, direct storage access, hand-written `@media`, third-party UI libraries — all machine-checked with concrete fixes. The official site itself is the first proving ground (D-2: pages with zero raw platform APIs, zero exemptions).

## One command tells you

From inside your project:

```bash
proteus gate run audit        # deep aggregate: ten domains in one pass (recommended entry)
proteus gate run check        # fast aggregate: css / style / router / config
proteus gate ls               # browse the full gate catalog (family / scope / wiring state)
```

**FAIL (error level) → exit 1**, consumable by CI. Violations list file and line, e.g.:

```text
── capabilities（✗）
[proteus-capabilities] ❌ 平台原生模块规范违规（11 处）：…
── fluid（✗）
  [FLD001] pages/devtools-open-api-demo.vue:273 禁止手写 @media 断点——改用 p-fluid / p-grid 语义
[proteus] audit all 汇总：10 域 / 2 失败
```

> Want only one specific check? `proteus gate run d2` (page platform APIs), `run api-check` (callback-style/sync storage), `run fluid` (layout rules) — each domain runs standalone too.

## The gate catalog (`proteus gate ls`)

| Family | Gates | What they check |
|---|---|---|
| Fast aggregate | `check` | css (CSS001-012) · style (`:style` runtime safety) · router · config/cli |
| Deep aggregate | `audit` | ten domains: route/module/config/i18n/capabilities/components/**d2**/**api-check**/**fluid**/devtools-budget |
| Dedicated | `d2` | raw platform APIs (`wx.*`/`window.*` …), hand-written `@media`, third-party UI libraries — severity configurable |
| Dedicated | `api-check` | **CMP007**: callback-style platform APIs, sync storage, raw global calls → migrate to `useXxx()` Hooks |
| Dedicated | `capabilities` | business dirs ban `wx.*`/`window.*`; platform files must not leak APIs |
| Dedicated | `fluid` | **FLD**: hand-written `@media`, hardcoded breakpoints, accessibility font sizes, dead sizes |
| Dedicated | `i18n` / `router` / `module` / `css` / `style` / `config` | hardcoded copy · route blocks · module contracts · cross-end CSS · style safety · config validity |
| Framework / repo | `coverage` / `conformance` / `check-pkg` / `check-deps` … | framework-repo governance (used by the official repo) |

## Adopt in three steps

**① Install the CLI** (templates ship `@proteus-vue/cli`):

```bash
npm i -D @proteus-vue/cli
```

**② (Optional) declare policy** in `proteus.config.ts`:

```ts
export default {
  // …required fields…
  audit: {
    rules: { 'no-media-query': 'warn' },          // D-2 per-rule: error (default) / warn / off
  },
  gates: {
    disabled: ['capabilities', 'devtools-budget'], // whole-gate switches (all enabled by default)
  },
}
```

> Layering: `audit.rules` sets D-2 **rule severities**; `gates.disabled` switches **whole gates/domains**. Full field reference: [global config](/docs/10-config).

**③ Wire into CI** — one command:

```yaml
- name: Quality gates (deep audit)
  run: proteus gate run audit
```

## Quick fix table (caught → how to fix)

| You wrote | Violation | Fix |
|---|---|---|
| `wx.request({ url, success(){…} })` callback-style | CMP007 | capability Hooks (`useFetch` and friends, see [capabilities](/docs/18-capability-system)) |
| `wx.setStorageSync('k', v)` direct storage | CMP007 | `useStorage` (capability Hook) |
| `window.scrollY` / raw `window.addEventListener('scroll')` in pages | D-2 | desktop primitive `createScrollObserver` (see [desktop primitives](/docs/30-desktop-primitives)) |
| `navigator.clipboard.writeText(url)` | D-2 | desktop `copyText(url)` |
| hand-written `@media (max-width: 820px)` | D-2 / FLD001 | `v-p-fluid` clamp / `p-grid` fluid grid (see [fluid layout](/docs/17-fluid-layout)) |
| `font-size: 11px` | FLD012 accessibility | `p-scale` dynamic size or ≥12px |
| `import { ElButton } from 'element-plus'` | D-2 | `p-*` semantic components (see [component overview](/docs/12-components-intro)) |

**Re-check after fixing**: `proteus gate run audit` until `✅ PASS`.

## Advanced governance

- **Downgrade instead of disable**: set a rule to `'warn'` — still reported but exit 0 (record first, clean later); `'off'` truly disables it.
- **Disable a whole gate**: `gates.disabled: ['fluid']` (e.g., keep a legacy-violating domain out while you clean it up).
- **Exemptions stay visible**: when no primitive exists yet, per-line `// d2-exempt: <reason>` or whole-file `/* d2-exempt-file: <reason> */` — reasons are listed in the report, auditable and reclaimable (delete the exemption once the primitive lands).
- **All standalone commands remain**: full command surface in the [CLI reference](/docs/reference/cli); gate fields in [global config](/docs/10-config).

## Honest boundaries

- `gate run audit` covers **project-level convention domains**; `coverage`/`conformance`/`check-pkg` are **framework-repo** gates (run by the official repo), not business-page gates.
- Gates check **statically decidable conventions**; runtime behavior (performance, real-device differences) is covered by [testing & deployment](/docs/27-testing-deploy) and device verification.
- The `proteus gate ls` registry is the single source of truth — look there first before adding/tuning a gate.
