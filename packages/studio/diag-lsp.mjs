#!/usr/bin/env node
/**
 * diag-lsp.mjs —— Studio 的**内存级语言服务桥**（决策 #1419）
 *
 * 【为什么要它】`vue-tsc --watch` 只能看**磁盘**，所以"敲错但没保存"永远不报 ——
 *   用户实测两次都不满意。主流 IDE（含 VS Code 的 Vue 支持）走的是 **Volar 语言服务**：
 *   编辑器把**内存里的文本**通过 `textDocument/didOpen|didChange` 推给服务端，
 *   服务端毫秒级回 `publishDiagnostics`，**不需要保存**。
 *
 * 【本脚本职责】极简 LSP 客户端：
 *   · 起 `vue-language-server --stdio`（Volar），转发 initialize / didOpen / didChange / didClose；
 *   · 把服务端的诊断事件降级成**行 JSON** 打到 stdout 给 Rust；
 *   · 从 stdin 读 Rust 的指令（行 JSON）。
 *
 * 【协议（与 Rust 侧一致）】
 *   stdin  ← {"t":"open","path":"a/b.vue","text":"..."}
 *            {"t":"change","path":"a/b.vue","text":"..."}
 *            {"t":"close","path":"a/b.vue"}
 *            {"t":"shutdown"}
 *   stdout → {"t":"diag","path":"a/b.vue","items":[{line,col,endLine,endCol,severity,code,message}]}
 *            {"t":"log","message":"..."}      // 诊断自身故障时，让界面能说清原因
 *            {"t":"ready"}                    // initialize 完成
 *
 * 【安全边界】参数全部来自 Rust（root 路径固定），不接受任意命令；只读文件 + 内存文本。
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const root = process.argv[2]
if (!root) {
  out({ t: 'log', message: '缺少仓库根参数' })
  process.exit(2)
}

const bin = path.join(root, 'node_modules/.bin/vue-language-server')
if (!existsSync(bin)) {
  out({ t: 'log', message: `缺少 vue-language-server（${bin}）—— 需要安装 @vue/language-server` })
  process.exit(3)
}

const send = (o) => process.stdout.write(JSON.stringify(o) + '\n')
/* 别名，避免和 LSP 的 jsonrpc `send` 混淆 */
function out(o) {
  send(o)
}

/* ── LSP 子进程 ──────────────────────────────────────────────────────────── */
const server = spawn(bin, ['--stdio'], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] })
server.stderr.on('data', (b) => {
  const s = String(b).trim()
  /* 服务端的 stderr 多半是噪音；只在像错误时上报，避免刷屏 */
  if (/error|exception|failed/i.test(s)) out({ t: 'log', message: s.slice(0, 300) })
})
server.on('exit', (code) => out({ t: 'log', message: `语言服务退出（code=${code}）` }))

/* JSON-RPC over stdio：Content-Length 分帧 */
let buf = Buffer.alloc(0)
server.stdout.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk])
  for (;;) {
    const headerEnd = buf.indexOf('\r\n\r\n')
    if (headerEnd < 0) return
    const header = buf.slice(0, headerEnd).toString('utf8')
    const m = /Content-Length:\s*(\d+)/i.exec(header)
    if (!m) {
      buf = buf.slice(headerEnd + 4)
      continue
    }
    const len = Number(m[1])
    const start = headerEnd + 4
    if (buf.length < start + len) return
    const body = buf.slice(start, start + len).toString('utf8')
    buf = buf.slice(start + len)
    try {
      onMessage(JSON.parse(body))
    } catch (e) {
      out({ t: 'log', message: `解析 LSP 消息失败：${String(e).slice(0, 120)}` })
    }
  }
})

