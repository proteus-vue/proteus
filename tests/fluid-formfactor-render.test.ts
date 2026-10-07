// tests/fluid-formfactor-render.test.ts
// @vitest-environment jsdom
// ★★p-formfactor 渲染级回归锁（2026-09-26 二次复审 P0 的机器门禁）：
//   背景：`v-if="caps.drawer"` 对三态字符串（'unsupported'）恒真 → 七形态全部渲染假徽标，
//   面板却显示「未支持」——声明与渲染互相打脸。静态扫描（.vue 文本正则）只能防「裸真值写法」，
//   无法证明「渲染结果与能力声明一致」。本文件真挂载组件，逐形态断言**渲染出的 UI 与 caps 判定同源**：
//     ① keyboard 徽标（⌘K）：仅 PC 出现
//     ② 表冠徽标：仅手表 / 车机出现
//     ③ 抽屉把手：仅 phone / fold / tablet 出现
//     ④ SKU 降级路径：仅车机（skuMulti=fallback）出现；手机/平板渲染真实多规格槽
//     ⑤ 触控形态不得拿到 dpad 热区类 / 焦点接管（has-dpad）
//     ⑥ 姿态覆盖：fold + tabletop → data-pf-nav='tabs'（nav 字段必须有渲染后果）
//     ⑦ Tab 栏：仅声明 tabs 的形态渲染（fold 已修——此前 unsupported 导致三姿态零导航）
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createApp, h, nextTick } from 'vue'
import { PFormfactor } from '@proteus-vue/components'
import { FORM_PROFILES, capsEnabled, resolveAspectClass, type DeviceForm } from '@proteus-vue/fluid'

/** 挂载 p-formfactor（注入全部内容槽——组件按能力过滤各槽的渲染） */
async function mountForm(form: DeviceForm, opts: { posture?: string; width?: number } = {}): Promise<HTMLElement> {
  const el = document.createElement('div')
  const slots = {
    rail: () => h('span', { class: 't-rail' }, 'rail'),
    media: () => h('div', { class: 't-media' }, 'media'),
    heading: () => h('strong', { class: 't-heading' }, 'heading'),
    price: () => h('span', { class: 't-price' }, '¥1299'),
    sku: () => h('span', { class: 't-sku fp-sku' }, 'sku'),
    actions: () => h('button', { class: 't-buy' }, 'buy'),
    recommend: () => h('div', { class: 't-rec pf-rec-card' }, 'rec'),
    tabbar: () => h('span', { class: 't-tab' }, 'tab'),
  }
  const app = createApp({
    render: () =>
      h(PFormfactor as never, { declared: form, posture: opts.posture ?? '', width: opts.width ?? 400 } as never, slots as never),
  })
  app.mount(el)
  await nextTick()
  return el
}

const root = (el: HTMLElement): HTMLElement => el.querySelector('.p-formfactor') as HTMLElement

