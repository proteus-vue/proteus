// tests/pnode-m0.test.ts
// ★★M0 渲染 IR 回归锁（2026-09-29）——App 端高性能渲染的地基。
//
// 锁什么（每条都对应一条**已实测**的结论或 Profile 规格）：
//   ① 单位折叠：px→dp 绝对；%/vw/vh/rpx/em/rem → 比例系数 + 基准（运行时零换算）
//   ② 分级管控：L3 特性（z-index/fixed/filter/shadow/3D）标注 + warn；Profile 外属性 → **error**
//   ③ PaintHint 编译期推导：单色文本 / 纯背景（两条已实测的内存优化前提）
//   ④ 拍平判定（主路径：实测 −91% 内存）：资格条件逐条可解释，违规显式报错
//   ⑤ 静态子树：后序传播（后代动态 ⇒ 祖先非静态）
//   ⑥ 动态绑定：槽位分配 + 更新种类推导（运行时按槽位写值，无 diff）
//   ⑦ 构建可复现：同输入 → 同 id（二进制序列化的前提）
import { describe, it, expect } from 'vitest'
import {
  resolveLength,
  normalizeStyleString,
  analyzePTree,
  buildPTree,
  flattenRate,
  inferUpdateKind,
  kindFromSemantic,
  type PRawNode,
  type PTree,
} from '../packages/component-ir/src/index'

describe('★★M0 · 单位折叠（运行时不换算 —— CSS Profile §3.2/§8.3）', () => {
  it('绝对单位：px / pt / 零值 → dp', () => {
    expect(resolveLength('16px')).toEqual({ kind: 'absolute', dp: 16 })
    expect(resolveLength('0')).toEqual({ kind: 'absolute', dp: 0 })
    expect(resolveLength('12pt')).toEqual({ kind: 'absolute', dp: 12 })
  })

  it('比例单位：% / vw / vh / rpx / em / rem → 系数 + 基准（基准语义精确）', () => {
    // % 的基准随轴（水平属性 → parentWidth；高度 → parentHeight）
    expect(resolveLength('50%', { axis: 'horizontal' })).toEqual({ kind: 'ratio', ratio: 0.5, base: 'parentWidth' })
    expect(resolveLength('50%', { axis: 'vertical' })).toEqual({ kind: 'ratio', ratio: 0.5, base: 'parentHeight' })
    // vw/vh → 视口基准；★Skyline 实测该单位**可用且精确**（探针页 25/25）
    expect(resolveLength('100vw')).toEqual({ kind: 'ratio', ratio: 1, base: 'viewportWidth' })
    expect(resolveLength('10vh')).toEqual({ kind: 'ratio', ratio: 0.1, base: 'viewportHeight' })
    // rpx：750rpx = 视口宽（小程序设计宽语义）
    expect(resolveLength('750rpx')).toEqual({ kind: 'ratio', ratio: 1, base: 'viewportWidth' })
    // em/rem 基准不同（父字号 vs 根字号）——不可混用
    expect(resolveLength('2em')).toEqual({ kind: 'ratio', ratio: 2, base: 'fontSize' })
    expect(resolveLength('2rem')).toEqual({ kind: 'ratio', ratio: 2, base: 'rootFontSize' })
  })

  it('非法值 → undefined（由调用方出诊断，不静默当 0）', () => {
    expect(resolveLength('abc')).toBeUndefined()
    expect(resolveLength('10xyz')).toBeUndefined()
    expect(resolveLength('auto')).toBeUndefined() // auto 不是长度
  })
})

