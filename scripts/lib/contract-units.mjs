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

// ══════════════════════════════════════════════════════════════════════════════
// ★★★#1141：**Vapor 槽位**的单元定义（三类里最复杂的一类：三端 + 17 项指纹）
//
// 【为什么这类必须单独建单元（不能靠"读索引"记住）】
//   普通契约是"改一处同步 N 个**文件**"；Vapor 是"改一处 ⇒ 三端**重跑并提交证据** ⇒ 指纹 17 项逐值一致"。
//   它的失败形态最隐蔽：**只跑一端时，另一端是"推断"不是"证据"**——
//   代码看起来对、单端判据全绿，而三端行为已经分叉（因为 Vapor 能力在**平台无关共享包**里，
//   任一端跑的都是同一份 JS，却由各自宿主驱动 ⇒ 只有三端都跑才证明"共享代码在各宿主上都成立"）。
//
// 【改一个槽位特性要碰的四层（实测 2026-10-20）】
//   ① 编译期：`packages/compiler/src/vapor/slot-scope.ts`（作用域分析与样式）+
//      `template.ts`（折叠/发射）——契约来源；
//   ② 运行时：`packages/slot-runtime/src/dispatch.ts`（分发/填充）；
//   ③ 桥：`hosts/android/bridge/entry-vapor.ts`（三端共用的 Vapor 入口）；
//   ④ 夹具 + 三端产物：`hosts/android/gen-vapor-fixture.mjs` → 三端 `results/vapor.json`。
//
// 【★为什么"三端重跑"不能自动化成一条命令】
//   三端要**真机/模拟器**（USB 设备 / hdc / iOS devicectl）⇒ CI 跑不了，
//   只能各端先跑再入库，CI 复算判据 + 比对指纹。所以本单元给的是**清单 + 门禁**，不是"一条命令搞定"。
// ══════════════════════════════════════════════════════════════════════════════

/** Vapor 槽位单元的层定义（顺序即数据流；每层给"改这里要动什么"）。 */
export const VAPOR_SLOT_LAYERS = [
  {
    name: '① 编译期 · 作用域槽位',
    file: 'packages/compiler/src/vapor/slot-scope.ts',
    note: '作用域分析 + 内容样式；改这里 ⇒ 三端产物都会变 ⇒ 必须重跑',
  },
  {
    name: '① 编译期 · 模板折叠/发射',
    file: 'packages/compiler/src/vapor/template.ts',
    note: '槽位在模板面的折叠与发射（本文件 4651 行，**只需看 slot 区段**）',
    // ★巨型文件必须给区段锚点，否则"5 层"会退化成读 1 万行（那就失去意义了）
    anchors: [/vSlotScopeOf/, /parseSlotScope\(/],
  },
  {
    name: '② 运行时 · 分发/填充',
    file: 'packages/slot-runtime/src/dispatch.ts',
    note: '纯 JS 共享代码——三端跑的是**同一份**，任一端不同即"没重跑"',
  },
  {
    name: '③ 桥 · Vapor 入口（三端共用）',
    file: 'hosts/android/bridge/entry-vapor.ts',
    note: '三端共用入口（3713 行）；改它 ⇒ 三端 bundle 都要重建。**只需看 slot 探针区段**',
    anchors: [/插槽分发探针/, /slot_probe:/],
  },
  {
    name: '④ 夹具',
    file: 'hosts/android/gen-vapor-fixture.mjs',
    note: '夹具变更会改变三端产物 ⇒ 指纹全变（不是缺陷，是"必须三端重跑"）',
    anchors: [/slot/i],
  },
]

/** 三端证据与重跑入口（CI 复算；本机需真机/模拟器）。 */
export const VAPOR_THREE_ENDS = [
  { end: 'android', evidence: 'hosts/android/results/vapor.json', run: 'bash hosts/android/run-vapor.sh' },
  { end: 'harmony', evidence: 'hosts/harmony/results/vapor.json', run: 'bash hosts/harmony/run-vapor.sh' },
  { end: 'ios', evidence: 'hosts/ios/results/vapor.json', run: 'bash hosts/ios/run-selfdraw.sh --vapor' },
]

/** 必须跑的门禁（CI 可跑：复算判据 + 比对 17 项指纹）。 */
export const VAPOR_SLOT_GATES = ['pnpm check:vapor-three-end', 'pnpm check:vapor-capability']

/**
 * **17 项指纹字段**（与 `scripts/check-vapor-three-end.mjs` 的 SCALAR_FIELDS 派生组同源的**摘要**）。
 * ★这里只列"改槽位时最可能被影响的"，完整清单以门禁脚本为准（避免两处清单分叉）。
 */
export const VAPOR_SLOT_FINGERPRINT_HINT = [
  'slot_probe.texts（内容文本集）',
  'slot_probe.fills（填充记录 name:filled）',
  'slot_probe.markers_left（标记残留数）',
  'scoped_probe.texts（作用域插槽内容）',
  'scoped_probe.anchor_width_field / rect（作用域样式内核真值）',
  'scoped_probe.destr_text / destr_width_*（解构形态）',
  'emit_probe.emits / parent_source_after / geom_*（子→父链路）',
  'tpl_nodes / sub_l1 / sub_l0（模板面）',
  'inst_* / updates_run / ops_bytes（实例化与增量）',
  'ev_bindings / ev_handlers / ev_modifiers（事件绑定）',
  'component_mounts / component_nodes（组件面）',
]
