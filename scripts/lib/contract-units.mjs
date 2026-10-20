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
