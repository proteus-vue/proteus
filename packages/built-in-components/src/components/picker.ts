// packages/web/src/components/picker.ts
// 小程序 <picker>（18-picker-swiper B1/B2）：Web 模拟
// ★对齐 weui.io/#form_select_primary 官方选择器（规划 17 方法论 CDP 实测）：
//   弹层 = 左上关闭按钮 + 居中标题（15px/500）+ 底部确定（绿 #07c160 48px）+ 动画 0.3s；
//   滚轮区 280px + 56px 行；选中高亮 = indicator 灰条（top 112px / #f7f7f7 / 左右 8px / 四角 8px）+ 渐隐遮罩；
//   内容定位 = translate3d 平移，滚动/点击后吸附最近项；无 value 默认中间项
// 模式：
//   selector（B1）：单列，range 一维数组，value 索引
//   multiSelector（B2）：多列联动，range 二维数组，value 索引数组；列切换触发 columnchange
// 载荷对齐微信 change：{ detail: { value } }（selector 索引 / multiSelector 索引数组）
import { defineComponent, h } from 'vue'

const ITEM_H = 48 // 官方 .weui-picker__item height（48）
const BD_H = 240 // 官方 .weui-picker__bd height（240——半屏内，不再 280）
const INDICATOR_TOP = (BD_H - ITEM_H) / 2 // 96（使选中项视觉居中）

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

    const createGroup = (items: string[], initIndex: number, onPick: (i: number) => void) => {
      const group = document.createElement('div')
      group.className = 'pwp-group'
      const maskEl = document.createElement('div')
      maskEl.className = 'pwp-picker-mask'
      const indicator = document.createElement('div')
      indicator.className = 'pwp-indicator'
      const content = document.createElement('div')
      content.className = 'pwp-content'
      items.forEach((text, i) => {
        const opt = document.createElement('div')
        opt.className = 'pwp-item'
        opt.textContent = text
        opt.dataset.i = String(i)
        content.appendChild(opt)
      })
      group.append(maskEl, indicator, content)

      // 内容平移量：选中项顶部对齐 indicator（offsetY = INDICATOR_TOP - sel * ITEM_H）
      let offsetY = INDICATOR_TOP - initIndex * ITEM_H
      let selected = Math.min(Math.max(initIndex, 0), items.length - 1)
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
        const min = INDICATOR_TOP - (items.length - 1) * ITEM_H
        return Math.min(INDICATOR_TOP, Math.max(min, v))
      }
      const snap = () => {
        const raw = Math.round((INDICATOR_TOP - offsetY) / ITEM_H)
        selected = Math.min(Math.max(raw, 0), items.length - 1)
        offsetY = INDICATOR_TOP - selected * ITEM_H
        render()
        onPick(selected)
      }
      const selectIndex = (i: number) => {
        selected = Math.min(Math.max(i, 0), items.length - 1)
        offsetY = INDICATOR_TOP - selected * ITEM_H
        render()
        onPick(selected)
      }

      // 滚轮：累加位移 + 防抖吸附
      group.addEventListener(
        'wheel',
        (e) => {
          e.preventDefault()
          offsetY = clampOffset(offsetY - e.deltaY)
          selected = Math.min(Math.max(Math.round((INDICATOR_TOP - offsetY) / ITEM_H), 0), items.length - 1)
          render()
          window.clearTimeout(snapTimer)
          snapTimer = window.setTimeout(snap, 120)
        },
        { passive: false },
      )

      // 触摸/鼠标拖拽
      group.addEventListener('pointerdown', (e) => {
        dragging = true
        startY = e.clientY
        startOffset = offsetY
        ;(group as HTMLElement).setPointerCapture(e.pointerId)
      })
      group.addEventListener('pointermove', (e) => {
        if (!dragging) return
        offsetY = clampOffset(startOffset + (e.clientY - startY))
        selected = Math.min(Math.max(Math.round((INDICATOR_TOP - offsetY) / ITEM_H), 0), items.length - 1)
        render()
      })
      const endDrag = () => {
        if (!dragging) return
        dragging = false
        snap()
      }
      group.addEventListener('pointerup', endDrag)
      group.addEventListener('pointercancel', endDrag)

      // 点击某项：选中并吸附（滚动预览，等待确定）
      content.querySelectorAll('.pwp-item').forEach((el) => {
        el.addEventListener('click', () => {
          selectIndex(Number((el as HTMLElement).dataset.i))
        })
      })

      // 初始化渲染（不触发 onPick——避免打开弹层时误发 columnchange/change）
      selected = Math.min(Math.max(initIndex, 0), items.length - 1)
      offsetY = INDICATOR_TOP - selected * ITEM_H
      render()
      return { el: group, selectIndex }
    }

    /** 通用弹层骨架（hd + bd + ft），多模式共用；confirm 回调由调用方传入（emit 载荷各模式不同） */
    const openSheet = (titleText: string, groups: Array<{ el: HTMLElement }>, onConfirm: () => void) => {
      const mask = document.createElement('div')
      mask.className = 'proteus-web-ui-mask'
      const sheet = document.createElement('div')
      sheet.className = 'proteus-web-picker-sheet'

      // 弹层头：左上关闭按钮（× 24px，官方 weui-icon-close-thin）+ 居中标题（官方 15px/500）
      const hd = document.createElement('div')
      hd.className = 'pwp-hd'
      const closeBtn = document.createElement('button')
      closeBtn.className = 'pwp-close'
      closeBtn.innerHTML =
        '<svg class="pwp-close-icon" viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path fill-rule="evenodd" d="M12.25 10.693L6.057 4.5 5 5.557l6.193 6.193L5 17.943 6.057 19l6.193-6.193L18.443 19l1.057-1.057-6.193-6.193L19.5 5.557 18.443 4.5z"/></svg>'
      const title = document.createElement('strong')
      title.className = 'pwp-title'
      title.textContent = titleText
      hd.append(closeBtn, title)

      // 滚轮区：多个 group flex 并排（官方 weui-picker__bd：flex row）
      const bd = document.createElement('div')
      bd.className = 'pwp-bd'
      groups.forEach((g) => bd.appendChild(g.el))

      // 底部按钮区（★可配置）
      //   show-buttons（默认 true）：false → 无底部按钮（仅弹层 + 关闭键）
      //   button-mode：'single'（默认，单个「确定」，weui-btn_primary 绿底）
      //                'double'（「取消」+「确定」并排——对齐原生 picker 的双手势，但保持 weui 现代视觉）
      const a = attrs as Record<string, unknown>
      const showButtons = a.showButtons !== false && a['show-buttons'] !== false
      const buttonMode = String(a.buttonMode ?? a['button-mode'] ?? 'single')
      let ft: HTMLElement | null = null
      if (showButtons) {
        ft = document.createElement('div')
        ft.className = 'pwp-ft'
        // ★尺寸用**单类**--sm（双按钮 120px），不用 :has()/后代选择器（Skyline 会剔除后代选择器）
        const sizeCls = buttonMode === 'double' ? ' pwp-btn-sm' : ''
        if (buttonMode === 'double') {
          const cancelBtn = document.createElement('button')
          cancelBtn.className = 'pwp-btn pwp-btn-cancel' + sizeCls
          cancelBtn.textContent = String(a.cancelText ?? a['cancel-text'] ?? '取消')
          ft.append(cancelBtn)
        }
        const confirmBtn = document.createElement('button')
        confirmBtn.className = 'pwp-btn pwp-btn-confirm' + sizeCls
        confirmBtn.textContent = String(a.confirmText ?? a['confirm-text'] ?? '确定')
        ft.append(confirmBtn)
        ft.addEventListener('click', (ev) => {
          const t = ev.target as HTMLElement
          if (t.classList.contains('pwp-btn-cancel')) {
            close()
            emit('cancel', {})
          } else if (t.classList.contains('pwp-btn-confirm')) {
            onConfirm()
            close()
          }
        })
        sheet.append(hd, bd, ft)
      } else {
        sheet.append(hd, bd)
      }
      document.body.append(mask, sheet)

      // ★弹出动画：挂载后双 rAF 加 is-open（translate3d 上滑 0.3s）
      requestAnimationFrame(() => {
        requestAnimationFrame(() => sheet.classList.add('is-open'))
      })

      // ★关闭动画：先播下滑（0.3s）再移除 DOM
      const close = (): void => {
        // 遮罩 fade-out 前恢复 transition（打开时的清理定时器可能已清掉 inline transition）
        mask.style.transition = 'opacity 0.3s ease'
        sheet.classList.remove('is-open')
        mask.style.opacity = '0'
        window.setTimeout(() => {
          mask.remove()
          sheet.remove()
        }, 300)
      }
      // 遮罩 fade-in
      mask.style.transition = 'opacity 0.3s ease'
      mask.style.opacity = '0'
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          mask.style.opacity = '1'
        })
      })
      window.setTimeout(() => {
        mask.style.transition = ''
      }, 400)

      closeBtn.addEventListener('click', () => {
        close()
        emit('cancel', {})
      })
      mask.addEventListener('click', () => {
        close()
        emit('cancel', {})
      })

      return { sheet, mask, close, ft }
    }

    /** selector 单列 */
    const openSelector = () => {
      const range = ((attrs as Record<string, unknown>).range as unknown[] | undefined) ?? []
      const rangeKey = (attrs as Record<string, unknown>).rangeKey ? String((attrs as Record<string, unknown>).rangeKey) : undefined
      const hasValue = (attrs as Record<string, unknown>).value !== undefined
      const initValue = hasValue
        ? Math.min(Math.max(Number((attrs as Record<string, unknown>).value ?? 0), 0), range.length - 1)
        : Math.floor(range.length / 2)

      let current = initValue
      const group = createGroup(range.map((it) => itemLabel(it, rangeKey)), initValue, (i) => {
        current = i
      })
      openSheet(String((attrs as Record<string, unknown>).title ?? '选择'), [group], () => {
        // ★载荷对齐微信 picker change：{ detail: { value: 索引 } }
        emit('change', { detail: { value: current } })
      })
    }

    /** multiSelector 多列（★微信语义：各列 options 静态取 range[colIdx]，联动由开发者 bindcolumnchange 改 range 数据驱动——框架不自动改列） */
    const openMultiSelector = () => {
      const range = ((attrs as Record<string, unknown>).range as unknown[][] | undefined) ?? []
      const rangeKey = (attrs as Record<string, unknown>).rangeKey ? String((attrs as Record<string, unknown>).rangeKey) : undefined
      const hasValue = (attrs as Record<string, unknown>).value !== undefined
      const initValues = hasValue
        ? ((attrs as Record<string, unknown>).value as unknown[]).map((v) => Number(v))
        : range.map((col) => Math.floor(col.length / 2))

      // 各列当前选中索引（静态列数据；联动列由开发者 columnchange 后外部改 range 驱动）
      const values = range.map((col, colIdx) =>
        Math.min(Math.max(initValues[colIdx] ?? Math.floor(col.length / 2), 0), col.length - 1),
      )

      // 初始构建各列（列数据 = range[colIdx] 静态；第 0 列列头对齐 selector 结构）
      const groups = range.map((col, colIdx) => {
        const init = Math.min(Math.max(values[colIdx] ?? 0, 0), col.length - 1)
        values[colIdx] = init
        return createGroup(col.map((it) => itemLabel(it, rangeKey)), init, (i) => {
          values[colIdx] = i
          // ★对齐微信 bindcolumnchange：{ detail: { column, value } }
          emit('columnchange', { detail: { column: colIdx, value: i } })
        })
      })

      openSheet(String((attrs as Record<string, unknown>).title ?? '选择'), groups.map((g) => ({ el: g.el })), () => {
        // ★载荷对齐微信 multiSelector change：{ detail: { value: 索引数组 } }
        emit('change', { detail: { value: values.slice() } })
      })
    }

    const onOpen = () => {
      if (mode === 'selector') openSelector()
      else if (mode === 'multiSelector') openMultiSelector()
      // time/date/region B2 后续实现
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
