---
title: Run & preview
order: 6
group: 开始
---

# Run & preview

Each target takes one command to run (per-target bootstrap & state above in "Terminal rollout").

## Web

```bash
npm run dev:web
```

Open the address Vite prints (default `http://localhost:5173`); seeing the home page means it works.

Web is a standard Vite SPA: **zero transformation** — Vue devtools, HMR, and route-level code-splitting all work.

## Mini Program

```bash
npm run build:mp
```

Artifacts land in `dist/mp-weixin/`: `app.js` / `app.json` / `app.wxss` + `pages/` (each page's wxml / wxss / js / json quartet; plus `subpackages/` when subPackages are configured).

Then in WeChat DevTools:

1. "Import Project" → choose the `dist/mp-weixin/` directory
2. Fill the AppID from `proteus.config.ts` (the template placeholder `wx0000000000` must be replaced before use)
3. Details → Local settings → enable "Debug base library" and pick ≥ 2.29.2
4. No need to hand-configure Skyline fields: `lazyCodeLoading` in `app.json` and `"renderer": "skyline"` in each page's `page.json` are generated automatically by gen-routes

When the scaffold home page renders in the simulator, the two wired targets — Web and Mini Program — are both up (other targets join as render backends are wired; see [Ends & maturity](/docs/framework/ends-matrix)).

## Other targets

App (iOS / Android / HarmonyOS) and the Flutter host are prototype mappings (🟡) — once wired per roadmap, the same `src/` source just gains the corresponding target entry; no page code changes.

## Next steps

- [Page anatomy](/docs/09-page-anatomy): read every part of the home SFC
- [Build & release](/docs/07-build-release): production builds and the full command reference
