// website/scripts/lib/type-refs.mjs
// ★★★#1124：**类型引用收集 + 悬空引用检查**（生成器共用的纯函数）。
//
// 【要解决的问题（用户点名）】
//   「文档里自定义签名没有单独说明，比如 `UploadSpec`、`AbortSignalLike`，参数表/属性表里用到了，
//     但没有详细说明，开发者会很懵」。
//
// 【为什么会漏】原 `collectRefTypes` 只从**方法签名**收集，而真实页面上有**四个**引用来源：
//   ① 参数类型（`config?: FetchConfig`）
//   ② 参数对象的属性类型（`config.upload: UploadSpec`）——★这层最容易漏
//   ③ 返回值类型（`Promise<FetchResult<T>>`）
//   ④ 页级属性/方法签名
//   前三个此前都没进收集 ⇒ 类型说明段缺失，而**没有任何门禁会发现**。
//
// 【本文件提供两个纯函数】
//   · `collectPageTypeRefs(...)`：把上述四个来源的名字都收进来（只收 ifaces 里真实存在的）
//   · `findUnexplainedTypes(markdown, ifaces)`：**悬空引用检查**——页面上出现了自定义类型名，
//     但该页没有对应说明段 ⇒ 返回缺失清单（生成器据此判红）

/** TS 内置/全局类型（不需要在本项目文档里解释）。 */
export const TS_BUILTINS = new Set([
  'Promise', 'Record', 'Array', 'ReadonlyArray', 'Partial', 'Required', 'Pick', 'Omit', 'Exclude',
  'Extract', 'NonNullable', 'ReturnType', 'Parameters', 'Awaited', 'Map', 'Set', 'WeakMap', 'WeakSet',
  'Date', 'Error', 'RegExp', 'Function', 'Object', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt',
  'Uint8Array', 'Uint8ClampedArray', 'Int8Array', 'Uint16Array', 'Int16Array', 'Uint32Array', 'Int32Array',
  'Float32Array', 'Float64Array', 'ArrayBuffer', 'ArrayBufferView', 'DataView', 'Blob', 'File', 'FileList',
  'FormData', 'Headers', 'Request', 'Response', 'URL', 'URLSearchParams', 'AbortSignal', 'AbortController',
  'ReadableStream', 'WritableStream', 'TransformStream', 'EventTarget', 'Event', 'AbortError',
  'JSON', 'Math', 'Reflect', 'Proxy', 'TypeError', 'RangeError', 'SyntaxError', 'Iterator', 'Iterable',
  'HTMLVideoElement', 'HTMLCanvasElement', 'ImageData', 'CanvasRenderingContext2D', 'MediaStream',
])

/** 从任意签名/类型片段里抽出**本项目已知的自定义接口名**。 */
export function namesIn(sig, ifaces) {
  const out = []
  if (typeof sig !== 'string') return out
  for (const m of sig.matchAll(/\b([A-Z][A-Za-z0-9]+)\b/g)) {
    const n = m[1]
    if (TS_BUILTINS.has(n)) continue
    if (!ifaces[n]) continue
    if (!out.includes(n)) out.push(n)
  }
  return out
}

/**
 * 收一页的全部类型引用（四个来源）。
 *
 * @param {object} p
 * @param {string} p.sigLine   hook 签名（如 `useFetch<T>(url: string, config?: FetchConfig): Promise<FetchResult<T>>`）
 * @param {object} p.ifaces    接口表（名 → {props, methods, doc}）
 * @param {Array}  p.allMethods 页级方法（`{sig}`）
 * @param {Array}  p.allProps   页级属性（`{type}`）
 * @returns {string[]} 类型名（去重，顺序稳定）
 */
