// tests/website-nav-dropdown.test.ts
// ★★★2026-10-19（决策 #1070 · 用户实测：「引擎那个下拉弹窗鼠标移走自动消失，阅读文档时基本点不开子菜单，
//   只有首页能正常点击」）：源码级回归，锁住两件事——
//   ① **间隙命中桥**必须在（面板 `top: calc(100% + 8px)` 的 8px 视觉间隙要纳入 hover 命中区，
//      否则鼠标穿过间隙瞬间既不在按钮也不在面板上 ⇒ `mouseleave` 立刻关闭）；
//   ② **关闭有宽限期**（斜向/快速移动时不瞬间关闭；进入面板即取消）。
//
// 【为什么是源码级而不是 DOM 级】官网是 Proteus 自身编译产物（需要 vite + 全插件链），
//   vitest 里跑整站成本过高；而这两个缺陷都是**结构性形态**（CSS 间隙 + 定时器宽限），
//   源码级判据能最直接地钉住。端到端真机验证已在浏览器里做过（见决策 #1070 的取证记录）。
//
// 【★这一组防的是"看起来对"的假修法】只加宽限期不补命中桥：鼠标**缓慢**穿过 8px 间隙（>140ms）
//   仍会关闭；只补命中桥不加宽限期：斜向快速移动时指针可能瞬时掠过间隙外沿。
//   ⇒ 两条断言必须同时成立。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const APP = path.join(ROOT, 'website/src/App.vue')
const src = fs.readFileSync(APP, 'utf8')

/** 取 `<style>` 里 `.nav-drop-panel` 的 `top` 偏移，作为"间隙高度"的唯一口径 */
function panelGapPx(): number {
  const m = /\.nav-drop-panel\s*\{[^}]*top:\s*calc\(100%\s*\+\s*(\d+)px\)/s.exec(src)
  if (!m) throw new Error('读不到 .nav-drop-panel 的 top 偏移（门禁的判定前提失效）')
  return Number(m[1])
}

describe('① 间隙命中桥（下拉不会被 8px 死区关掉）', () => {
  it('面板与触发器之间的间隙 > 0（这是问题的前提，变了要重新审视本组断言）', () => {
    expect(panelGapPx()).toBeGreaterThan(0)
  })

  it('存在 `.nav-drop.is-open::after` 命中桥，高度 = 面板间隙', () => {
    const block = /\.nav-drop\.is-open::after\s*\{([^}]*)\}/s.exec(src)
    expect(block, '缺 .nav-drop.is-open::after 间隙桥（鼠标穿过间隙会立即关闭下拉）').toBeTruthy()
    const body = block![1]
    const h = /height:\s*(\d+)px/.exec(body)
    expect(h, '命中桥必须有高度').toBeTruthy()
    // ★数值同源：桥高必须等于面板偏移，否则要么留缝、要么盖住面板首行
    expect(Number(h![1]), '命中桥高度必须与面板 top 偏移一致（两处数值同源）').toBe(panelGapPx())
    // 必须只在展开态存在（收起态不该凭空多出热区）
    expect(/\.nav-drop\.is-open::after/.test(src)).toBe(true)
    expect(/^\.nav-drop::after/m.test(src), '不得有无条件的 .nav-drop::after（收起态会有幽灵热区）').toBe(false)
  })

  it('命中桥宽度覆盖面板宽度（否则右半边的斜向移动仍会掉出去）', () => {
    const block = /\.nav-drop\.is-open::after\s*\{([^}]*)\}/s.exec(src)!
    const w = /width:\s*(\d+)px/.exec(block[1])
    const panelMin = /\.nav-drop-panel\s*\{[^}]*min-width:\s*(\d+)px/s.exec(src)
    expect(w, '命中桥必须有宽度').toBeTruthy()
    expect(Number(w![1])).toBeGreaterThanOrEqual(Number(panelMin![1]))
  })
})

describe('② 关闭宽限期（斜向 / 快速移动不瞬间关闭）', () => {
  it('closeEngines 走定时器而不是立即置 false', () => {
    const fn = /function closeEngines\(\)[^{]*\{([\s\S]*?)\n\}/.exec(src)
    expect(fn).toBeTruthy()
    expect(fn![1], 'closeEngines 必须延迟关闭（立即置 false 就是本缺陷）').toMatch(/setTimeout/)
    expect(/ENGINES_CLOSE_GRACE_MS/.test(fn![1]), '宽限期必须用登记过的常量').toBe(true)
  })

  it('宽限期是**有界小值**（>0 且不拖沓：≤300ms）', () => {
    const m = /const ENGINES_CLOSE_GRACE_MS\s*=\s*(\d+)/.exec(src)
    expect(m).toBeTruthy()
    const ms = Number(m![1])
    expect(ms).toBeGreaterThan(0)
    expect(ms).toBeLessThanOrEqual(300)
  })

  it('进入面板 / 再点触发器都会取消待关闭（否则 140ms 后仍会莫名关掉）', () => {
    // 面板上绑了取消
    expect(/class="nav-drop-panel"[\s\S]{0,120}@mouseenter="cancelCloseEngines"/.test(src)).toBe(true)
    // 切换触发器也取消（连续快速点击不应被上一个定时器打断）
    const toggle = /function toggleEngines\(\)[^{]*\{([\s\S]*?)\n\}/.exec(src)
    expect(toggle).toBeTruthy()
    expect(toggle![1]).toMatch(/cancelCloseEngines/)
  })

  it('路由切换与 Escape 走"立即关"且清掉定时器（不留悬空回调）', () => {
    expect(/function closeEnginesNow\(\)[^{]*\{[\s\S]*?cancelCloseEngines\(\)[\s\S]*?enginesOpen\.value = false/.test(src)).toBe(true)
    expect(/e\.key === 'Escape'[\s\S]{0,80}closeEnginesNow\(\)/.test(src)).toBe(true)
    expect(/watch\(\(\) => route\.fullPath[\s\S]{0,160}closeEnginesNow\(\)/.test(src)).toBe(true)
  })
})
