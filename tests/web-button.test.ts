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
    const state = reactive({ clicks: 0, opened: '' })
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
              onOpenshare: () => {
                state.opened = 'share'
              },
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

  it('open-type=share → 点击触发 openshare 事件（降级）', async () => {
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

  it('★按下态样式带 !important（压过用户主题化的基色覆盖——见 style.css）', async () => {
    // 断言框架样式表内按下态规则含 !important（静态检查：防止后续误删导致反馈再次失效）
    const fs = await import('node:fs')
    const path = await import('node:path')
    const css = fs.readFileSync(
      path.resolve(process.cwd(), 'packages/built-in-components/src/style.css'),
      'utf8',
    )
    const rule = css.match(/\.proteus-web-button--hover[^{]*\{[^}]*\}/)?.[0] ?? ''
    expect(rule, '按下态规则应存在').toContain('background-color')
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
    ;(document.querySelector('.pwp-confirm') as HTMLElement).click()
    await new Promise((r) => setTimeout(r, 350))
    expect(document.querySelector('.proteus-web-picker-sheet')).toBeNull()
    expect(events.changes.length).toBe(1)
    // 默认中间项：[1, 1]（2 项取 1 / 3 项取 1）
    expect(events.changes[0]).toEqual([1, 1])
  })
})
