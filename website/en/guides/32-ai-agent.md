---
title: AI-native development
order: 32
group: 专题深入
---

# AI-native development

Proteus's semantic model is not only for humans — **the semantic IR is the contract between AI and the framework**. The LLM is responsible for generating semantic code; the framework is responsible for correctness (IR validation + the six-target consistency gate). The two sides connect through a machine-readable intermediate representation rather than praying over prompts.

> Traditional model: AI generates platform code → humans review platform details line by line → mistakes keep you fixing until dawn
> Proteus model: AI generates semantic IR → machine validation (schema + conformance) → passing means consistent across the six targets

## MCP Server

`@proteus-vue/mcp` implements the Model Context Protocol standard surface (tools/list, tools/call, resources, prompts), plugging framework knowledge directly into MCP-capable AI clients (Claude, Cursor, and others).

### Tool list (11 tools)

| Tool | Purpose | Risk level |
|---|---|---|
| `search_primitives` | Query G-32 semantic primitives (substring match on id/semantic/tag/api, categorized as layout/ui/shell/gesture/capability/engineering) | Read-only |
| `get_primitive` | Fetch the full definition of a single primitive | Read-only |
| `list_primitives` | Full or per-category primitive lists (with statistics) | Read-only |
| `get_design_token` | Query design tokens (color / font size / spacing / radius — business code must not hardcode color values) | Read-only |
| `check_capability` | Query whether a given engine supports a given capability (supported/value) | Read-only |
| `get_capability_matrix` | target × capability matrix (derived from the six engines' capabilities) | Read-only |
| `lookup_miniprogram` | Mini Program API / component → Proteus equivalent mapping (for migration) | Read-only |
| `validate_ir` | Component IR Schema validation (p- prefix / legal semantic / CMP006 downgrade declarations / grid conflicts) | Read-only |
| `run_conformance` | Run six-target render conformance (semantic-control mapping vs. reference tables; by default all six engines run) | Read-only |
| `generate_code` | IR → code artifacts (json = normalized IR / ts = typed module) | Read-only |
| `write_file` | Write to disk | **High risk: disabled by default + interactive confirmation required (CMP021)** |

Beyond the tools, it also ships **resources** (the full primitive catalog, Design Tokens, the target × capability matrix, the Component IR Schema, an example product-detail page) and **prompts** (`proteus-flex-layout` flexible-layout guidance, `proteus-migrate-wx` Mini Program migration SOP, `proteus-token-only` banning hardcoded color lookups).

## Agent runtime

`@proteus-vue/agent` is the framework-side agent runtime, organized around a "generate → validate → correct" loop:

- **ir-builder**: normalizes AI output into legal Component IR
- **guardrails**: guardrail checks (paired with the diagnostics surface of validateComponentIR)
- **codegen**: IR → typed code artifacts
- **rules**: rule-driven (shares one source with the global CMP numbering system)

## Recommended workflow

```text
1. AI looks up semantic primitives   search_primitives / get_primitive
2. Pull the design spec              get_design_token (no hardcoded color lookups)
3. Generate Component IR             (the LLM produces it per the IR Schema)
4. Machine validation                validate_ir — schema / semantics / downgrade declarations / grid conflicts
5. Consistency gate                  run_conformance — six-target semantic-control mappings all green
6. Codegen                           generate_code → ts/json
7. Write to disk                     write_file (disabled by default; requires explicit user confirmation)
```

Steps 4 and 5 are the crux: before AI output ever enters the codebase, machines verify that it renders consistently across the six targets. Errors are intercepted at the IR layer instead of being discovered by users in production.

## Status & boundaries

| Capability | Status |
|---|---|
| MCP Server (11 tools + resources + prompts) | ✅ |
| Agent runtime (ir-builder / guardrails / codegen / rules) | ✅ |
| `write_file` interactive-confirmation gate (CMP021) | ✅ |
| Agent autonomously generating a complete project through multi-round iteration | 📋 planned |

## Next steps

- [Conformance](/docs/framework/29-conformance): the machine acceptance system for AI output
- [Semantic model](/docs/framework/11-semantic-model): where the IR that AI consumes comes from
- [CLI & project commands](/docs/28-cli): commands to run MCP / gates locally
