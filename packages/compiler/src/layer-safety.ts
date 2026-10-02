// packages/compiler/src/layer-safety.ts
// ★★LY1（2026-10-02）：**页面层级语义的编译期校验**（《Proteus 页面层级规范与多端一致性方案》§3.5/§4.1）
//
// 【它补的是什么（规范 §0 结论 2/3/4）】
//   ① 层级**语义化、不暴露数值**：开发者写 `layer="popout"`，不写 `z-index: 1000`；
//   ② **禁止裸 z-index 数值**（编译期**报错**，不是警告——开放数值会毁掉收敛体系）；
//   ③ `layer-mask` **不得单独使用**（WeUI 规范：Mask 配合 Popout）；
//   ④ `layer-popout` / `layer-mask` **必须在根容器**（规范 §4.1 最危险陷阱：
//      CSS stacking context 与鸿蒙 zIndex **都不跨容器**——弹层写在深层容器里，
//      A 端正常、B 端被遮挡，且**静默不报错**）。
//
// 【为什么这条必须编译期强制（规范 §4.1）】"提升到根容器"靠开发者自觉 = 迟早出错；
//   而错法在两端表现不同 ⇒ 一致性校验都抓不稳。⇒ 编译期拦在写下的那一刻。
//
// 【判据形态】纯静态分析（模板源码字符串 + 轻量 DOM 解析），产出与 style-safety 同形的
//   违规列表（机器可判别的稳定 code——门禁/测试按 code 断言，不依赖文案）。
//   零运行时依赖，可被编译器（buildLayoutTemplate 调用方）与门禁脚本共用（铁律 #9 同源）。
import { LAYER_ATTR_VALUES, LAYER_RESERVED } from '@proteus-vue/contracts/layers'

/** 层级违规（code 稳定，供门禁/测试断言） */
export interface LayerViolation {
  code: 'LY001' | 'LY002' | 'LY003' | 'LY004' | 'LY005'
  /** 规范条目（可追溯到文档） */
  rule: string
  message: string
  hint: string
  /** 源码行号（1-based，尽力给出） */
  line?: number
}

/** 违规码 → 规范条目（对外表述与测试断言共用） */
export const LAYER_RULE_OF: Record<LayerViolation['code'], string> = {
  LY001: '规范 §3.5「禁止开发者写裸 z-index 数值」',
  LY002: '规范 §3.5「层级原语为封闭集」',
  LY003: '规范 §3.5「layer-mask 不得单独使用（必须配合 Popout）」',
  LY004: '规范 §4.1「layer-popout / layer-mask 必须提升到根容器」',
  LY005: '规范 §4.6「layer-transition 是框架内部层，开发者不可声明」',
}

/**
 * ★★LY001 的**测量装置例外通道**（2026-10-03 修复：LY001 与 CSS Profile 探针页的冲突）
 *
 * 【为什么必须有这个口（本仓实测的真实冲突）】LY001 拦的是"把 z-index 当层级控制手段"的
 *   **页面层级使用**；而**测量装置**（如 `showcase/.../css-profile-probe.vue`）里写
 *   `z-index: 5` 是**被测对象本身**——该页的目的就是验证 Skyline 是否接受 z-index，
 *   删掉它这条测量就没法做（同页还有 25 个同款探针元素）。没有例外通道时：
 *   `pnpm check:compile-baseline` 在干净 HEAD 上必红（实测），整链无法收尾。
 *   ★同族先例：`check:host-rounding` 的 `I2-ALLOW`（测量/位图/报告三类合法例外）——
 *     **每个例外都要有名有姓**：标记写在源码里（谁、为什么），且有生效窗口，
 *     不能变成静默绕过（门禁纪律：例外不可匿名）。
 *   ★边界：**只豁免 LY001**（裸数值——唯一存在"测量/对照"场景的条款）；
 *     LY002/003/004/005 是语义违规（层名非法 / Mask 单独用 / 非根容器 / 保留层），
 *     不存在"测量它们"的合法场景——**无例外通道**。
 */
export const LY001_ALLOW_MARK = 'LY001-ALLOW:'
/** 标记生效窗口：该行**之前 5 行内**（与 I2-ALLOW 同口径：一条注释可覆盖其后的小段） */
const LY001_ALLOW_WINDOW = 5