export function collectPageTypeRefs({ sigLine = '', ifaces = {}, allMethods = [], allProps = [] } = {}) {
  const found = []

  // ① 参数类型 + ③ 返回值类型：都从签名的括号里外取
  const paren = sigLine.match(/\(([^)]*)\)/)
  const params = []
  if (paren && paren[1].trim()) {
    for (const raw of paren[1].split(',')) {
      const pm = raw.trim().match(/^(\w+)(\?)?:\s*(.+)$/)
      if (pm) params.push({ name: pm[1], type: pm[3].trim() })
    }
  }
  for (const p of params) found.push(...namesIn(p.type, ifaces))
  // 返回值（括号之后的部分）
  const retPart = paren ? sigLine.slice(paren.index + paren[0].length) : sigLine
  found.push(...namesIn(retPart, ifaces))

  // ② 参数对象的**属性**类型（★最容易漏的一层：参数表渲染了属性，但收集时没看）
  for (const p of params) {
    const ti = ifaces[p.type]
    if (!ti?.props?.length) continue
    for (const pr of ti.props) found.push(...namesIn(pr.type, ifaces))
  }

  // ④ 页级属性/方法
  for (const m of allMethods) found.push(...namesIn(m?.sig ?? '', ifaces))
  for (const p of allProps) found.push(...namesIn(p?.type ?? '', ifaces))

  // ⑤ 返回值**结构的属性类型**（★#1133 补：与 #1124 第②源同族）
  //   背景：`FetchResult<T>` 的成功支 `FetchOk` 有 `meta?: FetchMeta`，页面渲染返回值表时会打出
  //   `FetchMeta`（反引号包裹）⇒ 悬空引用门禁合理报「未解释」，但收集器根本没看过这一层。
  //   ★为什么不能只靠 namesIn(sigLine)：FetchResult 是**联合别名**，extractInterfaces 不收
  //     ⇒ 按生成器的同一命名约定（`XxxResult` → 成功支 `XxxOk`）再展开一层。
  const retPart0 = sigLine.replace(/^\([^)]*\)/, '')
  const retCandidates = new Set(namesIn(retPart0, ifaces))
  for (const m of retPart0.matchAll(/\b([A-Z][A-Za-z0-9]*Result)\b/g)) {
    const base = m[1].replace(/Result$/, '')
    for (const k of [`${base}Ok`, `${m[1]}Ok`]) if (ifaces[k]) retCandidates.add(k)
  }
  for (const n of retCandidates) {
    const ti = ifaces[n]
    if (!ti?.props?.length) continue
    for (const pr of ti.props) found.push(...namesIn(pr.type, ifaces))
  }

  return [...new Set(found)]
}

/** 说明段可接受的两种形态（`**\`X\`** — …` 或 `### X`）。 */
// 说明段可接受的形态：`**\`X\`** — …` / `### \`X\`` / `### X`。
// ★#1124：**标题带反引号**是本仓主流形态（`### \`Coords\``）——首版漏了它，
//   导致 19 个本来有说明段的页面被判"未解释"（假红）。
// 说明段可接受的形态（本仓实际出现的四种）：
//   ① `**\`X\`** — …`（行内加粗）
//   ② `### \`X\``（类型引用段，中文页主流）
//   ③ `#### \`X\` 的方法`（句柄型接口的方法表，如 CameraController）
//   ④ `### X`（无引号）
// ★#1124：首版只认 ①② 的子集 ⇒ 19 个本来有说明的页面被判"未解释"（假红）。
function hasExplanation(markdown, name) {
  if (markdown.includes('**`' + name + '`**')) return true
  const bt = '`'
  // 标题里出现该类型名即可（允许"的方法/的属性"等后缀）
  const re = new RegExp("^#{2,4}\\s+" + bt + "?" + name + bt + "?\\b", "m")
  return re.test(markdown)
}

/**
 * **悬空引用检查**：页面里引用了自定义类型，但没有任何说明段 ⇒ 返回缺失清单。
 *
 * 【判定口径（克制，避免假红）】
 *   · 只认**反引号包裹**的类型名（`` `UploadSpec` ``）——正文里的自然语言不算引用；
 *   · 只在 `ifaces` 里存在（即本项目真实定义的接口）——内置类型不管；
 *   · 说明段存在性看 `**\`X\`**` 或 `### X`（本仓两种既有渲染形态）。
 *
 * @param {string} markdown 生成的 md 全文
 * @param {object} ifaces   接口表
 * @returns {string[]} 未解释的类型名
 */
