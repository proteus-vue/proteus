/**
 * ★★★#1139：**「最小可闭环单元」探针**——给定契约点（如 `tag:Redirect`），
 * 直接打印"改它需要读哪几个文件的哪几段行号"，而不是让 AI 通读五端 2734 行。
 *
 * 【为什么这是"降低单会话认知负载"的直接落地】
 *   用户原话：「下次会话能不能**只读 3 个文件就改对**？」
 *   实测：改一个线格式 tag，五端编解码器各约 500-590 行（合计 2734 行）——
 *   但每端**真正要动的只有三处**（常量定义 / encode / decode），合计约 255 行（9%）。
 *   ⇒ 认知负载的瓶颈不是"代码总量"，而是**不知道那三处在哪**。
 *
 * 【★★探针自己的两个坑（都是实测抓出来的）】
 *   ① **去程 vs 回程命名不同**：去程 `TAG_*` / `MetaTagInvoke.*`，回程 `RTAG_*` / `MetaTagResolve.*`。
 *      首版只认去程 ⇒ 查 `StreamSeq`/`HttpStatus` 时 encode/decode 全 `—`（**误导人漏读**，比不查更糟）。
 *   ② **TS 用帕斯卡、四端用大写下划线**：`MetaTagInvoke.Redirect` vs `TAG_REDIRECT`
 *      ⇒ 同一个工厂不能同时收两种形态，必须**按端分别转换**。
 */

/** `Redirect` → `REDIRECT`（四端常量用大写下划线） */
export function snake(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/-/g, '_')
    .toUpperCase()
}

/**
 * 端点定义：每端三个正则工厂。
 * ★TS 端收**帕斯卡**名（`MetaTagInvoke.Redirect`），四端收**大写下划线**（`TAG_REDIRECT`）。
 */
function ends(constPrefix, tlvOwner) {
  return [
    {
      name: 'TS（SSOT）',
      file: 'packages/api/src/invoke-wire.ts',
      constRe: (c) => new RegExp(`^\\s+${c}:\\s*\\d+,`),
      encodeRe: (c) => new RegExp(`writeTlv\\(w, ${tlvOwner}\\.${c}`),
      decodeRe: (c) => new RegExp(`case ${tlvOwner}\\.${c}:`),
      // ★TS 用原样（帕斯卡）
      key: (name) => name,
    },
    {
      name: 'Java（Android）',
      file: 'hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/InvokeWire.java',
      constRe: (c) => new RegExp(`${constPrefix}${c} = \\d+;`),
      encodeRe: (c) => new RegExp(`writeTlv\\(w, ${constPrefix}${c}`),
      decodeRe: (c) => new RegExp(`case ${constPrefix}${c}:`),
      key: (name) => snake(name),
    },
    {
      name: 'Swift（iOS）',
      file: 'hosts/ios/ProteusHost/runtime/InvokeWire.swift',
      constRe: (c) => new RegExp(`${constPrefix}${c}: UInt8 = \\d+`),
      encodeRe: (c) => new RegExp(`writeTlv\\(w, ${constPrefix}${c}\\)`),
      decodeRe: (c) => new RegExp(`case ${constPrefix}${c}:`),
      key: (name) => snake(name),
    },
    {
      name: 'ArkTS（鸿蒙 JS）',
      file: 'hosts/harmony/host-app/entry/src/main/ets/runtime/InvokeWire.ts',
      constRe: (c) => new RegExp(`${constPrefix}${c}: number = \\d+`),
      encodeRe: (c) => new RegExp(`writeTlv\\(w, ${constPrefix}${c}`),
      decodeRe: (c) => new RegExp(`tag === ${constPrefix}${c}`),
      key: (name) => snake(name),
    },
    {
      name: 'C++（鸿蒙宿主）',
      file: 'hosts/harmony/host-app/proteus_render/src/main/cpp/invoke_wire.h',
      constRe: (c) => new RegExp(`${constPrefix}${c} = \\d+;`),
      encodeRe: (c) => new RegExp(`writeTlv\\(w, ${constPrefix}${c}`),
      decodeRe: (c) => new RegExp(`case ${constPrefix}${c}:`),
      key: (name) => snake(name),
    },
  ]
}

