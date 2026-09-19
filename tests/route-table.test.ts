// tests/route-table.test.ts
// ★G-32 B6（迁移工具链）：路由名表——collectRouteTargets / routeNameFromPath / buildRouteTable
//   wx 导航调用（navigateTo/switchTab/reLaunch/redirectTo）→ router.push({ name }) 候选表
//   ★跨包一致性（2026-09-19 修 bug 后新增）：routeNameFromPath ≡ router deriveNameFromFile
//   ——迁移建议的 name 必须与 derivePath 模式真实写进 routeMap 的 name 同名，否则是死引用
import { describe, it, expect } from 'vitest'
import { collectRouteTargets, routeNameFromPath, buildRouteTable } from '@proteus-vue/compat-miniprogram'
import { deriveNameFromFile } from '@proteus-vue/router'

describe('G-32 B6 路由名表（迁移工具链）', () => {
  it('collectRouteTargets：收集四类导航 API 的 url（量 query/无引号差异）', () => {
    const src = `
      wx.navigateTo({ url: '/pages/user/profile?id=1' })
      wx.switchTab({ url: '/pages/index' })
      wx.reLaunch({ url: '/pages/entry' })
      wx.redirectTo({ url: '/pages/order/list' })
      wx.navigateTo({ url: "pages/user/setting" })  // 无前导斜杠 + 双引号
      wx.getStorageSync('x')                        // 非导航——不收集
      wx.navigateTo({ url: \`/pages/dynamic/\${id}\` }) // 模板串——不收集
    `
    const targets = collectRouteTargets(src)
    expect(targets.length).toBe(5)
    expect(targets[0]).toMatchObject({ api: 'navigateTo', url: '/pages/user/profile?id=1', path: 'pages/user/profile' })
    expect(targets.map((t) => t.path)).toContain('pages/order/list')
    expect(targets.map((t) => t.path)).toContain('pages/user/setting')
    // 模板字符串不收集
    expect(targets.some((t) => t.path.includes('dynamic'))).toBe(false)
  })

  it('routeNameFromPath：kebab 命名（index 归并目录名；剥 pages 前缀；去 query/.vue）', () => {
    // ★kebab（非小驼峰）——derivePath 模式真实产物名（实测 auto-routes.js：builtin-components-demo）
    expect(routeNameFromPath('pages/user/profile')).toBe('user-profile')
    expect(routeNameFromPath('pages/index')).toBe('index')
    expect(routeNameFromPath('pages/user/index')).toBe('user') // index 归并目录名
    expect(routeNameFromPath('/pages/order/list')).toBe('order-list') // 去前导斜杠
    expect(routeNameFromPath('pages/user/setting?id=1')).toBe('user-setting') // 去 query
    expect(routeNameFromPath('pages/user/detail.vue')).toBe('user-detail') // 去 .vue
    expect(routeNameFromPath('subpackages/mine/index')).toBe('mine') // 剥 subpackages
    expect(routeNameFromPath('pages/user-profile')).toBe('user-profile') // 已是 kebab
  })

  it('★跨包契约：routeNameFromPath ≡ router deriveNameFromFile（迁移 name 不得为死引用）', () => {
    // 同一批路径分别走两个包的推导函数——不一致即 FAIL（本文件此前漏掉此断言，
    // 导致 routeNameFromPath 抄成小驼峰 NAME_RE 规则而长期无人发现）
    const cases: Array<[string, string]> = [
      ['pages/user/profile', '/app/pages/user/profile.vue'],
      ['pages/index', '/app/pages/index.vue'],
      ['pages/user/index', '/app/pages/user/index.vue'],
      ['pages/order/list', '/app/pages/order/list.vue'],
      ['pages/builtin-components-demo', '/app/pages/builtin-components-demo.vue'],
      ['subpackages/mine/index', '/app/subpackages/mine/index.vue'],
      ['subpackages/order/detail', '/app/subpackages/order/detail.vue'],
    ]
    for (const [routePath, file] of cases) {
      expect(routeNameFromPath(routePath), `routeNameFromPath(${routePath})`).toBe(deriveNameFromFile('/app', file))
    }
  })

  it('buildRouteTable：多源码去重 + 排序 + API 集合', () => {
    const table = buildRouteTable([
      `wx.navigateTo({ url: '/pages/user/profile' })`,
      `wx.switchTab({ url: '/pages/index' })`,
      `wx.navigateTo({ url: '/pages/user/profile?tab=posts' })`, // 同 path 去重（query 不重复计）
      `wx.reLaunch({ url: '/pages/order/list' })`,
    ])
    expect(table.length).toBe(3)
    // 按 path 排序
    expect(table.map((t) => t.path)).toEqual(['pages/index', 'pages/order/list', 'pages/user/profile'])
    const profile = table.find((t) => t.path === 'pages/user/profile')
    expect(profile?.name).toBe('user-profile')
    expect(profile?.apis).toEqual(['navigateTo']) // 同 path 合并 API
    const index = table.find((t) => t.path === 'pages/index')
    expect(index?.apis).toEqual(['switchTab'])
  })
})