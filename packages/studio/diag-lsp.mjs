#!/usr/bin/env node
/**
 * diag-lsp.mjs —— Studio 的**内存级诊断服务**（决策 #1419 起 · #1420 改为 tsserver 驱动）
 *
 * 【演进过程（避免以后再走弯路）】
 *   1. `vue-tsc --watch`：只看磁盘 ⇒ 不保存不报（用户第一次不满）。
 *   2. Volar（`vue-language-server --stdio`）：实测**对 .ts 恒返回空**、
 *      对 .vue 只给模板/CSS 提示 —— 因为 **script 块与 .ts 的类型检查在 tsserver 侧**
 *      （Volar 的 typescript 语言特性由 tsserver 插件提供，单独跑 server 拿不到）。
 *   3. **tsserver（typescript 自带）**：`updateOpen` 支持 `fileContent`（内存文本，不落盘），
 *      `syntacticDiagnosticsSync` + `semanticDiagnosticsSync` 直接拉取
 *      ⇒ 实测**首次 ~3s（项目加载）、之后毫秒级**。不需要新依赖，且真正"输入即报"。
 *
 * 【协议（与 Rust 侧约定，未变）】
 *   stdin  ← {"t":"open","path":"a/b.ts","text":"..."} / {"t":"change",...} / {"t":"close","path":...}
 *   stdout → {"t":"diag","path":"a/b.ts","items":[{line,col,severity,code,message}]}
 *            {"t":"log","message":"..."}   {"t":"ready"}
 *
 * 【范围】Studio UI 下的 .ts/.tsx/.js；`.vue` 依赖 `@vue/typescript-plugin`（写进了
 *   `packages/studio/ui/tsconfig.json` 的 `compilerOptions.plugins`）把 SFC 虚拟化成 TS 再诊断。
 *
 * 【为什么"关闭再打开"而不是 didChange】tsserver 的 `updateOpen.changedFiles` **只接受文件名**，
 *   不能带新内容；`change` 命令则需要精确行列增量。用 close+open 传 `fileContent` 最简单可靠，
 *   代价是一次 scriptInfo 重建（实测毫秒级）。
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import readline from 'node:readline'

const root = process.argv[2]
if (!root) {
  out({ t: 'log', message: '缺少仓库根参数' })
  process.exit(2)
}

const tsserver = path.join(root, 'node_modules/typescript/lib/tsserver.js')
/* Studio UI 是唯一有 tsconfig.json 的目录（根 tsconfig 的 include 不含它，见 #1419） */
const PROJECT = path.join(root, 'packages/studio/ui')
const EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue']
const REQ_TIMEOUT = 15000

function out(o) {
  process.stdout.write(JSON.stringify(o) + '\n')
}

const isSupported = (p) => EXTS.some((e) => p.endsWith(e))
const abs = (p) => path.join(root, p)

/* ── tsserver 进程 ──────────────────────────────────────────────────────── */
const proc = spawn(process.execPath, [tsserver, '--disableAutomaticTypingAcquisition'], {
  cwd: root,
  stdio: ['pipe', 'pipe', 'pipe'],
})
proc.on('exit', (code) => out({ t: 'log', message: `tsserver 退出（code=${code}）` }))
proc.stderr.on('data', (b) => {
  const s = String(b).trim()
  if (/error|exception/i.test(s)) out({ t: 'log', message: s.slice(0, 300) })
})

let seq = 0
const pending = new Map() // seq → { resolve, reject, timer }
let buf = Buffer.alloc(0)

proc.stdout.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk])
  for (;;) {
    const i = buf.indexOf('\n')
    if (i < 0) return
    const line = buf.slice(0, i).toString('utf8')
    buf = buf.slice(i + 1)
    if (!line.trim()) continue
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      continue
    }
    if (msg.type === 'response' && typeof msg.request_seq === 'number') {
      const w = pending.get(msg.request_seq)
      if (!w) continue
      pending.delete(msg.request_seq)
      clearTimeout(w.timer)
      if (msg.success === false) w.reject(new Error(String(msg.message ?? 'tsserver 请求失败')))
      else w.resolve(msg.body)
    }
  }
})

