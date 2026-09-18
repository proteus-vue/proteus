// tests/desktop-b3.test.ts
// ★G-24 B3（proteus-semantic-primitives-plan 01 §7 Navigation + 06-integration-batches）：导航结构四件套
//   验证点：p-master-detail（computeSplitLayout 窄/双/三列 + applySplitNav select/back/inspector）·
//   p-tabs（关闭激活迁移/非激活/不存在/normalize）· p-command（filter 含关键词分组稳定序 + moveCommandIndex 循环/越界/空）·
//   p-breadcrumb（路由栈推导 + index 归并 + 末段 current + label 驼峰化）
import { describe, it, expect } from 'vitest'
import {
  computeSplitLayout,
  applySplitNav,
  resolveTabAfterClose,
  normalizeTabs,
  filterCommands,
  moveCommandIndex,
  deriveBreadcrumb,
  crumbLabel,
} from '@proteus-vue/desktop'

describe('G-24 B3 p-master-detail（UISplitViewController 三列模式——01 §7）', () => {
  it('computeSplitLayout：窄屏 detail 独占 / master 独占（iOS collapse）', () => {
    const narrow = computeSplitLayout({ width: 600, detailOpen: false, inspector: true })
    expect(narrow).toMatchObject({ columns: ['master'], masterVisible: true, detailVisible: false })
    const narrowDetail = computeSplitLayout({ width: 600, detailOpen: true, inspector: true })
    expect(narrowDetail).toMatchObject({ columns: ['detail'], masterVisible: false, detailVisible: true })
  })

  it('computeSplitLayout：双列并排（double..triple）/ 三列（≥triple + inspector）', () => {
    const mid = computeSplitLayout({ width: 900, detailOpen: true, inspector: true })
    expect(mid.columns).toEqual(['master', 'detail'])
    expect(mid.inspectorVisible).toBe(false)
    const wide = computeSplitLayout({ width: 1300, detailOpen: true, inspector: true })
    expect(wide.columns).toEqual(['master', 'detail', 'inspector'])
    expect(wide.inspectorVisible).toBe(true)
    const wideNoInsp = computeSplitLayout({ width: 1300, detailOpen: true, inspector: false })
    expect(wideNoInsp.columns).toEqual(['master', 'detail'])
  })

  it('applySplitNav：窄屏 select → detail 独占 / back → master；宽屏无切换', () => {
    const narrow = computeSplitLayout({ width: 500, detailOpen: false, inspector: false })
    expect(applySplitNav({ type: 'select' }, { layout: narrow, inspectorOn: false }).detailOpen).toBe(true)
    const narrowDetail = computeSplitLayout({ width: 500, detailOpen: true, inspector: false })
    expect(applySplitNav({ type: 'back' }, { layout: narrowDetail, inspectorOn: false }).detailOpen).toBe(false)
    const wide = computeSplitLayout({ width: 1000, detailOpen: true, inspector: true })
    expect(applySplitNav({ type: 'select' }, { layout: wide, inspectorOn: false }).detailOpen).toBe(true) // 并排保持
    expect(applySplitNav({ type: 'back' }, { layout: wide, inspectorOn: false }).detailOpen).toBe(true)
  })

  it('applySplitNav：toggleInspector 窄屏忽略 / 宽屏翻转', () => {
    const narrow = computeSplitLayout({ width: 500, detailOpen: true, inspector: false })
    expect(applySplitNav({ type: 'toggleInspector' }, { layout: narrow, inspectorOn: false }).inspectorOn).toBe(false)
    const wide = computeSplitLayout({ width: 1300, detailOpen: true, inspector: true })
    expect(applySplitNav({ type: 'toggleInspector' }, { layout: wide, inspectorOn: true }).inspectorOn).toBe(false)
  })
})