/** 去程 tag（`TAG_*` / `MetaTagInvoke.*`） */
export const INVOKE_ENDS = ends('TAG_', 'MetaTagInvoke')

/** 回程 tag（`RTAG_*` / `MetaTagResolve.*`） */
export const RESOLVE_ENDS = ends('RTAG_', 'MetaTagResolve')

/**
 * 回程 tag 的已知清单（新增回程 tag 时加进这里）。
 * ★用显式清单而非猜测：查错方向时会以"三处只命中 0 处"响亮失败，而不是给出半套位置。
 */
export const RESOLVE_TAG_NAMES = new Set(['HttpStatus', 'Reason', 'Missing', 'Pending', 'Headers', 'StreamSeq'])

/** 按名字解析出该用哪一端点集。 */
export function endsFor(name) {
  return RESOLVE_TAG_NAMES.has(name) ? RESOLVE_ENDS : INVOKE_ENDS
}

/** 兼容性别名 */
export const UNIT_TAGS = { ends: INVOKE_ENDS }

// ══════════════════════════════════════════════════════════════════════════════
// ★★★#1140：useFetch **四层字段链**的单元定义
//
// 【为什么这类契约最需要"给位置"】
//   #1134 实测：redirectManual 前三层都加了，**唯独第③层（appHttpRequest 的 args）漏了**
//   ⇒ 宿主永远收不到 ⇒ 真机读数 manual_status=200（仍跟随），而 Web 层 16/16 全绿。
//   ★漏一层的表现是**功能静默失效**，不是报错 ⇒ 必须能一次看全四层。
//
// 【★第④层有 4 种归类形态（探针必须全认，否则误报"未归类"）】
//   A META_STR 数组（url / contentType / savePath）
//   B META_HEADERS 数组（headers / params）
//   C META_ENUM 对象（responseType）
//   D 显式分支 k === '<name>'（method / timeout / upload / redirectManual …）
//  ★这是"探针自己要先自证"的又一处：只认 A 会把 B/C/D 的字段全判成"漏"。
// ══════════════════════════════════════════════════════════════════════════════

/** 四层定义（顺序即数据流方向；探针按此打印，漏哪层一眼看出）。 */
export const FETCH_LAYERS = [
  {
    name: '① 门面类型（FetchConfig）',
    file: 'packages/api/src/capability-fetch-types.ts',
    re: (f) => new RegExp('^\\s+' + f + '\\??\\s*:', 'm'),
  },
  {
    name: '② 桥参数（runFetch）',
    file: 'packages/api/src/capability-fetch.ts',
    re: (f) => new RegExp('^\\s+' + f + ':\\s*config\\?\\.' + f, 'm'),
  },
  {
    name: '③ App args（appHttpRequest）',
    file: 'packages/api/src/capability-app-request.ts',
    re: (f) => new RegExp('\\b' + f + ':\\s*config\\.' + f + '\\b'),
  },
  {
    name: '④ 线格式归类（splitFramePayload）',
    file: 'packages/api/src/capability-invoke.ts',
    re: (f) =>
      new RegExp(
        [
          "META_STR\\s*=\\s*\\[[^\\]]*'" + f + "'",
          "META_HEADERS\\s*=\\s*\\[[^\\]]*'" + f + "'",
          'META_ENUM[\\s\\S]{0,200}\\b' + f + '\\s*:',
          "k === '" + f + "'",
        ].join('|'),
      ),
  },
]

/**
 * **不进 meta 的线格式字段**：由别的通道承载，不落 `splitFramePayload`。
 *   · `onChunk` → 走 `invokeHostStream`（流式通道，`meta.stream = true`）；
 *   · `signal`  → 作为参数传给 `invokeHostAsync/invokeHostStream`，不进 meta。
 * ★探针据此把"第④层为空"判成**正当**（而不是漏传）——否则会对这两个字段假红。
 * ★与 `tests/fetch-wire-fields.test.ts` 的 `APP_LAYER_EXCLUDED` 同源（改一处必须改两处）。
 */
export const NOT_IN_META_FIELDS = new Set(['onChunk', 'signal'])

/** 已知的**管线字段**：不该下传到 App 线格式（桥只跑一次请求）。 */
export const PIPELINE_ONLY_FIELDS = new Set(['retry', 'priority', 'maxRedirects', 'onRedirect', 'redirect'])
