// packages/compiler/src/vapor/text-runs.ts —— ★★★**元素/文本混排归一化**（2026-10-03）
//
// 【这一层解决什么（本仓实测的第一大模板缺口）】`<p>本页演示 <code>x</code> 的规则覆盖</p>`
//   这类**元素与文本混排**此前被诊断拒绝 ⇒ **文本整段丢失**（只渲染元素，页面文字缺一半）。
//   它在真实页面里极常见（27 个样例页里 13 处），是模板侧第一大类缺口。
//
// 【为什么是"合成文本叶"】自绘树里文本是**元素属性**（没有独立文本节点）——要让文本与元素
//   交错存在，唯一自洽的表示是：把每一段**连续文本**合成一个文本叶元素（`p-text`），
//   与元素兄弟一起按**文档序**排在父节点下。这与 B 路（Vue 运行时 → selfdraw 适配器）**同构**
//   （Vue 的匿名文本 vnode 在适配器里就是一个文本叶节点）。
//
// 【★空白压缩必须与 Vue 一致（本仓纪律：跨链语义对齐）】Vue 编译器默认 `whitespace: 'condense'`：
//   · 纯空白文本节点：**紧邻元素/注释/边界** ⇒ 删除；否则压缩为单个空格；
//   · 含非空白的文本 ⇒ 内部空白run 压缩为单个空格。
//   不照做 ⇒ 元素间缩进会被合成为**垃圾文本叶**（多出一堆空白节点，几何/节点数全错）。
//
// 【★三处 id 同源（本仓血泪纪律）】本模块是 template.ts / deps.ts / events.ts **唯一**的
//   子节点遍历输入：三处都遍历同一份归一化结果 ⇒ 合成的文本叶在**同一个 DFS 位置**消耗
//   一个元素序号 ⇒ id 空间天然同步（此前三处各写一遍判据，漂移过两次）。
//
// 【诚实边界】`<pre>`（preserve 空白）未支持——Vapor 路无 pre 语义（既有诊断保留）；
//   纯文本元素（无元素子节点）**不走本路径**（沿用"折到元素属性上"的既有行为，零变化）。

/** 解析器节点（最小面：本模块只关心 type / content / children） */
interface RawNode {
  type: number
  tag?: string
  content?: unknown
  loc?: { start?: { line?: number } }
}

/** 文本叶里的一项（TEXT = 2 / INTERPOLATION = 5） */
export interface TextRunItem {
  type: number
  content: unknown
  loc?: { start?: { line?: number } }
}

/** 归一化后的子节点项 */
export type MixedChild =
  | { kind: 'element'; node: RawNode }
  | { kind: 'text-run'; items: TextRunItem[] }

const isAllWhitespace = (s: string): boolean => /^[\t\r\n\f ]*$/.test(s)

/**
 * 把父节点的子节点列表归一化成"元素 + 文本叶run"序列。
 *
 * @returns
 *   · **非混排**（无元素子节点，或压缩后无文本run）⇒ `null`（调用方走既有路径，行为零变化）；
 *   · **混排** ⇒ 归一化序列（元素按文档序 + 连续文本合成为 run）。
 */
export function groupMixedChildren(children: readonly unknown[]): MixedChild[] | null {
  const nodes = children as RawNode[]
  const hasElement = nodes.some((n) => n.type === 1)
  if (!hasElement) return null
  // ── ① 空白压缩（**逐条照抄 Vue `condenseWhitespace`**——见文件头注；不修改原 AST）──
  //   Vue 的规则（compiler-core/parser.ts，condense 模式）：
  //     · 纯空白文本：**首/末**（无前/后继）⇒ 删；**两元素之间且含换行** ⇒ 删；
  //       其余 ⇒ 压成单个空格（`<b>a</b> <i>b</i>` 中间那个空格是**真内容**，必须留）；
  //     · 含非空白的文本：内部空白 run 压成单个空格。
  //   ★为什么必须逐条对齐：pretty-print 的换行缩进若被合成文本叶 ⇒ 多出一堆空白节点，
  //     节点数与几何全错（A/B 必然不等价）。
  const kept: Array<RawNode | null> = nodes.map((n) => (n.type === 2 ? { ...n, content: String(n.content ?? '') } : n))
  for (let i = 0; i < kept.length; i++) {
    const n = kept[i]
    if (!n || n.type !== 2) continue
    const content = String(n.content ?? '')
    if (isAllWhitespace(content)) {
      const prev = kept[i - 1]
      const next = kept[i + 1]
      const prevEl = prev?.type === 1
      const nextEl = next?.type === 1
      if (!prev || !next || (prevEl && nextEl && /[\r\n]/.test(content))) {
        kept[i] = null
      } else {
        n.content = ' '
      }
    } else {
      n.content = content.replace(/[\t\r\n\f ]+/g, ' ')
    }
  }
  // ── ② 分组：连续文本/插值 ⇒ 一个 run ──
  const out: MixedChild[] = []
  let run: TextRunItem[] = []
  const flush = (): void => {
    if (run.length === 0) return
    out.push({ kind: 'text-run', items: run })
    run = []
  }
  for (const n of kept) {
    if (!n) continue
    if (n.type === 1) {
      flush()
      out.push({ kind: 'element', node: n })
      continue
    }
    if (n.type === 2 || n.type === 5) {
      run.push({ type: n.type, content: n.content, ...(n.loc ? { loc: n.loc } : {}) })
      continue
    }
    // 其他类型（注释已由 parse 过滤；防御：忽略）
  }
  flush()
  // 若归一化后没有任何文本run ⇒ 不算混排（例如全是元素 + 已删空白）
  return out.some((x) => x.kind === 'text-run') ? out : null
}

/**
 * ★**合成文本叶**（混排里的"连续文本段"）——自绘树里文本是元素属性、没有独立文本节点，
 *   故每段文本合成一个 `p-text` 元素，与元素兄弟按**文档序**排布（与 B 路适配器同构）。
 *
 * 【为什么带 `__syntheticTextRun` 标记】诊断/测试可区分"用户写的 `<p-text>`"与"编译器合成的"。
 */
export function synthesizeTextLeaf(items: readonly TextRunItem[]): RawSyntheticLeaf {
  return { type: 1, tag: 'p-text', props: [], children: [...items], __syntheticTextRun: true }
}

export interface RawSyntheticLeaf {
  type: number
  tag: string
  props: unknown[]
  children: TextRunItem[]
  __syntheticTextRun: true
}

/**
 * ★★★**三处遍历的统一入口**（template.ts / deps.ts / events.ts）——返回"该遍历的子节点序列"：
 *   非混排 ⇒ 原数组（**引用原样**，行为零变化）；混排 ⇒ 归一化后的序列（文本run 换成合成叶）。
 *
 * 【为什么必须是唯一入口（本仓血泪纪律）】三处各自遍历模板 AST 给元素编号（DFS 序号）；
 *   若只有一处做混排合成 ⇒ **id 空间分叉**（症状：指令写到别的节点上、零报错）。
 */
export function normalizedChildSequence(children: readonly unknown[]): unknown[] {
  const mixed = groupMixedChildren(children)
  if (!mixed) return children as unknown[]
  return mixed.map((item) => (item.kind === 'element' ? item.node : synthesizeTextLeaf(item.items)))
}


/** 文本run 的**纯静态文本**（含插值时为 null——由调用方走段表路径） */
export function runStaticText(items: readonly TextRunItem[]): string | null {
  if (items.some((t) => t.type === 5)) return null
  return items.map((t) => String(t.content ?? '')).join('')
}
