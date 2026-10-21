// scripts/lib/gates-sync.mjs —— 门禁接线判定（纯函数，零依赖）
//
// 【为什么单独成文件】`scripts/check-gates-sync.mjs`（2026-09-18）原先把判定写在脚本里，
//   于是"接线判定"本身无法被测试。2026-10-21 发现它有一条**假绿通道**：
//
//   `coveredByCi()` 除了按 `check:*` 名字匹配，还会拿「命令里的脚本文件路径是否出现在 CI 文本里」
//   当接线证据。而 `packages/cli/src/index.ts` 这种**共享入口**被 CI 广泛提及（不同子命令各一行），
//   任何经它实现的 `check:*`（例如 `npx tsx packages/cli/src/index.ts knowledge check`）
//   **在真正加 CI 步骤之前就已经被判"已接线"**——门禁没跑，但检查显示绿。
//   更弱的同类：CI 里对 `check:foo` 的**注释提及**也算命中（`CI_TEXT.includes(name)`）。
//
// 【口径（收紧后）】—— 每一条都对应一处实测过的假绿/假红
//   1. 只认**会被执行**的 `run:` 命令：注释行、`name:` 字段、`env:` 值一律不算；
//   2. 命令先按 `&&` `||` `|` `;` **切段**再判：否则"三脚本串联"的第一段会被整条尾巴
//      （`&& node b.mjs`）当成位置参数而永远匹配不上（实测 `check:dactyl-budget`）；
//   3. `echo` / `grep` / `cat` 这类**不执行门禁**的段直接跳过：`echo "注意 check:foo"` 不算接线；
//   4. 名字命中必须是**包管理器调用形态**（`pnpm run check:x` / `pnpm check:x`），
//      裸子串不算（`--note=check:foo`、`grep -r check:foo` 都不算）；
//   5. 文件命中要求**同段内**位置参数按序 + flag 子集命中（`--check` ≠ `--update`）；
//   6. 一个 `check:*` 里有**多个**脚本引用时，**每个**都得到场——任一命中就整体放行，
//      会让"删掉主脚本、只留兄弟脚本"仍然绿（实测 `check:dactyl-budget` 被 ceiling 顶替）；
//   7. `pnpm run check:x` 的间接引用仍递归解析（子脚本真接线也算父脚本接线）。
//
// 【诚实边界】YAML 解析是**行级**实现（不引第三方库）：支持 `run: <cmd>`、`run: |` / `>` /
//   `|2` 等块标量、`- run:` 列表项、缩进块终止、YAML 整行注释与命令尾注释。
//   **不支持**：锚点/别名/多文档、`uses:` 复合 action 与可复用 workflow 里的步骤、
//   `if:` / 分支 / matrix 条件（`check:live` 只在 `[deploy]` 跑却仍算"已接线"）。
//   本仓当前未使用这些形态；用到时本门禁会给出**假红**（安全方向），不会假绿。

/** 块标量标记：`|`、`>`、`|-`、`>-`、`|+`、`|2`、`>2-` 等（含显式缩进指示符） */
const BLOCK_SCALAR = /^[|>][+-]?\d*$/