describe('★p-formfactor 渲染与能力声明同源（二次复审 P0 回归锁）', () => {
  it('① keyboard 徽标（⌘K）仅在声明 keyboard 的形态渲染（此前 7/7 全渲染）', async () => {
    for (const form of Object.keys(FORM_PROFILES) as DeviceForm[]) {
      const el = await mountForm(form)
      const has = !!el.querySelector('.pf-key-hint')
      expect(has, `${form}: keyboard 徽标渲染=${has}，声明=${capsEnabled(FORM_PROFILES[form].caps.keyboard)}`).toBe(
        capsEnabled(FORM_PROFILES[form].caps.keyboard),
      )
    }
  })

  it('② 表冠徽标仅在声明 crown 的形态渲染（手表唯一支持的能力不得漏）', async () => {
    for (const form of Object.keys(FORM_PROFILES) as DeviceForm[]) {
      const el = await mountForm(form)
      const has = !!el.querySelector('.pf-crown-hint')
      expect(has, `${form}: 表冠徽标渲染=${has}`).toBe(capsEnabled(FORM_PROFILES[form].caps.crown))
    }
  })

  it('③ 抽屉把手仅在声明 drawer 的形态渲染', async () => {
    for (const form of Object.keys(FORM_PROFILES) as DeviceForm[]) {
      const el = await mountForm(form)
      const has = !!el.querySelector('.pf-drawer-hint')
      expect(has, `${form}: 抽屉把手渲染=${has}`).toBe(capsEnabled(FORM_PROFILES[form].caps.drawer))
    }
  })

  it('④ SKU 三态：supported 渲染真实槽 / fallback 渲染降级路径 / unsupported 不渲染', async () => {
    const phone = await mountForm('phone')
    expect(!!phone.querySelector('.pf-sku'), '手机应渲染多规格').toBe(true)
    const car = await mountForm('car')
    expect(!!car.querySelector('.pf-sku-fallback'), '车机应渲染降级路径').toBe(true)
    const tv = await mountForm('tv')
    expect(!!tv.querySelector('.pf-sku') || !!tv.querySelector('.pf-sku-fallback'), 'TV 不应渲染任何 SKU 形态').toBe(false)
  })

  it('⑤ has-dpad 类与 dpad 声明同源；触控形态无遥控热区语义', async () => {
    for (const form of Object.keys(FORM_PROFILES) as DeviceForm[]) {
      const el = await mountForm(form)
      expect(root(el).classList.contains('has-dpad'), `${form} has-dpad`).toBe(capsEnabled(FORM_PROFILES[form].caps.dpad))
    }
  })

  it('⑥ 姿态覆盖：fold/flip 各自的姿态 → 拓扑与导航随姿态变化（nav 字段必须有渲染后果）', async () => {
    const folded = await mountForm('fold', { posture: 'folded' })
    // ★2026-09-28 借鉴 Apple HIG（iPhone Duo）：宽而矮的外屏把控件移到侧边 → side-tabs
    expect(root(folded).dataset.pfNav).toBe('side-tabs')
    expect(root(folded).dataset.pfPosture).toBe('folded')
    // ★2026-09-29：fold 的半开键是 **book**（书本式 half-open 横长条）；tabletop 属 flip（翻盖式半折）
    const book = await mountForm('fold', { posture: 'book' })
    expect(root(book).dataset.pfNav).toBe('side-tabs')
    expect(root(book).dataset.pfTopology).toBe('duo')
    const table = await mountForm('flip', { posture: 'tabletop' })
    expect(root(table).dataset.pfNav).toBe('side-tabs')
    expect(root(table).dataset.pfTopology).toBe('stack')
    const expanded = await mountForm('fold', { posture: 'expanded' })
    expect(root(expanded).dataset.pfTopology).toBe('duo')
  })

  it('⑥b ★★折痕只在真能看到铰链的姿态渲染（2026-09-29 用户实测「假折痕」回归锁）', async () => {
    // 用户实测原话：折痕在**折叠态/展开态也被绘制**（假折痕）——外屏上根本没有折痕；
    // 平坦展开态折痕是浅痕、不构成布局区域。只有**半开（悬停）**姿态有可见折痕带（铰链在窗口底缘）。
    const cases: Array<[DeviceForm, string, string, string]> = [
      // form, posture, 期望 data-pf-crease（渲染的带）, 期望 data-pf-crease-geom（姿态几何）
      ['fold', 'folded', '', ''],            // 折叠态：无折痕
      ['fold', 'book', 'horizontal-bottom', 'horizontal-bottom'],   // 半开：底缘折痕带
      ['fold', 'expanded', '', 'vertical-middle'],                  // 展开：折痕贯穿中部（不画带）
      ['flip', 'folded', '', ''],            // 翻盖折叠态：无折痕
      ['flip', 'tabletop', 'horizontal-bottom', 'horizontal-bottom'],// 半折：底缘折痕带
      ['flip', 'expanded', '', 'horizontal-middle'],                // 展开：水平折痕在中部（不画带）
    ]
    for (const [form, posture, wantBand, wantGeom] of cases) {
      const el = await mountForm(form, { posture })
      const r = root(el)
      expect(r.dataset.pfCrease, `${form}/${posture} 渲染的折痕带`).toBe(wantBand)
      expect(r.dataset.pfCreaseGeom, `${form}/${posture} 折痕几何`).toBe(wantGeom)
      expect(!!el.querySelector('.pf-crease'), `${form}/${posture} .pf-crease 元素`).toBe(wantBand !== '')
    }
  })

  it('⑥c ★折痕带宽度可**端注入**（机型几何交给端——「不只按三星做」的机制保证）', async () => {
    // 真机上端把铰链几何（env(fold-*) / FoldingFeature.bounds）换算后注入；缺省走演示壳默认值。
    const el = document.createElement('div')
    const app = createApp({
      render: () => h(PFormfactor as never, { declared: 'fold', posture: 'book', width: 470, creaseBand: 24 } as never, {} as never),
    })
    app.mount(el)
    await nextTick()
    const style = root(el).getAttribute('style') ?? ''
    expect(style, '注入的折痕带宽度须进入 CSS 变量').toContain('--pf-crease-band: 24px')
  })

  it('⑦ Tab 栏渲染：fold 三姿态必须有导航（此前 caps.tabs=unsupported → Tab 被过滤 = 零导航）', async () => {
    const phone = await mountForm('phone')
    expect(!!phone.querySelector('.pf-tabbar'), '手机 Tab 栏').toBe(true)
    for (const posture of ['folded', 'book', 'expanded'] as const) {
      const el = await mountForm('fold', { posture })
      expect(!!el.querySelector('.pf-tabbar'), `折叠屏 ${posture} 应有 Tab 导航`).toBe(true)
    }
    const tv = await mountForm('tv')
    expect(!!tv.querySelector('.pf-tabbar'), 'TV 无 Tab').toBe(false)
  })

  it('⑧ 根类覆盖全部声明能力（能力 → CSS 后果的接线不可漏项）', async () => {
    const el = await mountForm('car')
    const cls = root(el).classList
    // 车机声明：dpad / crown / focusTree / multiCol / focusRows / driveAware
    // ★三审：dense 已撤除（驾驶场景不做高密度——与接口注释一致）
    for (const c of ['has-dpad', 'has-crown', 'has-focus-tree', 'has-multicol', 'is-drive']) {
      expect(cls.contains(c), `车机应有 ${c}`).toBe(true)
    }
    expect(cls.contains('is-dense'), '车机不应有 is-dense（dense 已撤除）').toBe(false)
    // 未声明：hover / keyboard / sidebar / notch / drawer / tabs
    for (const c of ['has-hover', 'has-keyboard', 'has-notch', 'has-drawer']) {
      expect(cls.contains(c), `车机不应有 ${c}`).toBe(false)
    }
  })
})