describe('★★M0 · 属性分级（CSS Profile §3 的 L1–L5 落地）', () => {
  it('L1/L2 正常归一化（flex 系列 / 绘制 / 文本）', () => {
    const r = normalizeStyleString('display:flex;flex-direction:row;gap:8px;background-color:#6f4ae8;border-radius:10px;font-size:14px;color:#fff')
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(r.props.layout.display).toBe('flex')
    expect(r.props.layout.flexDirection).toBe('row')
    expect(r.props.layout.gap).toEqual({ kind: 'absolute', dp: 8 })
    expect(r.props.paint.backgroundColor).toBe('#6f4ae8')
    expect(r.props.paint.borderRadius?.top).toEqual({ kind: 'absolute', dp: 10 })
    expect(r.props.text?.fontSize).toEqual({ kind: 'absolute', dp: 14 })
    expect(r.props.text?.color).toBe('#fff')
  })

  it('★L3 特性：标注合成层 + warn（各占一块 backing store —— iOS 内存专项已实测其成本）', () => {
    for (const decl of ['z-index:10', 'position:fixed', 'filter:blur(4px)', 'box-shadow:0 2px 8px #000']) {
      const r = normalizeStyleString(decl)
      expect(r.props.paintHint.needsCompositingLayer, `${decl} 应标记需合成层`).toBe(true)
      const warn = r.diagnostics.find((d) => d.code === 'css.l3-opt-in')
      expect(warn, `${decl} 应给 L3 opt-in 警告`).toBeTruthy()
      expect(warn?.severity).toBe('warn')
    }
    // 3D 变换同样属 L3（合成层 + 光栅化）
    const r3d = normalizeStyleString('transform:translateZ(10px)')
    expect(r3d.props.paintHint.needsCompositingLayer).toBe(true)
  })

  it('★Profile 外属性 → **error**（不留到运行时静默降级 —— Profile §1 原则 5）', () => {
    for (const decl of ['grid-template-columns:1fr 1fr', 'float:left', 'animation:spin 1s', 'user-select:none']) {
      const r = normalizeStyleString(decl)
      const err = r.diagnostics.find((d) => d.severity === 'error')
      expect(err, `${decl} 应为 error`).toBeTruthy()
      expect(err?.code).toBe('css.out-of-profile')
    }
    // display:grid 单列（Profile L2 标「待定」）——明确报错而非静默
    expect(normalizeStyleString('display:grid').diagnostics.some((d) => d.code === 'css.grid-unsupported')).toBe(true)
  })

  it('L4（字体/BiDi）接受但**不进渲染 IR**（复用平台文本栈 —— Profile §L4）', () => {
    const r = normalizeStyleString('font-family:system-ui;direction:rtl;font-size:14px')
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(r.props.text?.fontSize).toEqual({ kind: 'absolute', dp: 14 })
    // 不产生 fontFamily/direction 字段（平台负责）
    expect(JSON.stringify(r.props.text)).not.toContain('fontFamily')
    expect(JSON.stringify(r.props.text)).not.toContain('direction')
  })
})

