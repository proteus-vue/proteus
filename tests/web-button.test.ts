// tests/web-button.test.ts
// ★小程序 <button> Web 模拟变体（17-weui-io-alignment + weui.io/#button_default）：
//   type（default/primary/warn）/ size（mini）/ disabled / loading / plain + open-type 降级
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createApp, h, reactive } from 'vue'
import { WebButton } from '../packages/built-in-components/src/components/button'
import { WebPicker } from '../packages/built-in-components/src/components/picker'

describe('WebButton（对齐 weui.io/#button_default 变体）', () => {
  let app: ReturnType<typeof createApp> | null = null
  let host: HTMLElement | null = null
  beforeEach(() => {
    document.body.innerHTML = ''
    host = document.createElement('div')
    document.body.appendChild(host)
  })
  afterEach(() => {
    app?.unmount()
    document.body.innerHTML = ''
    app = null
    host = null
  })

  function mountButton(props: Record<string, unknown>, text = '按钮') {
    const state = reactive({ clicks: 0, opened: '', fired: [] as string[] })
    // ★契约回归：记录全部语义事件名（含 open-type 降级事件）——供「事件名与 MP 对齐」断言
    const fired = state.fired
    const Root = {
      setup() {
        return () =>
          h(
            WebButton,
            {
              ...props,
              onClick: () => {
                state.clicks++
              },
              onShare: () => {
                state.opened = 'share'
                fired.push('share')
              },
              onContact: () => fired.push('contact'),
              onGetphonenumber: () => fired.push('getphonenumber'),
              onGetuserinfo: () => fired.push('getuserinfo'),
              onOpensetting: () => fired.push('opensetting'),
            },
            {
              default: () => [text],
            },
          )
      },
    }
    app = createApp(Root)
    app.mount(host!)
    return state
  }

  it('默认：is-default 类 + 灰底（微信原生默认）', () => {
    mountButton({})
    const btn = document.querySelector('.proteus-web-button')
    expect(btn?.classList.contains('is-default')).toBe(true)
    expect(btn?.classList.contains('is-primary')).toBe(false)
    expect(btn?.classList.contains('is-mini')).toBe(false)
  })

  it('type=primary / type=warn → is-primary / is-warn 类', () => {
    mountButton({ type: 'primary' })
    expect(document.querySelector('.proteus-web-button')?.classList.contains('is-primary')).toBe(true)
    app?.unmount()
    document.body.innerHTML = ''
    host = document.createElement('div')
    document.body.appendChild(host)
    mountButton({ type: 'warn' })
    expect(document.querySelector('.proteus-web-button')?.classList.contains('is-warn')).toBe(true)
  })

  it('size=mini → is-mini 类', () => {
    mountButton({ size: 'mini' })
    expect(document.querySelector('.proteus-web-button')?.classList.contains('is-mini')).toBe(true)
  })

  // ★2026-09-13 回归锁（用户实测「Web mini 和小程序尺寸差别大」）：mini 数值对齐基础库
  //   `wx-button[size=mini]{font-size:16px;line-height:2;padding:0 .75em;width:auto}`
  //   （旧实现 14px/6px 12px 偏小）。
  it('★size=mini 数值对齐基础库（font-size 16px / padding 0 .75em / width auto）', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const css = fs.readFileSync(path.resolve(process.cwd(), 'packages/built-in-components/src/style.css'), 'utf8')
    const rule = css.match(/\.proteus-web-button\.is-mini\s*\{[^}]*\}/)?.[0] ?? ''
    expect(rule, 'is-mini 规则应存在').toContain('font-size: 16px')
    expect(rule).toContain('line-height: 2')
    expect(rule, 'padding 应为 0 .75em（非固定 px）').toMatch(/padding:\s*0\s+0\.75em/)
    // ★不得再设固定 border-radius（原生 mini 不覆盖圆角 → 交由组件变量，与 MP 一致）
    expect(rule, 'is-mini 不应覆盖 border-radius').not.toContain('border-radius')
  })

  it('disabled（无值布尔）→ is-disabled 类 + disabled 属性', () => {
    // 模拟小程序无值布尔属性：attrs 里是空字符串
    mountButton({ disabled: '' })
    const btn = document.querySelector('.proteus-web-button') as HTMLButtonElement | null
    expect(btn?.classList.contains('is-disabled')).toBe(true)
    expect(btn?.disabled).toBe(true)
  })

  it('loading（无值布尔）→ is-loading 类 + spinner 元素', () => {
    mountButton({ loading: '' })
    const btn = document.querySelector('.proteus-web-button')
    expect(btn?.classList.contains('is-loading')).toBe(true)
    expect(btn?.querySelector('.pwb-loading')).not.toBeNull()
  })

  it('plain（无值布尔）→ is-plain 类', () => {
    mountButton({ plain: '' })
    expect(document.querySelector('.proteus-web-button')?.classList.contains('is-plain')).toBe(true)
  })

  // ★2026-09-13 回归锁（用户实测「Web 镂空是绿色，小程序是黑色」）：plain 缺省色对齐基础库
  //   `wx-button[type=default][plain]{transparent;border:1px solid #353535;color:#353535}`（黑）。
  //   绿色只属于 type=primary 的镂空。另锁 margin 归零（Web 模拟层 margin:auto 的居中语义不适用于 p-button）。
  it('★plain 缺省为黑色边框文字（非绿色）；primary/warn 镂空才带对应色', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const css = fs.readFileSync(path.resolve(process.cwd(), 'packages/built-in-components/src/style.css'), 'utf8')
    const base = css.match(/\.proteus-web-button\.is-plain\s*\{[^}]*\}/)?.[0] ?? ''
    expect(base, 'plain 基色应为黑 #353535').toContain('#353535')
    expect(base, 'plain 缺省不得为绿 #07c160').not.toContain('#07c160')
    const primaryPlain = css.match(/\.proteus-web-button\.is-plain\.is-primary\s*\{[^}]*\}/)?.[0] ?? ''
    expect(primaryPlain, 'primary 镂空才用绿 #07c160').toContain('#07c160')
    const warnPlain = css.match(/\.proteus-web-button\.is-plain\.is-warn\s*\{[^}]*\}/)?.[0] ?? ''
    expect(warnPlain, 'warn 镂空用红 #e64340（对齐基础库）').toContain('#e64340')
  })

  it('open-type=share → 点击触发 share 事件（Web-only 降级）', async () => {
    const state = mountButton({ openType: 'share' })
    ;(document.querySelector('.proteus-web-button') as HTMLElement).click()
    await new Promise((r) => setTimeout(r, 30))
    expect(state.opened).toBe('share')
    expect(state.clicks).toBe(1)
  })

  // ★2026-09-13 用户实测教训回归锁：按下反馈。
  //   故障：按下类（proteus-web-button--hover）已加到元素上，但用户 scoped 主题化
  //   `.p-button[data-v-x]{background:var(--p-button-bg)}` 特异性 (0,2,0) 压过框架类 (0,1,0)
  //   → 背景不变 → Web 端按钮「点下去没反应」。修复：style.css 的按下态加 !important（框架接管按下态）。
  it('★按下反馈：pointerdown 加 hover 类、pointerup 移除（对齐微信 button-hover）', async () => {
    mountButton({})
    const btn = document.querySelector('.proteus-web-button') as HTMLElement
    expect(btn.classList.contains('proteus-web-button--hover')).toBe(false)
    btn.dispatchEvent(new Event('pointerdown'))
    await new Promise((r) => setTimeout(r, 10))
    expect(btn.classList.contains('proteus-web-button--hover')).toBe(true)
    btn.dispatchEvent(new Event('pointerup'))
    await new Promise((r) => setTimeout(r, 10))
    expect(btn.classList.contains('proteus-web-button--hover')).toBe(false)
  })

  it('★hover-class="none" → 不施加任何按下类（关闭点击态）', async () => {
    mountButton({ hoverClass: 'none' })
    const btn = document.querySelector('.proteus-web-button') as HTMLElement
    btn.dispatchEvent(new Event('pointerdown'))
    await new Promise((r) => setTimeout(r, 10))
    // hover-class=none 时类名即 'none'（对齐微信：none 表示无点击态，这里断言不加 --hover 默认类）
    expect(btn.classList.contains('proteus-web-button--hover')).toBe(false)
  })

  it('★按下态用叠加层保留色相（background-image，非替换 background-color）+ !important', async () => {
    // 演进（2026-09-13 二改）：旧实现 `background-color: rgba(0,0,0,.1) !important` 是**替换**背景——
    //   彩色按钮（品牌蓝/theme 色/is-primary 绿）按下瞬间变半透明灰 → 用户实测「一闪一闪」。
    //   改为 `background-image` 渐变叠加层：保留基色相、只压暗一档，对任意基色自动成立。
    //   !important 仍必需（压过用户 `.p-button[data-v-x]{background:var(--p-button-bg)}` 基色覆盖）。
    const fs = await import('node:fs')
    const path = await import('node:path')
    const css = fs.readFileSync(
      path.resolve(process.cwd(), 'packages/built-in-components/src/style.css'),
      'utf8',
    )
    const rule = css.match(/\.proteus-web-button--hover[^{]*\{[^}]*\}/)?.[0] ?? ''
    expect(rule, '按下态规则应存在').toContain('background-image')
    expect(rule, '按下态必须是叠加层（不得替换 background-color）').not.toMatch(/background-color\s*:/)
    expect(rule, '按下态必须 !important（压过用户基色覆盖）').toContain('!important')
  })

  // ★2026-09-13 用户实测教训回归锁：暗色模式下按钮「消失」。
  //   故障：@media (prefers-color-scheme: dark) 内 `.proteus-web-button.is-default` 特异性 (0,2,0)，
  //   与用户主题化 `.p-button[data-v-x]{background:var(--p-button-bg)}` 打平 → 级联顺序使暗色规则胜出
  //   → 白 10% 底 + 白 80% 字，在浅色卡片上按钮不可见。
  //   修复：框架侧加 :where() 归零特异性（0,2,0 → 0,1,0），恢复「用户样式永远可覆盖框架默认」契约。
  it('★暗色模式规则必须用 :where() 归零特异性（保证用户主题化可覆盖）', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const css = fs.readFileSync(path.resolve(process.cwd(), 'packages/built-in-components/src/style.css'), 'utf8')
    const darkBlock = css.match(/@media \(prefers-color-scheme: dark\) \{[\s\S]*?\n\}/)?.[0] ?? ''
    expect(darkBlock, '暗色块应存在').toContain('prefers-color-scheme')
    // 暗色块内针对 button 的选择器都必须经 :where()（否则特异性会压过用户 scoped 样式）
    const btnSelectors = darkBlock.match(/\.proteus-web-button[^{]*\{/g) ?? []
    expect(btnSelectors.length).toBeGreaterThan(0)
    for (const sel of btnSelectors) {
      expect(sel, `暗色按钮选择器应经 :where() 归零特异性：${sel.trim()}`).toContain(':where(')
    }
  })
  // ★2026-09-13 真 bug：父级 hover-class（p-button 传 MP 侧类名 p-button--hover）会覆盖框架默认按下类，
  //   导致 Web 按下样式不匹配、无反馈。框架默认类 `.proteus-web-button--hover` 必须始终存在。
  it('★自定义 hover-class 时框架默认按下类仍在（否则 Web 按下无反馈）', async () => {
    mountButton({ hoverClass: 'p-button--hover' })
    const btn = document.querySelector('.proteus-web-button') as HTMLElement
    btn.dispatchEvent(new Event('pointerdown'))
    await new Promise((r) => setTimeout(r, 10))
    const cls = btn.className
    expect(cls, '框架默认按下类必须在').toContain('proteus-web-button--hover')
    // 自定义类作为附加
    expect(cls, '自定义 hover-class 也应附加').toContain('p-button--hover')
  })

  // ★2026-09-13 真 bug：多词属性名 kebab 兼容。
  //   WebButton 未声明 props，父级写 `:open-type` 时 Vue 保留**原始 kebab 键**（attrs['open-type']），
  //   旧代码只读 attrs.openType → open-type / hover-class 在 Web 端静默失效。
  it('★kebab 属性名兼容（:open-type 以 kebab 键到达时仍生效）', async () => {
    const fired: string[] = []
    const host2 = document.createElement('div'); document.body.appendChild(host2)
    const app2 = createApp({
      render: () => h(WebButton, { 'open-type': 'contact', 'hover-class': 'my-hover', onContact: () => fired.push('contact') }, { default: () => 'x' }),
    })
    app2.mount(host2)
    const btn = host2.querySelector('button') as HTMLButtonElement
    btn.dispatchEvent(new Event('click'))
    await new Promise((r) => setTimeout(r, 10))
    expect(fired, 'kebab 键 :open-type 也应触发 contact').toContain('contact')
    // pointerdown 应施加自定义 hover 类（来自 kebab :hover-class）
    btn.dispatchEvent(new Event('pointerdown'))
    await new Promise((r) => setTimeout(r, 10))
    expect(btn.className, 'kebab :hover-class 应生效').toContain('my-hover')
    app2.unmount(); document.body.innerHTML = ''
  })

  it('★WebButton 实际 emit 语义事件名（与 SFC 监听名一致）', async () => {
    const state = mountButton({ openType: 'contact' })
    const btn = document.querySelector('.proteus-web-button') as HTMLElement
    btn.dispatchEvent(new Event('click'))
    await new Promise((r) => setTimeout(r, 10))
    expect(state.fired, 'WebButton 应发 contact（而非 opencontact）').toContain('contact')
  })

})

