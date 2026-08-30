// tests/router-permissions.test.ts
// ★security M3 §3：createRouter permissions 检查器 —— meta.permissions 自动守卫（与 PermissionRegistry 直接对接）
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PermissionRegistry, permissionFor } from '../packages/security/src'

vi.mock('@proteus-vue/shared', () => ({
  adapter: {
    isMP: true,
    getCurrentPages: vi.fn(() => [{ route: 'pages/index' }]),
    navigateTo: vi.fn(async () => {}),
    redirectTo: vi.fn(async () => {}),
    reLaunch: vi.fn(async () => {}),
    switchTab: vi.fn(async () => {}),
    navigateBack: vi.fn(),
  },
}))

vi.mock('../packages/router/src/skyline', () => ({
  isSkyline: vi.fn(() => false),
  navigateWithCustomRoute: vi.fn(async () => {}),
}))

import { adapter } from '@proteus-vue/shared'
import { createRouter } from '../packages/router/src/index'
import type { RouteRecord } from '../packages/router/src/types'

const TRADE = permissionFor('trade', 'create')

const routes: RouteRecord[] = [
  { name: 'index', path: 'pages/index', file: 'index.vue' },
  { name: 'trade-create', path: 'pages/trade/create', file: 'trade/create.vue', meta: { title: '下单', permissions: [TRADE] } },
  { name: 'admin', path: 'pages/admin', file: 'admin.vue', meta: { permissions: [permissionFor('admin', 'view'), 'user:read'] } },
]

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createRouter permissions 守卫（security M3 §3）', () => {
  it('缺权限 → 导航被拦截（不调用 adapter）+ onPermissionFail 带权限名', async () => {
    const registry = new PermissionRegistry()
    const fails: string[] = []
    const router = createRouter(routes, { permissions: registry, onPermissionFail: (p) => fails.push(p) })
    await router.push({ name: 'trade-create' })
    expect(vi.mocked(adapter).navigateTo).not.toHaveBeenCalled()
    expect(fails).toEqual([TRADE])
  })

  it('授权后 → 放行（PermissionRegistry.grant 生效）', async () => {
    const registry = new PermissionRegistry()
    registry.grant([TRADE])
    const router = createRouter(routes, { permissions: registry })
    await router.push({ name: 'trade-create' })
    expect(vi.mocked(adapter).navigateTo).toHaveBeenCalled()
  })

  it('hasAll 多权限：缺任一 → 拦截', async () => {
    const registry = new PermissionRegistry()
    registry.grant([permissionFor('admin', 'view')])
    const router = createRouter(routes, { permissions: registry })
    await router.push({ name: 'admin' })
    expect(vi.mocked(adapter).navigateTo).not.toHaveBeenCalled()
  })

  it('无 permissions 检查器 → 放行（未配置不拦截，对齐 auth 检查器语义）', async () => {
    const router = createRouter(routes)
    await router.push({ name: 'trade-create' })
    expect(vi.mocked(adapter).navigateTo).toHaveBeenCalled()
  })

  it('无 meta.permissions 页面 → 不受影响', async () => {
    const registry = new PermissionRegistry()
    const router = createRouter(routes, { permissions: registry })
    await router.push({ name: 'index' })
    expect(vi.mocked(adapter).navigateTo).toHaveBeenCalled()
  })

  it('异步检查器（Promise<boolean>）同样生效', async () => {
    const router = createRouter(routes, {
      permissions: { hasAll: async () => false },
      onPermissionFail: vi.fn(),
    })
    await router.push({ name: 'trade-create' })
    expect(vi.mocked(adapter).navigateTo).not.toHaveBeenCalled()
  })
})