describe('★★M0 · PaintHint 编译期推导（承载两条已实测的内存优化 —— §12.4）', () => {
  it('纯背景（无其它绘制）→ isPureBackground（不分配 backing store；实测仅色块 4.9MB）', () => {
    const r = normalizeStyleString('background-color:#101020')
    expect(r.props.paintHint.isPureBackground).toBe(true)
    expect(r.props.paintHint.needsCompositingLayer).toBe(false)
  })

  it('纯背景 + 其它绘制（border/圆角/透明/合成层）→ 不再是纯背景', () => {
    expect(normalizeStyleString('background-color:#000;border:1px solid #fff').props.paintHint.isPureBackground).toBe(false)
    expect(normalizeStyleString('background-color:#000;border-radius:8px').props.paintHint.isPureBackground).toBe(false)
    expect(normalizeStyleString('background-color:#000;opacity:0.5').props.paintHint.isPureBackground).toBe(false)
    expect(normalizeStyleString('background-color:#000;filter:blur(2px)').props.paintHint.isPureBackground).toBe(false)
  })

  it('单色文本 → isMonochrome（可用紧凑 backing store 格式；实测 −39%）', () => {
    expect(normalizeStyleString('color:#ffffff;font-size:14px').props.paintHint.isMonochrome).toBe(true)
    // 有背景图/合成层时不再单色（策略不适用）
    expect(normalizeStyleString('color:#fff;background-image:linear-gradient(90deg,#000,#fff)').props.paintHint.isMonochrome).toBe(false)
  })

  // ══════════════════════════════════════════════════════════════════════════
  // ★★推导**必须充分**：这两条是 2026-09-29 实测抓出的真缺陷（修复前**恒真**）
  //
  // 为什么此前没人发现：两个 hint **全仓零消费者**（grep 无实现）⇒
  //   条件写漏了也不会有人踩到；而一旦按 I3 接线（平台据此换存储格式），
  //   后果是**静默画错**（不是慢）。
  // ══════════════════════════════════════════════════════════════════════════
  it('★★修复锁定：带底色的文本**不得**判 isMonochrome（单通道格式表达不了两种颜色）', () => {
    // 4050 夹具的真实形状：白字 + 蓝底。修复前判 true ⇒ 平台按单通道分配 ⇒ 丢一个颜色。
    const r = normalizeStyleString('color:#ffffff;background-color:#285ac8;font-size:14px')
    expect(r.props.paintHint.isMonochrome, '有底色 ⇒ 两种颜色 ⇒ 不可用紧凑单通道').toBe(false)
    // 对照：同一份样式在**无底色**时确实是单色（否则上一条会因为条件过严而"通过"）
    const bare = normalizeStyleString('color:#ffffff;font-size:14px')
    expect(bare.props.paintHint.isMonochrome, '无底色的纯色文本仍是单色').toBe(true)
  })

  it('★★修复锁定：圆角/透明度**不得**判 isMonochrome（紧凑格式无 alpha 通道）', () => {
    expect(normalizeStyleString('color:#fff;border-radius:4px;font-size:14px').props.paintHint.isMonochrome).toBe(false)
    expect(normalizeStyleString('color:#fff;opacity:0.5;font-size:14px').props.paintHint.isMonochrome).toBe(false)
  })

  it('★★修复锁定：带文本的节点**不得**判 isPureBackground（本字段语义 = 只有一块底色要画）', () => {
    // 修复前：`color:#fff;background-color:#285ac8` 同时判 isPureBackground=true
    // ⇒ 平台若据此跳过存储分配，**文字不见了**。
    const r = normalizeStyleString('color:#fff;background-color:#285ac8;font-size:14px')
    expect(r.props.paintHint.isPureBackground, '有字形要栅格化 ⇒ 必须有存储').toBe(false)
    // 对照：纯底色（无文本）仍为 true
    expect(normalizeStyleString('background-color:#285ac8').props.paintHint.isPureBackground).toBe(true)
  })

  it('★★修复锁定：**彩色**文本不得判 isMonochrome（8 位灰度格式表达不了色相）', () => {
    // 【为什么这条是硬约束而非保守选择】紧凑格式（iOS gray8Uint）只有亮度、没有色相
    //   ⇒ 红字写进灰度格式 = **静默变成灰字**。
    //   ★−39% 的实验用的是**白字**（恰好中性色）⇒ 该约束在实验里成立却从未写进判据。
    const red = normalizeStyleString('color:#ff0000;font-size:14px')
    expect(red.props.paintHint.isMonochrome, '红字不可用灰度格式').toBe(false)
    const gray = normalizeStyleString('color:rgb(128,128,128);font-size:14px')
    expect(gray.props.paintHint.isMonochrome, '中性灰可以（R=G=B）').toBe(true)
    const white = normalizeStyleString('color:#ffffff;font-size:14px')
    expect(white.props.paintHint.isMonochrome, '白色可以（−39% 实验的形态）').toBe(true)
  })

  it('★★颜色判定保守：拿不准的写法（具名色/hsl/半透明）一律不判"可用紧凑格式"', () => {
    // 具名色：本仓不解析 CSS 具名色 ⇒ 拿不准 ⇒ 不能用紧凑格式（保守，宁可走通用路径）
    expect(normalizeStyleString('color:red;font-size:14px').props.paintHint.isMonochrome).toBe(false)
    // 半透明字色：4 位 hex 的 alpha 位（`#fff8` = a≈0.53）/ 8 位 hex / rgba α<1
    //   ★注意 `#ffff` 是 **a=f（完全不透明）**，不属此列——CSS 4 位写法是 #RGBA
    expect(normalizeStyleString('color:#fff8;font-size:14px').props.paintHint.isMonochrome).toBe(false)
    expect(normalizeStyleString('color:#ffffff80;font-size:14px').props.paintHint.isMonochrome).toBe(false)
    expect(normalizeStyleString('color:rgba(255,255,255,0.5);font-size:14px').props.paintHint.isMonochrome).toBe(false)
    // 对照：**不透明**写法（6 位 hex / 8 位 alpha=ff / rgb 三参 / rgba α=1）可以
    expect(normalizeStyleString('color:rgb(255,255,255);font-size:14px').props.paintHint.isMonochrome).toBe(true)
    expect(normalizeStyleString('color:#ffffffff;font-size:14px').props.paintHint.isMonochrome).toBe(true)
    expect(normalizeStyleString('color:rgba(255,255,255,1);font-size:14px').props.paintHint.isMonochrome).toBe(true)
  })
})

