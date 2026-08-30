// packages/web/src/components/picker.ts
// 小程序 <picker>（18-picker-swiper B1：selector 单选）：Web 模拟
// 对齐微信：点击触发底部半屏弹层（toolbar 取消/确定 + 滚动列居中选中高亮）
// 载荷对齐微信 change：{ detail: { value: 索引 } }（小程序 picker change 的 detail.value 是索引）
import { defineComponent, h } from 'vue'

const ROW_H = 40 // 每项高度（微信 picker 行高 40px 附近）
const COL_H = 200 // 滚动列可视高度（4-5 项露出）

/** 取选项显示文本：range 元素为对象时按 range-key 取值 */
function itemLabel(item: unknown, rangeKey?: string): string {
  if (item !== null && typeof item === 'object' && rangeKey) {
    return String((item as Record<string, unknown>)[rangeKey] ?? '')
  }
  return String(item ?? '')
}

export const WebPicker = defineComponent({
  name: 'ProteusWebPicker',
  inheritAttrs: false,
  emits: ['change', 'cancel', 'columnchange'],
  setup(_props, { attrs, emit, slots }) {
    const mode = String((attrs as Record<string, unknown>).mode ?? 'selector')

    /** 打开 selector 半屏弹层（DOM 挂 body，复用 mask 遮罩） */
    const openSelector = () => {
      const range = ((attrs as Record<string, unknown>).range as unknown[] | undefined) ?? []
      const rangeKey = (attrs as Record<string, unknown>).rangeKey ? String((attrs as Record<string, unknown>).rangeKey) : undefined
      const initValue = Number((attrs as Record<string, unknown>).value ?? 0)

      const mask = document.createElement('div')
      mask.className = 'proteus-web-ui-mask'
      const sheet = document.createElement('div')
      sheet.className = 'proteus-web-picker-sheet'

      // toolbar：取消（左）/ 确定（右，WeUI 蓝）
      const toolbar = document.createElement('div')
      toolbar.className = 'pwp-toolbar'
      const cancelBtn = document.createElement('button')
      cancelBtn.className = 'pwp-toolbar-btn'
      cancelBtn.textContent = '取消'
      const confirmBtn = document.createElement('button')
      confirmBtn.className = 'pwp-toolbar-btn pwp-toolbar-btn--confirm'
      confirmBtn.textContent = '确定'
      toolbar.append(cancelBtn, confirmBtn)

      // 滚动列（scroll-snap 居中吸附）
      const col = document.createElement('div')
      col.className = 'pwp-col'
      range.forEach((item, i) => {
        const opt = document.createElement('div')
        opt.className = 'pwp-col-item'
        opt.textContent = itemLabel(item, rangeKey)
        opt.dataset.i = String(i)
        col.appendChild(opt)
      })

      sheet.append(toolbar, col)
      document.body.append(mask, sheet)

      // 初始定位到 value 索引（scroll-snap 居中）
      const initScroll = () => {
        const target = col.children[initValue] as HTMLElement | undefined
        if (target) col.scrollTop = target.offsetTop - (COL_H - ROW_H) / 2
      }
      initScroll()

      // 选中高亮：滚动后取最接近列中心的行
      const highlight = () => {
        const center = col.scrollTop + COL_H / 2
        let best = initValue
        let bestDist = Infinity
        for (let i = 0; i < col.children.length; i++) {
          const el = col.children[i] as HTMLElement
          const mid = el.offsetTop + ROW_H / 2
          const d = Math.abs(mid - center)
          if (d < bestDist) {
            bestDist = d
            best = i
          }
        }
        for (let i = 0; i < col.children.length; i++) {
          ;(col.children[i] as HTMLElement).classList.toggle('is-selected', i === best)
        }
        return best
      }
      highlight()
      col.addEventListener('scroll', () => highlight(), { passive: true })
      // scroll-snap 吸附是异步的——滚轮停止后补一次 highlight（对齐选中）
      let snapTimer = 0
      col.addEventListener(
        'scrollend',
        () => highlight(),
        { passive: true } as AddEventListenerOptions,
      )
      col.addEventListener(
        'scroll',
        () => {
          window.clearTimeout(snapTimer)
          snapTimer = window.setTimeout(() => highlight(), 120)
        },
        { passive: true },
      )
      // 点击某项直接选中并吸附居中
      col.querySelectorAll('.pwp-col-item').forEach((el) => {
        el.addEventListener('click', () => {
          const idx = Number((el as HTMLElement).dataset.i)
          col.scrollTop = (el as HTMLElement).offsetTop - (COL_H - ROW_H) / 2
          highlight()
        })
      })

      const close = (): void => {
        mask.remove()
        sheet.remove()
      }
      cancelBtn.addEventListener('click', () => {
        close()
        emit('cancel', {})
      })
      confirmBtn.addEventListener('click', () => {
        const idx = highlight()
        close()
        // ★载荷对齐微信 picker change：{ detail: { value: 索引 } }
        emit('change', { detail: { value: idx } })
      })
      mask.addEventListener('click', () => {
        close()
        emit('cancel', {})
      })
    }

    const onOpen = () => {
      if (mode === 'selector') openSelector()
      // 其余模式（multiSelector/time/date/region）B2 实现
    }

    return () => {
      const { class: cls, mode: _m, range: _r, rangeKey: _rk, value: _v, ...rest } = attrs as Record<string, unknown>
      return h(
        'div',
        {
          ...rest,
          class: ['proteus-web-picker', (cls as string) || ''],
          onClick: onOpen,
        },
        slots.default?.(),
      )
    }
  },
})