describe('WebPicker multiSelector（18-picker-swiper B2）', () => {
  let app: ReturnType<typeof createApp> | null = null
  let host: HTMLElement | null = null
  beforeEach(() => {
    document.body.innerHTML = ''
    host = document.createElement('div')
    document.body.appendChild(host)
  })
  afterEach(() => {
    app?.unmount()
    document.body.innerHTML = ''
    app = null
    host = null
  })

  /** 挂载 multiSelector picker，返回事件记录 */
  function mountMultiPicker(range: unknown[][], value?: number[]) {
    const events = reactive<{ changes: unknown[][]; columnchanges: number[][] }>({ changes: [], columnchanges: [] })
    const props: Record<string, unknown> = { mode: 'multiSelector', range }
    if (value) props.value = value
    const Root = {
      setup() {
        return () =>
          h(
            WebPicker,
            {
              ...props,
              onChange: (e: { detail: { value: unknown[] } }) => {
                events.changes.push(e.detail.value)
              },
              onColumnchange: (e: { detail: { column: number; value: number } }) => {
                events.columnchanges.push([e.detail.column, e.detail.value])
              },
            },
            {
              default: () => [h('span', {}, 'multi')],
            },
          )
      },
    }
    app = createApp(Root)
    app.mount(host!)
    return events
  }

  it('打开 multiSelector → 每列一个 group（flex 并排），无初始 columnchange', () => {
    const events = mountMultiPicker([
      ['甲', '乙'],
      ['一', '二', '三'],
    ])
    ;(document.querySelector('.proteus-web-picker') as HTMLElement).click()
    const sheet = document.querySelector('.proteus-web-picker-sheet')
    const groups = sheet?.querySelectorAll('.pwp-group')
    expect(groups?.length).toBe(2)
    // 每列默认选中中间项（微信语义 Math.floor(n/2)：2 项→index 1，3 项→index 1）
    const sel = [...(groups ?? [])].map((g) => g.querySelector('.pwp-item.is-selected')?.textContent)
    expect(sel).toEqual(['乙', '二'])
    // 打开不触发 columnchange
    expect(events.columnchanges.length).toBe(0)
  })

  it('显式 value → 各列按 value 索引选中', () => {
    mountMultiPicker(
      [
        ['甲', '乙'],
        ['一', '二', '三'],
      ],
      [1, 2],
    )
    ;(document.querySelector('.proteus-web-picker') as HTMLElement).click()
    const groups = document.querySelectorAll('.proteus-web-picker-sheet .pwp-group')
    const sel = [...groups].map((g) => g.querySelector('.pwp-item.is-selected')?.textContent)
    expect(sel).toEqual(['乙', '三'])
  })

  it('确定 → change { detail: { value: 索引数组 } } + 关闭（动画后移除）', async () => {
    const events = mountMultiPicker([
      ['甲', '乙'],
      ['一', '二', '三'],
    ])
    ;(document.querySelector('.proteus-web-picker') as HTMLElement).click()
    ;(document.querySelector('.pwp-btn-confirm') as HTMLElement).click()
    await new Promise((r) => setTimeout(r, 350))
    expect(document.querySelector('.proteus-web-picker-sheet')).toBeNull()
    expect(events.changes.length).toBe(1)
    // 默认中间项：[1, 1]（2 项取 1 / 3 项取 1）
    expect(events.changes[0]).toEqual([1, 1])
  })
})