function write(msg) {
  const body = JSON.stringify({ jsonrpc: '2.0', ...msg })
  server.stdin.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`)
}

/* ── 文档与版本 ──────────────────────────────────────────────────────────── */
const versions = new Map() // path -> version
const known = new Set()

const uriOf = (p) => 'file://' + encodeURI(path.join(root, p)).replace(/#/g, '%23')
const pathOf = (uri) => decodeURI(uri.replace(/^file:\/\//, ''))

function langId(p) {
  if (p.endsWith('.vue')) return 'vue'
  if (p.endsWith('.tsx')) return 'typescriptreact'
  if (p.endsWith('.ts')) return 'typescript'
  if (p.endsWith('.jsx')) return 'javascriptreact'
  if (/\.(js|mjs|cjs)$/.test(p)) return 'javascript'
  return 'plaintext'
}

function onMessage(msg) {
  if (msg.method === 'textDocument/publishDiagnostics') {
    const p = pathOf(msg.params.uri)
    /* 只关心仓库内路径（Volar 也会推 node_modules 里文件） */
    const rel = path.isAbsolute(p) ? path.relative(root, p).split(path.sep).join('/') : p
    if (!rel || rel.startsWith('..')) return
    const items = (msg.params.diagnostics || []).map((d) => ({
      line: d.range.start.line + 1,
      col: d.range.start.character + 1,
      severity: d.severity === 2 ? 'warning' : 'error',
      code: String(d.code ?? 'vue'),
      message: String(d.message || '').split('\n')[0],
    }))
    out({ t: 'diag', path: rel, items })
    return
  }
  /* 服务端发来的请求（如 window/workDoneProgress/create、client/registerCapability）要回空结果，
     否则它会一直等，导致后续诊断不推 */
  if (msg.id !== undefined && msg.method) {
    write({ id: msg.id, result: null })
    return
  }
  if (msg.id !== undefined && msg.method === undefined) {
    /* initialize 的响应 */
    if (msg.result?.capabilities) {
      write({ method: 'initialized', params: {} })
      out({ t: 'ready' })
    }
  }
}

/* ── 初始化 ─────────────────────────────────────────────────────────────── */
write({
  id: 1,
  method: 'initialize',
  params: {
    processId: process.pid,
    rootUri: uriOf(''),
    workspaceFolders: [{ uri: uriOf(''), name: 'proteus' }],
    capabilities: {
      textDocument: {
        publishDiagnostics: { relatedInformation: false },
        synchronization: { didSave: false, dynamicRegistration: false },
      },
      workspace: { configuration: false, workspaceFolders: false },
    },
    initializationOptions: {
      /* 明确 tsdk：否则服务端可能用内置的旧 TS，与仓库版本不一致会报一堆假错 */
      typescript: { tsdk: path.join(root, 'node_modules/typescript/lib') },
      vue: { hybridMode: false },
    },
  },
})

/* ── Rust → 本进程（行 JSON）─────────────────────────────────────────────── */
readline
  .createInterface({ input: process.stdin })
  .on('line', (line) => {
    let m
    try {
      m = JSON.parse(line)
    } catch {
      return
    }
    const p = m.path
    if (m.t === 'open' || m.t === 'change') {
      const v = (versions.get(p) ?? 0) + 1
      versions.set(p, v)
      if (m.t === 'open' && !known.has(p)) {
        known.add(p)
        write({
          method: 'textDocument/didOpen',
          params: { textDocument: { uri: uriOf(p), languageId: langId(p), version: v, text: m.text } },
        })
      } else {
        /* 全量替换：简单可靠（增量 range 需要精确的 range 计算，收益不大） */
        write({
          method: 'textDocument/didChange',
          params: { textDocument: { uri: uriOf(p), version: v }, contentChanges: [{ text: m.text }] },
        })
      }
      return
    }
    if (m.t === 'close') {
      if (known.delete(p)) {
        write({ method: 'textDocument/didClose', params: { textDocument: { uri: uriOf(p) } } })
      }
      versions.delete(p)
      return
    }
    if (m.t === 'shutdown') {
      try {
        write({ id: 999, method: 'shutdown', params: null })
        write({ method: 'exit' })
      } catch {
        /* 忽略 */
      }
      server.kill()
      process.exit(0)
    }
  })

process.on('SIGTERM', () => {
  server.kill()
  process.exit(0)
})
