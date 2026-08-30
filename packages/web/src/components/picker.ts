// packages/web/src/components/picker.ts
// 小程序 <picker>（18-picker-swiper B1：selector 单选）：Web 模拟
// ★对齐 weui.io/#form_select_primary 官方单列选择器（规划 17 方法论 CDP 实测）：
//   弹层 = 左上关闭按钮 + 居中标题（15px/500）；滚轮区 280px + 56px 行；
//   选中高亮 = indicator 灰条（top 112px / #f7f7f7 / 左右 8px / 四角 8px）+ 上下白色渐隐遮罩（112px）；
//   内容定位 = translate3d 平移（非 scroll-snap），滚动/点击后吸附最近项
// 载荷对齐微信 change：{ detail: { value: 索引 } }
import { defineComponent, h } from 'vue'

const ITEM_H = 56 // 官方 .weui-picker__item height
const BD_H = 280 // 官方 .weui-picker__bd height
const INDICATOR_TOP = (BD_H - ITEM_H) / 2 // 112（官方 top）

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
      // ★默认选中中间项（weui 官方：5 项默认 index 2，content 偏移 0）——value 属性缺省时取 Math.floor(n/2)
      const hasValue = (attrs as Record<string, unknown>).value !== undefined
      const initValue = hasValue
        ? Math.min(Math.max(Number((attrs as Record<string, unknown>).value ?? 0), 0), range.length - 1)
        : Math.floor(range.length / 2)

      const mask = document.createElement('div')
      mask.className = 'proteus-web-ui-mask'
      const sheet = document.createElement('div')
      sheet.className = 'proteus-web-picker-sheet'

      // 弹层头：左上关闭按钮（× 24px，官方 weui-icon-close-thin）+ 居中标题（官方 15px/500）
      const hd = document.createElement('div')
      hd.className = 'pwp-hd'
      const closeBtn = document.createElement('button')
      closeBtn.className = 'pwp-close'
      // ★官方 weui-icon-close-thin 精确 path（fill-rule evenodd 填充式细叉，描边约 1.2px——非 stroke 粗线）
      closeBtn.innerHTML =
        '<svg class="pwp-close-icon" viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path fill-rule="evenodd" d="M12.25 10.693L6.057 4.5 5 5.557l6.193 6.193L5 17.943 6.057 19l6.193-6.193L18.443 19l1.057-1.057-6.193-6.193L19.5 5.557 18.443 4.5z"/></svg>'
      const title = document.createElement('strong')
      title.className = 'pwp-title'
      title.textContent = String((attrs as Record<string, unknown>).title ?? '选择')
      hd.append(closeBtn, title)

      // 滚轮区：mask（渐隐遮罩）+ indicator（高亮条）+ content（translate3d 平移）
      const bd = document.createElement('div')
      bd.className = 'pwp-bd'
      const group = document.createElement('div')
      group.className = 'pwp-group'
      const maskEl = document.createElement('div')
      maskEl.className = 'pwp-picker-mask'
      const indicator = document.createElement('div')
      indicator.className = 'pwp-indicator'
      const content = document.createElement('div')
      content.className = 'pwp-content'
      range.forEach((item, i) => {
        const opt = document.createElement('div')
        opt.className = 'pwp-item'
        opt.textContent = itemLabel(item, rangeKey)
        opt.dataset.i = String(i)
        content.appendChild(opt)
      })
      group.append(maskEl, indicator, content)
      bd.append(group)

      // 底部确定按钮（官方 weui-half-screen-dialog__ft：weui-btn_primary 绿底白字 17px 圆角 8px 高 48px 居中）
      const ft = document.createElement('div')
      ft.className = 'pwp-ft'
      const confirmBtn = document.createElement('button')
      confirmBtn.className = 'pwp-confirm'
      confirmBtn.textContent = String((attrs as Record<string, unknown>).confirmText ?? '确定')
      ft.append(confirmBtn)

      sheet.append(hd, bd, ft)
      document.body.append(mask, sheet)

      // 内容平移量：选中项顶部对齐 indicator（offsetY = INDICATOR_TOP - sel * ITEM_H）
      let offsetY = INDICATOR_TOP - initValue * ITEM_H
      let selected = initValue
      let dragging = false
      let startY = 0
      let startOffset = 0
      let snapTimer = 0

      const render = () => {
        content.style.transform = `translate3d(0, ${offsetY}px, 0)`
        content.querySelectorAll<HTMLElement>('.pwp-item').forEach((el, i) => {
          el.classList.toggle('is-selected', i === selected)
        })
      }
      const clampOffset = (v: number): number => {
        const min = INDICATOR_TOP - (range.length - 1) * ITEM_H // 最后一项
        return Math.min(INDICATOR_TOP, Math.max(min, v))
      }
      /** 吸附最近项（滚轮/拖拽松手后） */
      const snap = () => {
        const raw = Math.round((INDICATOR_TOP - offsetY) / ITEM_H)
        selected = Math.min(Math.max(raw, 0), range.length - 1)
        offsetY = INDICATOR_TOP - selected * ITEM_H
        render()
      }
      /** 选中某索引（点击项 / 外部 value） */
      const selectIndex = (i: number) => {
        selected = Math.min(Math.max(i, 0), range.length - 1)
        offsetY = INDICATOR_TOP - selected * ITEM_H
        render()
      }

      // 滚轮：累加位移 + 防抖吸附
      group.addEventListener(
        'wheel',
        (e) => {
          e.preventDefault()
          offsetY = clampOffset(offsetY - e.deltaY)
          selected = Math.min(Math.max(Math.round((INDICATOR_TOP - offsetY) / ITEM_H), 0), range.length - 1)
          render()
          window.clearTimeout(snapTimer)
          snapTimer = window.setTimeout(snap, 120)
        },
        { passive: false },
      )

      // 触摸/鼠标拖拽（对齐微信滚轮手感）
      group.addEventListener('pointerdown', (e) => {
        dragging = true
        startY = e.clientY
        startOffset = offsetY
        ;(group as HTMLElement).setPointerCapture(e.pointerId)
      })
      group.addEventListener('pointermove', (e) => {
        if (!dragging) return
        offsetY = clampOffset(startOffset + (e.clientY - startY))
        selected = Math.min(Math.max(Math.round((INDICATOR_TOP - offsetY) / ITEM_H), 0), range.length - 1)
        render()
      })
      const endDrag = () => {
        if (!dragging) return
        dragging = false
        snap()
      }
      group.addEventListener('pointerup', endDrag)
      group.addEventListener('pointercancel', endDrag)

      // 点击某项：选中 + 吸附（滚动预览，等待确定）
      content.querySelectorAll('.pwp-item').forEach((el) => {
        el.addEventListener('click', () => {
          selectIndex(Number((el as HTMLElement).dataset.i))
        })
      })

      // 初始渲染（选中 initValue）
      selectIndex(initValue)

      const close = (): void => {
        mask.remove()
        sheet.remove()
      }
      closeBtn.addEventListener('click', () => {
        close()
        emit('cancel', {})
      })
      mask.addEventListener('click', () => {
        close()
        emit('cancel', {})
      })
      // 确定 → change { detail: { value: 索引 } }（微信小程序 picker 交互：滚动选择 + 确定提交）
      confirmBtn.addEventListener('click', () => {
        const idx = selected
        close()
        // ★载荷对齐微信 picker change：{ detail: { value: 索引 } }
        emit('change', { detail: { value: idx } })
      })
    }

    const onOpen = () => {
      if (mode === 'selector') openSelector()
      // 其余模式（multiSelector/time/date/region）B2 实现
    }

    return () => {
      const { class: cls, mode: _m, range: _r, rangeKey: _rk, value: _v, title: _t, ...rest } = attrs as Record<string, unknown>
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