describe('G-24 B3 p-tabs（桌面标签关闭迁移）', () => {
  const TABS = [
    { id: 'a', label: '首页' },
    { id: 'b', label: '用户' },
    { id: 'c', label: '设置' },
  ]

  it('关闭激活 tab：右邻优先 / 末位回退左邻', () => {
    const r = resolveTabAfterClose(TABS, 'b', 'b')
    expect(r.tabs.map((t) => t.id)).toEqual(['a', 'c'])
    expect(r.activeId).toBe('c') // 右邻优先
    const last = resolveTabAfterClose(TABS, 'c', 'c')
    expect(last.activeId).toBe('b') // 末位回退左邻
  })

  it('关闭非激活 tab：active 不变；active 被连带移除（异常）→ 末位', () => {
    const r = resolveTabAfterClose(TABS, 'a', 'b')
    expect(r.activeId).toBe('a')
    const odd = resolveTabAfterClose(TABS, 'b', 'a')
    expect(odd.activeId).toBe('b')
  })

  it('关闭不存在 tab：原样返回；关闭唯一 tab → active null', () => {
    const r = resolveTabAfterClose(TABS, 'a', 'zzz')
    expect(r.tabs.length).toBe(3)
    expect(r.activeId).toBe('a')
    const single = resolveTabAfterClose([{ id: 'x', label: 'x' }], 'x', 'x')
    expect(single.tabs).toEqual([])
    expect(single.activeId).toBeNull()
  })

  it('normalizeTabs：激活不存在/空 → 首个 / null', () => {
    expect(normalizeTabs(TABS, 'zzz')).toBe('a')
    expect(normalizeTabs(TABS, 'c')).toBe('c')
    expect(normalizeTabs(TABS, null)).toBe('a')
    expect(normalizeTabs([], 'a')).toBeNull()
  })
})

describe('G-24 B3 p-command（⌘K 命令面板数据层）', () => {
  const CMDS: Array<{ id: string; title: string; group?: string; keywords?: string[] }> = [
    { id: 'new', title: '新建文件', group: '文件', keywords: ['create'] },
    { id: 'open', title: '打开文件', group: '文件' },
    { id: 'save', title: '保存', group: '文件' },
    { id: 'prefs', title: '偏好设置', group: '设置', keywords: ['settings'] },
  ]

  it('filterCommands：空查询返回全部 + 分组出现序；子串命中 title/keywords', () => {
    const all = filterCommands(CMDS, '')
    expect(all.items.length).toBe(4)
    expect(all.groups).toEqual(['文件', '设置'])
    const f = filterCommands(CMDS, '新建')
    expect(f.items.map((i) => i.id)).toEqual(['new'])
    const byKw = filterCommands(CMDS, 'settings')
    expect(byKw.items.map((i) => i.id)).toEqual(['prefs'])
  })

  it('moveCommandIndex：循环 / 越界归位 / 空 -1', () => {
    expect(moveCommandIndex(0, 1, 3)).toBe(1)
    expect(moveCommandIndex(2, 1, 3)).toBe(0) // 循环
    expect(moveCommandIndex(0, -1, 3)).toBe(2)
    expect(moveCommandIndex(-1, 1, 3)).toBe(0) // 越界
    expect(moveCommandIndex(9, -1, 3)).toBe(2)
    expect(moveCommandIndex(0, 1, 0)).toBe(-1)
  })
})

describe('G-24 B3 p-breadcrumb（路由栈推导）', () => {
  it('crumbLabel：kebab → 空格首字母大写', () => {
    expect(crumbLabel('user-profile')).toBe('User Profile')
    expect(crumbLabel('index')).toBe('Index')
  })

  it('deriveBreadcrumb：路径段 → 链（index 归并 + 末段 current）', () => {
    const crumbs = deriveBreadcrumb(['user', 'profile'])
    expect(crumbs.map((c) => c.label)).toEqual(['User', 'Profile'])
    expect(crumbs[1].current).toBe(true)
    expect(crumbs[0].current).toBe(false)
    expect(deriveBreadcrumb(['index'])).toEqual([])
    expect(deriveBreadcrumb([])).toEqual([])
    const withHome = deriveBreadcrumb(['home', 'user', 'profile'])
    expect(withHome.map((c) => c.name)).toEqual(['home', 'user', 'profile'])
  })
})
