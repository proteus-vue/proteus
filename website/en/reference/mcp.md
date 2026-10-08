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

**① In-process**: the host plugs in `createMcpServer(options)` (`@proteus-vue/mcp`) to register tools/resources/prompts **in-process**; or wire a transport via `serveStdio()` / `startHttpServer()`.

**② CLI stdio (recommended for MCP clients)** — `proteus mcp serve` starts a stdio MCP server (a locally spawned process, JSON-RPC over stdin/stdout):

```jsonc
// Claude Desktop / Cursor mcpServers example
{
  "mcpServers": {
    "proteus": {
      "command": "npx",
      "args": ["-y", "@proteus-vue/cli", "mcp", "serve"]
      // to enable file writing: add "--allow-write", "--workspace", "/path/to/project"
    }
  }
}
```

**③ Streamable HTTP (remote / shared / multi-client / in-container)** — `proteus mcp serve --http`, listens on `127.0.0.1:7802`, endpoint `/mcp` by default:

```bash
proteus mcp serve --http                               # http://127.0.0.1:7802/mcp
proteus mcp serve --http --host 0.0.0.0 --token s3cr3t # exposed + Bearer auth
```

- **Stateless per-request**: each request is handled independently, no sessions — a read-only knowledge surface is naturally concurrency-safe with no session ops; the cost is no server-initiated push (e.g. log notifications), and GET/DELETE return 405.
- **Security**: binds `127.0.0.1` by default; when exposing via `--host 0.0.0.0` **always** set `--token`. `--port N` / `--host H` / `--token T` are HTTP-only.
- **Requires Node ≥ 20** (Streamable HTTP relies on the ESM global `crypto`; stdio has no such requirement).

**Common options**: `--allow-write` (enable `write_file`, read-only by default) · `--workspace <dir>` (write root, default cwd) · `--rate-limit <n>` (per-minute cap, default 60) · `--quiet` (disable structured request logs).

**★stdout is the protocol**: under stdio the server writes JSON-RPC to stdout only; status messages and request logs go to stderr (otherwise the client fails to parse).

**★Six-end conformance works out of the box**: `run_conformance` needs `document` (the vue-dom engine) — the server **auto-injects happy-dom** (optional dependency), so all six engines run under `proteus mcp serve`; without happy-dom the vue-dom engine honestly errors out (never silently pretends to pass).

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
