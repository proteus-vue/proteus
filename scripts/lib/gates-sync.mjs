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
      // 行内命令：去掉引号包裹与行尾注释（` # …`，只在引号外截断）
      const hasQuote = /^['"]/.test(value)
      if (hasQuote) {
        // ★引号形态也要剥尾注释：`run: "pnpm run check:x" # 说明`（独立验证指出）
        const q = value[0]
        const end = value.lastIndexOf(q)
        if (end > 0 && /^\s*#/.test(value.slice(end + 1))) value = value.slice(0, end + 1)
      } else {
        const hash = value.search(/\s#/)
        if (hash >= 0) value = value.slice(0, hash).trim()
      }
      if (/^'.*'$/.test(value) || /^".*"$/.test(value)) value = value.slice(1, -1)
      if (value) out.push(value)
      continue
    }

    // 块标量：收敛后续「缩进更深」且非空的行；遇到缩进回退即结束
    let consumed = i
    for (let j = i + 1; j < lines.length; j++) {
      const bl = lines[j].replace(/\r$/, '')
      if (!bl.trim()) continue
      const bIndent = bl.length - bl.trimStart().length
      if (bIndent <= indent) break
      let t = bl.trim()
      consumed = j
      // ★块内 `#` 开头是真注释（脚本行），而 YAML 注释只可能在块外——两者都跳过
      if (t.startsWith('#')) continue
      const hash = t.search(/\s#/)
      if (hash >= 0) t = t.slice(0, hash).trim()
      if (t) out.push(t)
    }
    // ★块内被消费的行不得再进外层循环：`run: |` 块里若有一行写成 `run: pnpm run check:evil`
    //   （比如嵌入的示例脚本），会被外层当成"又一条真命令" ⇒ 凭空多一条接线证据（独立验证指出）。
    i = consumed
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
      // ★flag 必须**完整**命中：子串判据会让 `--check` 被 `--check-output`（写回）冒充——
      //   而这条判据的全部意义就是区分"比对"与"写回"（独立验证 2026-10-22 指出）。
      return flags.every((f) => hasFlagToken(seg, f))
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

/* ══════════════════════════════════════════════════════════════════════════
 * LOCAL_ONLY 台账（2026-10-22 · 决策 #1159）
 *
 * 【缺陷（承接 #1157 的残余通道）】原形态是 `LOCAL_ONLY = { 'check:x': '一句理由' }`：
 *   任一 `check:*` 只要在表里写一句话就**永久不进 CI**，而这张表 159 条里占了 58 条。
 *   三个后果（实测，非推测）：
 *     ① **黑洞**：其中 20 条**既不在 CI、也不在 `pnpm verify`** ⇒ 默认流程里谁也不跑它，
 *        但报表只写"声明仅本地"，读起来像"本地有跑"；
 *     ② **理由不设下限**：`'check:x': '本地跑'` 与 `'check:y': '需真机（CI 无设备）'` 等价，
 *        豁免面无法审计（增长也无人看得见）；
 *     ③ **台账会说谎**：声明"CI 跑不了"而 CI 其实已在跑，或声称"构建脚本会调"而脚本里没这回事，
 *        都无人发现（`coveredByCi` 命中时直接 `continue`，重叠不被报出）。
 * 【口径】把两个自由维度变成**闭合枚举 + 可取证字段**：
 *     `cat` = 为什么 CI 跑不了（10 类，每类都有结构判据或明确不可判定）；
 *     `run` = 那它到底由谁跑（8 种，能机器取证的就机器取证）。
 *   ★判据只做**能证伪**的那些：`run=verify/suite/build-script/ci` 全部独立取证；
 *     `manual/on-device/closeout` 不可判定 ⇒ 只要求"不许与事实矛盾"（它在 verify 里就不能说人工）
 *     + 计入统计，让人工触发面**可见**。这条边界写在报告里，不假装判得出"人工是否真跑了"。
 * ══════════════════════════════════════════════════════════════════════════ */

/** cat：CI 跑不了/不该跑的原因（闭合枚举——新增一类必须改这里，不能现编） */
export const LOCAL_ONLY_CATS = {
  device: '需真机/模拟器或真机产物（CI 无设备）',
  macos: '需 macOS 工具链（Xcode / Swift / Metal / JavaScriptCore）',
  sdk: '需 Android SDK / NDK / JDK 或 DevEco OHOS SDK',
  // ★2026-10-22 独立验证后新增：原来有个 `host-src` 类，理由写"CI 无宿主源码语境 ⇒ 扫不到文件"，
  //   实测**不成立**（hosts/** 是入库源码，CI checkout 就能扫）。把"跑不了"换成"选择不跑"——
  //   政策豁免是合理决策，但不能伪装成能力所限，否则豁免面永远无法复核。
  policy: '能跑但**选择**本地跑（省时/避免 CI 与本地各红一次——是政策，不是能力所限）',
  'machine-noise': '跨机不可比或环境漂移 ⇒ CI 上必假红',
  generator: '生成物基线类（改一次刷一次，产物入库）',
  closeout: '收尾/发布时显式调用（:strict 族）',
  covered: '已被 CI 或测试套件等价覆盖（重复接线无收益）',
  measure: '测量装置 / 非门禁（不判红，产出数据供决策）',
  'local-env': '依赖本机 gitignored 配置（CI 无该文件）',
}

/** run：它由谁执行（闭合枚举） */
export const LOCAL_ONLY_RUNS = {
  ci: '由某个 workflow 的 run 命令执行',
  verify: '由 `pnpm verify` 链执行（名字直接出现）',
  suite: '由 verify 链的测试套件覆盖（also 指定套件脚本名）',
  'build-script': '由某个构建/取证脚本调用（at 指向该脚本，脚本内必须真引用它）',
  closeout: '仅在收尾/发布时显式调用',
  'on-device': '仅上真机/取证时跑',
  manual: '仅人工择机跑',
  none: '完全不跑（只允许 cat=measure）',
}

/* ══════════════════════════════════════════════════════════════════════════
 * cat 的**结构谓词**（2026-10-22 · 决策 #1161）
 *
 * 【为什么需要】#1159 之后 10 类 cat 里有 5 类**只是标签**：`cat='macos'` 与
 *   `cat='sdk'` 写什么都行，判不出真伪 ⇒ 等于换了个马甲的"自由文本豁免"。
 *   而这两类的声明是**可验证的事实命题**：「这条门禁需要 X 工具链」——
 *   那就必须能在**命令与它调用的脚本**里找到 X 的使用痕迹。
 *
 * 【证据面】命令原文 + 它调用的**全部**入口脚本。
 *   ★只看第一个入口是错的：`check:ios-host` = `node build.mjs && node verify.mjs`，
 *     `build.mjs` 是 esbuild（纯 JS，零 Xcode），`verify.mjs` 才 `xcrun swiftc`——
 *     只取首个入口会把这条件误判成"无 macOS 依赖"（我第一版就踩了）。
 *
 * 【只收强 token】`metal` 这类两义词不收（"Metal 着色器" vs "材质"）：
 *   收了会造出**假绿**（标签说什么都"有证据"），比判不出更糟。
 * ══════════════════════════════════════════════════════════════════════════ */
export const CAT_EVIDENCE = {
  macos: /\b(?:xcrun|swiftc|swift-frontend|xcodebuild|simctl|xcode-select|actool|ibtool)\b|\/Applications\/Xcode/,
  sdk: /\b(?:ndk|javac|sdkmanager|aapt2|d8|bundletool|hvigor\w*|ohpm|deveco|arktsc|es2abc)\b|ANDROID_HOME|ANDROID_SDK_ROOT|ANDROID_NDK|JAVA_HOME/i,
}

/** 仍**只有标签、没有谓词**的 cat（报告里点名，别让人以为都验证过） */
export const CAT_LABEL_ONLY = ['policy', 'machine-noise']

/** 有结构谓词的 cat（`local-env` 的谓词是"被点名的文件不得入库"，与 CAT_EVIDENCE 的工具链证据不同型） */
export const CAT_PREDICATED = [...Object.keys(CAT_EVIDENCE), 'local-env']

/** 从理由文本里取"被点名的本机路径"（`local-env` 用：声明"CI 无该文件"就必须说清是哪个文件） */
export function citedPaths(text) {
  const out = new Set()
  const re = /(?:^|[\s（(、，,：:；;])((?:\.?[\w.-]+\/)+[\w.*-]+|[\w.-]+\.(?:json|env|properties|toml|ya?ml))/g
  let m
  while ((m = re.exec(String(text ?? '')))) out.add(m[1])
  return [...out]
}

/** 理由文本下限：敷衍豁免（"本地跑"/"ok"）在这里被拦（去空白后 ≥ 16 字） */
const WHY_MIN_CHARS = 16

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 从命令里取首个脚本文件（含 .py/.sh——`refsOf` 只认 mjs/ts/js，夹具类对不上）。
 *  ★扩展名后必须断词：否则 `data/package.json` 会被读成 `data/package.js`（= #1157 d 的同款缺陷，
 *    而 `package.js` 恰好是 `package.json` 的子串 ⇒ "构建脚本里提到 package.json" 就能冒充入口文件）。 */
function entryFileOf(cmd) {
  const m = String(cmd ?? '').match(/[\w./-]+\.(?:mjs|mts|ts|js|py|sh)(?![\w])/)
  return m ? m[0] : null
}

/** 命令里**所有**入口脚本（`a.mjs && b.mjs` 两个都要看——证据可能在后一个里） */
function entryFilesOf(cmd) {
  return [...new Set(String(cmd ?? '').match(/[\w./-]+\.(?:mjs|mts|ts|js|py|sh)(?![\w])/g) ?? [])]
}

/** 该段里是否出现完整路径 token（左右必须是分隔符，防 `x.mjs.bak` / `ax.mjs` 冒充） */
function hasFileToken(seg, file) {
  return new RegExp(`(?:^|[\\s;&|])${escapeRe(file)}(?=$|[\\s;&|])`).test(seg)
}

/** 该段里是否出现 **完整 flag**（`--check` 不得命中 `--check-output` / `--check=off`） */
function hasFlagToken(seg, flag) {
  const esc = escapeRe(flag)
  const re = new RegExp(`(?:^|[\\s;&|])${esc}(?=$|[\\s;&|])`)
  return re.test(seg)
}

/**
 * "某脚本里真的调用了这个门禁" —— **按执行形态判**，不按文本包含判。
 * ★这一条是 2026-10-22 独立验证打回的：原实现 `body.includes(name)` 会被
 *   ① 注释掉的旧行（`# pnpm run check:x 已废弃`）② `echo "记得跑 check:x"` ③ `# old: x.mjs`
 *   全部骗过 —— 与 #1157 关掉的那条假绿通道同源（"文本里有" ≠ "会被执行"）。
 */
function scriptInvokes(body, name, file) {
  for (const raw of String(body ?? '').split('\n')) {
    const line = raw.replace(/\s#.*$/, '').trim()
    if (!line || line.startsWith('#')) continue
    for (const seg of splitSegments(line)) {
      if (!isExecSegment(seg)) continue
      if (segmentRunsCheck(seg, name)) return true
      if (file && hasFileToken(seg, file)) return true
    }
  }
  return false
}

/** CI 侧：某个参数是否出现在**会被执行**的命令段里（`covered.also` 用） */
function runTextExecutes(runText, token) {
  for (const cmd of String(runText ?? '').split('\n')) {
    for (const seg of splitSegments(cmd)) {
      if (isExecSegment(seg) && hasFlagToken(seg, token)) return true
    }
  }
  return false
}

/** verify 链是否以包管理器形态执行了某个 script 名（`suite` 用，支持 test / test:cse-parity 等） */
function verifyRunsScript(verifyCmd, key) {
  return new RegExp(`(?:pnpm|npm|yarn)(?:\\s+-\\S+)*\\s+(?:run\\s+)?${escapeRe(key)}(?=$|[\\s;&|])`).test(verifyCmd)
}

/**
 * 审计 LOCAL_ONLY 台账（纯函数；IO 经 `io` 注入，便于单测）。
 *
 * @param {object} a
 * @param {Record<string,string>} a.localOnly 名字 → 理由（原有形态，保持不动）
 * @param {Record<string,{cat?:string,run?:string,at?:string,also?:string,evidence?:string}>} a.meta 名字 → 结构化元数据
 * @param {Record<string,string>} a.scripts package.json scripts
 * @param {Set<string>} a.coveredNames 已由 workflow 执行的 check:* 名
 * @param {string} a.verifyCmd `scripts.verify` 原文
 * @param {string} a.runText 全部 workflow run 命令拼文
 * @param {number} a.max 台账条目上限（棘轮：只减不增）
 * @param {Set<string>|null} a.trackedFiles 仓库已跟踪文件集（`local-env` 用它证伪"CI 无该文件"；缺省退化为提醒）
 * @param {{ exists: (p:string)=>boolean, read: (p:string)=>string }} a.io 文件访问（实现方负责把路径限制在仓库内）
 * @returns {{ findings: {level:'error'|'note', code:string, name:string, msg:string}[], stats: { total:number, byCat:Record<string,number>, byRun:Record<string,number>, unverifiable:string[], labelOnlyCats:string[], predicatedCats:string[] } }}
 */
export function auditLocalOnly({ localOnly = {}, meta = {}, scripts = {}, coveredNames = new Set(), verifyCmd = '', runText = '', max = Infinity, trackedFiles = null, io }) {
  const findings = []
  const err = (code, name, msg) => findings.push({ level: 'error', code, name, msg })
  const note = (code, name, msg) => findings.push({ level: 'note', code, name, msg })
  const readSafe = (p) => {
    try {
      return io && io.exists(p) ? String(io.read(p) ?? '') : ''
    } catch {
      return ''
    }
  }
  const names = Object.keys(localOnly)
  const inVerify = (n) => hasToken(verifyCmd, n)

  // ① 元数据齐备（三向：整条缺 / 缺 cat / 缺 run）
  //   ★`{}` 是 truthy：只判 `!meta[n]` 会让"名字 + `{}`"整段跳过 ⑥–⑪（独立验证实测的三条绕过路径）。
  for (const n of names) {
    const m0 = meta[n]
    if (!m0) {
      err('NO_META', n, 'LOCAL_ONLY 声明缺结构化元数据（cat/run）——"仅本地"必须同时说明「为什么跑不了」与「那由谁跑」')
      continue
    }
    if (!m0.cat) err('NO_META', n, '缺 cat（为什么 CI 跑不了/不该跑）：只写 run 等于豁免一个没人执行的门禁')
    if (!m0.run) err('NO_META', n, '缺 run（那它到底由谁跑）：只写 cat 等于"宣称跑不了"却没人接手')
  }
  for (const n of Object.keys(meta)) if (!(n in localOnly)) {
    err('ORPHAN_META', n, 'LOCAL_ONLY_META 有条目但 LOCAL_ONLY 没有对应理由——台账分裂（两处必须同名同步）')
  }

  const byCat = {}
  const byRun = {}
  const unverifiable = []
  for (const n of names) {
    const m = meta[n] ?? {}
    const why = String(localOnly[n] ?? '')
    const cmd = scripts[n]

    // ② 脚本存在（声明失效 = 台账说谎：报表里的"仅本地 N 个"虚高）
    if (!cmd) err('STALE_NAME', n, 'LOCAL_ONLY 声明已失效——package.json 里没有这个脚本（删掉声明或补回脚本）')
    // ③ 理由非敷衍
    if (why.replace(/\s+/g, '').length < WHY_MIN_CHARS) {
      err('THIN_WHY', n, `理由过短（去空白 < ${WHY_MIN_CHARS} 字）——豁免必须写明"CI 缺什么前置条件"，否则等于没写`)
    }
    // ④ 枚举
    if (m.cat && !(m.cat in LOCAL_ONLY_CATS)) err('UNKNOWN_CAT', n, `未知 cat「${m.cat}」——枚举：${Object.keys(LOCAL_ONLY_CATS).join(' / ')}`)
    if (m.run && !(m.run in LOCAL_ONLY_RUNS)) err('UNKNOWN_RUN', n, `未知 run「${m.run}」——枚举：${Object.keys(LOCAL_ONLY_RUNS).join(' / ')}`)
    if (m.cat) byCat[m.cat] = (byCat[m.cat] ?? 0) + 1
    if (m.run) byRun[m.run] = (byRun[m.run] ?? 0) + 1

    // ⑤ 声明与事实互斥：CI 已在跑它，却还声明"仅本地"（重叠原先被 continue 吞掉）
    if (coveredNames.has(n)) {
      err('STALE_DECL', n, 'CI 的 run 命令已在执行它，却仍登记为"仅本地"——声明与事实矛盾（删掉该声明）')
    }

    if (!m.run || !(m.run in LOCAL_ONLY_RUNS)) continue

    // ⑥ 通道自证（每种"有人跑"的说法都必须独立取证）
    if (m.run === 'ci' && !coveredNames.has(n)) {
      err('RUN_UNPROVEN', n, 'run=ci 但没有任何 workflow 的 run 命令执行它')
    }
    if (m.run === 'verify' && !inVerify(n)) {
      err('RUN_UNPROVEN', n, 'run=verify 但 `pnpm verify` 链里没有它（名字未出现）')
    }
    if (m.run === 'suite') {
      if (!m.also) err('RUN_UNPROVEN', n, 'run=suite 必须在 also 里写明套件脚本名（如 test / test:cse-parity）')
      else if (m.also !== 'test' && !scripts[m.also]) err('RUN_UNPROVEN', n, `run=suite 的 also=${m.also} 不是 package.json 里的脚本`)
      else if (!verifyRunsScript(verifyCmd, m.also)) err('RUN_UNPROVEN', n, `run=suite 声称由 ${m.also} 覆盖，但 verify 链没有执行它`)
    }
    if (m.run === 'build-script') {
      if (!m.at) err('RUN_UNPROVEN', n, 'run=build-script 必须用 at 指向调用它的脚本')
      else if (!readSafe(m.at)) err('RUN_UNPROVEN', n, `at 指向的脚本不存在或不可读：${m.at}`)
      else if (!scriptInvokes(readSafe(m.at), n, entryFileOf(cmd))) {
        err('RUN_UNPROVEN', n, `at=${m.at} 里没有**执行形态**的 ${n} 或它的入口文件（${entryFileOf(cmd) ?? '未知'}）——"构建时跑"未被证实（注释/echo 不算）`)
      }
    }
    // ⑦ 反向矛盾：明明在 verify 里跑，却标注成人工/真机/收尾/不跑
    if ((m.run === 'manual' || m.run === 'on-device' || m.run === 'closeout' || m.run === 'none') && inVerify(n)) {
      err('RUN_MISLABEL', n, `标注 run=${m.run}，但它实际在 \`pnpm verify\` 链里——通道标签与事实不符`)
    }
    // ⑧ 「完全不跑」只允许测量装置
    if (m.run === 'none' && m.cat !== 'measure') {
      err('NO_TRIGGER', n, 'run=none（谁也不跑）只允许 cat=measure——门禁声明成"仅本地"却没有任何人执行它 = 黑洞')
    }
    // ⑨ cat 的结构自洽（只做**能证伪**的三类；其余类别在报告里标"仅标签"）
    if (m.cat === 'generator') {
      const file = entryFileOf(cmd)
      const twin = Object.keys(scripts).find((k) => k.startsWith('gen:') && entryFileOf(scripts[k]) && entryFileOf(scripts[k]) === file)
      // 生成物基线类的本质 = 「同一个生成器有两种模式：写回 / 比对」。
      // 取证二选一：① 有 `gen:*` 写回对偶；② 本命令自带 `--check`（= 与写回同脚本、只是比对）。
      if (!twin && !/--check(?![\w])/.test(String(cmd ?? ''))) {
        err('CAT_STRUCTURE', n, `cat=generator 但既无 gen:* 写回对偶（入口 ${file ?? '未知'}）也不带 --check——生成物基线类必须能证明"产物是生成的"`)
      }
    }
    if (m.cat === 'closeout') {
      // 收尾族必须成对：`:strict`（强制）↔ 基座（提醒）。两个方向都查——
      // 只查 `:strict` 一侧时，把"基座 + :strict"整对删掉不会报警（独立验证指出），
      // 而"收尾强制"能力正是靠这对撑着的。
      if (n.endsWith(':strict')) {
        const base = n.slice(0, -':strict'.length)
        if (!scripts[base]) err('CAT_STRUCTURE', n, `cat=closeout 但基座脚本 ${base} 不存在——收尾族必须成对（基座 + :strict）`)
        else if (!inVerify(base)) err('CAT_STRUCTURE', n, `cat=closeout 但基座 ${base} 不在 verify 链里——"只在收尾显式调用"会变成"平时没人跑"`)
      } else if (scripts[`${n}:strict`] && !(`${n}:strict` in localOnly)) {
        err('CAT_STRUCTURE', n, `cat=closeout 且存在强制变体 ${n}:strict，但台账没登记它——成对判据不能只查一侧`)
      }
    }
    if (m.cat === 'covered') {
      if (!m.also) err('CAT_STRUCTURE', n, "cat=covered 必须用 also 写明被谁覆盖（套件脚本名，或一个 --flag 形态的 CI 参数）")
      else if (m.also === 'test' || scripts[m.also]) {
        // 套件通道：verify 链里必须以包管理器形态执行该脚本（test / test:cse-parity / lint …）
        if (!verifyRunsScript(verifyCmd, m.also)) err('CAT_STRUCTURE', n, `cat=covered 声称由 ${m.also} 覆盖，但 verify 链没有执行它`)
      } else if (!/^--[\w-]+$/.test(m.also)) {
        // ★裸词（`also: 'node'`）能在 CI 文本里遍地命中 ⇒ 等于没取证。只接受 flag 形态。
        err('CAT_STRUCTURE', n, `also 必须形如 --frozen-lockfile（当前「${m.also}」既不是套件脚本也不是 flag，任何命令都能碰运气命中）`)
      } else if (!runTextExecutes(runText, m.also)) {
        err('CAT_STRUCTURE', n, `cat=covered 声称已被「${m.also}」覆盖，但 CI 的 run 命令里没有这个参数`)
      }
    }
    // ⑨c ★cat 的证据判据（决策 #1161）：`macos` / `sdk` / `local-env` 的声明是**可证伪的事实命题**
    //   「这条门禁需要 X」⇒ 命令与它调用的脚本里必须真的用到 X；否则标签只是换马甲的自由文本。
    const pred = CAT_EVIDENCE[m.cat]
    if (pred) {
      const files = entryFilesOf(cmd)
      const hay = [String(cmd ?? ''), ...files.map((f) => readSafe(f))].join('\n')
      if (!pred.test(hay)) {
        err(
          'CAT_UNPROVEN',
          n,
          `cat=${m.cat}（${LOCAL_ONLY_CATS[m.cat]}）但命令与它调用的脚本（${files.join(' ') || '无'}）里找不到任何该类工具链证据` +
            `——要么错标（换个 cat），要么理由已过时（脚本早不依赖了）`,
        )
      }
    }
    if (m.cat === 'local-env') {
      // 「CI 无该文件」必须点名文件，且该文件**不能是入库文件**（入库 ⇒ CI checkout 就有）
      const cited = citedPaths(why)
      if (!cited.length) {
        err('CAT_UNPROVEN', n, 'cat=local-env 但理由里没点名任何本机文件/目录——"依赖本机配置"必须写清是哪个，否则无法复核')
      } else if (trackedFiles) {
        const tracked = cited.filter((p) => trackedFiles.has(p.replace(/^\.\//, '')))
        if (tracked.length) {
          err('CAT_UNPROVEN', n, `cat=local-env 但 ${tracked.join(' / ')} 是**入库**文件——CI checkout 就有，"CI 无该文件"不成立`)
        }
      } else {
        note('CAT_UNPROVEN', n, `cat=local-env 的本机路径未能机器核对（未提供 trackedFiles）：${cited.join(' / ')}`)
      }
    }
    // ⑨b measure 的判据（唯一能机判的"非门禁"）：脚本不得有失败退出路径
    if (m.cat === 'measure' && cmd) {
      const body = readSafe(entryFileOf(cmd))
      if (body && /process\.exit(?:\(1\)|Code\s*=\s*1)/.test(body)) {
        err('CAT_STRUCTURE', n, 'cat=measure（不判红）但脚本里有失败退出路径——它其实是门禁，请接 CI 或在 verify 里跑')
      }
    }
    // ⑩ 人工/真机类：不可机判 ⇒ 只统计（透明化，不假装判得出）
    if (m.run === 'manual' || m.run === 'on-device' || m.run === 'closeout') unverifiable.push(n)
    // ⑪ 信息位：device 类却没真机产物路径（可能是漏写，也可能是 macos 族混标）。
    //    ★先看它调用的脚本**内部**是否读 results/（很多判据把产物路径写死在脚本里，命令只传空参），
    //      否则每轮都出 4 条噪声"提醒"，提醒一多就没人看了。
    if (m.cat === 'device' && cmd && !/results\//.test(cmd) && m.evidence !== 'live') {
      if (!/results\//.test(readSafe(entryFileOf(cmd)))) {
        note('DEVICE_NO_ARTIFACT', n, 'cat=device 但命令与它调用的脚本里都没有真机产物路径（results/…）——确认不是 macos 族混标')
      }
    }
  }

  // ⑫ 棘轮：台账只减不增（新增豁免必须显式抬 max，会留在 diff 里被看见）
  if (names.length > max) {
    err('RATCHET', '(LOCAL_ONLY)', `仅本地声明 ${names.length} 条 > 上限 ${max}——豁免面只减不增：先设法接 CI，确需新增再抬 max 并说明`)
  }

  // ★诚实边界：这些 cat 目前**只有标签、没有谓词**（判不出真伪）——报告里点名，别让人以为都验证过
  const usedCats = new Set(Object.keys(byCat))
  return {
    findings,
    stats: {
      total: names.length,
      byCat,
      byRun,
      unverifiable,
      labelOnlyCats: CAT_LABEL_ONLY.filter((c) => usedCats.has(c)),
      predicatedCats: CAT_PREDICATED.filter((c) => usedCats.has(c)),
    },
  }
}
