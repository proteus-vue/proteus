// tests/capability-no-empty-subscription.test.ts
// ★★★决策 #1085（2026-10-19）：**禁止空订阅装成可用**——Web 桥不得提供"只有 `() => () => {}`"的能力。
//
// 【为什么（承接 #1084 的审计）】用户「继续推进」后的本轮工作。上一轮把这类能力登记进了文档边界，
//   但**代码没改**：`getBeacon: () => ({ onServiceChange: () => () => {}, ... })` 这种实现会让
//   Hook 层拿到一个"成功"的句柄（`ok:true`），业务订阅后**永远收不到回调**——却以为接好了。
//   这与"伪造 false"是同族缺陷：**看起来可用、实际不工作**。
//
// 【判据（两类）】
//   ① **静态扫描**：`webBridge` 里不得出现"整个桥对象只含空订阅"的能力
//      （允许"部分方法为空"——那类 API 的主体功能本就返回 unsupported，空订阅只是兜底形状）；
//   ② **行为验证**：删掉实现后，四个 Hook 必须走既有 `*.unsupported` 分支（显式 Err，不是假句柄）。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BRIDGES = path.join(ROOT, 'packages/api/src/capability-bridges.ts')

/**
 * 从源码里找出"整个桥对象只含空订阅方法"的能力。
 *
 * ★为什么用文本扫描而不是运行时：这些对象在 `webBridge(g)` 里构建，运行时探测需要构造完整
 *   web 全局环境；而"某能力的所有方法都是空订阅"在源码上是**确定的形状**。
 */
function findEmptyOnlyApis(src: string): Array<{ name: string; members: string[] }> {
  const hits: Array<{ name: string; members: string[] }> = []
  // 匹配 `getXxx: () => ({ ... })` / `getXxx: () => { return { ... } }` 的对象体
  const re = /(\w+):\s*\(\)\s*=>\s*\(\{([\s\S]*?)\}\),/g
  for (const m of src.matchAll(re)) {
    const [, name, body] = m as unknown as [string, string, string]
    // 取对象体里的成员：`key: value`
    const members = [...body.matchAll(/(\w+):\s*([^,\n]+(?:=>\s*\(\)\s*=>\s*\{\})?)/g)]
      .map((x) => ({ key: x[1], value: x[2].trim() }))
    if (members.length === 0) continue
    // 全部成员都是空订阅 / 空函数 ⇒ 纯空壳
    const allEmpty = members.every((x) => /^\(\)\s*=>\s*\(\)\s*=>\s*\{\}$/.test(x.value) || /^\(\)\s*=>\s*\{\}$/.test(x.value))
    if (allEmpty) hits.push({ name, members: members.map((x) => x.key) })
  }
  return hits
}

describe('★#1085 ① 静态：web 桥不得提供"只有空订阅"的能力', () => {
  it('没有"整个桥对象只含空订阅"的 API（删掉或实现真订阅，二选一）', () => {
    const full = fs.readFileSync(BRIDGES, 'utf8')
    // ★只扫 webBridge 段（wxBridge 的订阅是真实现）
    const hits = findEmptyOnlyApis(full.slice(full.indexOf('export function webBridge(')))
    expect(
      hits,
      '这些能力在 web 桥里只有空订阅 ⇒ Hook 返回假句柄、业务订阅后永远收不到回调。'
      + '要么删掉实现（走 unsupported），要么实现真订阅：\n'
      + hits.map((h) => `  · ${h.name}（${h.members.join('/')}）`).join('\n'),
    ).toEqual([])
  })

  it('用户点名的四个能力已从 web 桥移除（beacon / local-service / translation / poster）', () => {
    const full = fs.readFileSync(BRIDGES, 'utf8')
    const start = full.indexOf('export function webBridge(')
    expect(start, 'webBridge 未找到（本判据的前提）').toBeGreaterThan(-1)
    const src = full.slice(start)   // ★只扫 web 桥——wxBridge 里的同名方法是真实现
    for (const name of ['getBeacon', 'getLocalService', 'getTranslation', 'getPoster']) {
      // 允许出现在注释里（说明为什么移除），不允许出现实现形态
      const impl = new RegExp(`^\\s*${name}:\\s*\\(\\)\\s*=>`, 'm')
      expect(impl.test(src), `${name} 仍有实现（应已移除，走 unsupported）`).toBe(false)
    }
  })
})

describe('★#1085 ② 行为：四个 Hook 在无桥方法时给出显式 unsupported', () => {
  // ★用 createCapabilityHooks 传一个不含这四个方法的空桥，验证既有降级分支真的生效
  it('useBeacon / useLocalService / useTranslation / usePoster 都 reject 成 *.unsupported', async () => {
    const { createCapabilityHooks } = await import('../packages/api/src/capability')
    // 最小桥：只提供 useStorage 等必需项——这四个能力缺桥方法
    const hooks = createCapabilityHooks({} as never)
    const cases: Array<[string, () => unknown, string]> = [
      ['useBeacon', () => hooks.useBeacon(), 'beacon.unsupported'],
      ['useLocalService', () => hooks.useLocalService(), 'local-service.unsupported'],
      ['useTranslation', () => hooks.useTranslation(), 'translation.unsupported'],
      ['usePoster', () => hooks.usePoster(), 'poster.unsupported'],
    ]
    for (const [name, run, code] of cases) {
      const r = (await run()) as { ok: boolean; error?: { code?: string } }
      expect(r.ok, `${name} 应失败（桥未提供）`).toBe(false)
      expect(r.error?.code, `${name} 的错误码应为 ${code}`).toBe(code)
    }
  })
})
