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