interface LayerNode {
  /** 元素在模板中的序号（DFS 序，与 Vapor 模板产物同源口径） */
  index: number
  tag: string
  /** 本节点的 layer 声明（无则 undefined） */
  layer?: string
  /** 是否含裸 z-index（style 属性或 :style 绑定里的 key） */
  rawZIndex?: { where: 'style' | ':style'; line: number }
  depth: number
  parentIndex: number | null
}

/** 极简模板标签扫描（不引入 DOM 解析器——本模块必须能被门禁脚本零依赖引用）。
 *  ★能力边界（如实）：按标签开合栈匹配，能覆盖本仓的模板形态（自闭合 + 成对）；
 *    畸形模板的边角情形由既有 sfc 解析链兜底（这里只做层级规则）。 */
function scanLayerNodes(templateSource: string): LayerNode[] {
  const nodes: LayerNode[] = []
  const stack: number[] = []
  let index = 0
  let line = 1
  // 逐个标签（开/闭/自闭合）；注释内的标签跳过
  const noComment = templateSource.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
  const TAG_RE = /<(\/?)([A-Za-z][A-Za-z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g
  let m: RegExpExecArray | null
  let cursor = 0
  while ((m = TAG_RE.exec(noComment)) !== null) {
    line += noComment.slice(cursor, m.index).split('\n').length - 1
    cursor = m.index
    const closing = m[1] === '/'
    const tag = m[2]!
    const attrs = m[3] ?? ''
    const selfClose = m[4] === '/'
    if (closing) {
      stack.pop()
      continue
    }
    const layerMatch = /\blayer\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(attrs)
    const layer = (layerMatch?.[1] ?? layerMatch?.[2])?.trim()
    // 裸 z-index：style="…z-index:…" 或 :style="…zIndex:…"（含短横线/驼峰两种写法）
    let raw: LayerNode['rawZIndex']
    const styleAttr = /\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(attrs)
    if (styleAttr && /\bz-index\s*:/.test(styleAttr[1] ?? styleAttr[2] ?? '')) {
      raw = { where: 'style', line }
    }
    const bindAttr = /(?::|v-bind:)style\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(attrs)
    // ★`:style` 的两种写法都要拦。实测两处坑（测试当场抓出）：
    //   ① 对象字面量写的是 `zIndex: 10`（驼峰）；`z-?index` 这个正则**不匹配 `zIndex`**
    //      （它要求 z 后先接可选 'index'；而驼峰是 z + 大写 I）⇒ 漏网；
    //   ② `:style` 值里 `z-index` 也可能带引号（`{'z-index': 5}`）。
    //   ⇒ 判据：**不区分大小写**地找 `z-index` / `zIndex` 后跟冒号（键位置）。
    if (bindAttr) {
      const expr = bindAttr[1] ?? bindAttr[2] ?? ''
      if (/['"]?\s*z-?index\s*['"]?\s*:/i.test(expr)) {
        raw = { where: ':style', line }
      }
    }
    const node: LayerNode = {
      index: index++,
      tag,
      ...(layer !== undefined && layer !== '' ? { layer } : {}),
      ...(raw ? { rawZIndex: raw } : {}),
      depth: stack.length,
      parentIndex: stack.length ? stack[stack.length - 1]! : null,
    }
    nodes.push(node)
    if (!selfClose && !['br', 'img', 'input', 'hr'].includes(tag)) stack.push(node.index)
    line += (m[0].match(/\n/g) ?? []).length
  }
  return nodes
}

/**
 * 校验页面层级的**语义合法性**（规范 §3.5 / §4.1）。
 *
 * @param templateSource `<template>` 内部（或完整模板）源码
 * @returns 违规列表（空 = 合规）。调用方决定严重度（本仓：LY001/LY003/LY004/LY005 为 error）
 */
export function validateLayerUsage(templateSource: string): LayerViolation[] {
  const out: LayerViolation[] = []
  const nodes = scanLayerNodes(templateSource)
  const byIndex = new Map(nodes.map((n) => [n.index, n]))
  /** 例外标记窗口查找用（保留**原始**注释文本——scanLayerNodes 内部会屏蔽注释） */
  const srcLines = templateSource.split('\n')

  for (const n of nodes) {
    // LY005：框架保留层名（layer-transition——转场内部用，规范 §4.6）
    if (n.layer && (LAYER_RESERVED as readonly string[]).includes(n.layer)) {
      out.push({
        code: 'LY005',
        rule: LAYER_RULE_OF.LY005,
        message: `<${n.tag}> 声明了框架保留层 \`layer="${n.layer}"\`（转场期间由宿主内部提升/复位）`,
        hint: '移除该声明；共享元素转场的层级由 Morpheus 转场通道处理（见规范 §8）',
        ...(n.rawZIndex ? { line: n.rawZIndex.line } : {}),
      })
      continue
    }
    // LY002：封闭集（非法层名——含拼写错误，防"看起来能用、实际静默无效"）
    if (n.layer && !(LAYER_ATTR_VALUES as readonly string[]).includes(n.layer)) {
      out.push({
        code: 'LY002',
        rule: LAYER_RULE_OF.LY002,
        message: `<${n.tag}> 的 \`layer="${n.layer}"\` 不在封闭集（合法值：${LAYER_ATTR_VALUES.join(' | ')}）`,
        hint: `改用合法层名；层级模型遵循 WeUI 四层语义（contracts/layers.ts 的 LAYER_SEMANTICS）`,
        ...(n.rawZIndex ? { line: n.rawZIndex.line } : {}),
      })
    }
    // LY001：裸 z-index 数值（规范性硬约束——编译期报错）
    if (n.rawZIndex) {
      // ★测量装置例外（`LY001-ALLOW:` 标记；窗口有界——见 LY001_ALLOW_MARK 头注）
      const at = n.rawZIndex.line - 1
      const windowText = srcLines.slice(Math.max(0, at - LY001_ALLOW_WINDOW), at + 1).join('\n')
      if (!windowText.includes(LY001_ALLOW_MARK)) {
        out.push({
          code: 'LY001',
          rule: LAYER_RULE_OF.LY001,
          message: `<${n.tag}> 在 ${n.rawZIndex.where} 里写裸 \`z-index\` 数值（层级必须语义化声明）`,
          hint: '删掉 z-index；改用 `layer="content|navigation|mask|popout"`（WeUI 四层；数值由框架映射，见 contracts/layers.ts）',
          line: n.rawZIndex.line,
        })
      }
    }
  }

  // LY003：layer-mask 不得单独使用（必须有 popout 兄弟/祖先）——WeUI 语义
  for (const n of nodes) {
    if (n.layer !== 'layer-mask') continue
    const hasPopout = nodes.some((o) => o.layer === 'layer-popout')
    if (!hasPopout) {
      out.push({
        code: 'LY003',
        rule: LAYER_RULE_OF.LY003,
        message: `<${n.tag}> 单独使用 \`layer-mask\`（WeUI：Mask 配合 Popout 使用，不得单独出现）`,
        hint: '该声明应与一个 `layer="layer-popout"` 的弹层同页配对（Mask 负责锁定下层交互）',
      })
    }
  }

  // LY004：popout / mask 必须在**根容器**（规范 §4.1——跨容器层级不生效是最大陷阱）
  //   判据：其祖先链上只有根一个元素（depth === 1：root 之下的直接子级；depth 0 = 根自身）。
  //   ★这是最保守的判据（可放宽到"根的直接子级"）——宁严勿松：跨容器失效是静默缺陷。
  for (const n of nodes) {
    if (n.layer !== 'layer-popout' && n.layer !== 'layer-mask') continue
    if (n.depth > 1) {
      const chain: string[] = []
      let cur = n.parentIndex
      while (cur !== null) {
        const p = byIndex.get(cur)
        if (p) chain.unshift(`<${p.tag}#${p.index}>`)
        cur = p?.parentIndex ?? null
      }
      out.push({
        code: 'LY004',
        rule: LAYER_RULE_OF.LY004,
        message: `<${n.tag}> 的 \`${n.layer}\` 嵌套在深层容器里（祖先链：${chain.join(' > ')}）——` +
          'CSS stacking context 与鸿蒙 zIndex 都不跨容器，弹层会在部分端被遮挡（静默！）',
        hint: '把该弹层提升到**根容器的直接子级**（规范 §4.1）；它不得位于任何 transform/opacity<1 的动画子树内',
      })
    }
  }

  return out
}
