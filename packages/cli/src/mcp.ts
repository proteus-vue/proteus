// packages/cli/src/mcp.ts —— `proteus mcp` 命令（★决策 #681 stdio / #682 HTTP）
//
// 【为什么有它】之前 `@proteus-vue/mcp` 只有传输无关核心，MCP 客户端连不上。本命令让 `proteus mcp serve`
//   起一个 **MCP server**：缺省 **stdio**（Claude Desktop / Cursor 的 command 模式）；
//   `--http` 起 **Streamable HTTP**（远端/共享/多客户端/容器内接法）。
//
// 【★★硬约束：stdio 下 stdout 是协议的】stdio 传输下 stdout 只能出 JSON-RPC 帧——**绝不走 `ui.ts`**（它全走 stdout）。
//   所有提示一律 `process.stderr.write`。改成 console.log 会让客户端连不上，且现象是"看起来能跑、就是不通"
//   （最贵的一类坑）。tests/mcp-stdio.test.ts 的破坏性用例锁住这条。
//
// 【诚实边界】
//   · write_file 默认**禁用**（只读安全）；`--allow-write` 才开写闸，`--workspace`（缺省 cwd）为写根。
//   · HTTP 缺省只绑 127.0.0.1；`--host 0.0.0.0` 对外时**务必**配 `--token`（否则任何人可调）。
//   · run_conformance/generate_code 依赖 document ⇒ core 自动注入 happy-dom（可选依赖）；未装则 vue-dom 端如实报错。
//   ★所有 `@proteus-vue/mcp` 引用均为**动态 import**（不在 CLI 启动期加载 MCP/SDK——`proteus build` 等命令零负担）。

export interface McpServeOptions {
  /** 传输：stdio（缺省）/ http */
  transport: 'stdio' | 'http'
  /** 开启写入闸（write_file）——缺省 false（只读安全） */
  allowWrite: boolean
  /** 写入根目录（防逃逸；缺省 process.cwd()） */
  workspaceRoot?: string
  /** 每分钟调用上限（缺省 60） */
  rateLimitPerMin?: number
  /** HTTP：端口（缺省 7802） */
  port?: number
  /** HTTP：监听地址（缺省 127.0.0.1） */
  host?: string
  /** HTTP：Bearer token（设置后须鉴权） */
  token?: string
  /** 结构化请求日志开关（缺省 true；--quiet 关闭） */
  logging: boolean
}

const FLAG_WITH_VALUE = new Set(['--workspace', '--rate-limit', '--port', '--host', '--token'])

/** 解析 `proteus mcp <sub> [flags]`——目前只支持 `serve` */
export function parseMcpArgs(argv: string[]): { sub: string; options: McpServeOptions } {
  const sub = argv[0]
  if (sub !== 'serve') {
    throw new Error(`未知子命令：${sub ?? '(空)'}（允许：serve）`)
  }
  const options: McpServeOptions = { transport: 'stdio', allowWrite: false, logging: true }
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--allow-write') options.allowWrite = true
    else if (a === '--http') options.transport = 'http'
    else if (a === '--quiet') options.logging = false
    else if (FLAG_WITH_VALUE.has(a)) {
      const v = argv[i + 1]
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} 需要参数值`)
      if (a === '--workspace') options.workspaceRoot = v
      else if (a === '--rate-limit') {
        const n = Number(v)
        if (!Number.isFinite(n) || n <= 0) throw new Error(`--rate-limit 需要正数，收到：${v}`)
        options.rateLimitPerMin = n
      } else if (a === '--port') {
        const n = Number(v)
        if (!Number.isInteger(n) || n < 0 || n > 65535) throw new Error(`--port 需要 0-65535 整数，收到：${v}`)
        options.port = n
      } else if (a === '--host') options.host = v
      else if (a === '--token') options.token = v
      i++
    } else {
      throw new Error(`未知参数：${a}`)
    }
  }
  if (options.transport === 'stdio' && (options.port !== undefined || options.host !== undefined || options.token)) {
    throw new Error('--port/--host/--token 仅用于 --http 模式')
  }
  return { sub, options }
}

/** 把对外服务需要的配置（写闸/写根/限流/documentLike）从 CLI 选项映射到 core 选项 */
async function coreOptions(options: McpServeOptions): Promise<{
  writeEnabled: boolean
  workspaceRoot?: string
  rateLimitPerMin?: number
  documentLike?: unknown
}> {
  const { resolveDocumentLike } = await import('@proteus-vue/mcp')
  return {
    writeEnabled: options.allowWrite,
    workspaceRoot: options.workspaceRoot,
    rateLimitPerMin: options.rateLimitPerMin,
    // run_conformance/generate_code 依赖 document ⇒ 自动注入（happy-dom 可选依赖；未装则如实降级）
    documentLike: await resolveDocumentLike(),
  }
}

/**
 * 启动 MCP server。stdio 阻塞至 stdin 关闭；http 阻塞至收到 SIGINT/SIGTERM（优雅关停）。
 * ★注意：**所有输出走 stderr**——stdout 留给协议。
 */
export async function runMcpServe(options: McpServeOptions): Promise<void> {
  const core = await coreOptions(options)
  if (options.transport === 'http') {
    const { startHttpServer } = await import('@proteus-vue/mcp')
    const handle = await startHttpServer({
      ...core,
      port: options.port,
      host: options.host,
      token: options.token,
      onRequest: options.logging ? (line) => process.stderr.write(`[proteus-mcp] ${line.status} ${line.method ?? ''} ${line.path} · ${line.ms}ms${line.tool ? ` · ${line.tool}` : ''}\n`) : undefined,
      onReady: (info) => {
        process.stderr.write(`[proteus-mcp] HTTP ready · ${info.url} · ${info.tools} tools${info.auth ? ' · bearer' : ' · no-auth'}\n`)
        if (!info.auth && info.host === '0.0.0.0') {
          process.stderr.write('[proteus-mcp] ⚠ 对外监听（0.0.0.0）但未设 --token——建议加 --token 防未授权调用\n')
        }
      },
    })
    // 优雅关停：SIGINT/SIGTERM ⇒ 停止监听 + 退出
    await new Promise<void>((resolve) => {
      const shutdown = (sig: string) => {
        process.stderr.write(`[proteus-mcp] ${sig} ⇒ 关停\n`)
        void handle.close().then(() => resolve())
      }
      process.once('SIGINT', () => shutdown('SIGINT'))
      process.once('SIGTERM', () => shutdown('SIGTERM'))
    })
    return
  }
  // stdio
  const { serveStdio } = await import('@proteus-vue/mcp')
  await serveStdio({
    ...core,
    onReady: (info) => {
      // ★stderr（不是 stdout）：stdout 是协议通道
      process.stderr.write(
        `[proteus-mcp] ready · ${info.name} v${info.version} · ${info.tools} tools` +
          `${options.allowWrite ? ` · write=on(${options.workspaceRoot ?? process.cwd()})` : ' · read-only'}\n`,
      )
    },
  })
}