/** 不执行门禁的段落首词（`echo "pnpm run check:x"` 不是接线） */
const NON_EXEC = /^(echo|printf|grep|rg|cat|ls|head|tail|sed|awk|true|false|exit|test|\[|:)$/

/**
 * 从一份 workflow 文本里抽出**会被执行**的命令行。
 *
 * @param {string} text workflow 源文本
 * @returns {string[]} 命令（按出现顺序；块标量已展开为逐行）
 */
export function extractRunCommands(text) {
  const out = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].replace(/\r$/, '')
    const m = raw.match(/^(\s*)(?:-\s+)?run:\s*(.*)$/)
    if (!m) continue
    const indent = m[1].length
    let value = m[2].trim()

    if (!BLOCK_SCALAR.test(value)) {
      // 行内命令：去掉引号包裹与行尾注释（` # …`，只在无引号时截断）
      const hasQuote = /^['"]/.test(value)
      if (!hasQuote) {
        const hash = value.search(/\s#/)
        if (hash >= 0) value = value.slice(0, hash).trim()
      }
      if (/^'.*'$/.test(value) || /^".*"$/.test(value)) value = value.slice(1, -1)
      if (value) out.push(value)
      continue
    }

    // 块标量：收敛后续「缩进更深」且非空的行；遇到缩进回退即结束
    for (let j = i + 1; j < lines.length; j++) {
      const bl = lines[j].replace(/\r$/, '')
      if (!bl.trim()) continue
      const bIndent = bl.length - bl.trimStart().length
      if (bIndent <= indent) break
      let t = bl.trim()
      if (t.startsWith('#')) continue
      const hash = t.search(/\s#/)
      if (hash >= 0) t = t.slice(0, hash).trim()
      if (t) out.push(t)
    }
  }
  return out
}

/**
 * 把命令切成"段"（`&&` / `||` / `|` / `;`）。★这一步是判据正确性的关键：
 * 不切段时 `node a.mjs && node b.mjs` 里的 `&&`/`node`/`b.mjs` 全被当成 a 的位置参数。
 *
 * @param {string} cmd
 * @returns {string[]}
 */
export function splitSegments(cmd) {
  return cmd
    .split(/\s*(?:&&|\|\||\||;)\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 该段是否真的会执行命令（`echo`/`grep`/`cat` 等不算） */
function isExecSegment(seg) {
  const first = seg.split(/\s+/)[0] ?? ''
  if (NON_EXEC.test(first)) return false
  // `sudo`/`env`/`exec`/`time` 前缀：看下一个词
  if (/^(sudo|env|exec|time|command|nohup)$/.test(first)) {
    const next = seg.split(/\s+/)[1] ?? ''
    return !NON_EXEC.test(next)
  }
  return true
}

/**
 * 从一条 npm script 命令里提取它调用的脚本文件 + `pnpm run` 子脚本。
 *
 * ★文件正则要求「至少一层目录」，这是刻意的：裸文件名在 CI 文本里毫无区分度。
 * ★`.sh`/`.py` 不在覆盖范围（23 个 check:* 属此列）——它们只能靠名字或 LOCAL_ONLY。
 *
 * @param {string} cmd
 * @returns {{ files: string[], subs: string[] }}
 */
export function refsOf(cmd) {
  // ★扩展名后必须断词：`\.js` 会命中 `app-stack.json` 的 `.js` 前缀 ⇒
  //   把**数据文件**当成脚本（实测 check:app-stack / check:host-runtime 的 results/*.json
  //   全被识别成 `*.js`，files 非空却永远匹配不上 ⇒ 判据被这些假条目搅乱）。
  const files = cmd.match(/(?:^|\s)(?:npx\s+tsx\s+)?(?:[\w.-]+\/)+[\w.-]+\.(?:mjs|ts|js)(?![\w])/g) ?? []
  const subs = (cmd.match(/pnpm run (check:[\w-]+)/g) ?? []).map((s) => s.replace('pnpm run ', ''))
  // 去掉 `npx tsx ` 前缀后再比：路径是**事实**，用什么 runner 跑是实现细节。
  // 留在串里会让"本地 `npx tsx x.ts` ⇄ CI `pnpm exec tsx x.ts`"这种同义写法对不上（假红）。
  return { files: files.map((f) => f.trim().replace(/^npx\s+tsx\s+/, '')), subs }
}

/** 词边界判断：`check:deps` 不应被 `pnpm run check:deps-extra` 命中 */
export function hasToken(text, token) {
  let from = 0
  for (;;) {
    const idx = text.indexOf(token, from)
    if (idx < 0) return false
    const before = idx === 0 ? '' : text[idx - 1]
    const after = text[idx + token.length] ?? ''
    // ★`.` 也算词内字符：否则 `check:knowledge` 会命中 `check:knowledge.disabled`
    //   （把"改了名的死命令"读成"真在跑"，又是一条假绿）。
    const isWord = (c) => c !== '' && /[\w:.-]/.test(c)
    if (!isWord(before) && !isWord(after)) return true
    from = idx + 1
  }
}

/**
 * 某条 CI 段是否在"执行"这个 `check:*`（包管理器调用形态）。
 * `pnpm run check:x` / `npm run check:x` / `pnpm check:x` / `pnpm -r run check:x` 都算；
 * `echo "check:x"` / `--note=check:x` / `grep -r check:x` 都不算（前两者已被段过滤或形态不符）。
 */
function segmentRunsCheck(seg, name) {
  if (!isExecSegment(seg)) return false
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|\\s)(?:pnpm|npm|yarn)(?:\\s+-\\S+)*\\s+(?:run\\s+)?${esc}(?=$|[\\s;&|])`).test(seg)
}

/**
 * 该命令是否"真的执行了"某个脚本文件：**同段内**路径命中 + 位置参数按序 + flag 子集。
 *
 * @param {string} cmd 本地 npm script 命令
 * @param {string} file 脚本路径（`refsOf` 的产物：已去 `npx tsx ` 前缀）
 * @param {string[]} runCommands
 * @returns {boolean}
 */
export function runsFile(cmd, file, runCommands) {
  const localSeg = splitSegments(cmd).find((s) => s.includes(file))
  if (!localSeg) return false
  const tail = localSeg.slice(localSeg.indexOf(file) + file.length)
  const tokens = tail.split(/\s+/).filter(Boolean)
  // 位置参数：不含 `-` 的词（`--check` 这类 flag 单独判）
  const positional = tokens.filter((t) => !t.startsWith('-'))
  // ★flag 也必须对上：`--check`（只比对）与 `--update`（写回）**语义相反**，
  //   把后者当接线等于"CI 在跑一个会改文件的命令，而门禁判据从未被执行"。
  const flags = tokens.filter((t) => t.startsWith('-'))
  return runCommands.some((rc) =>
    splitSegments(rc).some((seg) => {
      if (!isExecSegment(seg)) return false
      const i = seg.indexOf(file)
      if (i < 0) return false
      let cursor = i + file.length
      for (const p of positional) {
        const idx = seg.indexOf(p, cursor)
        if (idx < 0) return false
        cursor = idx + p.length
      }
      return flags.every((f) => seg.includes(f))
    }),
  )
}

/**
 * 判定某 `check:*` 是否已接线（CI 里真被执行 / 或经子脚本间接执行）。
 *
 * @param {object} args
 * @param {string} args.name `check:*` 名
 * @param {string} args.cmd 对应 npm script 命令
 * @param {string[]} args.runCommands `extractRunCommands()` 的结果
 * @param {Record<string,string>} args.scripts package.json 的 scripts
 * @param {number} [args.depth] 递归深度（防畸形自引用）
 * @returns {{ covered: boolean, via: 'name'|'file'|'sub'|null, detail?: string }}
 */
export function isCovered({ name, cmd, runCommands, scripts, depth = 0 }) {
  if (depth > 4) return { covered: false, via: null }
  if (runCommands.some((rc) => splitSegments(rc).some((seg) => segmentRunsCheck(seg, name)))) {
    return { covered: true, via: 'name' }
  }

  const { files, subs } = refsOf(cmd)
  // ★每个脚本引用都得到场：任一命中就放行会让"删掉主脚本、留兄弟脚本"仍然绿
  //   （实测 `check:dactyl-budget` 的主脚本被 `dactyl-ceiling.mjs` 顶替）。
  const filesOk = files.length > 0 && files.every((f) => runsFile(cmd, f, runCommands))
  if (filesOk) return { covered: true, via: 'file', detail: files.join(' + ') }
  for (const s of subs) {
    if (!scripts[s]) continue
    const r = isCovered({ name: s, cmd: scripts[s], runCommands, scripts, depth: depth + 1 })
    if (r.covered) return { covered: true, via: 'sub', detail: s }
  }
  return { covered: false, via: null }
}
