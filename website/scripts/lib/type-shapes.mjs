// website/scripts/lib/type-shapes.mjs
// ★★★#1161：**类型"形态"抽取**——从 TS 源码文本里认出"这几种类型长什么样"。
//
// 【为什么单列（用户实测驱动）】
//   用户点名的两个缺口都出在"形态识别"上：
//     · `FetchCacheMode` = **字符串字面量联合**（`'a' | 'b'`）——官网只有裸名字，没有取值说明；
//     · `CapError` = **class**（且字段是构造参数属性 `public readonly code: string`）——官网无属性表。
//   而 `gen-content.mjs` 已 2392 行（`check:file-size` 棘轮：存量只增不减）⇒ 新增形态识别不能内联。
//   ⇒ 本文件只做**纯函数形态识别**，不含任何渲染/IO；gen-content 负责把结果渲染成 Markdown。
//
// 【诚实边界】这是**文本扫描**而非真 TS 解析（生成器不能引 TS 编译器重依赖）。
//   支持形态与各自的判据见下；不认识的一律返回 null（**不猜**）。

import fs from 'node:fs'
import path from 'node:path'

/** 去注释与行内注释（保留换行；用于"这个 RHS 里还有没有类型名"这类结构判断）。 */
export function stripCommentsKeepLines(text) {
  return String(text)
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''))
    .replace(/\/\/[^\n]*/g, '')
}

/**
 * 认 **字符串字面量联合**：`export type X = 'default' | 'no-store' | …`
 *
 * @param {string} rhs 等号右侧原文
 * @returns {string[]|null} 取值列表；不是纯字符串字面量联合 ⇒ null
 *
 * 【口径】去掉所有字符串字面量与注释后，只允许 `|` 与空白——否则就是
 *   "字面量 + 类型名"的混合联合（如 `'auto' | ProtocolName`），那不是枚举，交给 alias 逻辑。
 */
