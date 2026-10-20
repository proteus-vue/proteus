// website/scripts/lib/error-codes.mjs
// ★★★#1122：**能力页错误码提取**（从 `gen-content.mjs` 抽出——该文件 2366 行超棘轮）。
//
// 【它做什么】从源码文本里抽 `CapError('code', 'message')` 形态的错误码，供能力页的
//   「错误码」表渲染（SSOT = 源码里真实抛出的 code，不是人手维护的清单）。
//
// 【★#1122 放宽了三条规则（原规则导致官网静默漏码）】
//   ① 接收者可以是 `ctx.CapError` / `new CapError`（原只认裸 `CapError(`）；
//   ② code 可出现在**三元/变量**里（`isTimeout ? 'fetch.timeout' : 'fetch.failed'`）；
//   ③ `xxx.code = 'fetch.aborted'` 这类**属性赋值**形态也收。
//
// 【★放宽时的两个连带伤害（都是实测踩到的，注释留证）】
//   · 首版把码字符集写成 `[\w.]+` ⇒ **连字符**（`phone-call.unsupported`）整条漏掉
//     ⇒ **52 个能力页的错误码表整体消失（净删 326 行）**。现为 `[\w-]*\.[\w.-]+`。
//   · 说明文字若取"参数里第一个字符串"，会抓到**另一个分支的码**当说明
//     （实测：`fetch.timeout` 的说明被写成 `fetch.aborted`）⇒ 现只取**码字面量之后**的。

/** 已知码的语义说明（三元/变量形态取不到字面量说明时的兜底）。 */
export const KNOWN_CODE_DOCS = {
  'fetch.aborted': '请求已取消（signal.abort()）',
  'fetch.timeout': '请求超时（未在 timeout 内完成）',
  'fetch.failed': '请求失败（网络/解析/其他）',
  'fetch.unsupported': '该端不支持此能力',
  'fetch.tooLarge': '响应体/落盘超过上限',
}

/**
 * 从实现体提取错误码。
 * @param {string} body 源码文本（可多文件拼接）
 * @returns {{code:string, message:string}[]} 去重后的错误码
 */
export function extractErrorCodes(body) {
  const out = []
  if (typeof body !== 'string') return out

  for (const m of body.matchAll(/(?:\w+\.)?CapError\(([^)]*)\)/g)) {
    const args = m[1]
    const cms = [...args.matchAll(/'([a-zA-Z][\w-]*\.[\w.-]+)'/g)].map((x) => x[1])
    for (const code of cms) {
      if (out.some((e) => e.code === code)) continue
      const after = args.slice(args.indexOf(`'${code}'`) + code.length + 2)
      const msgM = after.match(/^\s*,\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)/)
      const msg = msgM ? (msgM[1] ?? msgM[2] ?? msgM[3] ?? '') : ''
      out.push({ code, message: msg || KNOWN_CODE_DOCS[code] || '' })
    }
  }

  // 属性赋值形态：`code = 'fetch.aborted'` / `err.code = 'fetch.timeout'`
  for (const m of body.matchAll(/\.code\s*=\s*'([a-zA-Z][\w-]*\.[\w.-]+)'/g)) {
    const code = m[1]
    if (!out.some((e) => e.code === code)) out.push({ code, message: KNOWN_CODE_DOCS[code] || '' })
  }
  return out
}