// ★2026-09-13 契约回归锁：open-type 事件名必须与 MP 原生事件名对齐（跨端一个 @contact 通吃）。
//   故障：旧实现发 opencontact，而 p-button SFC 监听 @contact → Web 端 open-type 事件静默失效。
//   权威源：docs/generated/miniprogram-component-attrs.json 的 button 事件清单。
describe('★open-type 事件契约（与 MP 原生事件名对齐）', () => {
  it('MP 有原生事件者 → 同名（contact/getphonenumber/… 不带旧 open 前缀）', async () => {
    const { OPEN_TYPE_EVENTS, MP_NATIVE_EVENT_OPEN_TYPES } = await import('../packages/built-in-components/src/open-type')
    for (const ot of MP_NATIVE_EVENT_OPEN_TYPES) {
      const ev = OPEN_TYPE_EVENTS[ot]
      expect(ev, `${ot} 应有映射`).toBeTruthy()
      // 旧错误命名特征：open + 其它 open-type（opencontact/opengetphonenumber…）；
      // 注意 openSetting 的官方事件名本就是 opensetting（bind:opensetting），属合法。
      expect(ev, `${ot} → ${ev} 不应是旧前缀命名`).not.toMatch(/^open(contact|getphonenumber|getuserinfo|launchapp|chooseavatar)/)
    }
    expect(OPEN_TYPE_EVENTS.contact).toBe('contact')
    expect(OPEN_TYPE_EVENTS.getPhoneNumber).toBe('getphonenumber')
  })
})
