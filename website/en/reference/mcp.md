---
title: MCP Server (AI infrastructure)
order: 46
group: 开发者工具
---

# MCP Server (AI infrastructure)

Proteus's **AI-native development** lands here: `@proteus-vue/mcp` exposes an MCP (Model Context Protocol) Server — **11 tools / 5 resources / 3 prompts** — so an AI Agent operates the semantic layer directly (primitives / tokens / capability matrix / IR / conformance), turning "AI code generation" from text guessing into **machine-verifiable semantic operations**.

## Tools (11)

| Tool | Purpose |
|---|---|
| `search_primitives` | Semantic primitive search |
| `get_primitive` / `list_primitives` | Primitive details / catalog (`proteus://primitives/catalog`) |
| `get_design_token` | Design token lookup (`proteus://tokens/design`) |
| `check_capability` | Capability probing (`proteus://capabilities/matrix`) |
| `get_capability_matrix` | Capability matrix |
| `lookup_miniprogram` | Mini Program lookup (`proteus://mp/mapping` data source — reverse lookup from semantics to wx APIs / components) |
| `validate_ir` | C-IR validation (semantic enums / constraints) |
| `run_conformance` | Run the conformance gate |
| `generate_code` | Generate code from semantics |
| `write_file` | Write to disk (file writes within the guardrail) |

## Resources (5)

| URI | Content |
|---|---|
| `proteus://primitives/catalog` | Primitive catalog (136 entries, SSOT) |
| `proteus://tokens/design` | Design tokens |
| `proteus://capabilities/matrix` | Capability matrix |
| `proteus://ir/schemas/component` | C-IR Schema |
| `proteus://examples/product-detail` | Example (a well-formed IR example) |

## Prompts (3)

| Prompt | Purpose |
|---|---|
| `proteus-flex-layout` | Flexible-layout construction guidance (G-22 primitives + **no manual breakpoints**) |
| `proteus-migrate-wx` | Mini Program migration SOP (lookup_miniprogram + the automatic/manual split) |
| `proteus-token-only` | Token-only coloring enforced (no hardcoded color values) |

## Integration

MCP has no standalone CLI — the host (an Agent framework / Claude Desktop, etc.) plugs in `createMcpServer(options)` (`@proteus-vue/mcp`; the MCP stdio transport is wired host-side), which registers the tools/resources/prompts.

## Design notes

- **Write guardrail**: `write_file` writes to disk inside the guardrail (AI-generated code never bypasses the repository gate); `validate_ir` + `run_conformance` are the machine-verification gate after code generation
- **Semantics first**: the objects the tools operate on are IR / primitives / tokens (the constraint surface), not free-form text — so AI-generated code obeys the IR contract (see [Proteus vs. traditional frameworks](/docs/02-difference))
- **Reverse lookup**: `lookup_miniprogram` lets the AI query the wx equivalent by semantics when migrating existing Mini Programs

## Ecosystem integration

- **Agent Kit** (G-36 B2, `@proteus-vue/agent`): IRBuilder / generateCode / intent-to-flex — the library-level same-source core as MCP (in-process calls when no MCP transport is involved)
- **Skill** (G-36 B3): the `migrate-miniprogram` Skill = codemod reuse + a coverage guardrail

## Honest boundaries

- The tool list follows the current package (new tools must be synced into this page)
- `generate_code` writes semantically generated code to disk only after `validate_ir` verification — free-form AI improvisation is outside this tool's semantics

## Next steps

- [Semantic model](/docs/framework/11-semantic-model): the constraint surface the tools operate on
- [CLI & project commands](/docs/28-cli)
