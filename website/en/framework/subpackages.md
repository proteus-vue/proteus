---
title: Subpackages & on-demand injection
order: 32
group: 基础能力
---

# Subpackages & on-demand injection

Mini Program package size is a hard constraint — subpackages and on-demand injection are both handled automatically at **compile time**; business code merely declares.

> **Target scope**: subpackages / on-demand injection are **mp-weixin** platform mechanisms (WeChat's package-size constraint); the Web end carries the same need through route-level code-splitting (native Vite).

## Subpackages: configuration takes effect immediately

Subpackages are declared in `proteus.config.ts` (`name` + `root`); gen-routes runs **independent scanning + tree derivation per subpackage, with no cross-subpackage nesting**:

```ts
// proteus.config.ts
subPackages: [{ root: 'subpackages/order', name: 'order' }],
```

- Pages are written under the subpackage directory as usual; the `<route>` block is optional — routes are assigned to their owning subpackage
- **Subpackage dependencies are generated automatically**: a module chunk / name matching the subpackage base name → `dependencies` + `preloadRule` are written into app.json
- Artifacts: `dist/mp-weixin/subpackages/order/` (isolated from the main package)

## On-demand injection: lazyCodeLoading

When the Skyline switch is on, gen-routes automatically writes:

- `app.json`'s `lazyCodeLoading: "requiredComponents"` — the code of pages not yet visited is not injected
- Each page's `page.json` receives `"renderer": "skyline"` + `requiredComponents` (the prerequisite for Skyline rendering, validated by the WeChat platform)

## Shared modules & size

- Cross-page shared logic compiles into a standalone `_proteus/<module>.js` artifact + require transform (module-plan B0)
- bundle-report outputs the size report at the end of the build (main package budget 1200KB hard-blocked in CI)
- For size governance, see [Size budget](/docs/framework/perf-budget)

## Next steps

- [Conformance](/docs/framework/29-conformance)
