// packages/cli/src/mcp.ts —— `proteus mcp` 命令（★决策 #681：把 MCP stdio 适配器接到 CLI）
//
// 【为什么有它】之前 `@proteus-vue/mcp` 只有传输无关核心，MCP 客户端连不上（官网 mcp 页写"无独立 CLI"）。
//   本命令让 `proteus mcp serve` 起一个 **stdio MCP server**，Claude Desktop / Cursor 等可直接挂载。
//
// 【★★硬约束：stdout 是协议的】stdio 传输下 stdout 只能出 JSON-RPC 帧——**绝不走 `ui.ts`**（它全走 stdout）。
//   本模块所有提示一律 `process.stderr.write`（见 runMcpServe）。改成 console.log 会让客户端连不上，
//   且现象是"看起来能跑、就是不通"（最贵的一类坑）。tests/mcp-stdio.test.ts 有破坏性用例锁住这条。
//
// 【诚实边界】
//   · write_file 默认**禁用**（只读安全）；`--allow-write` 才开写闸，`--workspace`（缺省 cwd）为写根，
//     防路径逃逸由核心负责（workspaceRoot resolve 后必须在根内）。
//   · 依赖 `document` 的工具（run_conformance/generate_code）在纯 Node stdio 下无 document ⇒ 如实报错（不静默）。
//   · 仅 stdio；HTTP/SSE 传输不在本批。
export interface McpServeOptions {
  /** 开启写入闸（write_file）——缺省 false（只读安全） */
  allowWrite: boolean
  /** 写入根目录（防逃逸；缺省 process.cwd()） */
  workspaceRoot?: string
  /** 每分钟调用上限（缺省 60） */
  rateLimitPerMin?: number
}

/** 解析 `proteus mcp <sub> [flags]`——目前只支持 `serve` */
export function parseMcpArgs(argv: string[]): { sub: string; options: McpServeOptions } {
  const sub = argv[0]
  if (sub !== 'serve') {
    throw new Error(`未知子命令：${sub ?? '(空)'}（允许：serve）`)
  }
  const options: McpServeOptions = { allowWrite: false }
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--allow-write') options.allowWrite = true
    else if (a === '--workspace') {
      options.workspaceRoot = argv[i + 1]
      if (!options.workspaceRoot) throw new Error('--workspace 需要目录参数')
      i++
    } else if (a === '--rate-limit') {
      const n = Number(argv[i + 1])
      if (!Number.isFinite(n) || n <= 0) throw new Error(`--rate-limit 需要正数，收到：${argv[i + 1]}`)
      options.rateLimitPerMin = n
      i++
    } else {
      throw new Error(`未知参数：${a}`)
    }
  }
  return { sub, options }
}

/**
 * 启动 stdio MCP server（阻塞至 stdin 关闭/进程退出）。
 * ★注意：**所有输出走 stderr**——stdout 留给 JSON-RPC。
 */
export async function runMcpServe(options: McpServeOptions): Promise<void> {
  // 动态导入：让 CLI bundle 不硬捆 SDK（external），仅在真正 serve 时解析 @proteus-vue/mcp
  const { serveStdio } = await import('@proteus-vue/mcp')
  await serveStdio({
    writeEnabled: options.allowWrite,
    workspaceRoot: options.workspaceRoot,
    rateLimitPerMin: options.rateLimitPerMin,
    onReady: (info) => {
      // ★stderr（不是 stdout）：stdout 是协议通道
      process.stderr.write(
        `[proteus-mcp] ready · ${info.name} v${info.version} · ${info.tools} tools` +
          `${options.allowWrite ? ` · write=on(${options.workspaceRoot ?? process.cwd()})` : ' · read-only'}\n`,
      )
    },
  })
}