describe('★★M0 · 拍平判定（主路径：实测内存 −91% / 耗时 −32%）', () => {
  const mk = (over: Partial<PRawNode> = {}): PRawNode => ({ kind: 'view', tag: 'view', ...over })

  it('静态绘制节点 → 可拍平；叶子文本亦可', () => {
    const tree = buildPTree([mk({ style: 'background-color:#000', children: [mk({ kind: 'text', text: 'hi', style: 'color:#fff' })] })])
    expect(tree.roots[0]!.flags.flattenEligible).toBe(true)
    expect(tree.roots[0]!.children[0]!.flags.flattenEligible).toBe(true)
    expect(flattenRate(tree.stats)).toBe(1)
  })

  it('★事件绑定 ⇒ 不可拍平（拍平后无独立绘制对象，事件不可达）——且理由可解释', () => {
    const tree = buildPTree([mk({ facts: { hasEvent: true }, style: 'background-color:#000' })])
    const n = tree.roots[0]!
    expect(n.flags.flattenEligible).toBe(false)
    expect(n.flags.hasEvent).toBe(true)
  })

  it('transform / L3 / 组件根 / 结构边界 ⇒ 各有一条不可拍平理由', () => {
    expect(buildPTree([mk({ style: 'transform:translateX(4px)' })]).roots[0]!.flags.flattenEligible).toBe(false)
    expect(buildPTree([mk({ style: 'z-index:2' })]).roots[0]!.flags.flattenEligible).toBe(false)
    expect(buildPTree([mk({ facts: { isComponentRoot: true } })]).roots[0]!.flags.flattenEligible).toBe(false)
    const boundary = new Set([2])
    expect(buildPTree([mk({ style: 'background:#000' })], { startId: 2, analyze: { boundaryIds: boundary } }).roots[0]!.flags.flattenEligible).toBe(false)
    // 原生宿主（map/webview）永不可拍平
    expect(buildPTree([{ kind: 'native-host', tag: 'web-view' }]).roots[0]!.flags.flattenEligible).toBe(false)
  })

  it('★显式请求拍平但不合资格 → **error 诊断**（Profile lint E-CSS-006）', () => {
    const tree = buildPTree([mk({ facts: { hasEvent: true, requestFlatten: true } })])
    const err = tree.diagnostics.find((d) => d.code === 'css.flatten-violation')
    expect(err, '违规须编译期报错').toBeTruthy()
    expect(err?.severity).toBe('error')
    expect(err?.message).toContain('绑定事件')
  })

  it('统计口径：flattenableCount / compositingCount', () => {
    const tree = buildPTree([
      mk({ style: 'background:#000', children: [mk({ kind: 'text', text: 'a' })] }),
      mk({ style: 'z-index:1' }), // 需合成层 + 不可拍平
    ])
    expect(tree.stats.nodeCount).toBe(3)
    expect(tree.stats.flattenableCount).toBe(2)
    expect(tree.stats.compositingCount).toBe(1)
  })
})

