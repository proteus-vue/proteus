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
/** 已打开文件的当前内容：补全时内容没变就复用，不必 close+open（省一次 scriptInfo 重建） */
const openText = new Map()
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

/** 把内存文本交给 tsserver（内容没变则跳过） */
async function ensureDoc(file, text) {
  if (open.has(file) && openText.get(file) === text) return
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
  openText.set(file, text)
}

async function diagnose(file, text) {
  await ensureDoc(file, text)

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

/**
 * 补全（决策 #1428）：`completionInfo` 直接返回候选列表。
 * `line` / `offset` 都是 **1-based**（tsserver 的约定），调用方不要做 0/1 转换。
 * 任何失败都回空列表 —— 补全失败不该在编辑器里弹错误。
 */
async function complete(id, file, rel, text, line, col) {
  try {
    await ensureDoc(file, text)
    /* ★自己取光标前的单词当 `prefix`：不传的话 tsserver 会把**全部**成员（实测 1084 条）
       都吐回来，跨 IPC 传一遍纯属浪费；传了通常只剩几十条，且更相关。 */
    const lineText = (text.split('\n')[line - 1] ?? '').slice(0, Math.max(0, col - 1))
    const prefix = /[\w$]+$/.exec(lineText)?.[0] ?? ''
    const info = await req('completionInfo', {
      file,
      line,
      offset: col,
      prefix,
      includeExternalModuleExports: true,
      includeInsertTextCompletions: true,
    })
    const items = (info?.entries ?? []).map((e) => ({
      label: e.name,
      /* tsserver 的 kind 是字符串：function / variable / property / keyword / interface… */
      kind: String(e.kind ?? ''),
      detail: String(e.kindModifiers ?? '').replace(/,/g, ' '),
      insert: e.insertText ?? e.name,
    }))
    out({ t: 'completions', id, path: rel, items })
  } catch (e) {
    out({ t: 'completions', id, path: rel, items: [], error: String(e?.message ?? e).slice(0, 120) })
  }
}

/**
 * 跳转定义（决策 #1429）：`definition` 返回 `[{file, start:{line, offset}}]`。
 * ★目标可能在别的文件（甚至 `node_modules` 里的 `.d.ts`），所以这里把绝对路径转成
 *   **仓库相对路径**再回给前端；不在仓库内的（如 `lib.dom.d.ts`）也如实返回绝对路径，
 *   由前端决定"跳过去还是提示一下"。
 */
async function definition(id, file, rel, text, line, col) {
  try {
    await ensureDoc(file, text)
    const res = await req('definition', { file, line, offset: col })
    const first = Array.isArray(res) ? res[0] : res
    if (!first?.file) {
      out({ t: 'definition', id, path: rel, target: null })
      return
    }
    const absTarget = String(first.file)
    const relTarget = path.isAbsolute(absTarget)
      ? path.relative(root, absTarget).split(path.sep).join('/')
      : absTarget
    out({
      t: 'definition',
      id,
      path: rel,
      target: {
        path: relTarget,
        line: Number(first.start?.line ?? 1),
        /* tsserver 的 FileSpan.offset 是 **1-based**（与 line 一致），不要再 +1 */
        col: Number(first.start?.offset ?? 1),
      },
    })
  } catch (e) {
    out({ t: 'definition', id, path: rel, target: null, error: String(e?.message ?? e).slice(0, 120) })
  }
}

/** 类型/符号信息（决策 #1429）：`quickinfo` 给 `displayString`（如 `(property) x: number`） */
async function quickinfo(id, file, rel, text, line, col) {
  try {
    await ensureDoc(file, text)
    const info = await req('quickinfo', { file, line, offset: col })
    out({
      t: 'quickinfo',
      id,
      path: rel,
      text: String(info?.displayString ?? ''),
      doc: String(info?.documentation ?? '').split('\n').slice(0, 2).join(' '),
    })
  } catch (e) {
    out({ t: 'quickinfo', id, path: rel, text: '', doc: '', error: String(e?.message ?? e).slice(0, 120) })
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
  if (m.t === 'complete') {
    if (!isSupported(rel)) {
      out({ t: 'completions', id: m.id, path: rel, items: [] })
      return
    }
    void complete(Number(m.id) || 0, abs(rel), rel, String(m.text ?? ''), Number(m.line) || 1, Number(m.col) || 1)
    return
  }
  if (m.t === 'definition') {
    if (!isSupported(rel)) {
      out({ t: 'definition', id: m.id, path: rel, target: null })
      return
    }
    void definition(Number(m.id) || 0, abs(rel), rel, String(m.text ?? ''), Number(m.line) || 1, Number(m.col) || 1)
    return
  }
  if (m.t === 'quickinfo') {
    if (!isSupported(rel)) {
      out({ t: 'quickinfo', id: m.id, path: rel, text: '', doc: '' })
      return
    }
    void quickinfo(Number(m.id) || 0, abs(rel), rel, String(m.text ?? ''), Number(m.line) || 1, Number(m.col) || 1)
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