export function stringLiteralUnion(rhs) {
  if (typeof rhs !== 'string') return null
  const lits = [...rhs.matchAll(/'([^']*)'|"([^"]*)"/g)].map((x) => x[1] ?? x[2])
  if (!lits.length) return null
  const stripped = stripCommentsKeepLines(rhs.replace(/'[^']*'|"[^"]*"/g, ''))
  if (stripped.replace(/[|\s]/g, '') !== '') return null
  return lits
}

/**
 * 认 **对象字面量联合**：`export type X = { bytes: … } | { path: string }`
 *
 * @param {string} rhs 等号右侧原文
 * @returns {Array<{name:string, optional:boolean, type:string}>|null}
 *
 * 【口径】至少一个 `{…}` 分支，且去掉所有 `{…}` 后只允许 `|`/空白/注释
 *   （否则是"对象 + 类型名"混合联合，语义不明，不猜）。
 * 【限制】分支内的 JSDoc 只用于跳过，不抽取为属性说明（本仓这类联合无逐属性 JSDoc）。
 */
export function objectLiteralUnion(rhs) {
  if (typeof rhs !== 'string' || !/\{/.test(rhs)) return null
  const branches = [...rhs.matchAll(/\{([\s\S]*?)\}/g)].map((x) => x[1])
  if (!branches.length) return null
  const stripped = stripCommentsKeepLines(rhs.replace(/\{[\s\S]*?\}/g, ''))
  if (stripped.replace(/[|\s]/g, '') !== '') return null
  const props = []
  const seen = new Set()
  for (const b of branches) {
    for (const line of b.split('\n')) {
      const t = line
        .trim()
        .replace(/^\/\*\*?|\*\/$/g, '')
        .replace(/^\*\s?/, '')
        .trim()
      const pm = t.match(/^(?:readonly\s+)?(\w+)(\?)?\s*:\s*([^;]+)/)
      if (!pm || seen.has(pm[1])) continue
      seen.add(pm[1])
      props.push({ name: pm[1], optional: pm[2] === '?', type: pm[3].trim().replace(/,$/, ''), doc: '' })
    }
  }
  return props.length ? props : null
}

/**
 * 认 **函数类型别名**：`export type X = (a: T, b?: U) => R`
 *
 * @param {string} rhs
 * @returns {{sig:string, args:string, ret:string}|null}
 */
export function functionAlias(rhs) {
  if (typeof rhs !== 'string') return null
  const fn = rhs.match(/^\s*\(([\s\S]*?)\)\s*=>\s*([^\n;]+)/)
  if (!fn) return null
  // 参数里出现 `{` / `|` ⇒ 是对象/联合类型而不是简单参数表（本仓无此形态，不猜）
  if (/[{|]/.test(fn[1])) return null
  return { sig: `(${fn[1].trim()}): ${fn[2].trim()}`, args: fn[1], ret: fn[2].trim() }
}

/**
 * 认 **class 的构造参数属性**（TS parameter properties）：
 *   `constructor(public readonly code: string, message: string, public readonly cause?: unknown)`
 *
 * @param {string} line 一行源码
 * @returns {Array<{name:string, optional:boolean, type:string, doc:string}>}
 *
 * 【注意】无修饰符的构造参数（`message: string`）**也是实例字段**（赋值给 this），
 *   由调用方的通用属性规则收；本函数只收带 `public/protected/private` 的，
 *   避免与那条规则重复（重复会让属性表出现两行同名）。
 */
export function parameterProperties(line) {
  const out = []
  if (typeof line !== 'string') return out
  for (const m of line.matchAll(/\b(?:public|protected|private)\s+(?:readonly\s+)?(\w+)(\?)?\s*:\s*([^,)]+)/g)) {
    out.push({ name: m[1], optional: m[2] === '?', type: m[3].trim().replace(/,$/, ''), doc: '' })
  }
  return out
}

/**
 * 取 `export type NAME = …` 的等号右侧原文（直到下一个顶层 `export`）。
 *
 * @param {string} src  整个源集合（多文件拼接）
 * @param {string} name 类型名
 * @returns {string|null}
 */
export function typeAliasRhs(src, name) {
  const re = new RegExp(`export type ${name}\\s*=([^\\n]*(?:\\n(?!export )[^\\n]*)*)`)
  const m = String(src).match(re)
  return m ? m[1] : null
}

/**
 * ★★★#1161：枚举 `packages/api/src/` 下**所有**导出类型名（跨文件）。
 *
 * 【为什么必须扫全仓（而不是用生成器的 API_SRC_FILES）】
 *   后者正是可能漏登记的那份清单——用它做判据基准等于"用被测对象证明自己正确"。
 *   用户实测的 `FetchCacheMode` 就是这样长期不在检查范围内：源文件没登记 ⇒ 类型不进 ifaces
 *   ⇒ 悬空引用检查静默跳过 ⇒ 门禁全绿而官网无说明。
 *
 * @param {string} apiSrcDir `packages/api/src` 绝对路径
 * @returns {Set<string>}
 */
export function collectExportedTypeNames(apiSrcDir) {
  const names = new Set()
  for (const f of fs.readdirSync(apiSrcDir)) {
    if (!f.endsWith('.ts') || f.endsWith('.d.ts')) continue
    const txt = fs.readFileSync(path.join(apiSrcDir, f), 'utf8')
    for (const m of txt.matchAll(/^export\s+(?:interface|type|class)\s+(\w+)/gm)) names.add(m[1])
  }
  return names
}

/**
 * ★★★#1161：从类型 JSDoc 里抽**单个取值**的说明（官网取值表的"说明"列）。
 *
 * 约定（本仓现有写法）：`` · `no-store` = 不读也不写缓存； ``
 *   ⇒ 按反引号里的取值名 + `=` / `：` 取到该分句；取不到返回 ''（渲染 `—`，**不编造**）。
 */
export function unionValueDoc(doc, value) {
  if (!doc) return ''
  const esc = String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp('`' + esc + '`\\s*(?:=|：|:)\\s*([^·;\\n]+)', 'i')
  const m = String(doc).match(re)
  return m ? m[1].trim().replace(/[；;。]$/, '') : ''
}

/**
 * ★★★#1161：往 `lines` 追加**联合类型的取值表**（两条渲染路径共用：h2 页级类型引用 / h3 段内）。
 *
 * @param {string[]} lines 目标行数组
 * @param {{union?: string[], doc?: string}} ti 类型条目
 * @param {(s:string)=>string} escMd 竖线转义（调用方的本地约定）
 * @returns {boolean} 是否追加了内容
 */
export function renderUnionTable(lines, ti, escMd) {
  if (!ti?.union?.length) return false
  lines.push('| 取值 | 说明 |')
  lines.push('|---|---|')
  for (const v of ti.union) {
    lines.push(`| \`'${escMd(v)}'\` | ${unionValueDoc(ti.doc, v) || '—'} |`)
  }
  lines.push('')
  return true
}

/** JSDoc 归一（去注释壳与首尾空行，**内部空行保留**——Markdown 表格/列表靠空行分隔）。 */
function normalizeJsdoc(raw) {
  const ls = String(raw ?? '')
    .replace(/^\/\*\*/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map((l) => l.replace(/^\s*\*\s?/, '').trim())
  while (ls.length && !ls[0]) ls.shift()
  while (ls.length && !ls[ls.length - 1]) ls.pop()
  return ls.join('\n')
}
export function extractInterfaces(src) {
  const out = {}
  // ★官网漏修（2026-09-11）：原正则只认 `export interface X {` —— 漏三类 → 官网方法表缺失：
  //   ① extends（BluetoothAPI extends BluetoothInfo / NFCAPI extends NfcInfo）
  //   ② 单行接口（MapPolyline/MapCircle `{ ... }` 同行——还会吞掉紧随的 MapController）
  //   ③ 带泛型默认值的接口（ReactiveStorage<TState extends ... = ...>）
  // ★★★#1161：**class 也要收**（`CapError` 是 `export class`，被 `CapResult` 引用 ⇒ 每页都出现
  //   `CapError` 却解释不了）。class 的 public 字段 + 构造参数即"属性"；方法抽取沿用行级规则。
  //   改：定位每个 `export interface|class NAME`，从其后第一个 `{` 起花括号配对取 body（含跨行/单行/extends/泛型）。
  const re = /(?:\/\*\*((?:[^*]|\*(?!\/))*)\*\/\s*)?export (?:interface|class) (\w+)([^{;]*?)\{/g
  let m
  while ((m = re.exec(src))) {
    const jsdoc = m[1]
    const name = m[2]
    // extends 基名（如 ` extends BluetoothInfo）——合并父接口属性到本接口
    const extM = (m[3] || '').match(/extends\s+([\w.]+)/)
    const extendsName = extM ? extM[1] : null
    const braceStart = m.index + m[0].length - 1
    // 花括号配对（跳过字符串/注释简化：capability.ts 接口体无嵌套模板串干扰）
    let depth = 0
    let i = braceStart
    for (; i < src.length; i++) {
      const ch = src[i]
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) break
      }
    }
    const body = src.slice(braceStart + 1, i)
    re.lastIndex = i + 1
    const props = []
    // ★官网漏修：属性解析改**行级**（原多行正则会把 `getAdapterState(): Promise<CapResult<{ available: boolean; ... }>>`
    //   的参数碎片误当属性 → 类型截断）。行级规则：跳过注释行 / 含 `(` 的方法行 / 含 `<` 泛型参数行，仅收 `name?: type`。
    {
      const propLines = body.split('\n')
      let pdoc = ''
      // 顶层 ; 切分（单行接口 `a: X; b: Y` 拆成多条，尊重 <>{}()[] 嵌套）
      const splitTop = (str) => {
        const out = []
        let depth = 0
        let cur = ''
        for (const ch of str) {
          if ('<({['.includes(ch)) depth++
          else if ('>)}]'.includes(ch)) depth--
          if (ch === ';' && depth === 0) { out.push(cur); cur = '' } else cur += ch
        }
        if (cur.trim()) out.push(cur)
        return out
      }
      for (const rawLine of propLines) {
        const t = rawLine.trim()
        if (!t) continue
        // 含顶层 ; 的单行多属性 → 逐个（注释缓冲只在首个生效）
        const segs = splitTop(t)
        if (segs.length > 1) {
          for (const seg of segs) {
            const pm = seg.trim().match(/^(\w+)(\?)?:\s*(.*)$/)
            if (pm) props.push({ name: pm[1], optional: pm[2] === '?', type: pm[3].trim(), doc: pdoc.trim() })
          }
          pdoc = ''
          continue
        }
        if (t.startsWith('/**') || t.startsWith('*') || t.startsWith('*/')) {
          pdoc = (pdoc ? pdoc + ' ' : '') + t.replace(/^\/\*\*/, '').replace(/\*\/$/, '').replace(/^\*\s?/, '').trim()
          continue
        }
        // 方法行（`name(...): T` 形态）→ 跳过且清零文档缓冲
        // ★★★#1122：**函数类型的属性行不能跳**——`onChunk?: (chunk, seq) => void` 也是 `name?: type`，
        //   只是 type 里带 `(`。旧规则见 `(` 就跳过 ⇒ 官网能力页**静默丢掉所有回调型字段**
        //   （本轮实测：useFetch 的 onChunk 在生成的参数表里完全消失）。
        //   ⇒ 判据改成"**在 `:` 之前**出现 `(` 才算方法"。
        if (/^\w+\s*\(/.test(t)) { pdoc = ''; continue }
        // 属性行：类型可含嵌套对象/泛型（内部含 `;`）——取整行，再剥尾分号与行尾 // 注释
        // 剥行尾 // 注释（引号内的 // 罕见——capability.ts 接口属性注释均在行尾且无 // 字符串）
        const commentM = t.match(/^([\s\S]*?)\s*\/\/(.*)$/)
        const noComment = (commentM ? commentM[1] : t).replace(/;\s*$/, '')
        const inline = commentM ? commentM[2].trim() : ''
        // ★#1124：支持 `readonly` 修饰符——`readonly aborted: boolean` 原被整行丢弃
        //   （导致 AbortSignalLike 在文档里只有一句说明、**没有属性表**）
        const pm = noComment.match(/^(?:readonly\s+)?(\w+)(\?)?:\s*(.*)$/)
        if (pm) {
          // ★#1161：构造参数属性行尾带逗号（`message: string,`）⇒ 去掉行尾逗号，
          //   否则官网属性表出现 `string,`（实测 CapError.message）。
          props.push({
            name: pm[1],
            optional: pm[2] === '?',
            type: pm[3].trim().replace(/,$/, ''),
            doc: (pdoc || inline).trim(),
          })
        }
        // ★★★#1161：**class 的构造参数属性**（TS parameter properties）
        //   `constructor(public readonly code: string, message: string, public readonly cause?: unknown)`
        //   ⇒ 这些是实例字段，等价于 interface 的属性。CapError 只有这个形态 ⇒ 不抽则官网
        //   每页都引用 `CapError` 却没有属性表（用户实测"自定义类型没有单独说明"的同族）。
        props.push(...parameterProperties(t))
        pdoc = ''
      }
    }
    // 方法成员（行级解析——capability.ts 接口成员均为单行；JSDoc 缓冲遇非注释行即清零）
    // ★详细文档（2026-09-11）：保留 rawDoc（含 @param/@returns）+ 解析参数，供「逐方法详细段」生成
    const methods = []
    let mdocLines = []
    const parseMethodDoc = (raw) => {
      const lines = raw
        .replace(/^\/\*\*/, '')
        .replace(/\*\/$/, '')
        .split('\n')
        .map((l) => l.replace(/^\s*\*\s?/, '').trim())
      const paramDocs = {}
      let returns = ''
      const prose = []
      for (const l of lines) {
        let mm
        if ((mm = l.match(/^@param\s+(\w+)\s*(?:-|—)?\s*(.*)$/))) paramDocs[mm[1]] = mm[2].trim()
        else if ((mm = l.match(/^@returns?\s*(?:-|—)?\s*(.*)$/))) returns = mm[1].trim()
        else if (l.startsWith('@')) continue
        else prose.push(l)
      }
      return { doc: normalizeJsdoc(prose.join('\n')), paramDocs, returns } // ★保留行结构；cell 消费点过 oneline()
    }
    for (const raw of body.split('\n')) {
      const t = raw.trim()
      if (t.startsWith('/**') || t.startsWith('*') || t.startsWith('*/')) {
        mdocLines.push(t)
        continue
      }
      const mm = t.match(/^(\w+)\s*\((.*)\)\s*:\s*(.+?);?$/)
      if (mm) {
        const parsed = mdocLines.length ? parseMethodDoc(mdocLines.join('\n')) : { doc: '', paramDocs: {}, returns: '' }
        methods.push({ name: mm[1], sig: `${mm[1]}(${mm[2]}): ${mm[3].replace(/;$/, '')}`, args: mm[2], ret: mm[3].replace(/;$/, ''), doc: parsed.doc, paramDocs: parsed.paramDocs, returns: parsed.returns })
      }
      mdocLines = []
    }
    out[name] = {
      // ★★保留换行（2026-09-30 用户反馈「这块儿排版是不是乱了？」）：
      //   原 `.join(' ')` 把多行 JSDoc 压成一行 ⇒ 源码里的 **Markdown 表格**（如 C82 的
      //   「端 | 入口 | 首参」四行）在页面上退化成一大段普通文字（截图实测）。
      //   Markdown 的表格/列表/段落块都需要**行结构** ⇒ 这里保留 `\n`，
      //   而**表格 cell** 的消费点统一过 `oneline()` 压平（见其定义——cell 里不能有换行）。
      doc: normalizeJsdoc(jsdoc || ''),
      props,
      methods,
      extendsName,
    }
  }
  // ★官网漏修：extends 合并（子接口属性 = 父接口属性（去重） + 自身属性）——BluetoothAPI/NFCAPI 状态字段可见
  for (const name of Object.keys(out)) {
    const base = out[name].extendsName
    if (base && out[base]) {
      const ownNames = new Set(out[name].props.map((x) => x.name))
      out[name].props = [...out[base].props.filter((x) => !ownNames.has(x.name)), ...out[name].props]
    }
  }
  // ★#1161：类型形态识别交给 lib/type-shapes.mjs（字符串联合/对象联合/函数别名/class 构造参数）。
  {
    const unionRe = /(?:\/\*\*((?:[^*]|\*(?!\/))*)\*\/\s*)?export type (\w+)\s*=\s*([^;\n]*(?:\n\s*\|[^;\n]*)*)/g
    let um
    while ((um = unionRe.exec(src))) {
      const [, udoc, uname, urhs] = um
      if (out[uname]) continue                    // interface 同名优先
      const lits = stringLiteralUnion(urhs)
      if (lits) {
        out[uname] = { doc: normalizeJsdoc(udoc || ''), props: [], methods: [], union: lits, extendsName: null }
        continue
      }
      const objProps = objectLiteralUnion(urhs)
      if (objProps) { out[uname] = { doc: normalizeJsdoc(udoc || ''), props: objProps, methods: [], extendsName: null }; continue }
      const fn = functionAlias(urhs)
      if (fn) {
        out[uname] = {
          doc: normalizeJsdoc(udoc || ''),
          props: [],
          methods: [{ name: 'call', sig: fn.sig, args: fn.args, ret: fn.ret, doc: '', paramDocs: {}, returns: '' }],
          extendsName: null,
        }
      }
    }
  }
  return out
}
