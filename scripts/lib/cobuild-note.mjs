// scripts/lib/cobuild-note.mjs —— verification_note 的归属合并（唯一实现）
//
// 为什么单列（2026-11-12，外部 F-44 报告 + 框架自查）：
//   原 mergeNote 内联在 sync-cobuild.mjs 里，测试只能靠 `toContain` 检查源码字符串
//   （无法真跑断言），于是三个缺陷长期存在而门禁全绿：
//     ① 认不出标签的文本被**默认归为 framework** ⇒ 消费者原文被标成框架写的；
//     ② 外部 note 本身多段时被整体打包 ⇒ 产物出现 `[external] [external] …`；
//     ③ 旧版每同步一次可能叠一层标签 ⇒ 台账里留下 8 条 `[external] [framework] X` 脏数据。
//   抽成纯函数后：sync 与 tests 引用同一实现，可对真实输入跑断言。
//
// `verification_note` 的语义：**「双方各自视角」的容器**（不是冲突字段）——
//   外部记「我在我项目里怎么验的」，框架记「我改了什么、怎么自证的」，两侧都该保留。

/**
 * 把一段文本拆成 `{tag, text}` 段。
 * `tag` ∈ `'external'` | `'framework'` | `null`（null = 无归属，原样保留、不擅自归类）。
 *
 * 识别的标签族（大小写不敏感，允许修饰词）：
 *   `[external]` / `[external 观察]` / `[external · 第十二轮]`
 *   `[framework]` / `[framework · 2026-09-29 补正]`
 *   `[我方处置]` / `[我方…]` —— 消费方自述，归 external
 */
export function splitNoteSegments (raw) {
  const out = []
  let cur = null
  for (const line of String(raw ?? '').split('\n')) {
    const m = /^\[\s*(external|framework)\b[^\]]*\]\s*([\s\S]*)$/i.exec(line.trim())
    const mine = /^\[\s*我方[^\]]*\]\s*([\s\S]*)$/.exec(line.trim())
    if (m) {
      cur = { tag: m[1].toLowerCase(), text: [m[2]] }
      out.push(cur)
    } else if (mine) {
      cur = { tag: 'external', text: [mine[1]] }
      out.push(cur)
    } else if (cur) {
      cur.text.push(line) // 续行并入当前段
    } else {
      cur = { tag: null, text: [line] } // 开头无标签：**不加归属**
      out.push(cur)
    }
  }
  return out
    .map((s) => ({ tag: s.tag, text: s.text.join('\n').trim() }))
    .filter((s) => s.text)
    .map(unwrapNestedTag)
}

/**
 * ★递归剥离「标签叠加」（历史脏数据自愈）。
 *
 * 旧版 mergeNote 每跑一次同步就可能叠一层标签，框架台账里已留下此类脏数据：
 *   `[external] [framework] 独立 import() 求值：…`       ← 外层误加，内层才是真归属
 *   `[framework] [external · 第七轮复测] registry 包 …`   ← 同上
 *
 * 判据：**一段文本的正文又以归属标签开头** ⇒ 外层是叠加产物，取内层。反复直到不再叠加。
 * 这样脏数据在下次同步时自动清洗，无需单独迁移脚本；清洗后与既有干净段正文相同 ⇒ 去重会收敛。
 *
 * ⚠️ 唯一误伤场景：刻意引用他人原话且原文恰好以 `[external]` 开头。
 *   本工具里 note 的语义就是「归属容器」，引用请写进正文并避免行首出现裸标签——
 *   该约束比「静默保留错误归属」安全。
 */
function unwrapNestedTag (seg) {
  let { tag, text } = seg
  for (let guard = 0; guard < 5; guard++) {
    const m = /^\[\s*(external|framework)\b[^\]]*\]\s*([\s\S]*)$/i.exec(text)
    if (!m) break
    tag = m[1].toLowerCase()
    text = m[2].trim()
    if (!text) break
  }
  return { tag, text }
}

/**
 * 合并两边的 note。
 * - 两侧用同一套拆分（既有合并结果与外部原文**地位对等**），故外部原文多段不会被二次打包；
 * - 去重键 = 归属 + 正文（同文同源只留一份，同文异源各留一份）；
 * - 无归属段**原样输出**（不加任何前缀）——这是「不擅自归属」的落点；
 * - 幂等：`mergeNote(mergeNote(x,y), y) === mergeNote(x,y)`。
 */
export function mergeNote (mine, theirs) {
  const parts = []
  const seen = new Set()
  const push = (tag, text) => {
    const t = String(text ?? '').trim()
    if (!t) return
    const key = `${tag ?? ''}\u0000${t}`
    if (seen.has(key)) return
    // ★无归属段另做「包含判重」：无标签文本会被当作**前一段的续行**吸收，
    //   于是 `[framework] b` + 续行 `c` 与单独一段 `c` 是同一内容的不同形态。
    //   不做包含判重就会在反复同步时累积重复（实测：再喂一次同一外部原文就多一行）。
    if (tag === null && parts.some((p) => p.text.includes(t) || t.includes(p.text))) return
    seen.add(key)
    parts.push({ tag, text: t })
  }
  for (const seg of splitNoteSegments(mine)) push(seg.tag, seg.text)
  for (const seg of splitNoteSegments(theirs)) push(seg.tag, seg.text)
  if (!parts.length) return undefined
  return parts.map((p) => (p.tag ? `[${p.tag}] ${p.text}` : p.text)).join('\n')
}
