---
title: Size budget
order: 38
group: 质量与兼容
---

# Size budget

Mini Program main-package size is a hard constraint of the WeChat platform (2MB cap per package). Proteus governs it with a **build-time budget gate**: `bundle-report.ts` measures artifact sizes at the end of `build:mp` and compares them against the budget.

## The budget mechanism

- **Main-package budget**: 1200KB by default (`config.budget.mainPackageKB`; real project runs keep the main package under 1200KB)
- **Strict mode**: with `budget.strict = true`, going over budget **fails the build** (warning by default)
- **Subpackage monitoring**: each subpackage is counted independently — WeChat caps a single package at 2MB, and exceeding it is an error that blocks the build
- **Top-N largest files**: the report outputs the largest-file list in a structured form, pinpointing where the size comes from

## Size-control measures

| Measure | Effect |
|---|---|
| Subpackages ([Subpackages & on-demand injection](/docs/framework/subpackages)) | The main package keeps only tab / first-screen routes |
| On-demand injection (`lazyCodeLoading`) | Code of unvisited pages is never injected |
| Shared-module dedup | Cross-page shared logic collapses into a single `_proteus/<module>.js` artifact |
| Component on-demand imports (Web) | Unused components never enter the bundle |

## How the numbers are measured

Size figures are **measured from real build artifacts** (printed automatically at the end of a build), not estimates — consistent with the G-60.9 figure-annotation discipline. Historical main-package measurements live in the examples builds (e.g., 709KB under the 1200KB budget).

## Next steps

- [Conformance](/docs/framework/29-conformance)