export function findUnexplainedTypes(markdown, ifaces) {
  if (typeof markdown !== 'string') return []
  const missing = []
  let inSection = false
  for (const line of markdown.split('\n')) {
    if (/^#{2,4}\s/.test(line)) inSection = /^#{2,4}\s+`?[A-Z]/.test(line)
    // ★#1161：说明段**内部**提到的类型名不算"引用"（叙述性提及，如"定义在 capability-app.ts 的
    //   `AppLifecycleHandle`"——那段话本身就在解释这个别名指向谁）。否则会逼人为每个同源别名
    //   再建一个重复段落 ⇒ 假红（本仓假红比漏报更贵）。
    if (inSection) continue
    for (const m of line.matchAll(/`([A-Z][A-Za-z0-9]+)`/g)) {
      const n = m[1]
      if (TS_BUILTINS.has(n)) continue
      if (!ifaces[n]) continue
      if (hasExplanation(markdown, n)) continue
      if (!missing.includes(n)) missing.push(n)
    }
  }
  return missing
}

/**
 * ★★★#1161：**数据源覆盖检查**——页面上引用的类型，在 `packages/api/src/` 里确实导出，
 * 却**不在 `ifaces` 里** ⇒ 说明该源文件没登记进生成器的 `API_SRC_FILES`。
 *
 * 【这道门禁为什么必须单独存在（用户实测的漏网形态）】
 *   `findUnexplainedTypes` 的判据是 `if (!ifaces[n]) continue` —— 它只检查"**已知**类型有没有说明段"。
 *   于是源文件没登记时，类型**根本不进 ifaces**，悬空引用检查**静默跳过**它：
 *   门禁全绿，而官网上 `FetchCacheMode` 只有一个裸名字、没有取值说明。
 *   ★这与本仓反复记的"断言只覆盖已知集合 ⇒ 集合外的形态永远不报"是同一族缺陷。
 *   ⇒ 判据换向：**从源码侧枚举所有导出类型**，凡是文档里引用了却抽不到 ⇒ 直接判"数据源缺失"。
 *
 * 【口径（克制）】只认**反引号包裹**、且在 api 源码里以 `export interface/type/class` 出现的名字；
 *   抽不到才报，不猜测"应不应该出现在这页"。
 *
 * ★★排除"说明段里提到的名字"（2026-10-22 实测）：
 *   正文/说明段**叙述性**提到某个类型名（如 `AppLifecycle` 的 doc 里写"定义在
 *   `capability-app.ts` 的 `AppLifecycleHandle`"）**不构成悬空引用**——那段话是在解释
 *   `AppLifecycle` 这个别名指向谁。若把它们也算引用，会要求每个"被提及的同源类型"都建独立段
 *   ⇒ 假红（本仓假红比漏报更贵：会逼人删掉有价值的说明）。
 *   实现：按行扫描，**跳过**任何"已在说明段内"的行（`### \`X\`` 之后到下一个标题之间）。
 *
 * @param {string} markdown     生成的 md 全文
 * @param {Set<string>} exported api 源码里**全部**导出类型名（跨所有文件）
 * @param {object} ifaces       生成器实际抽到的接口表
 * @returns {string[]} 引用了但抽取不到的导出类型名
 */
export function findUnregisteredTypes(markdown, exported, ifaces) {
  if (typeof markdown !== 'string' || !exported) return []
  const missing = []
  let inSection = false
  for (const line of markdown.split('\n')) {
    // 进入/离开"类型说明段"（### `X` / ## 类型引用 之外的一句话叙述不算）
    if (/^#{2,4}\s/.test(line)) { inSection = /^#{2,4}\s+`?[A-Z]/.test(line) }
    if (inSection) continue
    for (const m of line.matchAll(/`([A-Z][A-Za-z0-9]+)`/g)) {
      const n = m[1]
      if (TS_BUILTINS.has(n)) continue
      if (ifaces[n]) continue              // 已抽到 ⇒ 由 findUnexplainedTypes 管
      if (!exported.has(n)) continue       // 不是本项目的导出类型（外部/内置）
      if (!missing.includes(n)) missing.push(n)
    }
  }
  return missing
}
