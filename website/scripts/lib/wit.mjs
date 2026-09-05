// wit-parser.mjs —— WIT 子集解析器 + ApiSpec 渲染器 + 漂移门禁（G-60 B1「文档即契约」）
// 解析范围（首版）：package 头 / interface / /// doc 注释 / record·enum·variant·func。
// 结构模型：栈深度区分 interface 结束（深度 1 的 }）与类型块结束（深度 2 的 }）。
// 纪律：G-60.1 参考页是 renderer 非副本；lint（SPEC_LINT）缺 doc 即报；sourceHash 漂移锚点。

/** 解析单个 .wit 文件 → ApiSpec（version + interfaces[]） */
export function parseWit(text, { version } = {}) {
  const spec = { version: version ?? null, package: null, interfaces: [] }
  let doc = [] // /// 注释缓冲（归属下一个声明）
  let depth = 0 // 0 顶层 / 1 interface 内 / 2 类型块（record/enum/variant）内
  let cur = null // 当前 interface
  let block = null // 当前类型块

  const flushBlock = () => {
    if (!block) return
    block.doc = doc.join(' ').trim()
    if (cur) cur.items.push(block)
    block = null
    doc = []
  }

  for (const raw of text.split('\n')) {
    const line = raw.trim()

    if (line.startsWith('///')) { doc.push(line.replace(/^\/\/\/\s?/, '')); continue }
    if (line.startsWith('//') || line === '') continue

    // package 头：package proteus:plugin@0.1.0;
    const pkg = line.match(/^package\s+([\w-]+):([\w-]+)@([\d.]+);?$/)
    if (pkg) {
      spec.package = `${pkg[1]}:${pkg[2]}`
      if (version === undefined || version === null) spec.version = pkg[3]
      doc = []
      continue
    }

    // interface 开始：interface host {
    const iface = line.match(/^interface\s+([\w-]+)\s*\{$/)
    if (iface) {
      cur = { name: iface[1], doc: doc.join(' ').trim(), items: [] }
      spec.interfaces.push(cur)
      doc = []
      depth = 1
      continue
    }

    if (!cur) continue

    if (line === '}') {
      if (depth === 2) { flushBlock(); depth = 1 } // 类型块结束
      else { flushBlock(); doc = []; cur = null; depth = 0 } // interface 结束
      continue
    }

    // 类型声明开始：record x { / enum x { / variant x {
    const kind = line.match(/^(record|enum|variant)\s+([\w-]+)\s*\{$/)
    if (kind) { flushBlock(); block = { kind: kind[1], name: kind[2], fields: [] }; depth = 2; continue }

    // func 声明：name: func(a: t) -> r; 或无返回值 name: func(a: t);（单行）
    const fn = line.match(/^([\w-]+)\s*:\s*func\s*\((.*)\)\s*(?:->\s*(.+?))?;?$/)
    if (fn && depth === 1) {
      cur.items.push({
        kind: 'func',
        name: fn[1],
        doc: doc.join(' ').trim(),
        params: fn[2] === '' ? [] : fn[2].split(',').map((p) => {
          const [n, t] = p.trim().split(/:\s*/)
          return { name: n, type: t }
        }),
        result: (fn[3] ?? '').trim().replace(/;$/, ''),
      })
      doc = []
      continue
    }

    // 类型字段行（depth 2）：name: type, / name(payload), / name,（enum 成员）
    const field = line.match(/^([\w-]+)\s*(?:\(([^)]*)\))?\s*(?::\s*(.+?))?,?$/)
    if (field && depth === 2 && block) {
      if (field[2] !== undefined) block.fields.push({ name: field[1], type: field[2].trim().replace(/,$/, '') })
      else if (field[3]) block.fields.push({ name: field[1], type: field[3].trim().replace(/,$/, '') })
      else block.fields.push({ name: field[1] })
      continue
    }
  }
  flushBlock()
  return spec
}

/** SPEC_LINT：缺 doc 的 interface / item 即违规（返回违规清单，空数组 = 通过） */
export function lintSpec(spec) {
  const problems = []
  for (const iface of spec.interfaces) {
    if (!iface.doc) problems.push(`SPEC_LINT: interface ${iface.name} 缺 /// 文档`)
    for (const item of iface.items) {
      if (!item.doc) problems.push(`SPEC_LINT: ${iface.name}.${item.name} 缺 /// 文档`)
    }
  }
  return problems
}

/** 8 位 sourceHash（djb2 变体——稳定、零依赖、可复现） */
export function sourceHash(text) {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0
  return h.toString(16).padStart(8, '0')
}

/** ApiSpec → 参考页 markdown（每个 interface 一页；generated:true + source_hash 锚点） */
export function renderSpecMd(spec, ifaceName, { sourceHash: hash, order = 90 } = {}) {
  const iface = spec.interfaces.find((i) => i.name === ifaceName)
  if (!iface) return null
  const out = []
  out.push('---')
  out.push(`title: ${iface.name}（v${spec.version}）`)
  out.push(`order: ${order}`)
  out.push(`group: 插件 API`)
  out.push(`generated: true`)
  if (hash) out.push(`source_hash: ${hash}`)
  out.push('---')
  out.push('')
  out.push(`# ${iface.name}`)
  out.push('')
  out.push('> 本页由 WIT 自动生成（since_v' + spec.version.replaceAll('.', '_') + '.wit），请勿手工编辑。')
  out.push('> 需要补充「为什么 / 怎么做」，请写到指南并链接过来。')
  if (iface.doc) { out.push(''); out.push(iface.doc) }
  for (const item of iface.items) {
    out.push('')
    if (item.kind === 'func') {
      const params = item.params.map((p) => `${p.name}: \`${p.type}\``).join(', ')
      out.push(`## ${item.name}`)
      if (item.doc) { out.push(''); out.push(item.doc) }
      out.push('')
      out.push('```ts')
      out.push(`${item.name}(${params}) -> ${item.result}`)
      out.push('```')
      if (item.params.length) {
        out.push('')
        out.push('| 参数 | 类型 |')
        out.push('|---|---|')
        for (const p of item.params) out.push(`| ${p.name} | \`${p.type}\` |`)
      }
    } else {
      out.push(`## ${item.name}（${item.kind}）`)
      if (item.doc) { out.push(''); out.push(item.doc) }
      out.push('')
      for (const f of item.fields) out.push(`- **${f.name}**${f.type ? `: \`${f.type}\`` : ''}`)
    }
  }
  out.push('')
  return out.join('\n')
}

/** 漂移检测：regenerated 与 committed 不一致 → 漂移（CI 阻断） */
export function checkDrift(committed, generated) {
  if (committed === generated) return { status: 'fresh' }
  return { status: 'stale', message: '生成物与 WIT 源不一致——重新运行 gen:plugin-docs 并提交' }
}