describe('★★M0 · 静态子树与动态绑定', () => {
  it('★静态性是**后序传播**的：后代有动态绑定 ⇒ 祖先非静态（拍平安全前提）', () => {
    const tree = buildPTree([
      {
        kind: 'view',
        tag: 'view',
        style: 'background:#000',
        children: [{ kind: 'text', tag: 'text', text: 'x', bindings: [{ propKey: 'text.color', exprId: 'e1' }] }],
      },
    ])
    const root = tree.roots[0]!
    expect(root.children[0]!.flags.isStatic).toBe(false)
    expect(root.flags.isStatic, '祖先须随后代一起降级为非静态').toBe(false)
    expect(root.flags.flattenEligible, '非静态子树不可拍平').toBe(false)
    expect(root.props.paintHint.staticSubtree).toBe(false)
  })

  it('动态绑定：槽位连续分配 + 更新种类推导（运行时按槽位写值，无 diff）', () => {
    const tree = buildPTree([
      {
        kind: 'view',
        tag: 'view',
        bindings: [
          { propKey: 'text.color', exprId: 'e1' },
          { propKey: 'layout.width', exprId: 'e2' },
          { propKey: 'visible', exprId: 'e3' },
        ],
      },
    ])
    expect(tree.bindings.map((b) => b.slotId)).toEqual([0, 1, 2])
    expect(tree.bindings.map((b) => b.updateKind)).toEqual(['style', 'style', 'visibility'])
  })

  it('inferUpdateKind 映射表', () => {
    expect(inferUpdateKind('text.color')).toBe('style')
    expect(inferUpdateKind('text.content')).toBe('text-content')
    expect(inferUpdateKind('layout.width')).toBe('style')
    expect(inferUpdateKind('display')).toBe('visibility')
    expect(inferUpdateKind('list.items')).toBe('list-data')
    expect(inferUpdateKind('href')).toBe('attr')
  })
})

