// tests/capability-app-share.test.ts —— ★★★#1336 C22 `share`（App 桥）判据
//
// 【判据要点（不是"能调用"就算过）】
//   ① 输入白名单**逐条**验（合法形态放行 / 注入形态必须拒）——这是本能力的安全边界；
//   ② 真的走到宿主 `share`，且传的是**归一化后**的载荷；
//   ③ 非法输入**在 JS 层就被拦**，不出到宿主（否则宿主成为唯一防线）；
//   ④ 宿主拒绝 ⇒ 如实报错（不静默成功）；
//   ⑤ 宿主"已入队"回执（鸿蒙形态）也算受理，且不报成"已分享成功"；
//   ⑥ 宿主缺 `share` ⇒ 装配层**不提供**该方法（`useShare` 才能如实 unsupported）。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const calls: Array<{ method: string; args: unknown }> = []
let hostResult: { ok: true; data: unknown } | { ok: false; reason: string; missing: boolean } = { ok: true, data: {} }

vi.mock('../packages/api/src/capability-invoke', () => ({
  invokeHost: (method: string, args?: unknown) => {
    calls.push({ method, args })
    return hostResult
  },
}))

describe('★★★#1336 App 能力 C22 · share', () => {
  beforeEach(() => {
    calls.length = 0
    hostResult = { ok: true, data: { dispatched: true } }
  })

  it('① 合法形态全部放行（文本 / 链接 / 组合 / 仅标题）', async () => {
    const { assertShareOptions } = await import('../packages/api/src/capability-app-share')
    expect(assertShareOptions({ text: 'hello' })).toEqual({ text: 'hello' })
    expect(assertShareOptions({ url: 'https://example.com/a?b=1' })).toEqual({ url: 'https://example.com/a?b=1' })
    expect(assertShareOptions({ title: 'T', text: 'x', url: 'http://a.b' })).toEqual({ title: 'T', text: 'x', url: 'http://a.b' })
    expect(assertShareOptions({ title: '只有标题' })).toEqual({ title: '只有标题' })
    // ★标题会被 trim（空白标题等于没给）
    expect(assertShareOptions({ title: '  T  ', text: 'x' })).toEqual({ title: 'T', text: 'x' })
    // ★正文**不** trim（首尾空白可能是业务有意为之，比如代码片段）
    expect(assertShareOptions({ text: '  code  ' })).toEqual({ text: '  code  ' })
    // ★大写 scheme 也合法（URL 规范化由 new URL 处理，这里只判协议）
    expect(assertShareOptions({ url: 'HTTPS://example.com' })).toEqual({ url: 'HTTPS://example.com' })
  })

  it('★★② 危险 URL scheme 必须全部拒绝（分享会把链接递给别的 App）', async () => {
    const { assertShareOptions } = await import('../packages/api/src/capability-app-share')
    const bad = [
      'file:///etc/passwd',            // 本机路径泄漏
      'javascript:alert(1)',           // 可执行语义
      'data:text/html,<script>',       // 内联内容
      'content://com.other/secret',    // 跨应用私有 provider
      'ftp://example.com',             // 非 http(s)
      'tel:10086',                     // 其它能力域
      'myapp://deep/link',             // 自定义 scheme
      '/relative/path',                // 非绝对地址
      'example.com',                   // 无 scheme
    ]
    for (const u of bad) {
      expect(() => assertShareOptions({ url: u }), `危险 url 被放行：${u}`).toThrow(/share\.invalid/)
    }
  })

  it('★★③ 空内容 / 超长 / 类型错误必须拒绝', async () => {
    const { assertShareOptions, SHARE_MAX_TEXT_LEN, SHARE_MAX_TITLE_LEN, SHARE_MAX_URL_LEN } = await import(
      '../packages/api/src/capability-app-share'
    )
    // 三项全空 = 无意义调用（也防"空 Intent 拉起空面板"）
    for (const o of [{}, { title: '' }, { text: '' }, { url: '' }, { title: '  ', text: '' }, null, undefined, 'x', 42]) {
      expect(() => assertShareOptions(o), `空/非法参数被放行：${JSON.stringify(o)}`).toThrow(/share\.invalid/)
    }
    // 超长（★Binder TransactionTooLargeException 的前置拦截）
    expect(() => assertShareOptions({ text: 'x'.repeat(SHARE_MAX_TEXT_LEN + 1) })).toThrow(/text 过长/)
    expect(() => assertShareOptions({ title: 'x'.repeat(SHARE_MAX_TITLE_LEN + 1) })).toThrow(/title 过长/)
    expect(() => assertShareOptions({ url: 'https://a.b/' + 'x'.repeat(SHARE_MAX_URL_LEN) })).toThrow(/url 过长/)
    // 类型错误
    expect(() => assertShareOptions({ text: 123 })).toThrow(/text 必须是字符串/)
    expect(() => assertShareOptions({ title: {} })).toThrow(/title 必须是字符串/)
    expect(() => assertShareOptions({ url: [] })).toThrow(/url 必须是字符串/)
    // ★边界值本身合法（避免 off-by-one：上限是"允许"的）
    expect(() => assertShareOptions({ text: 'x'.repeat(SHARE_MAX_TEXT_LEN) })).not.toThrow()
  })

  it('④ 真的走到宿主 share，且传的是归一化后的载荷', async () => {
    const { createAppShare } = await import('../packages/api/src/capability-app-share')
    const b = createAppShare()
    expect(typeof b.share, '桥必须提供 share').toBe('function')
    await b.share!({ title: ' 标题 ', text: '正文', url: 'https://example.com' })
    expect(calls.map((c) => c.method)).toEqual(['share'])
    expect(calls[0]!.args).toEqual({ title: '标题', text: '正文', url: 'https://example.com' })
  })

  it('④b 非法输入**在 JS 层就被拦**，不出到宿主', async () => {
    const { createAppShare } = await import('../packages/api/src/capability-app-share')
    const b = createAppShare()
    await expect(b.share!({ url: 'file:///etc/passwd' })).rejects.toThrow(/share\.invalid/)
    await expect(b.share!({})).rejects.toThrow(/share\.invalid/)
    expect(calls.length, '★非法输入不该到达宿主（否则宿主成为唯一防线）').toBe(0)
  })

  it('⑤ 宿主拒绝 ⇒ 如实报错（不静默成功）', async () => {
    const { createAppShare } = await import('../packages/api/src/capability-app-share')
    const b = createAppShare()
    hostResult = { ok: false, reason: '无可用窗口', missing: false }
    await expect(b.share!({ text: 'x' })).rejects.toThrow(/share\.failed/)
  })

  it('★★⑥ 宿主"已入队"回执（鸿蒙形态）也算受理，且不报成已分享成功', async () => {
    const { createAppShare } = await import('../packages/api/src/capability-app-share')
    const b = createAppShare()
    // 鸿蒙走动作队列 ⇒ 回执是 {accepted:true, queued:N}
    hostResult = { ok: true, data: { accepted: true, queued: 1 } }
    await expect(b.share!({ text: 'x' })).resolves.toBeUndefined()
  })

  it('★★★⑧ 不得依赖 URL 构造器（App 精简引擎没有它 —— 这是真机剖出的缺陷）', async () => {
    /* ★为什么必须有这条：#1336 首跑时 Node 下 8/8 全绿，而 iOS 真机
       `useShare({url:'https://proteus.dev/'})` 返回 `share.invalid: url 不是合法绝对地址`。
       根因 = 实现用了 `new URL(u)`，而 **QuickJS/JSC 精简版没有 URL 构造器**
       （同族既有事实：无 TextDecoder #1071 / 无 TextEncoder #1095）。
       ⇒ 把全局 URL 换成"一调用就抛"，模拟宿主引擎：校验逻辑必须照样工作。
       ★这条断言让"用回 new URL"这个错误**在单测里就翻红**，不用等真机。 */
    const g = globalThis as unknown as { URL?: unknown }
    const saved = g.URL
    g.URL = function PoisonedURL(): never {
      throw new Error('App 精简引擎没有 URL 构造器')
    }
    try {
      const { assertShareOptions } = await import('../packages/api/src/capability-app-share')
      // 合法 URL 必须照样通过（不能因为没了 URL 构造器就判"不是合法地址"）
      expect(assertShareOptions({ url: 'https://proteus.dev/' })).toEqual({ url: 'https://proteus.dev/' })
      expect(assertShareOptions({ url: 'http://a.b/c?d=1' })).toEqual({ url: 'http://a.b/c?d=1' })
      // 危险 scheme 照样必须被拒
      expect(() => assertShareOptions({ url: 'file:///etc/passwd' })).toThrow(/share\.invalid/)
      expect(() => assertShareOptions({ url: 'javascript:alert(1)' })).toThrow(/share\.invalid/)
      // 缺 scheme / 缺主机名照样必须被拒
      expect(() => assertShareOptions({ url: 'example.com' })).toThrow(/缺少 scheme/)
      expect(() => assertShareOptions({ url: 'https:///nohost' })).toThrow(/缺少主机名/)
    } finally {
      g.URL = saved
    }
  })

  it('⑦ 可用性探测：宿主缺 share ⇒ 不提供该方法', async () => {
    const { appShareAvailable } = await import('../packages/api/src/capability-app-share')
    hostResult = { ok: false, reason: '未实现', missing: true }
    expect(appShareAvailable(), '★宿主缺方法时必须报不可用（否则 useShare 假可用）').toBe(false)
    hostResult = { ok: true, data: {} }
    expect(appShareAvailable()).toBe(true)
    // 宿主存在但返错（非 missing）⇒ 仍算可用（错误由调用时报出，不在装配期吞掉）
    hostResult = { ok: false, reason: '运行时错误', missing: false }
    expect(appShareAvailable()).toBe(true)
  })
})
