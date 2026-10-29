// tests/capability-app-document.test.ts —— ★★★#1384 C84 `openDocument`（App 桥）判据
//
// 【判据要点（不是"能调用"就算过）】
//   ① **路径纪律**逐条验（沙箱相对路径放行 / 绝对路径、`..`、反斜杠、控制字符必须拒）——
//      这是本能力的安全边界：预览会把文件字节交给**另一个 App**；
//   ② **扩展名白名单**逐条验（8 个支持项放行 / 其余必须拒，且**不降级成 octet-stream**）；
//   ③ MIME 映射与标题推导正确（三端宿主用的是同一份映射，改一处要改四处）；
//   ④ 真的走到宿主 `document.open`，且传的是**归一化后**的载荷；
//   ⑤ 非法输入**在 JS 层就被拦**，不出到宿主（否则宿主成为唯一防线）；
//   ⑥ 宿主拒绝 ⇒ 如实报错（不静默成功）；宿主"已入队"（鸿蒙形态）也算受理；
//   ⑦ 宿主缺 `document.open` ⇒ 装配层**不提供**该方法（`useOpenDocument` 才能如实 unsupported）；
//   ⑧ ★不得依赖 URL 构造器（App 精简引擎没有它 —— #1336 真机剖出的缺陷，同族复发防御）。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const calls: Array<{ method: string; args: unknown }> = []
let hostResult: { ok: true; data: unknown } | { ok: false; reason: string; missing: boolean } = { ok: true, data: {} }

vi.mock('../packages/api/src/capability-invoke', () => ({
  invokeHost: (method: string, args?: unknown) => {
    calls.push({ method, args })
    return hostResult
  },
}))