describe('★图标风格统一（2026-09-29）：官网源码不得用 emoji 承担视觉角色', () => {
  it('全站 src（页面/组件/文案数据）图标位不出现 emoji——一律走自绘图标集', () => {
    // 背景（用户实测两轮）：① 多端同屏页原用 emoji（⌚📱📲📖📐💻🚗📺 / 🎧🎵🔌🎒🔋📦🏠⚙️ / ▮▮▮⌁❤️）
    //   ② 修完**多端同屏页**后，用户又发现**首页**的多端同屏横幅没更新——因为门禁只扫了 3 个文件。
    //   emoji 由**系统字体**渲染：跨平台字形/配色不一（Windows 彩色方块 / macOS Apple 风格 / Linux 又一套），
    //   与站点既有线性图标语言（FeatureIcon/DemoIcon）冲突，且无法随形态主题着色。
    //   本门禁**扫全站 website/src**（避免「改了 A 漏了 B」复发）。
    const fs = require('node:fs') as typeof import('node:fs')
    const pathMod = require('node:path') as typeof import('node:path')
    const SRC = pathMod.resolve(__dirname, '../website/src')
    // emoji 区间（含 dingbats/符号箭头区——图标位常混用）
    const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{231A}\u{231B}\u{2300}-\u{23FF}\u{25A0}-\u{25FF}\u{2190}-\u{21FF}]/u
    // 允许：① 排版符号（★✓→← 等——本仓通用语义标记）
    //      ② **状态标记** ✅🟡📋⬜❌（ends.ts / stats.ts / Home 对标表同一约定：它们是「已落地/部分/规划」
    //         的文本口径，与「图标」不同类；且 Home 的对标表是**竞品对照矩阵**，符号即语义）
    //      ③ ● ▸ ▾ ✗ ✎ ⌕（文本控件字形：LIVE 点 / 折叠箭头 / 报错前缀 / 编辑标记 / 搜索标记）
    //      ④ ◐（「部分完成」状态字形——board-inventory / 记忆的既定口径；产品页「诚实边界」列表
    //         用它做条目前缀点，属「状态标记」类，与 ② 同源）★2026-10-01 实测抓出后按类收编
    //      ⑤ ✕ ▼（Themis 页 Themis/CssEngine 的**文本标记**：✕ = ✓ 的「未胜出」配对（同一 decl-mark
    //         span）；▼ = 管线流程箭头，与已允许的 ▸/▾ 同类）★2026-10-08 实测抓出后按类收编
    const ALLOW = new Set([
      '★', '✓', '→', '←', '↑', '↓', '↔', '⇄', '⇒', '◆', '↗',
      '✅', '🟡', '📋', '⬜', '❌',
      '●', '▸', '▾', '✗', '✎', '⌕',
      '◐', '✕', '▼',
    ])
    const problems: string[] = []
    const walk = (dir: string): string[] => {
      const out: string[] = []
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = pathMod.join(dir, e.name)
        if (e.isDirectory()) {
          if (e.name === 'node_modules') continue
          out.push(...walk(p))
        } else if (/\.(vue|ts)$/.test(e.name)) out.push(p)
      }
      return out
    }
    for (const file of walk(SRC)) {
      const lines = fs.readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        // 注释行跳过（注释里允许引述「原 emoji 是什么」这类说明）
        if (/^\s*(\/\/|\*|\/\*|<!--)/.test(line)) return
        for (const m of line.matchAll(new RegExp(EMOJI, 'gu'))) {
          if (ALLOW.has(m[0])) continue
          problems.push(`${pathMod.relative(pathMod.resolve(__dirname, '..'), file)}:${i + 1} 「${m[0]}」`)
        }
      })
    }
    expect(problems, `官网源码出现 emoji（须改用自绘图标 DemoIcon/FeatureIcon）：\n${problems.join('\n')}`).toEqual([])
  })

  it('DemoIcon 覆盖演示所需的全部图标名（缺名会静默退化成 box 兜底）', () => {
    const fs = require('node:fs') as typeof import('node:fs')
    const iconSrc = fs.readFileSync(require('node:path').resolve(__dirname, '../website/src/components/DemoIcon.vue'), 'utf8')
    const names = [...iconSrc.matchAll(/^\s{2}'?([a-z-]+)'?:\s*\[/gm)].map((m) => m[1]!)
    const need = [
      // 形态（FORM_PROFILES 八项——多端同屏页 + 首页横幅共用）
      'watch', 'phone', 'flip', 'fold', 'tablet', 'pc', 'car', 'tv',
      // 内容槽（演示商品）
      'headphones', 'earpads', 'cable', 'case', 'battery-charge', 'box',
      'home', 'audio', 'orders', 'settings', 'cart', 'bookmark',
      // 状态栏
      'signal', 'battery', 'heart',
      // 生态页卡片
      'globe', 'blocks', 'bolt', 'plus-circle',
    ]
    const missing = need.filter((n) => !names.includes(n))
    expect(missing, `DemoIcon 缺少图标：${missing.join(', ')}`).toEqual([])
  })
})