function req(command, args) {
  const s = ++seq
  proc.stdin.write(JSON.stringify({ seq: s, type: 'request', command, arguments: args }) + '\n')
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(s)
      reject(new Error(`tsserver 超时：${command}`))
    }, REQ_TIMEOUT)
    pending.set(s, { resolve, reject, timer })
  })
}

/* ── 文档状态 ───────────────────────────────────────────────────────────── */
const open = new Set()
/** 诊断进行中又收到新文本 ⇒ 记下来，完成后用最新文本再跑一次 */
const latest = new Map()
const running = new Set()

function toItems(diags) {
  const list = []
  for (const d of diags ?? []) {
    list.push({
      line: d.start?.line ?? 1,
      col: (d.start?.offset ?? 0) + 1, // tsserver 的 offset 是 0-based
      severity: d.category === 'warning' ? 'warning' : 'error',
      code: String(d.code ?? 'ts'),
      message: String(d.text ?? '').split('\n')[0],
    })
  }
  return list
}

async function diagnose(file, text) {
  /* close+open：把**内存文本**塞进 tsserver（`changedFiles` 不接受内容） */
  if (open.has(file)) {
    await req('close', { file }).catch(() => {})
    open.delete(file)
  }
  await req('updateOpen', {
    openFiles: [{ file, fileContent: text, projectRootPath: PROJECT }],
    changedFiles: [],
    closedFiles: [],
  })
  open.add(file)

  /* `.vue` 交给 @vue/typescript-plugin 虚拟化；它的 syntactic 可能不实现 ⇒ 失败当空 */
  const [syn, sem] = await Promise.all([
    req('syntacticDiagnosticsSync', { file }).catch(() => []),
    req('semanticDiagnosticsSync', { file }).catch(() => []),
  ])
  const items = [...toItems(syn), ...toItems(sem)]
  /* 去重：同一位置同类消息可能语法/语义两边都给 */
  const seen = new Set()
  return items.filter((i) => {
    const k = `${i.line}:${i.col}:${i.message}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

async function run(file, rel, text) {
  if (running.has(file)) {
    latest.set(file, { rel, text })
    return
  }
  running.add(file)
  try {
    const items = await diagnose(file, text)
    const nx = latest.get(file)
    if (nx && nx.text !== text) {
      /* 诊断期间文本又变了 ⇒ 丢弃这次结果（否则旧文本的错误会画在新内容上），用最新文本重跑 */
      latest.delete(file)
      running.delete(file)
      return run(file, nx.rel, nx.text)
    }
    latest.delete(file)
    out({ t: 'diag', path: rel, items })
  } catch (e) {
    out({ t: 'log', message: `诊断失败：${String(e?.message ?? e).slice(0, 160)}` })
  } finally {
    running.delete(file)
  }
}

/* 就绪信号：tsserver 没有显式 ready，发一次 configure 确认管道通 */
req('configure', { preferences: {} })
  .catch(() => {})
  .finally(() => out({ t: 'ready' }))

/* ── Rust → 本进程 ──────────────────────────────────────────────────────── */
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let m
  try {
    m = JSON.parse(line)
  } catch {
    return
  }
  const rel = m.path ?? ''
  if (m.t === 'open' || m.t === 'change') {
    if (!isSupported(rel)) return
    void run(abs(rel), rel, String(m.text ?? ''))
    return
  }
  if (m.t === 'close') {
    const file = abs(rel)
    latest.delete(file)
    if (open.delete(file)) void req('close', { file }).catch(() => {})
    return
  }
  if (m.t === 'shutdown') {
    proc.kill()
    process.exit(0)
  }
})

process.on('SIGTERM', () => {
  proc.kill()
  process.exit(0)
})
