---
title: Componentization & semantic naming
order: 18
group: 组件框架
---

# Componentization & semantic naming

p-* semantic components are the fundamental unit of the Proteus component framework. Each one is a **standard Vue SFC**, plus three disciplines:

1. **Semantic naming (iron rule G-31.1)**: components and tags must be semantically named with a `p-` prefix (`p-grid` expresses grid intent) and must not share names with Mini Program / HTML tags
2. **Object-form defineProps**: props use object literals (statically extracted by the compiler; the contract is `BaseProps` in `@proteus-vue/contracts`)
3. **Zero audit violations**: machine-audited by `components:audit` (direct platform-API calls / synchronous storage / manifest completeness)

## Semantics are IR

Each p-* component is turned into a **C-IR semantic node** by `toComponentIR`: `tag → semantic` (e.g. `p-grid → layout.grid`) + props + children. Render backends consume the **semantic field**, never the tag string — this is exactly where "the backend implements by semantics" lands (the 136-primitive SSOT is in [PRIMITIVE_CATALOG](/docs/framework/22-architecture)).

## Component audit

The audit is driven by the component-ir contracts (`tests/component-audit.test.ts`):

- Directory structure: `src/components/p-*/index.vue` (one directory per component)
- props in object form (the precondition for the compiler's static extraction)
- Platform-API red line: no direct `document.*` / `window.*` / `wx.*` calls inside components (no-platform-api)
- Semantic linking: TAG_SEMANTIC_MAP double registration (component ↔ semantic)

## Three-tier forms

| Form | Characteristic | Example |
|---|---|---|
| Tier 0 pure data | Fully expressible in JSON, zero code | Themes / snippets / configuration |
| Tier 1 declarative | Lightweight WASM behavior | Commands / panels |
| Tier 2 full | Full WASM runtime | Complex interaction plugins |

(Tier 0/1/2 is also the form boundary of the [plugin API](/docs/plugin/host).)

## Next steps

- [Component references & registration](/docs/framework/components-registration)
