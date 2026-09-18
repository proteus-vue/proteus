// tests/router-config.test.ts
// ★#492 项目级路由管理：router 段统一收口（routesOutput/subPackages/customRoute 从顶层收编）
//   解析器语义：router.* 显式优先 / 顶层遗留别名兼容 / 双处声明登记 duplicates / 缺省值兜底
//   + validateConfig 二选一存在性 + router 段嵌套校验 + v2→v3 迁移
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveRouterConfig, hasLegacyRouterAliases, DEFAULT_ROUTES_OUTPUT, migrateConfig, CONFIG_VERSION } from '@proteus-vue/types'
import { validateConfig } from '../packages/cli/src/config-validate'
import { runGenRoutes } from '@proteus-vue/plugin-vite'

describe('#492 resolveRouterConfig（生效路由配置解析）', () => {
  it('统一形态：router.* 全量声明 → 生效值取 router 段，无 duplicates', () => {
    const { router, duplicates } = resolveRouterConfig({
      router: {
        routesOutput: 'router/auto-routes.ts',
        subPackages: [{ root: 'subpackages/order', name: 'order' }],
        customRoute: { registerPresets: false, builders: { halfScreen: 'a.ts' } },
        meta: { index: { title: '首页', isTab: true } },
        tabBar: { color: '#fff', selectedColor: '#000', list: [{ name: 'index', text: '首页' }] },
      },
    })
    expect(duplicates).toEqual([])
    expect(router.routesOutput).toBe('router/auto-routes.ts')
    expect(router.subPackages).toEqual([{ root: 'subpackages/order', name: 'order' }])
    expect(router.customRoute).toEqual({ registerPresets: false, builders: { halfScreen: 'a.ts' } })
    expect(router.meta).toEqual({ index: { title: '首页', isTab: true } })
    expect(router.tabBar?.selectedColor).toBe('#000')
  })

  it('遗留别名：顶层声明 → 生效值取顶层（兼容不改的存量工程）', () => {
    const { router, duplicates } = resolveRouterConfig({
      routesOutput: 'src/router/auto-routes.ts',
      subPackages: [{ root: 'subpackages/a' }],
      customRoute: { registerPresets: true, builders: { slideUp: 'b.ts' } },
    })
    expect(duplicates).toEqual([])
    expect(router.routesOutput).toBe('src/router/auto-routes.ts')
    expect(router.subPackages).toEqual([{ root: 'subpackages/a' }])
    expect(router.customRoute.builders).toEqual({ slideUp: 'b.ts' })
  })

  it('双处声明 → router.* 优先 + duplicates 登记（构建期提示收敛）', () => {
    const { router, duplicates } = resolveRouterConfig({
      routesOutput: 'legacy.ts',
      subPackages: [{ root: 'legacy-a' }],
      customRoute: { registerPresets: true, builders: {} },
      router: { routesOutput: 'unified.ts', subPackages: [{ root: 'unified-a' }] },
    })
    expect(duplicates).toEqual(['routesOutput', 'subPackages'])
    expect(router.routesOutput).toBe('unified.ts')
    expect(router.subPackages).toEqual([{ root: 'unified-a' }])
    expect(router.customRoute.builders).toEqual({}) // customRoute 顶层生效（router 段未声明）
  })

  it('缺省值：零声明 → routesOutput 默认 + 空 subPackages + customRoute 缺省 registerPresets: true', () => {
    const { router, duplicates } = resolveRouterConfig({})
    expect(duplicates).toEqual([])
    expect(router.routesOutput).toBe(DEFAULT_ROUTES_OUTPUT)
    expect(router.subPackages).toEqual([])
    expect(router.customRoute).toEqual({ registerPresets: true, builders: {} })
  })

  it('customRoute 部分声明：仅 builders / 仅 registerPresets → 缺省补齐', () => {
    const onlyBuilders = resolveRouterConfig({ router: { customRoute: { builders: { halfScreen: 'h.ts' } } } }).router.customRoute
    expect(onlyBuilders).toEqual({ registerPresets: true, builders: { halfScreen: 'h.ts' } })
    const onlyFlag = resolveRouterConfig({ router: { customRoute: { registerPresets: false } } }).router.customRoute
    expect(onlyFlag).toEqual({ registerPresets: false, builders: {} })
  })

  it('hasLegacyRouterAliases：顶层别名登记（config:check 迁移提示用）', () => {
    expect(hasLegacyRouterAliases({ routesOutput: 'a', customRoute: {} })).toEqual(['routesOutput', 'customRoute'])
    expect(hasLegacyRouterAliases({ router: { routesOutput: 'a' } })).toEqual([])
  })
})

