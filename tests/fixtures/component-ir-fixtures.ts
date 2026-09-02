// tests/fixtures/component-ir-fixtures.ts
// ★G-31 B5：组件渲染 conformance fixtures——L1 组件集（6 布局原语 + UI 原语 + Fluid 扩展）的代表性 C-IR 树
//   与 conformance.md §4 示例对齐（grid-basic 等）；经 toComponentTree（模板标签 → C-IR）构建，保证是合法生产输入
import { toComponentTree } from '@proteus-vue/component-ir'
import type { ComponentIR } from '@proteus-vue/component-ir'

/** grid-basic：conformance.md §4 示例——p-grid(minColWidth/maxCols/gap) + 8× p-box */
export const GRID_BASIC: ComponentIR = toComponentTree('p-grid', { minColWidth: 160, maxCols: 4, gap: 12 }, [
  { tag: 'p-box', props: {} },
  { tag: 'p-box', props: {} },
  { tag: 'p-box', props: {} },
  { tag: 'p-box', props: {} },
  { tag: 'p-box', props: {} },
  { tag: 'p-box', props: {} },
  { tag: 'p-box', props: {} },
  { tag: 'p-box', props: {} },
])!

/** stack-form：p-stack(gap) + [p-text, p-button]——布局 + UI 原语混合 */
export const STACK_FORM: ComponentIR = toComponentTree('p-stack', { gap: 8 }, [
  { tag: 'p-text', props: { variant: 'h1' } },
  { tag: 'p-button', props: { variant: 'primary' } },
])!

/** adaptive-modal：p-adaptive + [p-text, p-button]——adaptive 语义载体（p-modal 角色） */
export const ADAPTIVE_MODAL: ComponentIR = toComponentTree('p-adaptive', {}, [
  { tag: 'p-text', props: {} },
  { tag: 'p-button', props: {} },
])!

/** list-row：p-list-view + 2× p-box(p-text)——列表行结构 */
export const LIST_ROW: ComponentIR = toComponentTree('p-list-view', {}, [
  { tag: 'p-box', props: {}, children: [{ tag: 'p-text', props: {} }] },
  { tag: 'p-box', props: {}, children: [{ tag: 'p-text', props: {} }] },
])!

/** nav-header：p-nav-bar + [p-text, p-button]——导航头 */
export const NAV_HEADER: ComponentIR = toComponentTree('p-nav-bar', { title: 'Home' }, [
  { tag: 'p-text', props: { variant: 'h1' } },
  { tag: 'p-button', props: {} },
])!

/** sidebar-split：p-sidebar > p-split > [p-safe, p-box]——Fluid 扩展语义（折叠屏/平板场景） */
export const SIDEBAR_SPLIT: ComponentIR = toComponentTree('p-sidebar', {}, [
  { tag: 'p-split', props: {}, children: [{ tag: 'p-safe', props: {} }, { tag: 'p-box', props: {} }] },
])!

/** L1 组件 fixtures 全集（conformance 门禁逐 fixture × 逐后端跑） */
export const COMPONENT_FIXTURES: Record<string, ComponentIR> = {
  'grid-basic': GRID_BASIC,
  'stack-form': STACK_FORM,
  'adaptive-modal': ADAPTIVE_MODAL,
  'list-row': LIST_ROW,
  'nav-header': NAV_HEADER,
  'sidebar-split': SIDEBAR_SPLIT,
}
