// tests/p-batch2-contract.test.ts
// ★端对齐批次 2（容器与外壳）契约回归锁（2026-09-14 SOP v2）：
//   覆盖 p-view / p-text / p-icon / p-image / p-page-container / p-scroll-view /
//        p-router-link（navigator 语义纠偏）/ p-nav-bar（navigation-bar 语义纠偏）。
//   每条锁对应一个真实踩坑或能力点，破坏性验证思路写在断言注释里。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { compileVueSfc } from '@proteus-vue/compiler'

const ROOT = path.resolve(__dirname, '..')
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8')
const compile = (dir: string) => {
  const src = read(`packages/components/${dir}/index.vue`)
  return { src, ...compileVueSfc(src, { isComponent: true, filename: `packages/components/${dir}/index.vue` }) }
}
/** 去掉注释（注释里会提到被禁的属性名，不算违规）：HTML 注释 + 块注释 + 行注释 */
const strip = (s: string) =>
  s.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('★批次2 · 中性标签（Web 模拟层必须能介入）', () => {
  // ★真机/浏览器复测根因（2026-09-14）：组件根写原始 HTML 标签（div/span/img）时，Web 端保持原生元素，
  //   Web 模拟层（proteus-view/text/image）**完全不介入** → hover 反馈/长按菜单/scroll 事件全部失效。
  //   组件模板必须用**小程序标签**（view/text/image/scroll-view），由 defaultScopedPlugin 改写为 proteus-*。
  const NEUTRAL: Array<[string, string]> = [
    ['p-view', 'view'],
    ['p-text', 'text'],
    ['p-image', 'image'],
    ['p-router-link', 'view'],
  ]
  for (const [dir, tag] of NEUTRAL) {
    it(`${dir} 根节点用 <${tag}>（非原始 HTML 标签）`, () => {
      const { src } = compile(dir)
      // 模板首标签应为该小程序标签
      const tpl = src.slice(src.indexOf('<template>'), src.indexOf('</template>'))
      expect(tpl, `${dir} 模板应以 <${tag}> 开头元素`).toMatch(new RegExp(`<${tag}[\\s>]`))
      // 不应再出现原始 HTML 标签做根（div/span 根）
      expect(tpl, `${dir} 不应以 <div> 为根`).not.toMatch(/^\s*<div[\s>]/m)
    })
  }

  it('p-text 不再用 <span> 根；p-image 不再用 <img> 根', () => {
    expect(compile('p-text').src, 'p-text 不应有 <span> 根').not.toMatch(/<template>\s*<span/)
    expect(compile('p-image').src, 'p-image 不应有 <img> 根').not.toMatch(/<template>\s*<img/)
  })

  it('★p-page-container 用 v-model:show 时才可被遮罩点击关闭（@update:show 亦归一到 update-show）', () => {
    // 编译器：父级 @update:show / v-model:show → 产物 bind:update-show（单段——与子组件 emit 匹配）
    const page = fs.readFileSync(path.join(ROOT, 'showcase/subpackages/components/pages/p-page-container.vue'), 'utf-8')
    const { wxml } = compileVueSfc(page, { isComponent: false, filename: 'p-page-container.vue' })
    expect(wxml, 'v-model:show 应编译为 bind:update-show（单段，非 bind:update:show）').toContain('bind:update-show=')
    expect(wxml, '不得出现双冒号 bind:update:show（永不匹配）').not.toContain('bind:update:show=')
  })
})