describe('★国内厂商折叠规范落地（2026-09-28 小米/ITGSA 三区域 + 宽高比）', () => {
  it('★两类半开各自的网格结构 + 折痕空行（区域 3 结构上无元素）', async () => {
    // 小米《大屏应用 UX 设计指南》原文：「避免区域 3 内出现任何元素」（区域 3 = 折痕/形变区）。
    // 实现取「**空网格行**」：折痕带所在行不分配给任何元素 → 由结构保证，而非样式巧合。
    // ★2026-09-29：两类半开结构不同（书本式横长条左右分栏 / 翻盖式竖方形上下分区）。
    const styleText = fs.readFileSync(
      path.resolve(__dirname, '../packages/components/p-formfactor/index.vue'),
      'utf8',
    )
    const blockOf = (sel: string, endMark: string): string => {
      const a = styleText.indexOf(sel)
      const b = styleText.indexOf(endMark, a)
      expect(a, `未找到 ${sel}`).toBeGreaterThan(-1)
      return styleText.slice(a, b > a ? b : a + 6000)
    }
    const bookBlock = blockOf('/* 书本式半开（fold · Book 模式）', '/* 翻盖式半折（flip · TableTop')
    const tableBlock = blockOf('.p-formfactor.posture-tabletop .pf-body {', '/* ── 拓扑：stack（手机')
    // ① 书本式半开：横长条 → 左右两列（展示 | 推荐列），折痕带在**窗口底缘**
    expect(bookBlock, '书本式半开须左右分栏').toContain('grid-template-columns')
    expect(bookBlock, '书本式半开给底缘折痕带留位').toContain('padding-bottom: var(--pf-crease-band')
    // ② 翻盖式半折：竖方形 → 行结构 + 折痕空行（末行 ::after 占位，无元素分配）
    expect(tableBlock, '翻盖式半折须声明行分配').toContain('grid-template-rows')
    expect(tableBlock, '折痕空行须用 ::after 占位（末行）').toMatch(/pf-body::after[\s\S]*?grid-row:\s*5/)
    expect(tableBlock, '折痕带宽度消费端注入变量').toContain('--pf-crease-band')
    // ③ SKU 与主操作同在下半屏（操作区）——SKU 不被隐藏（Apple「跨姿态同样功能」）
    expect(tableBlock).not.toMatch(/posture-tabletop[^}]*\.pf-sku\s*{[^}]*display:\s*none/)
    // ④ 规格槽：两类半开都不得换行（横长条/竖方形都放不下两行规格）
    for (const [name, blk] of [['book', bookBlock], ['tabletop', tableBlock]] as const) {
      expect(blk, `${name} 规格槽须单行横滚`).toContain('flex-wrap: nowrap')
    }
  })

  it('宽高比分类：极扁（车机）与竖屏（折叠外屏）分属不同类，媒体上限随宽高比收紧', () => {
    const cases: Array<[number, number, string]> = [
      [1280, 480, 'ultra-wide'], // 车机 8/3
      [1920, 1080, 'wide'], // TV 16:9
      [673, 420, 'wide'], // 半折
      [466, 678, 'tall'], // Duo 外屏
    ]
    for (const [w, h, want] of cases) {
      expect(resolveAspectClass(w, h), `${w}x${h}`).toBe(want)
    }
  })
})