describe('★★M0 · 语义 → 绘制类型映射与可复现性', () => {
  it('kindFromSemantic：布局/文本/图像/原生宿主各归其位', () => {
    expect(kindFromSemantic('layout.box', 'p-view')).toBe('view')
    expect(kindFromSemantic('layout.virtual-list', 'p-list')).toBe('list')
    expect(kindFromSemantic('ui.text', 'p-text')).toBe('text')
    expect(kindFromSemantic('ui.rich-text', 'p-rich-text')).toBe('rich-text')
    expect(kindFromSemantic('ui.image', 'p-image')).toBe('image')
    expect(kindFromSemantic('shell.webview', 'p-webview')).toBe('native-host')
    expect(kindFromSemantic('ui.map', 'p-map')).toBe('native-host')
    // 无语义时按标签兜底
    expect(kindFromSemantic(undefined, 'text')).toBe('text')
    expect(kindFromSemantic(undefined, 'view')).toBe('view')
  })

  it('★构建可复现：同输入 → 同 id / 同槽位（二进制序列化的前提）', () => {
    const input: PRawNode[] = [
      { kind: 'view', tag: 'view', style: 'background:#000', children: [{ kind: 'text', tag: 'text', text: 'a', bindings: [{ propKey: 'text.color', exprId: 'e' }] }] },
    ]
    const a = buildPTree(input)
    const b = buildPTree(input)
    const ids = (t: PTree): number[] => t.roots.flatMap(function collect(n): number[] { return [n.id, ...n.children.flatMap(collect)] })
    expect(ids(a)).toEqual(ids(b))
    expect(a.bindings).toEqual(b.bindings)
    // startId 可错开（多页/多组件共用一个产物时）
    expect(buildPTree(input, { startId: 100 }).roots[0]!.id).toBe(100)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// ★M0 出口条件（计划 §M0）：「proteus explain 能输出拍平/静态提升的完整决策 trace」
// ══════════════════════════════════════════════════════════════════════════════
describe('★★M0 出口条件 · 决策 trace 可解释性', () => {
  it('trace 含统计摘要（拍平率）+ 逐节点决策 + 受阻理由', async () => {
    const { formatPTrace } = await import('../packages/component-ir/src/index')
    const tree = buildPTree([
      { kind: 'view', tag: 'view', style: 'background:#000', children: [{ kind: 'text', tag: 'text', text: 'x' }] },
      { kind: 'view', tag: 'view', facts: { hasEvent: true }, style: 'background:#111' },
    ])
    const { analyzePTree } = await import('../packages/component-ir/src/index')
    const analysis = analyzePTree(tree)
    const out = formatPTrace(tree, analysis)
    // ① 统计摘要（拍平率是实测关心的核心指标）
    expect(out).toContain('拍平率')
    expect(out).toContain('可拍平 2')
    // ② 逐节点决策 + 可拍平标记
    expect(out).toContain('✅可拍平')
    // ③ ★受阻理由必须**具体**（不是笼统的「不可拍平」）——这是排查的前提。
    //   注意：带事件的节点同时含「子树含动态绑定」（事件即动态）+「绑定事件」两条理由——
    //   两条都对且都有用（前者说明静态性受影响、后者说明拍平后事件不可达），故按「含」断言。
    expect(out).toContain('⛔受阻：')
    expect(out).toContain('绑定事件')
    expect(out, '理由须具体到原因，不是笼统的「不可拍平」').not.toMatch(/⛔受阻：不可拍平/)
    // ④ 参照数据（把实测基线写进 trace，读者能立即判断当前拍平率是否正常）
    expect(out).toContain('186.7→17.7MB')
  })

  it('--only-blocked 只列受阻节点（排查「为什么这个不能拍平」）', async () => {
    const { formatPTrace, analyzePTree } = await import('../packages/component-ir/src/index')
    const tree = buildPTree([
      { kind: 'view', tag: 'view', style: 'background:#000' },
      { kind: 'view', tag: 'view', facts: { hasEvent: true } },
    ])
    const out = formatPTrace(tree, analyzePTree(tree), { onlyBlocked: true })
    expect(out).toContain('⛔受阻')
    expect(out).not.toContain('✅可拍平')
    expect(out).toContain('（仅受阻项）')
  })

  it('--max-nodes 限制输出（本仓效率规范：输出控制）', async () => {
    const { formatPTrace, analyzePTree } = await import('../packages/component-ir/src/index')
    const many = Array.from({ length: 30 }, () => ({ kind: 'view' as const, tag: 'view', style: 'background:#000' }))
    const tree = buildPTree(many)
    const out = formatPTrace(tree, analyzePTree(tree), { maxNodes: 5 })
    expect(out).toContain('省略 25 个节点')
  })

  it('诊断输出：error 优先列出，warn 截断到 20 条', async () => {
    const { formatPTrace, analyzePTree } = await import('../packages/component-ir/src/index')
    const tree = buildPTree([
      { kind: 'view', tag: 'view', style: 'grid-template-columns:1fr' }, // error
      { kind: 'view', tag: 'view', facts: { hasEvent: true, requestFlatten: true } }, // flatten-violation error
    ])
    const out = formatPTrace(tree, analyzePTree(tree))
    expect(out).toContain('[css.out-of-profile]')
    expect(out).toContain('[css.flatten-violation]')
    expect(out).toContain('error 2')
  })
})