describe('#492 validateConfig（路由字段二选一存在 + router 段嵌套校验）', () => {
  const base = { platform: 'mp-weixin', skyline: true, appid: 'wx1', pagesDir: 'src/pages', setDataBridge: {}, style: {} }

  it('统一形态（router.* 声明）→ 校验通过', () => {
    const r = validateConfig({
      ...base,
      router: { routesOutput: 'src/router/auto-routes.ts', customRoute: { registerPresets: true, builders: {} } },
    })
    expect(r.ok).toBe(true)
  })

  it('两处都不声明 → CONFIG_MISSING_REQUIRED 指向 router.*', () => {
    const r = validateConfig(base)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      const paths = r.errors.filter((e) => e.code === 'CONFIG_MISSING_REQUIRED').map((e) => e.path)
      expect(paths).toContain('router.routesOutput')
      expect(paths).toContain('router.customRoute')
    }
  })

  it('router 段未知子键 → CONFIG_UNKNOWN_FIELD', () => {
    const r = validateConfig({ ...base, router: { routesOutput: 'a', routesOutPut: 'typo' } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some((e) => e.code === 'CONFIG_UNKNOWN_FIELD' && e.path === 'router.routesOutPut')).toBe(true)
  })

  it('router.subPackages 非法（root 缺失）→ CONFIG_INVALID_TYPE 指向 router.subPackages', () => {
    const r = validateConfig({ ...base, router: { routesOutput: 'a', customRoute: {}, subPackages: [{ name: 'x' }] } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some((e) => e.path === 'router.subPackages[0].root')).toBe(true)
  })

  it('顶层遗留写法（customRoute）→ 类型错误仍报顶层路径', () => {
    const r = validateConfig({ ...base, routesOutput: 'a', customRoute: { registerPresets: 'yes' } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some((e) => e.path === 'customRoute.registerPresets')).toBe(true)
  })
})

describe('#492 gen-routes 消费统一 router 段（tabBar 显式声明接线——此前 color/selectedColor/list 被忽略）', () => {
  it('router.routesOutput/subPackages 生效 + router.tabBar.list 顺序与文案/color 进 app.json', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-rc-'))
    const pagesDir = path.join(root, 'pages')
    fs.mkdirSync(pagesDir, { recursive: true })
    fs.writeFileSync(path.join(pagesDir, 'index.vue'), '<template><view /></template>\n')
    fs.writeFileSync(path.join(pagesDir, 'mine.vue'), '<template><view /></template>\n')
    fs.writeFileSync(path.join(pagesDir, 'about.vue'), '<template><view /></template>\n')
    runGenRoutes({
      config: {
        platform: 'mp-weixin',
        skyline: false,
        appid: 'wx1',
        pagesDir: 'pages',
        router: {
          routesOutput: 'router/auto-routes.ts',
          tabBar: {
            color: '#111111',
            selectedColor: '#222222',
            list: [
              { name: 'mine', text: '我的页' },
              { name: 'index', text: '首页' },
            ],
          },
          meta: { index: { title: '首页', isTab: true }, mine: { title: '我的', isTab: true } },
        },
      } as never,
      root,
    })
    const appJson = JSON.parse(fs.readFileSync(path.join(root, 'dist', 'mp-weixin', 'app.json'), 'utf-8'))
    // list 声明顺序生效（mine 在前）；文案取 tabBar.list.text；color/selectedColor 接线
    expect(appJson.tabBar.color).toBe('#111111')
    expect(appJson.tabBar.selectedColor).toBe('#222222')
    expect(appJson.tabBar.list.map((i: { text: string }) => i.text)).toEqual(['我的页', '首页'])
    // routesOutput 来自 router 段
    expect(fs.existsSync(path.join(root, 'router', 'auto-routes.ts'))).toBe(true)
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('未声明 router.tabBar → 沿用 meta.isTab 推导（兼容语义不变）', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-rc2-'))
    const pagesDir = path.join(root, 'pages')
    fs.mkdirSync(pagesDir, { recursive: true })
    fs.writeFileSync(path.join(pagesDir, 'index.vue'), '<template><view /></template>\n')
    fs.writeFileSync(path.join(pagesDir, 'mine.vue'), '<template><view /></template>\n')
    runGenRoutes({
      config: {
        platform: 'mp-weixin',
        skyline: false,
        appid: 'wx1',
        pagesDir: 'pages',
        router: { routesOutput: 'router/auto-routes.ts', meta: { index: { title: '首页', isTab: true }, mine: { title: '我的', isTab: true } } },
      } as never,
      root,
    })
    const appJson = JSON.parse(fs.readFileSync(path.join(root, 'dist', 'mp-weixin', 'app.json'), 'utf-8'))
    expect(appJson.tabBar.list).toHaveLength(2) // isTab 推导照常
    expect(appJson.tabBar.color).toBeUndefined() // 未声明 color → 不注入
    fs.rmSync(root, { recursive: true, force: true })
  })
})

describe('#492 配置迁移 v2→v3（顶层收编 router 段）', () => {
  it('顶层三字段迁移进 router 段；router.* 已声明键不被覆盖', () => {
    const { version, config } = migrateConfig(
      {
        routesOutput: 'legacy.ts',
        subPackages: [{ root: 'sub-a' }],
        customRoute: { registerPresets: true, builders: {} },
        router: { routesOutput: 'unified.ts', meta: { index: { title: '首页' } } },
      },
      2,
    )
    expect(version).toBe(CONFIG_VERSION)
    expect(version).toBe(3)
    expect((config as Record<string, unknown>).routesOutput).toBeUndefined()
    expect((config as Record<string, unknown>).customRoute).toBeUndefined()
    const router = (config as { router: Record<string, unknown> }).router
    expect(router.routesOutput).toBe('unified.ts') // router.* 已声明 → 保留
    expect(router.subPackages).toEqual([{ root: 'sub-a' }]) // 顶层迁入
    expect(router.customRoute).toEqual({ registerPresets: true, builders: {} }) // 顶层迁入
    expect(router.meta).toEqual({ index: { title: '首页' } })
  })

  it('无顶层路由字段的配置迁移 → 原样（不产生空 router 段）', () => {
    const { config } = migrateConfig({ platform: 'mp-weixin' }, 2)
    expect((config as Record<string, unknown>).router).toBeUndefined()
  })
})
