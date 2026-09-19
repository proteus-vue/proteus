// tests/shared-singleton-cross-copy.test.ts
// @vitest-environment jsdom
// ★跨包副本单例共享（2026-09-19 修外部实战报告里**最严重的静默失败**）：
//   外部项目实测「URL 变了但视图永不更新，且**没有任何报错**」。根因：依赖树里出现**两份**
//   `@proteus-vue/shared`（npm 嵌套去重常见：顶层一份 + 某个依赖再带一份）→ 模块被求值两次
//   → **两个 adapter 实例** → 一方 `onPageLoad` 注册 listener、另一方 `navigateTo` emit
//   → 事件永不送达（视图不更新，无告警）。
//
//   修法：有状态单例经 `globalThis` 共享（同 runtime/probe.ts 的注册表做法）：
//     · shared：`__PROTEUS_ADAPTER__`
//     · app-config：`__PROTEUS_APP_CONFIG_STORE__`
//     · devtools-runtime：`__PROTEUS_TRACE_BUS__`
//
//   本文件验证**该机制本身**（两份副本必须落到同一实例）——
//   ★验证方式说明：真正 import 两份不同路径的副本在 vitest 下不便构造（模块解析限制），
//   故直接验证「机制」：① 全局键在实例创建后确实被写入且指向导出实例；
//   ② 第二个副本（模拟）读取同一键时**复用**而不新建——这正是跨副本共享的判据。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const SRC = (rel: string) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8')

describe('★跨副本单例：全局键机制（外部实战报告的静默失败根因）', () => {
  it('shared：adapter 经 globalThis 键复用（跨副本同实例）', async () => {
    const g = globalThis as Record<string, unknown>
    delete g.__PROTEUS_ADAPTER_WEB__
    delete g.__PROTEUS_ADAPTER_MP__
    const mod = (await import('../packages/shared/src/platform/index')) as { adapter: unknown }
    // ★键按平台判定分设（见源码注释：单一键会在「同上下文两种判定」时错误复用）
    const hit = g.__PROTEUS_ADAPTER_WEB__ ?? g.__PROTEUS_ADAPTER_MP__
    expect(hit, '★实例必须写入全局键（否则另一副本会各自新建 → 监听器/emit 分裂）').toBe(mod.adapter)
  })

  it('shared：源码确为「键存在即复用」语义（防被改回模块级 let）', () => {
    const src = SRC('packages/shared/src/platform/index.ts')
    expect(src, '应有全局键常量（分平台两份）').toMatch(/__PROTEUS_ADAPTER_WEB__/)
    expect(src).toMatch(/__PROTEUS_ADAPTER_MP__/)
    expect(src, '应「先读全局键、有则复用」').toMatch(/const existing = g\[key\][\s\S]*if \(existing\) return existing/)
    // ★回归防护：不得退回模块级单例（那是 bug 形态）
    expect(src, '★不得退回 `let singleton: PlatformAdapter | null` 模块私有单例').not.toMatch(/let\s+\w*adapter\w*\s*:\s*PlatformAdapter\s*\|\s*null/)
  })

  it('app-config：store 经 globalThis 键复用（configRef + listeners 跨副本共享）', () => {
    const src = SRC('packages/app-config/src/store.ts')
    expect(src).toMatch(/__PROTEUS_APP_CONFIG_STORE__/)
    // ★关键：listeners 也必须在共享槽内（只共享 configRef 不够——订阅者仍会分裂）
    expect(src, '★listeners 必须与 configRef 同处共享槽（否则 setConfig 通知不到另一副本的订阅者）').toMatch(
      /AppConfigStore[\s\S]*listeners: Array<\(config: AppConfig\) => void>/,
    )
  })

  it('devtools-runtime：traceBus 经 globalThis 键复用（事件缓冲 + 订阅者不分裂）', () => {
    const src = SRC('packages/devtools-runtime/src/index.ts')
    expect(src).toMatch(/__PROTEUS_TRACE_BUS__/)
    expect(src, '★不得退回模块级 singletonBus').not.toMatch(/let singletonBus/)
  })
})