describe('★批次2 · p-view（官方 <view> 4 属性）', () => {
  it('hover-* 四属性声明并透传到原生 view', () => {
    const { src, wxml } = compile('p-view')
    for (const p of ['hoverClass', 'hoverStopPropagation', 'hoverStartTime', 'hoverStayTime']) {
      expect(src, `应有 ${p}`).toMatch(new RegExp(`${p}:\\s*\\{\\s*type:`))
    }
    expect(wxml).toContain('hover-class="{{hoverClass')
    expect(wxml).toContain('hover-start-time="{{hoverStartTime}}"')
    expect(wxml).toContain('hover-stay-time="{{hoverStayTime}}"')
  })

  it('按压类 p-view--hover 为 global 单类（MP 平台加类无 scopeId 后缀，scoped 匹配不上）', () => {
    const { src } = compile('p-view')
    expect(src).toContain('<style global>')
    expect(src).toMatch(/<style global>[\s\S]*?\.p-view--hover\s*\{/)
  })
})

describe('★批次2 · p-text（官方 <text> 7 属性）', () => {
  it('user-select/overflow/max-lines/select-on-gesture/space/decode 声明并透传', () => {
    const { src, wxml } = compile('p-text')
    for (const p of ['userSelect', 'overflow', 'maxLines', 'selectOnGesture', 'space', 'decode']) {
      expect(src, `应有 ${p}`).toMatch(new RegExp(`${p}:\\s*\\{\\s*type:`))
    }
    expect(wxml).toContain('user-select="{{userSelect')
    expect(wxml).toContain('max-lines="{{maxLines')
    expect(wxml).toContain('select-on-gesture="{{selectOnGesture')
    expect(wxml).toContain('space="{{space}}"')
    expect(wxml).toContain('decode="{{decode')
  })

  it('max-lines 的 Web 映射走 -webkit-line-clamp（动态行数，CSS 类承载不了）', () => {
    const { src } = compile('p-text')
    expect(src).toContain('WebkitLineClamp')
  })
})

describe('★批次2 · p-icon（官方 <icon> type 别名）', () => {
  it('type 为 name 的官方别名（name 优先），字形表含官方取值', () => {
    const { src } = compile('p-icon')
    expect(src).toMatch(/type:\s*\{\s*type:\s*String/)
    expect(src).toContain("props.name || props.type")
    for (const g of ['success', 'success_no_circle', 'info', 'warn', 'waiting', 'cancel', 'download', 'clear']) {
      expect(src, `字形表应含官方 type=${g}`).toMatch(new RegExp(`\\b${g}:\\s*'`))
    }
  })
})

describe('★批次2 · p-image（官方 <image> 7 + cover-image referrer-policy）', () => {
  it('show-menu-by-longpress/fade-in/preload/webp/referrer-policy 声明并透传', () => {
    const { src, wxml } = compile('p-image')
    for (const p of ['showMenuByLongpress', 'fadeIn', 'preload', 'webp', 'referrerPolicy']) {
      expect(src, `应有 ${p}`).toMatch(new RegExp(`${p}:\\s*\\{\\s*type:`))
    }
    expect(wxml).toContain('show-menu-by-longpress="{{showMenuByLongpress')
    expect(wxml).toContain('preload="{{preload')
    expect(wxml).toContain('webp="{{webp')
    expect(wxml).toContain('referrerpolicy="{{referrerPolicy}}"')
  })

  it('★mode 的变体类用**字面量键**（禁动态拼接——T12：动态类名 MP 端整体丢失）', () => {
    const { src, wxml } = compile('p-image')
    expect(src, '禁动态拼接类名').not.toMatch(/'p-image--'\s*\+/)
    expect(wxml, '字面量键应进产物').toContain("mode === 'aspectFill'?'p-image--aspectFill")
  })
})

describe('★批次2 · p-page-container（官方 <page-container> 9 属性）', () => {
  it('duration/z-index/close-on-slide-down/overlay-style/custom-style 声明', () => {
    const { src } = compile('p-page-container')
    for (const p of ['duration', 'zIndex', 'closeOnSlideDown', 'overlayStyle', 'customStyle', 'closeOnClickOverlay']) {
      expect(src, `应有 ${p}`).toMatch(new RegExp(`${p}:\\s*\\{\\s*type:`))
    }
  })

  it('★行内 style 禁对象/数组字面量（编译器产出 {{...}} 嵌套花括号，WXML 不合法）', () => {
    const { src, wxml } = compile('p-page-container')
    const code = strip(src)
    // 源码里不应出现 `:style="{ zIndex }"` 或 `:style="[a, b]"`
    expect(code, '禁对象字面量 style 绑定').not.toMatch(/:style="\{/)
    expect(code, '禁数组字面量 style 绑定').not.toMatch(/:style="\[/)
    // 产物不应出现非法嵌套/数组插值
    expect(wxml, 'WXML 不应有嵌套花括号插值').not.toContain('{{{')
    expect(wxml, 'WXML 不应有数组字面量插值').not.toMatch(/\{\{\[/)
    expect(wxml).toContain('style="{{rootStyle}}"')
    expect(wxml).toContain('style="{{panelStyle}}"')
  })

  it('下滑关闭（touchstart/move/end）已接线', () => {
    const { wxml } = compile('p-page-container')
    expect(wxml).toContain('bindtouchstart="onTouchStart"')
    expect(wxml).toContain('bindtouchend="onTouchEnd"')
  })
})

describe('★批次2 · p-scroll-view（官方 <scroll-view> 40 属性）', () => {
  it('核心属性全量声明（滚动位置/阈值/下拉刷新/增强族/渲染模式）', () => {
    const { src } = compile('p-scroll-view')
    const need = [
      'scrollX', 'scrollY', 'upperThreshold', 'lowerThreshold', 'scrollTop', 'scrollLeft',
      'scrollIntoView', 'scrollIntoViewOffset', 'scrollWithAnimation', 'enableBackToTop', 'enablePassive',
      'refresherEnabled', 'refresherThreshold', 'refresherDefaultStyle', 'refresherBackground', 'refresherTriggered',
      'bounces', 'showScrollbar', 'fastDeceleration', 'scrollAnchoring',
      'type', 'associativeContainer', 'reverse', 'clip', 'cacheExtent', 'minDragDistance',
      'scrollIntoViewWithinExtent', 'scrollIntoViewAlignment', 'padding',
      'refresherTwoLevelEnabled', 'refresherTwoLevelTriggered', 'refresherTwoLevelThreshold',
      'refresherTwoLevelCloseThreshold', 'refresherTwoLevelScrollEnabled', 'refresherBallisticRefreshEnabled',
      'refresherTwoLevelPinned', 'enableFlex', 'enhanced', 'pagingEnabled', 'usingSticky',
    ]
    for (const p of need) expect(src, `应有 ${p}`).toMatch(new RegExp(`${p}:\\s*\\{\\s*type:`))
  })

  it('★事件名与 MP 原生 bind:<name> 对齐；defineEmits 单行（编译清单行正则提取）', () => {
    const { src } = compile('p-scroll-view')
    expect(src).toContain("'scrolltoupper'")
    expect(src).toContain("'refresherrefresh'")
    expect(src).toContain("'refresherpulling'")
    const emitsLine = src.match(/defineEmits\(\[(.*?)\]\)/s)
    expect(emitsLine, 'defineEmits 应为单行数组').toBeTruthy()
    expect(emitsLine![1], 'defineEmits 不得跨行').not.toContain('\n')
  })

  it('★p-scroll-view 根样式不含 display/overflow（防覆盖页面侧横向 flex 布局）', () => {
    // 2026-09-14 横向滚动修复：组件根 `.p-scroll-view{display:block;overflow:auto}` 与页面侧
    // `.scroll-x{display:flex}` 同特异性竞争（apply-shared 顺序不定）→ 横向 flex 被 block 覆盖，
    // 子项塌成一条线。组件根不应声明 display/overflow（滚动由 scroll-view 原生 / Web 模拟层 inline 承担）。
    const { src } = compile('p-scroll-view')
    const block = src.match(/<style scoped>[\s\S]*?<\/style>/)?.[0] ?? ''
    expect(block, '根类不应声明 display').not.toMatch(/\.p-scroll-view\s*\{[^}]*display\s*:/)
    expect(block, '根类不应声明 overflow').not.toMatch(/\.p-scroll-view\s*\{[^}]*overflow\s*:/)
  })

  it('★横向滚动 demo：子项用原生 <view>（非自定义组件）+ 内层 flex row wrapper', () => {
    // Skyline 下自定义组件宿主在 flex 容器里不可靠；横向排列 = 内层 view 做 flex row。
    // 且 demo 不得使用未 import 的组件标签（如 <p-view>）——否则 Web 报 Failed to resolve component。
    const page = read('showcase/subpackages/components/pages/p-scroll-view.vue')
    const tpl = page.slice(page.indexOf('<template>'), page.lastIndexOf('</template>'))
    const horizBlock = tpl.slice(tpl.indexOf('index="02"'), tpl.indexOf('index="03"'))
    expect(horizBlock, '横向块应含内层 flex wrapper').toContain('scroll-x__inner')
    expect(horizBlock, '横向子项应为原生 <view>').toMatch(/<view[^>]*v-for|<view\b[\s\S]*?v-for/)
    expect(horizBlock, '横向子项不应是自定义组件 p-view').not.toContain('<p-view')
    // 页面用到的 p-* 组件必须在 import 列表中
    const imports = page.slice(0, page.indexOf('const '))
    for (const tag of ['p-scroll-view', 'p-text', 'p-button']) {
      const comp = tag.replace(/^p-/, '').replace(/(^|-)(\w)/g, (_m, _d, c) => c.toUpperCase())
      const pascal = 'P' + comp
      expect(imports, `用到 <${tag}> 须 import ${pascal}`).toContain(pascal)
    }
    expect(tpl, '模板不得出现未 import 的 <p-view>').not.toContain('<p-view')
  })

  it('★★横向 scroll-view 容器必须声明**确定高度**（否则塌成一条线、内容被裁——真机实测 S60）', () => {
    // 真根因（2026-09-14 真机目视定位）：横向 demo 的 `.scroll-x` 只有 width、**无 height** →
    //   Skyline 下 scroll-view 无确定交叉轴尺寸 → 容器塌成细线 → 子项被裁「看不到」。
    //   （子项自身有几何、内层 wrapper 也撑开了，但父容器不显示——只有「容器高度」能区分。）
    //   官方 <scroll-view> 同理：scroll-x 需 `white-space:nowrap` + **容器高度**。
    const page = read('showcase/subpackages/components/pages/p-scroll-view.vue')
    const style = page.match(/<style scoped>[\s\S]*?<\/style>/)?.[0] ?? ''
    const rule = style.match(/\.scroll-x\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(rule, '横向容器 .scroll-x 应声明 height（否则塌成一条线）').toMatch(/(^|;|\s)height\s*:/)
    // 内层 wrapper 用 inline-flex（随内容撑开）；禁 flex（会被容器宽夹住）
    const innerRule = style.match(/\.scroll-x__inner\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(innerRule, '★内层 wrapper 应用 inline-flex（随内容撑开）').toMatch(/display\s*:\s*inline-flex/)
    expect(innerRule, '内层 wrapper 不得用 display:flex（会被容器宽夹住）').not.toMatch(/display\s*:\s*flex\s*;/)
  })
})

describe('★批次2 · 标尺语义纠偏（navigator↔p-router-link / navigation-bar↔p-nav-bar）', () => {
  it('audit 脚本映射与 SSOT component-ir/audit.ts 一致', () => {
    const auditScript = read('scripts/audit-component-attrs.mjs')
    expect(auditScript, 'navigator 应映射 p-router-link（导航链接）').toMatch(/'navigator':\s*'p-router-link'/)
    expect(auditScript, 'navigation-bar 应映射 p-nav-bar').toMatch(/'navigation-bar':\s*'p-nav-bar'/)
    // 不得再错映射到导航栏 p-nav
    expect(auditScript).not.toMatch(/'navigator':\s*'p-nav'/)
  })

  it('p-router-link 承载官方 navigator 跳转属性（target/url/open-type/delta/…）', () => {
    const { src } = compile('p-router-link')
    for (const p of ['target', 'url', 'openType', 'delta', 'appId', 'path', 'extraData', 'version', 'shortLink']) {
      expect(src, `应有 ${p}`).toMatch(new RegExp(`${p}:\\s*\\{\\s*type:`))
    }
    // 框架语义 to 保留，且 url 可回退
    expect(src).toContain('props.to || props.url')
  })

  it('p-nav-bar 承载官方 navigation-bar 属性（loading/front-color/background-color/换色动画）', () => {
    const { src } = compile('p-nav-bar')
    for (const p of ['loading', 'frontColor', 'backgroundColor', 'colorAnimationDuration', 'colorAnimationTimingFunc']) {
      expect(src, `应有 ${p}`).toMatch(new RegExp(`${p}:\\s*\\{\\s*type:`))
    }
  })

  it('★p-nav-bar spinner 无单边异色 border（Skyline 圆角失效 T11）', () => {
    const { src } = compile('p-nav-bar')
    expect(strip(src), '禁 border-*-color').not.toMatch(/border-(top|right|bottom|left)-color/)
    expect(src, 'spinner 为统一色环 + 随子点').toContain('p-nav-bar-spinner-dot')
  })
})

describe('★批次2 · 标尺算法（worklet 回调不计属性）', () => {
  it('audit 脚本排除 worklet 回调（事件而非可声明属性）', () => {
    const auditScript = read('scripts/audit-component-attrs.mjs')
    expect(auditScript).toMatch(/a\.type !== 'worklet'/)
    expect(auditScript).toMatch(/\^\(bind\|catch\|worklet\)/)
  })

  it('（破坏性验证）worklet 名确实存在于快照，但被审计排除', () => {
    const snap = JSON.parse(read('docs/generated/miniprogram-component-attrs.json'))
    const sv = snap.components['scroll-view'] as Array<{ name: string; type: string }>
    const worklets = sv.filter((a) => a.name.startsWith('worklet:'))
    expect(worklets.length, '快照含 worklet 条目（故排除逻辑有实际对象）').toBeGreaterThan(0)
    // 这些条目都是 worklet/callback 类型 → 会被同一过滤条件排除
    expect(worklets.every((a) => a.type === 'worklet' || a.type === 'callback')).toBe(true)
  })
})

describe('★框架元素探针（编译器注入契约，2026-09-14）', () => {
  it('组件产物注入自测量（ready 内 `.in(this)` + 写全局注册表）', () => {
    // 组件内部节点对工具不可见（glass-easel 隔离）→ 组件 must 自测量并发布（跨端 E2E 降级通道）。
    const { js } = compile('p-scroll-view')
    expect(js, '组件应注入探针函数').toContain('__proteusProbe')
    expect(js, '探针应在 ready 中调用').toMatch(/__proteusProbe\(\)/)
    expect(js, '探针应用组件作用域查询（.in(this)）').toContain('.in(__self)')
    expect(js, '探针应写全局注册表').toContain('__PROTEUS_PROBES__')
    expect(js, '探针应受 pid/全局开关门控（零成本）').toContain('__PROTEUS_PROBE_ALL__')
    expect(js, '探针根选择器应用 scoped 类名定位根节点').toMatch(/\.p-scroll-view-data-v-/)
  })

  it('页面产物注入探针复位（key 稳定）+ debug 构建默认开启', () => {
    const page = read('showcase/subpackages/components/pages/p-scroll-view.vue')
    // 页面模式编译
    const { js } = compileVueSfc(page, { isComponent: false, filename: 'p-scroll-view.vue' })
    expect(js, '页面 onLoad 应复位注册表（同页 key 稳定）').toContain('__PROTEUS_PROBES__ = {}')
    expect(js, '页面 onLoad 应复位序号').toContain('__PROTEUS_PROBE_SEQ__ = 0')
  })

  it('（破坏性）规则禁用 script/element-probe 时不注入', () => {
    const { js } = compileVueSfc(read('packages/components/p-scroll-view/index.vue'), {
      isComponent: true,
      filename: 'packages/components/p-scroll-view/index.vue',
      rules: { disabled: ['script/element-probe'] },
    })
    expect(js, '禁用后不应注入探针').not.toContain('__proteusProbe')
  })
})
