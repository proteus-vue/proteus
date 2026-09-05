---
title: Conformance
order: 37
group: 质量与兼容
---

# Conformance

> The framework does only two things: define what you want (the semantic interfaces) and define how to prove you got it right (conformance).
> Conformance is the second one mechanized — whether a backend conforms is decided by gates, not by documentation.

## What gets verified

The biggest lie-risk across cross-target frameworks is: "the same code, consistent across all targets". Proteus turns that sentence into executable assertions:

| Assertion layer | What it verifies | Failure example |
|---|---|---|
| IR schema | The semantic tree is structurally legal (p- prefix / valid `semantic` / CMP006 degradation declarations / grid conflicts) | An illegal node slips in |
| Render consistency | The same semantic tree renders semantically equivalent control trees across the six backends | Web renders text, native renders button |
| Combination compliance | Host × backend combinations satisfy the combination-layer iron rules | Switching backends destroys the resource pool |
| Capability compliance | The capabilities used are declared on the target | A page uses scanning but the target never declared it |

## The rule-numbering system

Every rule carries a global number (the CMP series) — referenceable by tools and enforceable in CI:

- **CMP global numbering**: consecutive across plans, dodging already-registered numbers (e.g., G-46 = CMP089-096, G-47 = CMP097-102)
- **CCI combination-layer iron rules** (G-47): the six error-level iron rules for composing backends with resource pools —

| ID | Level | Iron rule |
|---|---|---|
| CCI-01 | error | A backend must not cache `readAuth` results — query the shared pool every time |
| CCI-02 | error | `unmount()` must not destroy any resource in the pool |
| CCI-03 | error | Switching backends must be an atomic transaction (mounting the new + unmounting the old cannot be split) |
| CCI-04 | error | Logout and backend switching must be serialized (the same lock) |
| CCI-05 | error | An unavailable backend must throw explicitly (silent error-swallowing is forbidden) |
| CCI-06 | error | Combination conformance must be 100% PASS, 0 warnings |

- **AP anti-pattern series**: a naming registry of known pitfall patterns (e.g., AP-C3 silently swallowing load errors = a CCI-05 violation)

## Gate forms

### 1. IR validation (before rendering)

`validateComponentIR` validates the semantic tree before rendering / code emission: legal `p-` prefixes, valid `semantic` fields, degradation declarations (CMP006), grid-conflict checks. The diagnostics double as instructions for fixing the IR.

### 2. Six-backend rendering conformance

The same semantic tree is fed to the six render backends, and the semantic-to-control mapping is checked row by row against the reference table (the G-31 B5 gate): mapping rows such as `ui.text → UILabel / CupertinoText / Text` must hold. The `test-ir` package provides `ConformanceRunner` and the assertion runner (`evalAssertion` / `applyAct`), supporting stateful "render → assert → interact → assert again" verification.

### 3. Capability gating (SKIP semantics)

When a target has not declared a capability, the corresponding check is **SKIP, not FAIL** — the gate distinguishes "done wrong" from "never promised". For capability declarations see [Capability system](/docs/18-capability-system).

### 4. Host × engine combination matrix

6 hosts × 6 engines = 36 combinations, with the verification scope declared per Tier: all Tier 1 (promised verification) combinations have `runConformance().failed === 0`; Tier 0 (not legal across the ecosystem) is explicitly blacklisted. The matrix also runs the CCI iron rules, guarding against "correct on one target, broken in combination".

## Running it in your project

```bash
npm test                          # unit tests + per-package conformance cases
npm run test:e2e:web              # browser E2E
proteus conformance --repo        # repo-level conformance report (CLI)
```

In AI scenarios the same gates are exposed through MCP: `validate_ir` → `run_conformance` (see [AI-native development](/docs/32-ai-agent)).

## Principle #0

> The verification system is not a KPI for the QA department — it is part of the architecture: **an SPI without conformance is a fake SPI**.
> Every rule number traces back to a real incident or an architecture decision.

## Next steps

- [Headless backend & semantic snapshots](/docs/framework/25-headless-backend): run conformance in a device-free environment
- [Testing & deployment](/docs/27-testing-deploy): test layering inside the project
- [Containers & hosts](/docs/framework/33-containers-hosts): the profiles of the six containers under verification
