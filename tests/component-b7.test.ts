// tests/component-b7.test.ts
// ★组件库落地评估 v2（B7）：性能加固
//   - 虚拟窗口纯函数 getVirtualWindow（10k 数据 → 恒定行数，可单测）
//   - 组件 onUnmounted → detached（MP 组件真实销毁钩子，定时器清理防内存泄漏）
//   - 弹层定时器清理 + 降级 warn-once（capabilityWarnOnce，C6 防刷屏）
import { describe, it, expect, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { compileVueSfc, transformScriptToPage } from '@proteus-vue/compiler'
import { getVirtualWindow } from '../src/components/runtime/virtual-window'
import { capabilityWarnOnce, capabilityWarn } from '../src/components/runtime/capability'

const COMPONENTS_DIR = path.resolve('src/components')

function compileComponent(tag: string) {
  const sfc = fs.readFileSync(path.join(COMPONENTS_DIR, tag, 'index.vue'), 'utf-8')
  return compileVueSfc(sfc, { isComponent: true, filename: `src/components/${tag}/index.vue` })
}

describe('getVirtualWindow 虚拟窗口数学（万级数据 → 恒定行数）', () => {
  it('首屏：start=0，count = 视口行数 + 缓冲（与数据总量无关）', () => {
    const w = getVirtualWindow(0, 44, 400, 2, 10000)
    expect(w).toEqual({ start: 0, count: 12 }) // ceil(400/44)=10 + 2
  })

  it('滚动到第 5000 项：start 正确、count 恒定', () => {
    const w = getVirtualWindow(5000 * 44, 44, 400, 2, 10000)
    expect(w.start).toBe(5000)
    expect(w.count).toBe(12)
  })

  it('末尾截断：剩余不足视口行数时 count 收窄', () => {
    const w = getVirtualWindow(9998 * 44, 44, 400, 2, 10000)
    expect(w.count).toBe(2)
  })

  it('滚过末尾（start ≥ total）→ 空窗口（占位仍撑高度，不崩）', () => {
    const w = getVirtualWindow(20000 * 44, 44, 400, 2, 10000)
    expect(w).toEqual({ start: 10000, count: 0 })
  })
})

describe('组件 onUnmounted → detached（MP 组件真实销毁钩子，B7 内存）', () => {
  it('组件模式：onUnmounted 映射为 detached（微信组件无 onUnload）', () => {
    const { js } = transformScriptToPage('const t = ref(0)\nonUnmounted(() => {\n  clearTimeout(t.value)\n})', { px2rpx: true, rpxRatio: 2 }, { isComponent: true })
    expect(js).toContain('detached() {')
    expect(js).not.toContain('onUnload()')
    expect(js).toContain('clearTimeout(this.data.t)')
  })

  it('页面模式：onUnmounted 仍映射 onUnload（含页面级清理）', () => {
    const { js } = transformScriptToPage('onUnmounted(() => {\n  log(1)\n})', { px2rpx: true, rpxRatio: 2 }, { isComponent: false })
    expect(js).toContain('onUnload() {')
  })

  it('映射钩子不再误报警告（onMounted/onUnmounted 已登记）', () => {
    const { warnings } = transformScriptToPage('const t = ref(0)\nonMounted(() => {\n  t.value = 1\n})\nonUnmounted(() => {\n  clearTimeout(t.value)\n})', { px2rpx: true, rpxRatio: 2 }, { isComponent: true })
    expect(warnings.join()).not.toContain('未映射')
  })
})

describe('弹层定时器清理（B7 内存）', () => {
  it('p-popup / p-toast 含 onUnmounted 清理（编译为 detached）', () => {
    for (const tag of ['p-popup', 'p-toast']) {
      const { js } = compileComponent(tag)
      expect(js).toContain('detached() {')
      expect(js).toContain('clearTimeout(this.data.timer)')
    }
  })

  it('p-popup 接入降级 warn-once（Worklet 未实现 → CSS animation）', () => {
    const { js } = compileComponent('p-popup')
    expect(js).toContain("capabilityWarnOnce('p-popup'")
  })
})

describe('capabilityWarnOnce（同 key 只 warn 一次，防刷屏）', () => {
  it('多次调用同 key → 仅首次输出', () => {
    const calls: string[] = []
    const origWarn = console.warn
    console.warn = (...a: unknown[]) => { calls.push(String(a[0])) }
    try {
      capabilityWarnOnce('p-popup', 'worklet-animation', 'x')
      capabilityWarnOnce('p-popup', 'worklet-animation', 'x')
      capabilityWarn('p-popup', 'other', 'y')
    } finally {
      console.warn = origWarn
    }
    expect(calls.filter((c) => c.includes('worklet-animation')).length).toBe(1)
    expect(calls.filter((c) => c.includes('other')).length).toBe(1)
  })
})