describe('★★★#1384 App 能力 C84 · openDocument', () => {
  beforeEach(() => {
    calls.length = 0
    hostResult = { ok: true, data: { dispatched: true } }
  })

  it('① 沙箱相对路径全部放行（含子目录 / 中文名 / 大写扩展名）', async () => {
    const { assertDocumentRequest } = await import('../packages/api/src/capability-app-document')
    expect(assertDocumentRequest('a.pdf')).toEqual({
      path: 'a.pdf',
      mimeType: 'application/pdf',
      title: 'a',
    })
    expect(assertDocumentRequest('docs/2026/报告.docx')).toEqual({
      path: 'docs/2026/报告.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      title: '报告',
    })
    // ★扩展名大小写不敏感（真机上用户给的文件名常是大写）
    expect(assertDocumentRequest('X.PDF').mimeType).toBe('application/pdf')
    // ★首尾空白被 trim（与 share 的 title 同口径；路径本身不该带空白）
    expect(assertDocumentRequest('  a.txt  ').path).toBe('a.txt')
    // ★标题保留点号前的完整名字（含多个点）
    expect(assertDocumentRequest('a.b.c.pdf').title).toBe('a.b.c')
  })

  it('★★② 路径越界必须全部拒绝（预览会把字节交给别的 App）', async () => {
    const { assertDocumentRequest } = await import('../packages/api/src/capability-app-document')
    const bad: Array<[string, RegExp]> = [
      ['/etc/passwd.pdf', /只接受沙箱相对路径/],       // 绝对路径
      ['../secret.pdf', /不得含 "\.\."/],              // 目录穿越
      ['a/../../b.pdf', /不得含 "\.\."/],              // 中间穿越
      ['a\\b.pdf', /非法字符/],                        // 反斜杠（三端语义不同 ⇒ 拒）
      ['a\u0000b.pdf', /非法字符/],                    // 控制字符
      ['a\nb.pdf', /非法字符/],
    ]
    for (const [p, re] of bad) {
      expect(() => assertDocumentRequest(p), `越界路径被放行：${JSON.stringify(p)}`).toThrow(re)
    }
  })

  it('★★③ 空值 / 类型错误 / 超长必须拒绝', async () => {
    const { assertDocumentRequest, DOC_OPEN_MAX_PATH_LEN } = await import('../packages/api/src/capability-app-document')
    for (const v of ['', '   ', null, undefined, 42, {}, []]) {
      expect(() => assertDocumentRequest(v), `空/非法参数被放行：${JSON.stringify(v)}`).toThrow(/document\.open\.invalid/)
    }
    expect(() => assertDocumentRequest('x'.repeat(DOC_OPEN_MAX_PATH_LEN) + '.pdf')).toThrow(/过长/)
    expect(assertDocumentRequest('x'.repeat(DOC_OPEN_MAX_PATH_LEN - 4) + '.pdf').path.length).toBe(DOC_OPEN_MAX_PATH_LEN)
  })

  it('★★④ 扩展名白名单：8 项放行，其余必须拒（不降级成 octet-stream）', async () => {
    const { assertDocumentRequest, DOC_OPEN_EXTENSIONS } = await import('../packages/api/src/capability-app-document')
    // 白名单与 wx.openDocument 官方支持集对齐（前 7 项）+ txt（三端原生预览器都认）
    expect([...DOC_OPEN_EXTENSIONS].sort()).toEqual(
      ['doc', 'docx', 'pdf', 'ppt', 'pptx', 'txt', 'xls', 'xlsx'],
    )
    for (const ext of DOC_OPEN_EXTENSIONS) {
      expect(() => assertDocumentRequest(`f.${ext}`), `.${ext} 在白名单却被拒`).not.toThrow()
    }
    /* ★★关键：不在白名单的必须**报错**，不能"给个 application/octet-stream 让系统自己猜"——
       那样在多数设备上没有接收方，表现是"点了没反应"（最难归因的失败形态）。
       也不能按内容嗅探（本层读不到文件）。 */
    const bad = ['exe', 'zip', 'html', 'svg', 'js', 'apk', 'png', 'mp4', 'bin', 'pdf.exe']
    for (const ext of bad) {
      expect(() => assertDocumentRequest(`f.${ext}`), `.${ext} 该被拒却放行`).toThrow(/unsupported-format/)
    }
    // 没有扩展名 / 只有点
    expect(() => assertDocumentRequest('README')).toThrow(/没有扩展名/)
    expect(() => assertDocumentRequest('a.')).toThrow(/没有扩展名/)
    expect(() => assertDocumentRequest('.pdf')).toThrow(/没有扩展名/)
    // 路径末尾是目录
    expect(() => assertDocumentRequest('docs/')).toThrow(/缺少文件名/)
  })

  it('⑤ 真的走到宿主 document.open，且传的是归一化后的载荷', async () => {
    const { createAppDocument } = await import('../packages/api/src/capability-app-document')
    const b = createAppDocument()
    expect(typeof b.openDocument, '桥必须提供 openDocument').toBe('function')
    await b.openDocument!('docs/报告.pdf')
    expect(calls.map((c) => c.method)).toEqual(['document.open'])
    expect(calls[0]!.args).toEqual({
      path: 'docs/报告.pdf',
      mimeType: 'application/pdf',
      title: '报告',
    })
  })

  it('⑤b 非法输入**在 JS 层就被拦**，不出到宿主', async () => {
    const { createAppDocument } = await import('../packages/api/src/capability-app-document')
    const b = createAppDocument()
    await expect(b.openDocument!('/etc/passwd.pdf')).rejects.toThrow(/document\.open\.invalid/)
    await expect(b.openDocument!('../x.pdf')).rejects.toThrow(/document\.open\.invalid/)
    await expect(b.openDocument!('x.exe')).rejects.toThrow(/unsupported-format/)
    expect(calls.length, '★非法输入不该到达宿主（否则宿主成为唯一防线）').toBe(0)
  })

  it('⑥ 宿主拒绝 ⇒ 如实报错；missing 分档写进 reason', async () => {
    const { createAppDocument } = await import('../packages/api/src/capability-app-document')
    const b = createAppDocument()
    hostResult = { ok: false, reason: '沙箱内没有该文件', missing: false }
    await expect(b.openDocument!('a.pdf')).rejects.toThrow(/document\.open\.failed/)
    hostResult = { ok: false, reason: '未实现的原生方法', missing: true }
    await expect(b.openDocument!('a.pdf')).rejects.toThrow(/document\.open\.unsupported/)
  })

  it('★★⑦ 宿主"已入队"回执（鸿蒙形态）也算受理，且不报成"已打开"', async () => {
    const { createAppDocument } = await import('../packages/api/src/capability-app-document')
    const b = createAppDocument()
    // 鸿蒙走动作队列 ⇒ 回执是 {accepted:true, queued:N}
    hostResult = { ok: true, data: { accepted: true, queued: 1 } }
    await expect(b.openDocument!('a.pdf')).resolves.toBeUndefined()
  })

  it('⑧ 可用性探测：宿主缺 document.open ⇒ 不提供该方法', async () => {
    const { appOpenDocumentAvailable } = await import('../packages/api/src/capability-app-document')
    hostResult = { ok: false, reason: '未实现', missing: true }
    expect(appOpenDocumentAvailable(), '★宿主缺方法时必须报不可用（否则 useOpenDocument 假可用）').toBe(false)
    hostResult = { ok: true, data: {} }
    expect(appOpenDocumentAvailable()).toBe(true)
    // 宿主存在但返错（非 missing）⇒ 仍算可用（错误由调用时报出，不在装配期吞掉）
    hostResult = { ok: false, reason: '运行时错误', missing: false }
    expect(appOpenDocumentAvailable()).toBe(true)
  })

  it('★★★⑨ 不得依赖 URL 构造器（App 精简引擎没有它 —— #1336 真机剖出，同族复发防御）', async () => {
    /* ★为什么这条要复制过来：`#1336` 的真实事故是"Node 单测 8/8 全绿、iOS 真机直接抛"，
       根因 = 实现用了 `new URL()` 而 QuickJS/JSC 精简版没有该构造器。
       本能力的实现也做路径/扩展名解析 —— 最容易被写成 `new URL(p).pathname`。
       ⇒ 把全局 URL 换成"一调用就抛"，模拟宿主引擎：校验逻辑必须照样工作。 */
    const g = globalThis as unknown as { URL?: unknown }
    const saved = g.URL
    g.URL = function PoisonedURL(): never {
      throw new Error('App 精简引擎没有 URL 构造器')
    }
    try {
      const { assertDocumentRequest } = await import('../packages/api/src/capability-app-document')
      expect(assertDocumentRequest('a/b.pdf')).toEqual({ path: 'a/b.pdf', mimeType: 'application/pdf', title: 'b' })
      expect(assertDocumentRequest('a.XLSX').mimeType).toBe(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      )
      expect(() => assertDocumentRequest('../x.pdf')).toThrow(/不得含 "\.\."/)
    } finally {
      g.URL = saved
    }
  })

  it('★★⑩ 三端宿主用的是同一份扩展名↔MIME 映射（漂移会让"JS 放行、宿主拒绝"）', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const root = path.resolve(__dirname, '..')
    const js = (await import('../packages/api/src/capability-app-document')).DOC_OPEN_MIME as Record<string, string>
    // 从三端宿主的源码里抽 `ext → mime` 字面量，逐项与 JS 层比对。
    // ★不执行宿主代码（跨语言），只做**文本契约**核对——这是本仓对"三端同一集"的既有做法。
    const read = (p: string): string => fs.readFileSync(path.join(root, p), 'utf8')

    const javaSrc = read('hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/DocumentCapability.java')
    for (const [ext, mime] of Object.entries(js)) {
      const re = new RegExp(`case\\s+"${ext}"\\s*:\\s*return\\s+"${mime.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`)
      expect(re.test(javaSrc), `Android 宿主的 ${ext} 映射与 JS 层不一致（应为 ${mime}）`).toBe(true)
    }

    const swiftSrc = read('hosts/ios/ProteusHost/runtime/document-preview-capability.swift')
    for (const [ext, mime] of Object.entries(js)) {
      const re = new RegExp(`case\\s+"${ext}"\\s*:\\s*return\\s+"${mime.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`)
      expect(re.test(swiftSrc), `iOS 宿主的 ${ext} 映射与 JS 层不一致（应为 ${mime}）`).toBe(true)
    }

    const cppSrc = read('hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_document.h')
    for (const [ext, mime] of Object.entries(js)) {
      const re = new RegExp(`ext\\s*==\\s*"${ext}"\\s*\\)\\s*return\\s*"${mime.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`)
      expect(re.test(cppSrc), `鸿蒙宿主的 ${ext} 映射与 JS 层不一致（应为 ${mime}）`).toBe(true)
    }

    // ★反向：宿主不得有 JS 层没有的扩展名（多一项 = 页面说"不支持"但宿主放行）
    const countJava = (javaSrc.match(/case\s+"[a-z]+"\s*:\s*return\s+"application|case\s+"[a-z]+"\s*:\s*return\s+"text/g) ?? []).length
    expect(countJava, `Android 宿主映射项数（${countJava}）应等于 JS 层（${Object.keys(js).length}）`).toBe(
      Object.keys(js).length,
    )
  })
})
