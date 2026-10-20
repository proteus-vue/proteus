// website/scripts/gen-content.mjs
// ★#390ii 组件/能力参考文档生成器（内容即数据——SSOT = 框架源码，产物勿手改）
//   ① website/content/components/*.md —— 59 个 p-* 组件：props/emits（解析 defineProps/defineEmits + JSDoc）
//      + 语义映射（component-ir TAG_SEMANTIC_MAP）+ 小程序等价（MP_MAPPING_MATRIX）
//   ② website/content/capabilities/*.md —— 50 个能力原语（PRIMITIVE_CATALOG kind=capability）
//      + 签名/返回类型（packages/api/src/capability.ts CapabilityHooks 接口 JSDoc）
//   幂等：重复运行输出一致（无时间戳）。用法：node website/scripts/gen-content.mjs
import fs from 'node:fs'
import { extractErrorCodes } from './lib/error-codes.mjs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { COMP_EN, DOMAIN_EN, MP_STATUS_EN, ENDS_EN, END_NOTE_EN, COMP_LEGEND_EN, SHARED_EN, OVERVIEW_EN, CAP_SHARED_EN, CAP_USAGE_EN, CAP_ARGS_EN, CAP_DATA_HINTS_EN, CAP_METHODS_EN, CAP_EN, CAP_CAT_EN, CAP_OVERVIEW_EN, LIFECYCLE_EVENT_EN, LIFECYCLE_EVENT_NOTE_EN, LIFECYCLE_SRC_EN } from './gen-content-en.mjs'
// ★决策 #881：App 桥方法集抽取抽成独立模块（锚定式解析 + 符号缺失硬失败）——详见该模块头注释
import { loadAppBridgeKeysFrom } from './lib/app-bridge-keys.mjs'
import { capabilityIntro, assertGuideCoverage } from './lib/capability-docs.mjs'; import { EN_ARG_PLACEHOLDERS } from './lib/cap-usage-en.mjs'   // ★#1084/#1087
import { usageOf } from './lib/cap-usage/index.mjs'   // ★#1088 示例 SSOT（中英同源）
import { capabilityEndStatuses, bucketOf, STATUS_MARK, capabilityCoverage, renderCoverage, CAP_LEGEND_ZH } from './lib/cap-end-status.mjs'   // ★#1089/#1090 逐端判定（含纯空壳）+ 总览汇总
// ★hook→桥方法引用抽取同法抽成独立模块（锚定式 + 硬失败）；三条契约共用 lib/ts-source-scan.mjs 原语
import { extractHookBridgeRefs, HOOK_FACTORY } from './lib/hook-bridge-refs.mjs'
// ★平台桥成员集 = 手写桥（capability-bridges.ts）∪ 声明式桥（generated/bridge-ext.ts）——见模块头注释
import { extractBridgeKeys, BRIDGE_EXT_REL_PATH } from './lib/bridge-keys.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
// ★组件库已拆包（2026-09-14）：@proteus-vue/components → packages/components（原仓库根 src/components）
const COMP_DIR = path.join(ROOT, 'packages', 'components')
const OUT_COMP = path.join(ROOT, 'website', 'content', 'components')
const OUT_CAP = path.join(ROOT, 'website', 'content', 'capabilities')

// ★官网漏修：能力「扩展 Hook」映射——某些能力的富操作接口由**额外 hook** 暴露（非 c.api 那一个），
//   如 C1 相机 → useCameraContext(id)、C2 录音 → useRecorder()、C5 传感器 → useSensorStream(kind)、
//   C20 日历 → useCalendarAPI()、C17 通知 → useDeviceNotification/useCustomerService。
//   这些也要在能力页展示（否则官网只见主 hook，富接口不可见）。value = 扩展 hook 名数组。
const CAP_EXTRA_HOOKS = {
  'capability.camera': ['useCameraContext'],
  'capability.microphone': ['useRecorder'],
  'capability.sensor': ['useSensorStream'],
  'capability.calendar': ['useCalendarAPI'],
  'capability.notification': ['useDeviceNotification', 'useCustomerService'],
}

// ★2026-09-10：--check 漂移模式（此前只能覆盖写、无门禁 → 手改文档与源脱节无人拦）。
//   与 gen-reference.mjs 同模式：--check 只比对不写，不一致 exit 1。
const check = process.argv.includes('--check')
const drifts = []
/** 排版自检命中（见 assertNoCollapsedTable——生成物里的"表格塌成段落"形态） */
const collapsed = []

/**
 * ★★排版自检（2026-09-30 用户反馈「这块儿排版是不是乱了？」——把这类生成器回归变成机器判据）
 *
 * 【反面形态（本轮截图实测）】多行 JSDoc 被 `.join(' ')` 压成**单行** ⇒ 源码里的 Markdown 表格
 *   （如 C82 的「端 | 入口 | 首参」四行）在页面上退化成**一大段普通文字**。
 *   修法是"解析保留行结构 + cell 处 oneline()"，但**判据必须存在**——否则下次谁再引入一处 `.join(' ')`
 *   又会静默变丑（与「接线不靠记忆」「门禁覆盖面跟形态走」同源纪律）。
 *
 * 【判据】正文行（非表格行 / 非列表行 / 非代码围栏内）若**超长且含多个列分隔** ⇒ 视为塌表：
 *   · 正常说明段落即使很长（本仓最长的接口头注约 250 字）也不会含 ≥3 个 ` | `；
 *   · 塌表行实测 > 600 字且含 10+ 个 ` | `（阈值取 400 字 / 3 个，留足安全边际）。
 */
function assertNoCollapsedTable(relPath, content) {
  if (!relPath.endsWith('.md')) return
  const offenders = []
  let inFence = false
  content.split('\n').forEach((line, idx) => {
    if (/^\s*```/.test(line)) { inFence = !inFence; return }
    if (inFence) return
    if (/^\s*\|/.test(line)) return        // 合法表格行
    if (/^\s*[-*>]\s?/.test(line)) return  // 列表/引用行
    if (line.length > 400 && (line.match(/ \| /g) ?? []).length >= 3) offenders.push(idx + 1)
  })
  if (offenders.length) collapsed.push(`${relPath}:${offenders.join(',')}`)
}

/** 写产物（--check 时改为比对；记录漂移文件） */
function writeDoc(p, content) {
  assertNoCollapsedTable(path.relative(ROOT, p), content)
  if (check) {
    const cur = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''
    if (cur !== content) drifts.push(path.relative(ROOT, p))
    return
  }
  fs.writeFileSync(p, content)
}

// —— component-ir SSOT（tsx 直接 import TS 源） ——
// ★2026-09-30：能力分域表也走同一 SSOT（原为本文件内部常量——那份副本已删除）
import { CAPABILITY_CATEGORY, CAPABILITY_CATEGORY_ORDER } from '../../packages/component-ir/src/capability-domains.ts'
async function loadIr() {
  const mod = await import(pathToFileURL(path.join(ROOT, 'packages', 'component-ir', 'src', 'index.ts')).href)
  return mod
}

// —— 端注册表 SSOT（W-7 L-B：兼容进度表的端列/状态 = website/src/ends.ts） ——
async function loadEnds() {
  const mod = await import(pathToFileURL(path.join(ROOT, 'website', 'src', 'ends.ts')).href)
  return mod.ENDS
}


// ══════════════════════════════════════════════════════════════════
// ★★生命周期事件 meta（用户反馈三点的数据源：说明缺失 / 无方法级端支持）
//   SSOT = `packages/api/src/capability-app.ts` 的 PAGE_EVENT_META / APP_EVENT_META
//   （动态 import——与 loadEnds 同款；改 SSOT 文档即变，无需在生成器里再写一份）
// ══════════════════════════════════════════════════════════════════
async function loadLifecycleMeta() {
  try {
    const mod = await import(pathToFileURL(path.join(ROOT, 'packages', 'api', 'src', 'capability-app.ts')).href)
    return { page: mod.PAGE_EVENT_META ?? {}, app: mod.APP_EVENT_META ?? {}, topics: mod.PLATFORM_TOPICS ?? {} }
  } catch {
    return { page: {}, app: {}, topics: {} } // read failure (early build) → empty tables, docs fall back to JSDoc
  }
}

/**
 * 平台专栏渲染（用户反馈第 4 点：应用与生命周期缺平台特有专栏）
 *
 * ★设计：专栏内容是**交叉引用**（话题 → 该用哪个能力），不是另写一套说明——
 *   避免 C23/C25 那样的重复（同一语义一处实现）。链接指向能力页（权威说明在那里）。
 */
function renderPlatformTopics(lines, capabilitySlug, lifecycleMeta, hookToSlug, hookStatus, lang) {
  if (!lifecycleMeta?.topics) return
  const perCap = lifecycleMeta.topics[capabilitySlug]
  if (!perCap) return
  const ORDER = ['mp', 'web', 'app']
  const L = lang === 'en'
    ? {
        h: '## Platform notes',
        sub: { mp: '### Mini Program (MP)', web: '### Web', app: '### App (iOS / Android / Harmony)' },
        related: 'Related capabilities',
        roadmap: 'Planned',
        title: (t) => t.titleEn,
        desc: (t) => t.descEn,
        rm: (t) => t.roadmapEn ?? t.roadmap,
      }
    : {
        h: '## 平台专栏',
        sub: { mp: '### 小程序（MP）', web: '### Web', app: '### App（iOS / Android / 鸿蒙）' },
        related: '相关能力',
        roadmap: '规划中',
        title: (t) => t.title,
        desc: (t) => t.desc,
        rm: (t) => t.roadmap ?? t.roadmapEn,
      }
  lines.push(L.h)
  lines.push('')
  for (const endKey of ORDER) {
    const list = perCap[endKey]
    if (!list || !list.length) continue
    lines.push(L.sub[endKey])
    lines.push('')
    for (const t of list) {
      const bits = [`**${L.title(t)}**`, '—', L.desc(t)]
      // ★★只对 **implemented** 的能力生成链接（用户反馈：「相关能力都只有文档，没有落地实现」）
      //   · implemented → 链接到 /docs/capability/<slug>（官网真实路由前缀，非 /capabilities/）
      //   · planned / 缺省 → **纯文本 + 显式标注**（不生成链接——链接会 404，且暗示"可用"）
      const links = (t.hooks ?? []).map((h) => {
        const slug = hookToSlug?.[h]
        const status = slug ? (hookStatus?.[slug] ?? 'planned') : 'unknown'
        if (slug && status === 'implemented') return `[\`${h}\`](/docs/capability/${slug})`
        return `\`${h}\`（${L.roadmap}）`
      })
      if (links.length) bits.push('·', `${L.related}:`, links.join(' / '))
      if (t.roadmap && !(t.hooks ?? []).length) bits.push('·', `${L.roadmap}:`, L.rm(t))
      lines.push(`- ${bits.join(' ')}`)
    }
    lines.push('')
  }
}

/** 方法名 → kebab 事件名（与 SSOT 表的 key 对齐）：onShow→show / setShareAppMessageProvider→share-app-message */
function methodToEvent(methodName) {
  // 特例：方法名与事件名不同形（历史命名）
  const SPECIAL = { onWindowResize: 'resize', onNetworkStatusChange: 'network-change' }
  if (SPECIAL[methodName]) return SPECIAL[methodName]
  const provider = methodName.match(/^set(.+)Provider$/)
  let n = provider ? provider[1] : methodName.replace(/^on/, '')
  return n.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

/** 取某方法的事件 meta（按句柄类型选表；无则 null） */
function eventMetaOf(handleT, methodName, meta) {
  if (!meta) return null
  const table = handleT === 'PageLifecycle' ? meta.page : handleT === 'AppLifecycle' ? meta.app : meta.app
  return table[methodToEvent(methodName)] ?? null
}

/** 端支持单元格（紧凑图标：MP/Web/App 有来源即 ✅，无即 —） */
function endSupportCell(m) {
  if (!m) return '—'
  return `MP ${m.mp ? '✅' : '—'} · Web ${m.web ? '✅' : '—'} · App ${m.app ? '✅' : '—'}`
}

/** EN 源向量（优先 EN 译本，缺 key 回退 zh —— 诚实） */
function srcEnOf(handleT, methodName, m) {
  const sheet = handleT === 'PageLifecycle' ? (LIFECYCLE_SRC_EN.page ?? {}) : (LIFECYCLE_SRC_EN.app ?? {})
  const d = sheet[methodToEvent(methodName)]
  return { mp: d?.mp ?? m.mp, web: d?.web ?? m.web, app: d?.app ?? m.app }
}

/** Per-target support cell (EN) */
function endSupportCellEn(m) {
  if (!m) return '—'
  return `MP ${m.mp ? '✅' : '—'} · Web ${m.web ? '✅' : '—'} · App ${m.app ? '✅' : '—'}`
}

/** 端支持详情行（各端真实来源；无来源的端显式标"无此事件"——诚实边界） */
function endSupportLine(m, labels) {
  const parts = []
  parts.push(m.mp ? `${labels.mp} \`${m.mp}\`` : `${labels.mp} —（${labels.none}）`)
  parts.push(m.web ? `${labels.web} \`${m.web}\`` : `${labels.web} —（${labels.none}）`)
  parts.push(m.app ? `${labels.app} \`${m.app}\`` : `${labels.app} —（${labels.none}）`)
  return parts.join(' · ')
}

// ★★App 宿主桥方法集（`packages/api/src/capability-app.ts`）——从源码推导，决定能力页 App 端 ✅/🟡。
//   【为什么在生成器里】原有实现硬编码「能力桥未接线」，而生命周期三能力的 App 腿早已落地并真机验证 ⇒
//   页面与源码事实脱节（wx/web 列早已用 wxMissing/webMissing 推导，只有 native 列写死）。
//   【决策 #881】解析抽到 `lib/app-bridge-keys.mjs`（锚定式：export function → 顶层 return 对象 → 深度 0
//   成员名，方法简写/属性箭头两种风格都收）；旧窄正则 `/^\s{4}(get[A-Z]\w*)\(/` 只认简写 ⇒ 13 个只抽到 3 个。
//   数据源文件/工厂符号/返回对象缺失 ⇒ 硬失败抛错（不静默得空集）。细节见该模块头注释。
// ★决策 #1067：多源（含拆出的 capability-app-device.ts）；鸿蒙分档见 lib/harmony-host-keys.mjs
const APP_BRIDGE_KEYS = loadAppBridgeKeysFrom(ROOT).keys
// ★真机双端验证的覆盖范围（SSOT = check:host-runtime 的 results/*.json——当前只含生命周期组）：
const HOST_RUNTIME_VERIFIED_CAPS = new Set(['app-lifecycle', 'page-lifecycle', 'background'])
// ★#1069 推送型（壳真推才可用）· #1090 纯空壳降 ⚠️（lib/bridge-impl-reality.mjs）
const PUSH_CAPABILITIES = new Set(['keyboard'])
const MP_STATUS_LABEL = { ok: 'L1 原语', compat: 'L2 兼容层', private: '平台私有', missing: '缺失' }

// ★能力侧栏分组：按 10 类归组——★2026-09-30 已抽为 **component-ir 的共享事实源**
//   （`CAPABILITY_CATEGORY` / `CAPABILITY_CATEGORY_ORDER`）：原表是本文件的内部常量（75 条、未导出），
//   而 NC0《能力实现优先级表》需要**同一分组** ⇒ 各自维护即"第 N 份手写副本"（本仓纪律禁止）。
//   同时补齐了 7 个未映射项（update/album/worker/address/wifi/we-run/webassembly —— 原落「其他」兜底）。
const CAP_CATEGORY = CAPABILITY_CATEGORY
const CAP_CAT_ORDER = [...CAPABILITY_CATEGORY_ORDER]

// 兼容进度表（uni-app 式全端对照）：端列/状态来自 ENDS 注册表，说明 = 引擎（注册表） + 逐项注记
function compatSection(rows, footer) {
  const lines = []
  lines.push('## 兼容进度')
  lines.push('')
  lines.push('| 端 | 兼容 | 说明 |')
  lines.push('|---|---|---|')
  for (const r of rows) lines.push(`| ${r.name} | ${r.status} | ${r.note} |`)
  lines.push('')
  lines.push(footer)
  lines.push('')
  return lines
}

// ★#1089 全端兼容进度的汇总与渲染实现在 lib/cap-end-status.mjs（生成器保持"只装配不实现"）
// ★#406 颗粒度批：TS 接口解析（能力页参数/返回值属性表的 SSOT——capability.ts 内 60+ 接口属性带 JSDoc）
//   提取 export interface X { ... } 的逐属性：名称/类型/可选(?)/前置 JSDoc 首行
//   ★#490 补方法成员：句柄型接口（CookieJar/BackgroundAPI/FSAdapter…）的结构本体是方法——属性通道排除 '): ' 行，这里成对补齐
// ★#1122：**TS 接口解析**（从 `gen-content.mjs` 抽出——该文件 2326 行超棘轮）。
//
// 【它做什么】把 `packages/api/src/*.ts` 里的 `export interface X { ... }` 解析成
//   `{X: {props:[], methods:[], doc}}`，供能力页渲染**参数表 / 返回值属性表 / 类型引用**。
//   ★SSOT = 源码里的 JSDoc——文档的字段说明不手写，全从接口注释来。
//
// 【诚实边界】这是**文本扫描**而非真 TS 解析：靠花括号配对 + 行级规则，
//   因此对"字符串里含花括号/正则"等形态不严谨。本仓用它是因为生成器不能引入 TS 编译器的重依赖。
function extractInterfaces(src) {
  const out = {}
  // ★官网漏修（2026-09-11）：原正则只认 `export interface X {` —— 漏三类 → 官网方法表缺失：
  //   ① extends（BluetoothAPI extends BluetoothInfo / NFCAPI extends NfcInfo）
  //   ② 单行接口（MapPolyline/MapCircle `{ ... }` 同行——还会吞掉紧随的 MapController）
  //   ③ 带泛型默认值的接口（ReactiveStorage<TState extends ... = ...>）
  //   改：定位每个 `export interface NAME`，从其后第一个 `{` 起花括号配对取 body（含跨行/单行/extends/泛型）。
  const re = /(?:\/\*\*((?:[^*]|\*(?!\/))*)\*\/\s*)?export interface (\w+)([^{;]*?)\{/g
  let m
  while ((m = re.exec(src))) {
    const jsdoc = m[1]
    const name = m[2]
    // extends 基名（如 ` extends BluetoothInfo）——合并父接口属性到本接口
    const extM = (m[3] || '').match(/extends\s+([\w.]+)/)
    const extendsName = extM ? extM[1] : null
    const braceStart = m.index + m[0].length - 1
    // 花括号配对（跳过字符串/注释简化：capability.ts 接口体无嵌套模板串干扰）
    let depth = 0
    let i = braceStart
    for (; i < src.length; i++) {
      const ch = src[i]
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) break
      }
    }
    const body = src.slice(braceStart + 1, i)
    re.lastIndex = i + 1
    const props = []
    // ★官网漏修：属性解析改**行级**（原多行正则会把 `getAdapterState(): Promise<CapResult<{ available: boolean; ... }>>`
    //   的参数碎片误当属性 → 类型截断）。行级规则：跳过注释行 / 含 `(` 的方法行 / 含 `<` 泛型参数行，仅收 `name?: type`。
    {
      const propLines = body.split('\n')
      let pdoc = ''
      // 顶层 ; 切分（单行接口 `a: X; b: Y` 拆成多条，尊重 <>{}()[] 嵌套）
      const splitTop = (str) => {
        const out = []
        let depth = 0
        let cur = ''
        for (const ch of str) {
          if ('<({['.includes(ch)) depth++
          else if ('>)}]'.includes(ch)) depth--
          if (ch === ';' && depth === 0) { out.push(cur); cur = '' } else cur += ch
        }
        if (cur.trim()) out.push(cur)
        return out
      }
      for (const rawLine of propLines) {
        const t = rawLine.trim()
        if (!t) continue
        // 含顶层 ; 的单行多属性 → 逐个（注释缓冲只在首个生效）
        const segs = splitTop(t)
        if (segs.length > 1) {
          for (const seg of segs) {
            const pm = seg.trim().match(/^(\w+)(\?)?:\s*(.*)$/)
            if (pm) props.push({ name: pm[1], optional: pm[2] === '?', type: pm[3].trim(), doc: pdoc.trim() })
          }
          pdoc = ''
          continue
        }
        if (t.startsWith('/**') || t.startsWith('*') || t.startsWith('*/')) {
          pdoc = (pdoc ? pdoc + ' ' : '') + t.replace(/^\/\*\*/, '').replace(/\*\/$/, '').replace(/^\*\s?/, '').trim()
          continue
        }
        // 方法行（`name(...): T` 形态）→ 跳过且清零文档缓冲
        // ★★★#1122：**函数类型的属性行不能跳**——`onChunk?: (chunk, seq) => void` 也是 `name?: type`，
        //   只是 type 里带 `(`。旧规则见 `(` 就跳过 ⇒ 官网能力页**静默丢掉所有回调型字段**
        //   （本轮实测：useFetch 的 onChunk 在生成的参数表里完全消失）。
        //   ⇒ 判据改成"**在 `:` 之前**出现 `(` 才算方法"。
        if (/^\w+\s*\(/.test(t)) { pdoc = ''; continue }
        // 属性行：类型可含嵌套对象/泛型（内部含 `;`）——取整行，再剥尾分号与行尾 // 注释
        // 剥行尾 // 注释（引号内的 // 罕见——capability.ts 接口属性注释均在行尾且无 // 字符串）
        const commentM = t.match(/^([\s\S]*?)\s*\/\/(.*)$/)
        const noComment = (commentM ? commentM[1] : t).replace(/;\s*$/, '')
        const inline = commentM ? commentM[2].trim() : ''
        const pm = noComment.match(/^(\w+)(\?)?:\s*(.*)$/)
        if (pm) {
          props.push({ name: pm[1], optional: pm[2] === '?', type: pm[3].trim(), doc: (pdoc || inline).trim() })
        }
        pdoc = ''
      }
    }
    // 方法成员（行级解析——capability.ts 接口成员均为单行；JSDoc 缓冲遇非注释行即清零）
    // ★详细文档（2026-09-11）：保留 rawDoc（含 @param/@returns）+ 解析参数，供「逐方法详细段」生成
    const methods = []
    let mdocLines = []
    const parseMethodDoc = (raw) => {
      const lines = raw
        .replace(/^\/\*\*/, '')
        .replace(/\*\/$/, '')
        .split('\n')
        .map((l) => l.replace(/^\s*\*\s?/, '').trim())
      const paramDocs = {}
      let returns = ''
      const prose = []
      for (const l of lines) {
        let mm
        if ((mm = l.match(/^@param\s+(\w+)\s*(?:-|—)?\s*(.*)$/))) paramDocs[mm[1]] = mm[2].trim()
        else if ((mm = l.match(/^@returns?\s*(?:-|—)?\s*(.*)$/))) returns = mm[1].trim()
        else if (l.startsWith('@')) continue
        else prose.push(l)
      }
      return { doc: normalizeJsdoc(prose.join('\n')), paramDocs, returns } // ★保留行结构；cell 消费点过 oneline()
    }
    for (const raw of body.split('\n')) {
      const t = raw.trim()
      if (t.startsWith('/**') || t.startsWith('*') || t.startsWith('*/')) {
        mdocLines.push(t)
        continue
      }
      const mm = t.match(/^(\w+)\s*\((.*)\)\s*:\s*(.+?);?$/)
      if (mm) {
        const parsed = mdocLines.length ? parseMethodDoc(mdocLines.join('\n')) : { doc: '', paramDocs: {}, returns: '' }
        methods.push({ name: mm[1], sig: `${mm[1]}(${mm[2]}): ${mm[3].replace(/;$/, '')}`, args: mm[2], ret: mm[3].replace(/;$/, ''), doc: parsed.doc, paramDocs: parsed.paramDocs, returns: parsed.returns })
      }
      mdocLines = []
    }
    out[name] = {
      // ★★保留换行（2026-09-30 用户反馈「这块儿排版是不是乱了？」）：
      //   原 `.join(' ')` 把多行 JSDoc 压成一行 ⇒ 源码里的 **Markdown 表格**（如 C82 的
      //   「端 | 入口 | 首参」四行）在页面上退化成一大段普通文字（截图实测）。
      //   Markdown 的表格/列表/段落块都需要**行结构** ⇒ 这里保留 `\n`，
      //   而**表格 cell** 的消费点统一过 `oneline()` 压平（见其定义——cell 里不能有换行）。
      doc: normalizeJsdoc(jsdoc || ''),
      props,
      methods,
      extendsName,
    }
  }
  // ★官网漏修：extends 合并（子接口属性 = 父接口属性（去重） + 自身属性）——BluetoothAPI/NFCAPI 状态字段可见
  for (const name of Object.keys(out)) {
    const base = out[name].extendsName
    if (base && out[base]) {
      const ownNames = new Set(out[name].props.map((x) => x.name))
      out[name].props = [...out[base].props.filter((x) => !ownNames.has(x.name)), ...out[name].props]
    }
  }
  return out
}

// 表格单元格内类型/签名/描述竖线转义（'joined' | 'left' / string | null / 形态区间表达式——否则断列）
const escMd = (s) => String(s).replace(/\|/g, '\\|')

/**
 * ★行内化：多行 doc 进**表格 cell** 必须压成单行（Markdown 表格行不能含换行——否则整表断裂）。
 * 【为什么需要（2026-09-30 用户反馈「这块儿排版是不是乱了？」）】接口/方法的 JSDoc 现已**保留换行**
 *   （`extractInterfaces`/`parseMethodDoc`：表格/列表/段落块需要行结构才能正确渲染），
 *   而大量 cell 消费点（属性表/方法表/类型引用表）把 doc 直接插进 `| … |` ⇒ 必须在**这里**压平。
 * ★判据（维护提示）：凡 `${…doc…}` 出现在以 `|` 开头的模板串里，就该过 oneline()。
 */
const oneline = (s) => String(s ?? '').replace(/\r?\n+/g, ' ').trim()

/**
 * ★JSDoc 归一：去注释壳与首尾空行，**内部空行保留**（Markdown 的表格/列表/段落块靠空行分隔——
 *   压掉空行会让表格退化成普通文字，正是 2026-09-30 用户截图里的形态）。
 * 用法：接口/方法/能力级 doc 的**块渲染**走本函数；表格 cell 一律过 `oneline()`。
 * ★行内容左右都 trim（与旧实现一致）：只去一个前导空格会留下行首空白
 *   ⇒ 一是渲染出多余缩进，二是 `.replace(/^C\d+\s+/, '')` 这类**行首锚定**的后处理失配
 *   （实测踩到：useEmbedded 页出现 " C48 useEmbedded…" 前缀未被剥掉）。
 */
const normalizeJsdoc = (raw) => {
  const lines = String(raw ?? '')
    .replace(/^\/\*\*/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map((l) => l.replace(/^\s*\*\s?/, '').trim())
  while (lines.length && !lines[0]) lines.shift()
  while (lines.length && !lines[lines.length - 1]) lines.pop()
  return lines.join('\n')
}

// ★详细文档（2026-09-11）：方法签名 → 参数列表（名称/类型/可选；与 JSDoc @param 合并）
function parseSigArgs(argsStr) {
  if (!argsStr || !argsStr.trim()) return []
  const out = []
  // 顶层逗号切分（跳过尖括号/圆括号/方括号/花括号内）
  // ★★`=>` 修复（2026-09-30）：箭头函数的 `>` 此前被当成**尖括号闭合** ⇒ 深度被打成负数
  //   ⇒ 之后的 `<`（泛型开始）只回到 0 ⇒ 泛型内的逗号被当作顶层分隔 ⇒ 参数表被切坏
  //   （实测形态：`fn: () => Record<string, unknown>` 被切成两行 `Record<string` / `unknown>`）。
  //   修法：`>` 前一个字符是 `=`（即箭头 `=>`）时**不动深度**。
  let depth = 0
  let cur = ''
  let prev = ''
  for (const ch of argsStr) {
    if ('<([{'.includes(ch)) depth++
    else if (ch === '>' && prev === '=') { /* 箭头 => 的 > —— 不计深度 */ }
    else if ('>)]}'.includes(ch)) depth--
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = '' } else cur += ch
    prev = ch
  }
  if (cur.trim()) out.push(cur.trim())
  const params = []
  for (const seg of out) {
    let m = seg.match(/^(\w+)\??:\s*([\s\S]+)$/) // name: type
    if (m) { params.push({ name: m[1], type: m[2].trim(), optional: /\?\s*:/.test(seg) }); continue }
    m = seg.match(/^\.\.\.(\w+)\s*:\s*([\s\S]+)$/) // rest
    if (m) { params.push({ name: '...' + m[1], type: m[2].trim(), optional: false }); continue }
    params.push({ name: seg, type: '', optional: false }) // 非常规（回调解构等）——原样
  }
  return params
}

// 从签名/返回类型提取「引用的接口名」（大写开头标识符），过滤 TS 内建/泛型占位
const TS_BUILTINS = new Set(['Promise', 'CapResult', 'Array', 'Record', 'Partial', 'Readonly', 'Map', 'Set', 'Date', 'Error', 'ArrayBuffer', 'Uint8Array', 'Boolean', 'String', 'Number', 'Object', 'Function', 'T', 'K', 'V'])
function collectRefTypes(methodSigs, ifaces) {
  const names = new Set()
  for (const sig of methodSigs) {
    for (const m of sig.matchAll(/\b([A-Z][A-Za-z0-9]+)\b/g)) {
      const n = m[1]
      if (!TS_BUILTINS.has(n) && ifaces[n]) names.add(n)
    }
  }
  return [...names]
}

// 渲染引用类型表（去重；不含自身/父）——放在方法详细段之后
function renderTypeRefs(lines, names, ifaces, opts) {
  if (!names.length) return
  const { hLevel, label, cols } = opts
  lines.push(`${hLevel} ${label}`)
  lines.push('')
  for (const n of names) {
    const ti = ifaces[n]
    if (!ti) continue
    if (ti.doc) { lines.push(`**\`${n}\`** — ${ti.doc}`); lines.push('') }
    if (ti.props.length) {
      lines.push(`| ${cols[0]} | ${cols[1]} | ${cols[2]} |`)
      lines.push('|---|---|---|')
      for (const pr of ti.props) lines.push(`| \`${pr.name}\` | \`${escMd(pr.type)}\` | ${oneline(pr.doc) || '—'} |`)
      lines.push('')
    }
    if (ti.methods.length) {
      lines.push(`| ${cols[0]} | ${cols[1]} | ${cols[2]} |`)
      lines.push('|---|---|---|')
      for (const mm of ti.methods) lines.push(`| \`${mm.name}\` | \`${escMd(mm.sig)}\` | ${oneline(mm.doc) || '—'} |`)
      lines.push('')
    }
  }
}

// 参数说明自动兜底（无 @param 时按名称/类型生成，避免满屏 `—`）
function autoParamDoc(a) {
  const t = a.type || ''
  if (/=>/.test(t)) {
    if (a.name === 'cb' || a.name === 'callback') return '事件 / 结果回调函数'
    return '回调函数'
  }
  if (a.name === 'options' || a.name === 'opt' || a.name === 'config') return '配置选项对象'
  // 通用参数名兜底
  const GENERIC = {
    value: '值', data: '数据', params: '附加参数对象', token: '凭证', event: '事件名',
    name: '名称', kind: '类型', id: '标识', key: '键名', kvList: '键值对列表',
    phone: '电话号码', url: '地址', path: '路径', kind: '类型',
  }
  if (GENERIC[a.name]) return GENERIC[a.name]
  if (/\[\]/.test(t)) return '数组参数'
  if (t === 'string') return '字符串参数'
  if (t === 'number') return '数值参数'
  if (t === 'boolean') return '布尔参数'
  return '—'
}

// ★颗粒度对齐 B（2026-09-11）：组件用法示例——基于真实 props/emits/slots 生成（替硬编码空壳）。
//   规则：v-model 型（有 update:modelValue）→ v-model 绑定；其余有值 props → 示例属性；具名插槽 → <template #name>。
function buildComponentUsage(dir, props, emits, slots) {
  const vmProp = emits.find((e) => e === 'update:modelValue')
  const vmVisible = emits.find((e) => e === 'update:visible')
  const attrs = []
  if (vmProp) attrs.push('v-model="value"')
  else if (vmVisible) attrs.push('v-model:visible="visible"')
  // 示例属性：跳过 v-model 承载字段/通用字段（pid/ariaLabel）/函数型默认（() => ...）/超长表达式/复杂 union 字符串
  const skip = new Set(['pid', 'ariaLabel', 'modelValue', 'visible', 'items', 'model', 'rules', 'pAdaptive', 'anchor'])
  const sampleProps = props.filter((p) => {
    if (skip.has(p.name)) return false
    const d = String(p.default ?? '')
    if (d.includes('=>') || d.length > 24 || d.includes('|')) return false // 函数/超长/union 默认 → 略
    return true
  }).slice(0, vmProp || vmVisible ? 2 : 3)
  for (const p of sampleProps) {
    let val
    if (p.type === 'Boolean') val = 'true'
    else if (p.type === 'Number') val = p.default && p.default !== '-1' && p.default !== '0' ? p.default : '0'
    else if (p.default && p.default !== "''") val = p.default
    else val = "'…'"
    attrs.push(`:${p.name}="${val}"`)
  }
  const namedSlots = slots.filter((s2) => s2.name !== 'default')
  const lines = [`<${dir}${attrs.length ? ' ' + attrs.join(' ') : ''}>`]
  for (const s2 of namedSlots.slice(0, 2)) lines.push(`  <template #${s2.name}>…</template>`)
  lines.push('  <p-text>内容</p-text>')
  lines.push(`</${dir}>`)
  return lines
}

// ★颗粒度对齐 A：从 JSDoc 文本提取「默认值」（缺省/默认 X）——能力页类型引用属性表的「默认值」列
function extractDefaultFromDoc(doc) {
  if (!doc) return ''
  const m = doc.match(/(?:缺省|默认(?:值)?)[\s：:是为=]+([^\s，。；;）)]+)/)
  return m ? m[1] : ''
}

// 渲染类型引用（h2 段内：每类型 h3 + 属性/方法表）——TOC 可列类型名
function renderTypeRefsH2(lines, names, ifaces) {
  // ★颗粒度对齐 A（2026-09-11）：**递归展开**引用的 interfaces——原只展一层，嵌套类型（nfc 的 NfcTag/NfcTagHandle/
  //   NdefHandle、组件类型里的嵌套）不展开。BFS：从给定 names 出发，扫属性类型 + 方法签名中的 interface 引用继续。
  const rendered = new Set()
  const queue = [...names]
  while (queue.length) {
    const n = queue.shift()
    if (rendered.has(n) || !ifaces[n]) continue
    rendered.add(n)
    const ti = ifaces[n]
    lines.push(`### \`${n}\``)
    lines.push('')
    if (ti.doc) { lines.push(ti.doc); lines.push('') }
    if (ti.props.length) {
      lines.push('| 属性 | 类型 | 默认值 | 说明 |')
      lines.push('|---|---|---|---|')
      for (const pr of ti.props) {
        const dflt = extractDefaultFromDoc(pr.doc)
        lines.push(`| \`${pr.name}\` | \`${escMd(pr.type)}\` | ${dflt ? `\`${escMd(dflt)}\`` : '—'} | ${oneline(pr.doc) || '—'} |`)
        for (const r of collectRefTypes([pr.type], ifaces)) if (!rendered.has(r)) queue.push(r)
      }
      lines.push('')
    }
    if (ti.methods.length) {
      lines.push('| 方法 | 签名 | 说明 |')
      lines.push('|---|---|---|')
      for (const mm of ti.methods) {
        lines.push(`| \`${mm.name}\` | \`${escMd(mm.sig)}\` | ${oneline(mm.doc) || '—'} |`)
        for (const r of collectRefTypes([mm.sig], ifaces)) if (!rendered.has(r)) queue.push(r)
      }
      lines.push('')
    }
  }
}

// 渲染「逐方法详细说明」（h4：签名 + 参数表 + 返回值 + 说明）——小程序文档式颗粒度
function renderMethodDetails(lines, methods, opts) {
  const { hLevel, paramCols, returnsLabel, descLabel } = opts
  for (const mm of methods) {
    lines.push(`${hLevel} \`${mm.name}\``)
    lines.push('')
    lines.push('```ts')
    lines.push(mm.sig)
    lines.push('```')
    lines.push('')
    if (mm.doc) { lines.push(`**${descLabel}**：${mm.doc}`); lines.push('') }
    const args = parseSigArgs(mm.args)
    if (args.length) {
      lines.push(`| ${paramCols[0]} | ${paramCols[1]} | ${paramCols[2]} | ${paramCols[3]} |`)
      lines.push('|---|---|---|---|')
      for (const a of args) {
        const doc = (mm.paramDocs && mm.paramDocs[a.name]) || autoParamDoc(a)
        lines.push(`| \`${a.name}\` | \`${escMd(a.type || '—')}\` | ${a.optional ? paramCols[4] : paramCols[5]} | ${doc} |`)
      }
      lines.push('')
    }
    lines.push(`**${returnsLabel}**：\`${escMd(mm.ret)}\`${mm.returns ? '——' + mm.returns : ''}`)
    lines.push('')
  }
}

// ★#490 返回形态判定（zh/EN 同源）：Promise<CapResult<T>> 数据型 / Promise<CapResult<句柄>> 句柄型 / 同步句柄
//   旧版 directT 硬编码 ['AuthState','CompatStorage'] 漏掉 6 个同步句柄（TrackAPI/Logger/AppLifecycle/PageLifecycle/FSAdapter/KeyboardLifecycle）
//   → data 行渲染成空类型 + 用法误配 await 模板；Contact[] 数组后缀不剥 → 元素接口查表落空。均由本函数签名推导收口
function hookShape(sigLine, ifaces) {
  const retM = sigLine.match(/\)\s*:\s*([^\n]+)$/)
  const retType = retM ? retM[1].trim() : ''
  // ★★★#1122：结果是 `Result` 家族的**任意命名**（`CapResult<T>` / `FetchResult<T>` …），
  //   不再写死 `CapResult`——否则换名字的能力页会**静默退化成"data 类型为空"**
  //   （本轮实测：useFetch 改成 FetchResult<T> 后，官网返回值表变成 `| data |  |`）。
  const retT = sigLine.match(/(?:\w*Result)<([^<>]+(?:<[^<>]+>)?)>/)
  const dataT = retT ? retT[1].trim() : ''
  const voidRet = /(?:\w*Result)<void>/.test(sigLine)
  // ★返回是否 Promise（`FetchResult` 与 `CapResult` 同族，都按数据型渲染）
  const isResultFamily = /(?:\w*Result)</.test(sigLine)
  void isResultFamily
  const handleT = !/^Promise</.test(retType) && /^[A-Z]\w*$/.test(retType) ? retType : ''
  const dataElemT = dataT.endsWith('[]') ? dataT.slice(0, -2) : dataT
  const dataIface = dataElemT ? ifaces[dataElemT] : undefined
  const handleIface = handleT ? ifaces[handleT] : undefined
  return { retType, dataT, voidRet, handleT, dataElemT, dataIface, handleIface }
}

void extractErrorCodes

// 桥方法实现体切片（wxBridge/webBridge 内 methodName: ... 到同级下一方法）——错误码提取用
function extractBridgeBodies(apiSrc, fnName) {
  const start = apiSrc.indexOf(`function ${fnName}`)
  if (start < 0) return {}
  const rest = apiSrc.slice(start)
  const endM = rest.search(/^}/m)
  const body = endM >= 0 ? rest.slice(0, endM) : rest
  const bodies = {}
  const keyRe = /^ {4}([a-zA-Z]+):/gm
  const hits = [...body.matchAll(keyRe)]
  for (let k = 0; k < hits.length; k++) {
    const end = k + 1 < hits.length ? hits[k + 1].index : body.length
    bodies[hits[k][1]] = body.slice(hits[k].index, end)
  }
  return bodies
}

// —— defineProps 块提取（平衡花括号/括号/字符串） ——
function extractCall(src, fnName) {
  const idx = src.indexOf(`${fnName}(`)
  if (idx < 0) return null
  const start = src.indexOf('{', idx)
  if (start < 0) return null
  let depth = 0
  for (let i = start; i < src.length; i++) {
    const ch = src[i]
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch
      i++
      for (; i < src.length; i++) {
        if (src[i] === '\\') { i++; continue }
        if (src[i] === quote) break
      }
      continue
    }
    if (ch === '{' || ch === '(') depth++
    else if (ch === '}' || ch === ')') {
      depth--
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  return null
}

// 顶层键分割：在块内按逗号切割（深度 0 时的逗号为界，跳过字符串/嵌套）
function splitTopLevel(block) {
  const parts = []
  let depth = 0
  let start = 0
  for (let i = 0; i < block.length; i++) {
    const ch = block[i]
    if (ch === "'" || ch === '"' || ch === '`') {
      const q = ch
      i++
      for (; i < block.length; i++) {
        if (block[i] === '\\') { i++; continue }
        if (block[i] === q) break
      }
      continue
    }
    if (ch === '{' || ch === '(' || ch === '[') depth++
    else if (ch === '}' || ch === ')' || ch === ']') depth--
    else if (ch === ',' && depth === 0) {
      parts.push(block.slice(start, i))
      start = i + 1
    }
  }
  const tail = block.slice(start)
  if (tail.trim()) parts.push(tail)
  return parts
}

function parseValue(seg) {
  // ★#406：剥行内注释——字符串字面量内的 // 不误伤（'http://x' 等场景：只剥引号外的 //）
  let out = ''
  let q = null
  for (let i = 0; i < seg.length; i++) {
    const ch = seg[i]
    if (q) {
      out += ch
      if (ch === '\\') { out += seg[++i] ?? ''; continue }
      if (ch === q) q = null
      continue
    }
    if (ch === '\'' || ch === '"' || ch === '`') { q = ch; out += ch; continue }
    if (ch === '/' && seg[i + 1] === '/') break
    out += ch
  }
  // ★2026-09-10：剥 TS 类型断言（default: 'bottom' as PopoverPlacement → 'bottom'）——
  //   否则重新生成会把 `as Xxx` 泄漏进文档（此前手工改对了但无漂移门禁，重生成即回退）。
  return out
    .trim()
    .replace(/\s+as\s+[A-Za-z_$][\w$.]*(?:<[^>]*>)?(?:\[\])?\s*$/, '')
    .replace(/[},\s]+$/, '')
    .replace(/\s+/g, ' ')
    .replace(/\{\s+$/, '{}')
}

// 解析 props：/** jsdoc */ name: { … } 逐项——顶层键分割后逐键解析 type/default/required
function parseProps(block) {
  const out = []
  if (!block) return out
  // 条目正则：JSDoc 可选（无注释的 prop doc = —）
  const re = /(?:\/\*\*([\s\S]*?)\*\/\s*)?([A-Za-z_$][\w$]*)\s*:\s*\{/g
  const entries = []
  let m
  while ((m = re.exec(block))) entries.push({ doc: (m[1] ?? '').trim(), name: m[2], braceStart: m.index + m[0].length - 1, docStart: m.index })
  for (let k = 0; k < entries.length; k++) {
    const e = entries[k]
    const bodyEnd = k + 1 < entries.length ? entries[k + 1].docStart : block.length
    // 剥尾部：prop 自身「}」/ 项间逗号 / 外层「}」/「}）」——反复剥离直到尾部是内容字符
    let body = block.slice(e.braceStart, bodyEnd).replace(/^\{/, '')
    while (/[}\)\s,]+$/.test(body)) body = body.replace(/[}\)\s,]+$/, '')
    body += '\n'
    const keys = { type: '—', default: undefined, required: false }
    for (const part of splitTopLevel(body)) {
      const tm = part.match(/^\s*type:\s*([\s\S]+)$/)
      const dm = part.match(/^\s*default:\s*([\s\S]+)$/)
      const rm = part.match(/^\s*required:\s*([\s\S]+)$/)
      if (tm) keys.type = parseValue(tm[1])
      if (dm) keys.default = parseValue(dm[1])
      if (rm) keys.required = rm[1].trim() === 'true'
    }
    out.push({ name: e.name, doc: (e.doc || '').split('\n')[0] || '—', type: keys.type, default: keys.default, required: keys.required })
  }
  return out
}

function parseEmits(src) {
  const em = src.match(/defineEmits\((\[[\s\S]*?\]|\{[\s\S]*?\})\)/)
  if (!em) return []
  // ★颗粒度对齐 A（2026-09-11）：旧字符类 [a-zA-Z-] 不含 ':' → update:modelValue/update:visible/update:active/update:group
  //   等 13 个 v-model 事件全丢（8 个组件页整段 Events 消失）。改 [\w:-]（含 ':'）。
  const names = [...em[1].matchAll(/['"`]([a-zA-Z][\w:-]*)['"`]/g)].map((x) => x[1])
  return [...new Set(names)]
}

/**
 * ★颗粒度对齐 A：解析 emit 载荷（事件回调参数）——`emit('name', EXPR)` → name→EXPR（行级，取行尾最后一个 ')' 前）。
 * 供组件页 Events 表「载荷」列（对齐小程序「事件回调参数」粒度）。
 */
function parseEmitPayloads(src) {
  const out = {}
  for (const line of src.split('\n')) {
    const m = line.match(/\bemit\(\s*['"`]([^'"`]+)['"`]\s*(?:,\s*([\s\S]*))?\)\s*$/)
    if (!m) continue
    if (m[2] !== undefined) out[m[1]] = m[2].trim()
    else if (!(m[1] in out)) out[m[1]] = ''
  }
  // v-model 隐式载荷（update:xxx 常为表达式本身；无显式 emit 时留空）
  return out
}

/**
 * ★颗粒度对齐 A：解析组件模板插槽——`<slot>`（默认）/ `<slot name="x">`（具名）/ `<slot :prop="…">`（作用域）。
 * 供组件页「插槽」段（对齐小程序「插槽」）。
 */
function parseSlots(src) {
  const out = []
  const seen = new Set()
  for (const m of src.matchAll(/<slot\b([^>]*)>/g)) {
    const attrs = m[1]
    const nm = attrs.match(/\bname\s*=\s*["']([^"']+)["']/)
    const name = nm ? nm[1] : 'default'
    if (seen.has(name)) continue
    seen.add(name)
    const scopedProps = [...attrs.matchAll(/:([\w$]+)\s*=/g)].map((x) => x[1])
    out.push({ name, scoped: scopedProps.length > 0, props: scopedProps })
  }
  return out
}

// ★组件 tab 重构：提取组件源码头部的说明注释（「是做什么的」）
// 形态：<!-- <路径> —— <短描述>（批次）\n<设计注记行> -->
function extractComponentDesc(src) {
  const m = src.match(/^<!--[\s\S]*?-->/)
  if (!m) return { short: '', notes: [] }
  const lines = m[0]
    .replace(/^<!--/, '')
    .replace(/-->$/, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  // 首行：路径 —— 短描述（批次）
  const first = lines[0] ?? ''
  let short = first
  const dash = first.indexOf('——')
  if (dash >= 0) short = first.slice(dash + 2).trim()
  // 剥尾部批次括号（内部里程碑编号不对外）+ 剥首部集数编号（E20 等内部序号，与能力页剥 C\d+ 同理）
  short = short.replace(/（[^）]*）\s*$/, '').trim().replace(/^E\d+\s+/, '')
  const notes = lines.slice(1).filter((l) => !l.startsWith('packages/components'))
  return { short, notes }
}

// ★#406 颗粒度批：框架通用属性/事件说明（SSOT = 各组件 defineProps JSDoc；此处只收敛跨组件的公约属性——
//   pid/disabled/ariaLabel 等在 15+ 组件重复出现且无 JSDoc，公约说明此处写一次全站消费）
const COMMON_PROP_DOCS = {
  pid: '组件实例标识（调试/观测/测试定位用——D-2 dogfooding 契约）',
  disabled: '禁用态（禁交互 + 弱化视觉；MP 原生 disabled 透传）',
  ariaLabel: '无障碍标签（读屏器朗读文本）',
  visible: '是否可见（显隐由响应式数据驱动，零平台分支）',
  placeholder: '占位提示文本',
  value: '绑定值',
  text: '显示文本',
  position: '位置/方位',
  modelValue: '双向绑定值（v-model；MP 自定义组件 v-model 限制见 useInput 事件契约）',
  maxlength: '最大输入长度（≤ 0 = 不限）',
  focus: '自动聚焦',
  duration: '持续时间（ms）',
  title: '标题',
  type: '类型变体',
  mode: '模式/裁剪方式（各组件枚举见类型列）',
  height: '高度（px）',
  min: '最小值',
  max: '最大值',
  step: '步长',
  src: '资源地址（网络/本地/临时路径）',
  alt: '替代文本（图片加载失败/无障碍）',
  loading: '加载中状态',
  fixed: '是否固定定位（吸顶/吸底）',
  lazy: '懒挂载（首屏不渲染，首次滚动/可见才渲染）',
  lazyLoad: '懒加载（进入视口才加载资源）',
  virtual: '虚拟化开关（false = 全量渲染，小列表省切片开销）',
  itemHeight: '单项高度（px，虚拟窗口计算基准）',
  bufferSize: '可视区外缓冲行数（平滑滚动的提前量）',
  items: '数据项数组',
  selectable: '是否可选中文本',
  scrollX: '允许横向滚动',
  scrollY: '允许纵向滚动',
  scrollLeft: '横向滚动位置（px）',
  scrollTop: '纵向滚动位置（px）',
  lowerThreshold: '距底部多少 px 触发 scrolltolower 事件',
  refresherEnabled: '启用自定义下拉刷新',
  maskOpacity: '遮罩透明度（0-1）',
  mask: '是否显示遮罩',
  closeOnMask: '点遮罩是否关闭',
  closeOnTap: '点击后是否自动关闭',
  throttle: '点击节流间隔（ms，防重复触发——runtime 内置）',
  fallbackText: '加载失败/空态的兑底文案',
  avatar: '是否头部头像形状（骨架屏）',
  lines: '行数（骨架屏占位行数）',
  opacity: '透明度（0-1）',
  back: '是否显示返回按钮（仅 emit 事件，导航由页面自决——组件不直接调路由）',
  navigate: '点击导航后触发（载荷 { to, replace, switchTab }）',
}

// 通用事件说明（emit 名 → 说明；跨组件公约事件收敛于此，组件特有事件看各组件 JSDoc/实现要点）
const COMMON_EVENT_DOCS = {
  click: '点击/轻触（throttle 节流后触发）',
  input: '输入变化（载荷 { value } 跨端归一——MP 自定义组件 v-model 仅覆盖原生 input/textarea，故显式事件契约）',
  confirm: '键盘确认（回车/完成键）',
  focus: '获得焦点',
  blur: '失去焦点',
  change: '选中值变化',
  select: '选中某项',
  cancel: '取消/关闭',
  close: '关闭',
  load: '加载完成',
  error: '加载/执行失败',
  scroll: '滚动（eventScrollTop 归一：MP e.detail.scrollTop / Web e.target.scrollTop）',
  scrolltolower: '滚动到底部（lowerThreshold 触发）',
  refresh: '刷新触发',
  refresherrefresh: '自定义下拉刷新触发',
  'load-more': '加载更多（触底翻页）',
  drag: '拖拽中（gesture.draggable）',
  drop: '拖拽释放',
  submit: '表单提交',
  formChange: '表单项变化',
  back: '点击返回按钮（导航由页面自决——组件不直接调路由）',
}

// ★#406：常见能力参数说明兑底（自解释参数名的公约语义——与组件 COMMON_PROP_DOCS 同模式）
const COMMON_PARAM_DOCS = {
  url: '目标 URL（HTTPS）',
  onProgress: '进度回调（0-100；可省）',
  extensionId: '扩展/插件 ID（G-21 扩展点登记名）',
  prompt: '认证提示文案（原生系统 UI 展示）',
  productId: '内购商品 ID（应用商店登记）',
  provider: '服务提供方标识（wechat / web / 宿主自定义）',
  id: '地图实例 ID（多地图场景区分）',
  templateId: '订阅消息模板 ID（公众平台登记）',
  name: '权限名（web Permissions API 标准名）',
  phoneNumber: '电话号码',
  roomId: '直播间 ID',
  phone: '对方电话号码',
  message: '内容文本',
  protocols: 'WebSocket 子协议（可省）',
  durationMs: '震动时长（ms）',
  cb: '状态变化回调（返回取消订阅函数）',
  kind: '传感器类型（accelerometer 加速度计 / compass 罗盘 / gyroscope 陀螺仪）',
  options: '选项对象（字段见下表）',
}

// —— ① 组件页 ——
function genComponents(ir, ends) {
  fs.mkdirSync(OUT_COMP, { recursive: true })
  const semanticMap0 = ir.TAG_SEMANTIC_MAP ?? ir.SEMANTIC_TAG_MAP ?? {}
  // ★2026-09-10：只收录 **SSOT 已登记**的组件（TAG_SEMANTIC_MAP）——此前按目录扫描，
  //   会把编译器内部产物（如 p-svg-canvas：用户写 `<svg>` 由编译器生成，无人手写该标签，
  //   且不在 PRIMITIVE_CATALOG）也收录成「group: —」的空壳页。口径：**文档 ⇔ SSOT 登记**。
  const dirs = fs
    .readdirSync(COMP_DIR)
    .filter((d) => fs.statSync(path.join(COMP_DIR, d)).isDirectory() && d.startsWith('p-') && semanticMap0[d])
  const semanticMap = ir.TAG_SEMANTIC_MAP ?? ir.SEMANTIC_TAG_MAP ?? {}
  const mpComp = (ir.MP_MAPPING_MATRIX ?? []).filter((i) => i.group === 'component')
  // ★组件 tab 重构：tag → kind（域分类 SSOT = PRIMITIVE_CATALOG）
  const tagKind = {}
  for (const p of ir.PRIMITIVE_CATALOG) if (p.tag) tagKind[p.tag] = p.kind
  const KIND_DOMAIN = { layout: '布局', ui: '内容与表单', shell: '页面外壳', gesture: '手势', engineering: '工程', capability: '能力入口' }
  // ★#405：TAG_SEMANTIC_MAP 已全量登记 59 组件（catalog 同步 +9 条目），EXTRA_KIND 文档兑底退役
  //   域推导两级：catalog kind → semantic 前缀
  // ★侧栏/总览分组统一域推导：与单页同构（catalog kind → semantic 前缀）
  const DOMAIN_ORDER = ['布局', '内容与表单', '页面外壳', '手势', '工程', '能力入口', '—']
  const domainOf = {}
  for (const dir of dirs) {
    const vueFile = path.join(COMP_DIR, dir, 'index.vue')
    if (!fs.existsSync(vueFile)) continue
    const semantic = semanticMap[dir] ?? null
    const kind = tagKind[dir] ?? (semantic ? semantic.split('.')[0] : null) ?? '—'
    domainOf[dir] = KIND_DOMAIN[kind] ?? kind
  }
  // order = 域序 × 1000 + 域内字母序（侧栏组按 min(order) 排序 → 域顺序确定，组内字母序）
  const perDomain = {}
  const orderOf = {}
  for (const dir of Object.keys(domainOf).sort()) {
    perDomain[domainOf[dir]] = (perDomain[domainOf[dir]] ?? 0) + 1
    orderOf[dir] = DOMAIN_ORDER.indexOf(domainOf[dir]) * 1000 + perDomain[domainOf[dir]]
  }
  let ok = 0
  const indexRows = []
  for (const dir of dirs) {
    const vueFile = path.join(COMP_DIR, dir, 'index.vue')
    if (!fs.existsSync(vueFile)) continue
    const src = fs.readFileSync(vueFile, 'utf8')
    const props = parseProps(extractCall(src, 'defineProps') ?? '')
    const emits = parseEmits(src)
    const emitPayloads = parseEmitPayloads(src)
    const slots = parseSlots(src)
    const semantic = semanticMap[dir] ?? null
    const domain = domainOf[dir]
    // ★兼容进度表：MP_MAPPING_MATRIX.proteus 存的是语义名（'layout.box / layout.stack'）而非 p-* 目录名——
    //   旧代码 i.proteus === dir 永不命中（小程序等价列全灭），改语义包含匹配
    const mpMatches = semantic ? mpComp.filter((i) => i.proteus.split(' / ').some((s) => s.includes(semantic))) : []
    const mpLabel = (i) => `\`${i.mp}\`（${MP_STATUS_LABEL[i.status] ?? i.status}）`
    const mpText = mpMatches.slice(0, 4).map(mpLabel).join(' · ') + (mpMatches.length > 4 ? ` 等 ${mpMatches.length} 项` : '')
    const mpEquiv = mpMatches.length ? mpText : '—'
    // ★组件 tab 重构：h1 后输出组件自身说明（源码头注释 SSOT），替换千篇一律的通用语
    const desc = extractComponentDesc(src)
    const lines = []
    lines.push('---')
    lines.push(`title: ${dir}`)
    lines.push(`group: ${domain}`)
    lines.push(`order: ${orderOf[dir]}`)
    lines.push('---')
    lines.push('')
    lines.push(`# ${dir}`)
    lines.push('')
    lines.push(desc.short || '通用语义组件（Layer 0），编译期映射到各端原生控件，业务零平台分支。')
    lines.push('')
    lines.push(`> 语义组件（Layer 0）· 域 **${domain}** · 编译期映射到各端原生控件，业务零平台分支。`)
    lines.push('')
    lines.push('| 语义 | 域 | 小程序等价 |')
    lines.push('|---|---|---|')
    lines.push(`| ${semantic ?? '—'} | ${domain} | ${mpEquiv} |`)
    lines.push('')
    // ★兼容进度（uni-app 式全端对照）：端列/状态 = ENDS 注册表 SSOT，小程序行注入真实映射
    const compRows = []
    for (const end of ends) {
      let note = ''
      switch (end.id) {
        case 'web': note = '双端同源码编译目标（编译期映射 + 事件归一）'; break
        case 'mp-weixin': note = mpMatches.length ? `原生控件映射 → ${mpText}` : 'Proteus 扩展组件——无小程序对应'; break
        case 'headless': note = 'IR 渲染测试档（工具端）'; break
        case 'flutter': note = 'widget 级映射——组件级未验证'; break
        case 'quick-app': note = '端未开始'; break
        default: note = '渲染核心已落地——组件级接线未开始'
      }
      compRows.push({ name: end.name, status: STATUS_MARK[end.status] ?? '⬜', note: `${end.engine} · ${note}` })
    }
    lines.push(...compatSection(compRows, '> 状态口径：✅ 端已落地·本组件可用；🟡 组件级接线未开始；⬜ 端未开始。端架构对照（引擎 / 运行时 / 持久化）见 [端与成熟度](/docs/framework/ends-matrix)。'))
    if (props.length) {
      lines.push('## Props')
      lines.push('')
      lines.push('| 属性 | 说明 | 类型 | 默认值 | 必填 |')
      lines.push('|---|---|---|---|---|')
      for (const p of props) {
        // 说明：源码 JSDoc 优先，公约属性兑底（COMMON_PROP_DOCS——pid/disabled 等跨组件公约语义）；escMd 防描述/默认值竖线断列
        const doc = p.doc !== '—' ? p.doc : COMMON_PROP_DOCS[p.name] ?? '—'
        lines.push(`| \`${p.name}\` | ${escMd(oneline(doc))} | \`${escMd(p.type)}\` | ${p.default ? `\`${escMd(p.default)}\`` : p.required ? '**是**' : '—'} | ${p.required ? '**是**' : '否'} |`)
      }
      lines.push('')
      // ★颗粒度对齐 B（2026-09-11）：逐属性详解（对齐小程序「属性」粒度——每属性一段：类型/默认值/必填/说明）
      lines.push('### 属性详解')
      lines.push('')
      for (const p of props) {
        const pd = p.doc !== '—' ? p.doc : COMMON_PROP_DOCS[p.name] ?? '—'
        lines.push(`#### \`${p.name}\``)
        lines.push('')
        lines.push(`- **类型**：\`${escMd(p.type)}\`　**默认值**：${p.default ? `\`${escMd(p.default)}\`` : '—'}　**必填**：${p.required ? '是' : '否'}`)
        lines.push(`- **说明**：${escMd(pd)}`)
        lines.push('')
      }
    }
    if (emits.length) {
      lines.push('## Events')
      lines.push('')
      lines.push('| 事件 | 说明 | 载荷 |')
      lines.push('|---|---|---|')
      // v-model 事件说明兜底（update:* → 双向绑定语义）
      const vmDoc = (e) => {
        const m = e.match(/^update:(.+)$/)
        if (!m) return null
        const field = m[1] === 'modelValue' ? 'v-model 值' : `\`${m[1]}\``
        return `v-model 双向绑定：${field}变化时触发（同步父级绑定）`
      }
      for (const e of emits) {
        const doc = COMMON_EVENT_DOCS[e] ?? vmDoc(e) ?? '—'
        const payload = emitPayloads[e]
        lines.push(`| \`${e}\` | ${escMd(doc)} | ${payload ? `\`${escMd(payload)}\`` : '—'} |`)
      }
      lines.push('')
      // ★颗粒度对齐 B：逐事件详解（对齐小程序「事件」粒度——每事件一段：说明 + 载荷）
      lines.push('### 事件详解')
      lines.push('')
      for (const e of emits) {
        const doc = COMMON_EVENT_DOCS[e] ?? vmDoc(e) ?? '—'
        const payload = emitPayloads[e]
        lines.push(`#### \`${e}\``)
        lines.push('')
        lines.push(`- **说明**：${escMd(doc)}`)
        lines.push(`- **载荷**：${payload ? `\`${escMd(payload)}\`` : '无'}${e.startsWith('update:') ? '（v-model 隐式：值本身）' : ''}`)
        lines.push('')
      }
    }
    // ★颗粒度对齐 A（2026-09-11）：插槽段（对齐小程序「插槽」——默认/具名/作用域）
    if (slots.length) {
      lines.push('## 插槽')
      lines.push('')
      lines.push('| 插槽 | 说明 |')
      lines.push('|---|---|')
      for (const sl of slots) {
        const label = sl.name === 'default' ? 'default' : `\`${sl.name}\``
        let doc
        const scopedNote = `作用域参数：${sl.props.map((x) => `\`${x}\``).join('、')}`
        if (sl.name === 'default') doc = sl.scoped ? `默认插槽（作用域参数：${sl.props.map((x) => `\`${x}\``).join('、')}）` : '默认插槽（组件主内容）'
        else if (sl.scoped) doc = `具名 + 作用域插槽（${scopedNote}）`
        else doc = '具名插槽'
        lines.push(`| ${label} | ${doc} |`)
      }
      lines.push('')
    }
    // ★组件 tab 重构：源码头注释的设计注记 → 「实现要点」段（无则跳过）
    if (desc.notes.length) {
      lines.push('## 实现要点')
      lines.push('')
      for (const n of desc.notes) lines.push(`- ${n}`)
      lines.push('')
    }
    lines.push('## 用法')
    lines.push('')
    lines.push('```vue')
    lines.push(...buildComponentUsage(dir, props, emits, slots))
    lines.push('```')
    lines.push('')
    lines.push(`<!-- generated by website/scripts/gen-content.mjs · 源码 SSOT：packages/components/${dir}/index.vue -->`)
    writeDoc(path.join(OUT_COMP, `${dir}.md`), lines.join('\n'))
    indexRows.push({ dir, props: props.length, emits: emits.length, domain })
    ok++
  }
  // ★组件 tab 重构：总览按语义域分组（域来自与单页同构的统一推导，「—」组已归位）
  const byDomain = {}
  for (const r of indexRows) (byDomain[r.domain] ??= []).push(r)
  const idx = []
  idx.push('---')
  idx.push('title: 组件总览')
  idx.push('group: 总览')
  idx.push('order: 0')
  idx.push('---')
  idx.push('')
  idx.push('# 组件总览')
  idx.push('')
  idx.push(`> ${ok} 个语义组件（${Object.keys(byDomain).length} 域）——props/events 由源码 SSOT 生成（\`website/scripts/gen-content.mjs\`），与框架实现实时一致。`)
  idx.push('')
  for (const domain of Object.keys(byDomain).sort((a, b) => DOMAIN_ORDER.indexOf(a) - DOMAIN_ORDER.indexOf(b))) {
    idx.push(`## ${domain}（${byDomain[domain].length}）`)
    idx.push('')
    idx.push('| 组件 | Props | Events |')
    idx.push('|---|---|---|')
    for (const r of byDomain[domain].sort((a, b) => a.dir.localeCompare(b.dir))) {
      idx.push(`| [${r.dir}](/docs/component/${r.dir}) | ${r.props} | ${r.emits} |`)
    }
    idx.push('')
  }
  writeDoc(path.join(OUT_COMP, '00-components-overview.md'), idx.join('\n'))
  // ★2026-09-26 组件总览画廊：同源数据再产出结构化索引（组件总览页的卡片画廊消费——
  //   与 md 总览同一 indexRows，props/events 与源码实时一致；官网重做 https 参考样式）。
  emitComponentIndex(byDomain, ok, DOMAIN_ORDER)
  return ok
}

/** 组件总览画廊的结构化索引（website/src/data/component-index.ts；zh 域分组 + EN 域名，同源 SSOT） */
function emitComponentIndex(byDomain, total, DOMAIN_ORDER) {
  const domains = Object.keys(byDomain)
    .sort((a, b) => DOMAIN_ORDER.indexOf(a) - DOMAIN_ORDER.indexOf(b))
    .map((domain) => ({
      key: domain,
      en: DOMAIN_EN[domain] ?? domain,
      components: byDomain[domain]
        .sort((a, b) => a.dir.localeCompare(b.dir))
        .map((r) => ({ dir: r.dir, props: r.props, emits: r.emits })),
    }))
  const ts = [
    '// 由 website/scripts/gen-content.mjs 生成（勿手改）——组件总览画廊的结构化索引。',
    '// SSOT：packages/components/*/index.vue 的 defineProps/defineEmits（与 md 总览同一 indexRows）。',
    `export interface ComponentIndexEntry { dir: string; props: number; emits: number }`,
    `export interface ComponentIndexDomain { key: string; en: string; components: ComponentIndexEntry[] }`,
    `export interface ComponentIndex { total: number; domains: ComponentIndexDomain[] }`,
    '',
    `export const componentIndex: ComponentIndex = ${JSON.stringify({ total, domains }, null, 2)}`,
    '',
  ].join('\n')
  const dataDir = path.join(ROOT, 'website', 'src', 'data')
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(path.join(dataDir, 'component-index.ts'), ts)
}

// —— ② 能力页 ——
// ★#481 数据准备抽共享（zh 路径行为不变——同一函数输出必须与重构前逐字节一致）：zh 与 EN pass 同源
function capContext(ir) {
  const caps = ir.PRIMITIVE_CATALOG.filter((p) => p.kind === 'capability')
  // ★★★#1122：**新抽出的文件也必须进源集合**——否则接口解析找不到它们，
  //   能力页会静默退化成"没有参数表/返回值表"（本轮实测：fetch.md 被生成器**删掉 38 行**）。
  //   ★这是"拆文件"的连带义务：拆分不只是移动代码，还要同步所有**靠文本扫描**的下游。
  const API_SRC_FILES = [
    'capability-types.ts', 'capability.ts', 'capability-bridges.ts',
    // #1122 抽出（网络能力专属）：类型 / 门面实现 / 两端腿 / App 腿
    'capability-fetch-types.ts', 'capability-fetch.ts', 'capability-fetch-legs.ts', 'capability-app-request.ts',
    // ★#1122：**通道层也有 fetch.* 错误码**（取消 `fetch.aborted` / 超时 `fetch.timeout` 在
    //   `capability-invoke.ts` 里抛）⇒ 错误码表的「全文件扫描」必须覆盖它，否则官网只列出 1 条。
    'capability-invoke.ts',
  ]
  let apiSrc = API_SRC_FILES.map((f) => fs.readFileSync(path.join(ROOT, 'packages', 'api', 'src', f), 'utf8')).join('\n') // ★#876 三文件拼接（#870 拆分）；types 在前——下游 bridgeIface=slice(CapabilityBridge,CapabilityHooks) 靠此序
  // ★★类型别名解析（2026-09-30）：句柄类型已**收口**到 `capability-app.ts`（单一事实源），
  //   `capability.ts` 里只剩 `export type AppLifecycle = AppLifecycleHandle` 这类别名 ⇒
  //   只解析本文件会**抽不到方法列表**（页面会显示旧方法集——用户实测"搜不到新事件"即此形态）。
  //   ⇒ 把所有 `export type X = Y` 解析成 `export interface X { ...原 Y 的接口体... }` 内联进来，
  //     供既有行级解析器继续工作（不改解析器，只补数据源）。
  const appSrchPath = path.join(ROOT, 'packages', 'api', 'src', 'capability-app.ts')
  if (fs.existsSync(appSrchPath)) {
    const appSrc = fs.readFileSync(appSrchPath, 'utf8')
    const aliasRe = /export type (\w+) = (\w+)\n/g
    let am
    while ((am = aliasRe.exec(apiSrc))) {
      const [, alias, target] = am
      // 在 capability-app.ts 里找 `export interface <target> {` 的接口体
      const ifaceRe = new RegExp(`export interface ${target}[^{]*{`)
      const im = ifaceRe.exec(appSrc)
      if (!im) continue
      const bodyStart = im.index + im[0].length
      let depth = 1
      let i = bodyStart
      while (i < appSrc.length && depth > 0) {
        if (appSrc[i] === '{') depth++
        else if (appSrc[i] === '}') depth--
        i++
      }
      const body = appSrc.slice(bodyStart, i - 1)
      // 用等价 interface 替换别名（保留别名导出语义：生成器只读不执行）
      apiSrc = apiSrc.replace(am[0], `export interface ${alias} {${body}}
`)
    }
  }
  // ★平台桥成员集 = 手写桥（wxBridge/webBridge）∪ 声明式桥（generated/bridge-ext.ts）
  //   ——运行时由 capability.ts 的 createCapabilityBridge **真实 spread 并集**（漏抽曾致 8 格误标 ⚠️）
  const extPath = path.join(ROOT, BRIDGE_EXT_REL_PATH)
  if (!fs.existsSync(extPath)) throw new Error(`[gen-content] 找不到声明式桥生成物：${extPath}（先跑 node scripts/gen-bridge-ext.mjs）`)
  const bridgeKeys = extractBridgeKeys(apiSrc, fs.readFileSync(extPath, 'utf8'))
  if (bridgeKeys.misses.length) throw new Error(`[gen-content] 平台桥成员集解析失败（数据源契约被破坏）：${bridgeKeys.misses.join('；')}`)
  const { wxKeys, webKeys } = bridgeKeys
  const ifaces = extractInterfaces(apiSrc)
  // ★颗粒度对齐 A（2026-09-11）：旧 spread 让 webBridge 同名方法覆盖 wxBridge → 丢 wx 原生错误码（network/orientation/device…）。
  //   改 per-method **并集**（同名两段都保留，错误码提取两源皆扫）。
  const wxBodies = extractBridgeBodies(apiSrc, 'wxBridge')
  const webBodies = extractBridgeBodies(apiSrc, 'webBridge')
  const bridgeBodies = {}
  for (const k of new Set([...Object.keys(wxBodies), ...Object.keys(webBodies)])) {
    bridgeBodies[k] = [wxBodies[k], webBodies[k]].filter(Boolean).join('\n')
  }
  const iface = apiSrc.slice(apiSrc.indexOf('export interface CapabilityHooks'))
  const hookDocs = {}
  const JSDOC = '\\*\\*((?:[^*]|\\*(?!/))*)\\*\\/'
  const re = new RegExp(`${JSDOC}\\s*\\n\\s*(use[A-Z]\\w*|set[A-Z]\\w*)\\(`, 'g')
  let m
  const cleanDoc = (t) => normalizeJsdoc(t) // ★保留行结构（表格块需要空行分隔——见 normalizeJsdoc）
  while ((m = re.exec(iface))) hookDocs[m[2]] = cleanDoc(m[1])
  const hooksBody = apiSrc.slice(apiSrc.indexOf('export function createCapabilityHooks'))
  const reLine = /\/\/\s*(.+?)\s*\n\s*(use[A-Z]\w*|set[A-Z]\w*):/g
  while ((m = reLine.exec(hooksBody))) if (!hookDocs[m[2]]) hookDocs[m[2]] = m[1].trim()
  const bridgeIface = apiSrc.slice(apiSrc.indexOf('export interface CapabilityBridge'), apiSrc.indexOf('export interface CapabilityHooks'))
  const bridgeDocs = {}
  const reBridge = new RegExp(`${JSDOC}\\s*\\n\\s*(\\w+)\\??\\s*\\(`, 'g')
  while ((m = reBridge.exec(bridgeIface))) bridgeDocs[m[2]] = cleanDoc(m[1])
  // ★refs：锚定式解析（原语 lib/ts-source-scan.mjs；旧盲区两条见 lib/hook-bridge-refs.mjs 头注释）
  const { refs: hookRefs, misses: refMisses } = extractHookBridgeRefs(apiSrc, HOOK_FACTORY)
  if (refMisses.length) throw new Error(`[gen-content] hook→bridge refs 解析失败：${refMisses.join('；')}`)
  for (const [hook, refs] of Object.entries(hookRefs)) {
    if (hookDocs[hook]) continue
    if (refs[0] && bridgeDocs[refs[0]]) hookDocs[hook] = bridgeDocs[refs[0]].replace(/^C\d+\s+/, '')
  }
  const catOf = {}
  for (const c of caps) {
    const slug = c.semantic.replace('capability.', '')
    catOf[c.semantic] = CAP_CATEGORY[slug] ?? '其他'
  }
  const perCat = {}
  const orderOfCap = {}
  for (const c of caps) {
    perCat[catOf[c.semantic]] = (perCat[catOf[c.semantic]] ?? 0) + 1
    orderOfCap[c.semantic] = CAP_CAT_ORDER.indexOf(catOf[c.semantic]) * 1000 + perCat[catOf[c.semantic]]
  }
  return { caps, wxKeys, webKeys, ifaces, bridgeBodies, iface, hookDocs, hooksBody, hookRefs, catOf, orderOfCap, apiSrc }
}

function genCapabilities(ir, ends) {
  fs.mkdirSync(OUT_CAP, { recursive: true })
  const { caps, wxKeys, webKeys, ifaces, bridgeBodies, iface, hookDocs, hooksBody, hookRefs, catOf, orderOfCap, apiSrc } = capContext(ir)
  // ★#1088：示例表的单一 SSOT = website/scripts/lib/cap-usage.mjs（中英同源；本文件不再内联手写表）

  // 纯数据/void 型 hook 的参数典型值（SSOT = 签名；句柄型走 USAGE_EXAMPLES 不经此表）
  const CAP_ARGS = {
    useVibrate: '30',
    useShare: "{ title: 'Proteus 跨端框架', url: 'https://proteus-vue.cn' }",
    setClipboard: "'要复制的文本'",
    usePermission: "'geolocation'",
    useSensor: "'accelerometer'",
    setBrightness: '0.8',
    usePhoneCall: "'10086'",
    usePayment: "{ timeStamp: '1725600000', nonceStr: 'a1b2c3d4', package: 'prepay_id=wx2501010001', paySign: 'SIGN' }",
    useLogin: "'wechat'",
    useUpload: "{ url: 'https://api.example.com/upload', filePath }",
    useDownload: "'https://cdn.example.com/pkg.apk', { responseType: 'path' }",
    useNotification: "'tmpl-123456'",
    useCalendar: "{ title: '项目周会', startTime: Date.now() + 3600000 }",
    useArchive: "{ src: 'wxfile://tmp/photo.jpg', quality: 80 }",
    useSMS: "'10086', '您的验证码是 1234'",
    useFaceID: "'验证本人操作'",
    useInAppPurchase: "'com.example.premium'",
    useExtension: "'com.acme.exporter'",
  }
  // 成功分支的 data 用法行（按返回类型给真实字段访问——替换千篇一律的 console.log(res.data)）
  const CAP_DATA_HINTS = {
    useLocation: ['  const { latitude, longitude } = res.data'],
    useNetwork: ["  console.log(res.data.online ? '在线' : '离线', res.data.type)"],
    useClipboard: ['  console.log(\'剪贴板内容:\', res.data)'],
    useQRCode: ['  console.log(\'扫码结果:\', res.data)'],
    useBiometric: ['  if (res.data) console.log(\'设备支持生物识别\')'],
    useBrightness: ['  console.log(\'当前亮度:\', res.data)'],
    useFaceID: ['  if (res.data) console.log(\'人脸认证通过\')'],
    useContact: ['  console.log(\'联系人:\', res.data.map((c) => c.name))'],
    useLogin: ['  console.log(\'登录渠道:\', res.data.provider, res.data.code ?? res.data.token ?? \'\')'],
    useUpload: ['  console.log(\'上传完成:\', res.data.status, res.data.progress ?? 100)'],
    useDownload: ['  console.log(\'下载完成:\', res.data.status, res.data.path ?? \'(blob/text)\')'],
    usePayment: ['  console.log(\'支付:\', res.data.provider, res.data.transactionId ?? \'\')'],
    useInAppPurchase: ['  console.log(\'内购:\', res.data.productId, res.data.state)'],
    useSensor: ['  console.log(res.data.kind, res.data.x, res.data.y, res.data.z)'],
    useNotification: ['  console.log(\'订阅:\', res.data.templateId, \'授权:\', res.data.granted)'],
    useCamera: ['  console.log(\'摄像头:\', res.data.supported, \'授权:\', res.data.granted)'],
    useMicrophone: ['  console.log(\'麦克风:\', res.data.supported, \'授权:\', res.data.granted)'],
    useDevice: ['  console.log(res.data.platform, res.data.os, res.data.version)'],
    useScreen: ['  console.log(`${res.data.width}x${res.data.height} @${res.data.dpr}x`)'],
    useOrientation: ['  console.log(res.data.type, res.data.angle)'],
    useBattery: ['  console.log(`电量 ${(res.data.level * 100).toFixed(0)}%`, res.data.charging)'],
    useBluetooth: ['  console.log(\'蓝牙可用:\', res.data.available)'],
    useNFC: ['  console.log(\'NFC:\', res.data.supported, res.data.available)'],
    usePermission: ['  console.log(res.data.permission, res.data.state)'],
    useEmbedded: ['  console.log(\'宿主:\', res.data.provider)'],
    useExtension: ['  console.log(\'扩展返回:\', res.data)'],
  }
  let ok = 0
  for (const c of caps) {
    const hook = c.api.replace('()', '')
    const doc = (hookDocs[hook] ?? '').replace(/^C\d+\s+/, '')
    // ★#407：泛型支持（useFetch<T = unknown>(...)——名字与括号间有 <...>，旧正则 useFetch\( 永不命中 → 参数全丢）
    const sigM = iface.match(new RegExp(`${hook}(?:<[^>(]*>)?\\([^)]*\\):\\s*[^\\n]+`))
    const lines = []
    lines.push('---')
    lines.push(`title: ${hook}（${c.semantic}）`)
    lines.push(`group: ${catOf[c.semantic]}`)
    lines.push(`order: ${orderOfCap[c.semantic]}`)
    lines.push('---')
    lines.push('')
    lines.push(`# ${hook}`)
    lines.push('')
    lines.push(...capabilityIntro(c, { en: false }))   // ★#1084 先答"能做什么"，技术标识行后移
    if (doc) {
      lines.push(doc)
      lines.push('')
    }
    lines.push('## 签名')
    lines.push('')
    lines.push('```ts')
    lines.push(sigM ? sigM[0] : `${c.api} → ${c.props?.[0] ?? 'Result<T>'}`)
    lines.push('```')
    lines.push('')
    // ★#406 颗粒度批：参数表 + 返回值属性表 + 错误码表（对齐小程序文档颗粒度，SSOT = capability.ts 接口 JSDoc）
    const refs = hookRefs[hook] ?? []
    const sigLine = sigM ? sigM[0] : ''
    const paramM = sigLine.match(/\(([^)]*)\)/)
    const params = []
    if (paramM && paramM[1].trim()) {
      for (const raw of paramM[1].split(',')) {
        const pm = raw.trim().match(/^(\w+)(\?)?:\s*(.+)$/)
        if (pm) params.push({ name: pm[1], optional: pm[2] === '?', type: pm[3].trim() })
      }
    }
    if (params.length) {
      lines.push('## 参数')
      lines.push('')
      lines.push('| 参数 | 类型 | 必填 | 说明 |')
      lines.push('|---|---|---|---|')
      for (const p of params) {
        const t = p.type
        const ti = ifaces[t]
        const desc = oneline(ti?.doc) || COMMON_PARAM_DOCS[p.name] || '—'
        lines.push(`| \`${p.name}\` | \`${escMd(t)}\` | ${p.optional ? '否' : '是'} | ${desc} |`)
      }
      lines.push('')
      // 对象参数展开：属性表（对齐小程序「对象参数展开」粒度）
      for (const p of params) {
        const ti = ifaces[p.type]
        if (!ti || !ti.props.length) continue
        lines.push(`#### \`${p.name}\` 的属性`)
        lines.push('')
        lines.push('| 属性 | 类型 | 必填 | 说明 |')
        lines.push('|---|---|---|---|')
        for (const pr of ti.props) {
          lines.push(`| \`${pr.name}\` | \`${escMd(pr.type)}\` | ${pr.optional ? '否' : '是'} | ${pr.doc || '—'} |`)
        }
        lines.push('')
      }
    }
    // 返回值：三形态（★#490 hookShape 签名推导——Promise<CapResult<T>> 数据型 / Promise<CapResult<句柄>> 句柄型 / 同步句柄）
    const shape = hookShape(sigLine, ifaces)
    const dataT = shape.dataT
    const voidRet = shape.voidRet
    const handleT = shape.handleT
    lines.push('## 返回值')
    lines.push('')
    if (handleT) {
      lines.push(`返回 \`${handleT}\`（同步句柄——无 Promise、无 await，结构见下）。`)
      lines.push('')
    } else {
      // ★#1122：用**实际签名里的结果类型名**（CapResult / FetchResult …）——
      //   写死 CapResult 会让换了类型名的能力页文案与签名自相矛盾。
      const resultName = (sigLine.match(/(\w*Result)</) ?? [, 'CapResult'])[1]
      lines.push(`\`Promise<${resultName}<T>>\`——铁律：无回调、无 try/catch 义务，\`res.ok\` 分支处理：`)
      lines.push('')
      lines.push('| 属性 | 类型 | 说明 |')
      lines.push('|---|---|---|')
      lines.push(`| \`ok\` | \`boolean\` | 成功 \`true\` / 失败 \`false\` |`)
      // data 行说明：有属性结构 →（结构见下）；仅方法（句柄）→（方法结构见下）；数组 →（元素结构见下）
      const di = shape.dataIface
      const dataNote = dataT === 'T' ? '成功载荷——泛型，由响应内容推导（如 JSON 自动反序列化）'
        : voidRet ? '成功时无载荷'
        : `成功载荷${di?.props.length ? '（结构见下）' : di?.methods.length ? '（方法结构见下）' : ''}`
      lines.push(`| \`data\` | \`${dataT}\` | ${dataNote} |`)
      lines.push('| `error` | `CapError` | 失败时存在：`code`（机器码）/ `message`（人读原因）/ `cause`（原始异常） |')
      // ★#1122：结果类型若**比 Result<T> 多字段**（如 `FetchResult<T>` 还带 status/headers），
      //   必须把额外字段列出来——否则官网只写 ok/data/error，业务不知道能拿到状态码。
      //   来源：`<结果名>` 拆联合后取 `ok:true` 那一支的接口（`<名>Ok`）。
      // 命名约定：`FetchResult` → 成功支 `FetchOk`；`CapResult` → 无对应接口（基类形态）
      const baseName = resultName.replace(/Result$/, '')
      const okIface = ifaces[`${baseName}Ok`] ?? ifaces[`${resultName}Ok`] ?? ifaces[resultName]
      if (okIface?.props?.length) {
        for (const pr of okIface.props) {
          if (['ok', 'data'].includes(pr.name)) continue
          lines.push(`| \`${pr.name}\` | \`${escMd(pr.type)}\` | ${oneline(pr.doc) || '—'} |`)
        }
      }
      lines.push('')
    }
    // ★TOC 优化（2026-09-11）：方法/属性/类型引用提升为 h2 段，条目为 h3——右侧目录可直观看到有哪些方法
    //   汇总属性/方法（data 接口 + 句柄接口双通道合并）
    const allProps = [...(shape.dataIface?.props ?? [])]
    const allMethods = [...(shape.dataIface?.methods ?? [])]
    if (handleT && shape.handleIface) {
      for (const pr of shape.handleIface.props) {
        if (pr.type.includes('=>') || pr.type.startsWith('(')) continue // 函数类型属性（方法成员）
        allProps.push(pr)
      }
      allMethods.push(...shape.handleIface.methods)
    }
    // ## 方法（h2）——汇总表 + 每方法 h3 详解
    // ★★2026-09-30 用户反馈两点已落实：
    //   ①「说明放签名后面有点怪」+「有的有说明有的没有」⇒ 表改为 `方法 | 说明`（**签名移入 h3 详情**，
    //      那里本来就有完整签名块）；说明**优先取事件 meta**（SSOT）→ 全部方法都有说明，不再出现 `—`。
    //   ②「没有单独的兼容进度说明（方法级）」⇒ 生命周期句柄的表**加 End support 列**
    //      （MP/Web/App 三端是否触发——数据来自 meta 的三端来源字段），并有表下逐端详情。
    if (allMethods.length) {
      lines.push('## 方法')
      lines.push('')
      const isLifecycleHandle = handleT === 'PageLifecycle' || handleT === 'AppLifecycle'
      const docOf = (mm) => {
        const m = isLifecycleHandle ? eventMetaOf(handleT, mm.name, lifecycleMeta) : null
        return oneline(m?.doc || mm.doc || '').replace(/^C\d+\s+/, '')
      }
      if (isLifecycleHandle) {
        lines.push('| 方法 | 说明 | 端支持（MP / Web / App） |')
        lines.push('|---|---|---|')
        for (const mm of allMethods) {
          const m = eventMetaOf(handleT, mm.name, lifecycleMeta)
          lines.push(`| [\`${mm.name}\`](#${mm.name.toLowerCase()}) | ${docOf(mm) || '—'} | ${endSupportCell(m)} |`)
        }
      } else {
        lines.push('| 方法 | 说明 |')
        lines.push('|---|---|')
        for (const mm of allMethods) lines.push(`| [\`${mm.name}\`](#${mm.name.toLowerCase()}) | ${docOf(mm) || '—'} |`)
      }
      lines.push('')
      // 方法级兼容进度：逐事件列出各端真实来源（表列只给图标，这里给"到底走哪条路"）
      if (isLifecycleHandle) {
        const withMeta = allMethods.map((mm) => ({ mm, m: eventMetaOf(handleT, mm.name, lifecycleMeta) })).filter((x) => x.m)
        if (withMeta.length) {
          lines.push('### 方法级端支持（各端真实触发源）')
          lines.push('')
          for (const { mm, m } of withMeta) {
            const none = '无此事件'
            lines.push(`- \`${mm.name}\`：MP ${m.mp ? `\`${m.mp}\`` : `—（${none}）`} · Web ${m.web ? `\`${m.web}\`` : `—（${none}）`} · App ${m.app ? `\`${m.app}\`` : `—（${none}）`}${m.note ? ` — ${m.note}` : ''}`)
          }
          lines.push('')
        }
      }
      renderMethodDetails(lines, allMethods, { hLevel: '###', paramCols: ['参数', '类型', '必填', '说明', '否', '是'], returnsLabel: '返回值', descLabel: '说明' })
    }
    // ## 属性（h2）
    if (allProps.length) {
      lines.push('## 属性')
      lines.push('')
      lines.push('| 属性 | 类型 | 必填 | 说明 |')
      lines.push('|---|---|---|---|')
      for (const pr of allProps) lines.push(`| \`${pr.name}\` | \`${escMd(pr.type)}\` | ${pr.optional ? '否' : '是'} | ${oneline(pr.doc) || '—'} |`)
      lines.push('')
    }
    // ## 类型引用（h2）——签名/属性引用的接口展开为 h3
    const refTypeNames = collectRefTypes([...allMethods.map((m) => m.sig), ...allProps.map((p) => p.type)], ifaces)
    if (refTypeNames.length) {
      lines.push('## 类型引用')
      lines.push('')
      renderTypeRefsH2(lines, refTypeNames, ifaces)
    }
    // 错误码表：hook 条目切片 + 关联桥方法实现体中 CapError('code', 'msg') 全量提取
    const hookStart = hooksBody.indexOf(`${hook}:`)
    const hookEnd = (() => {
      const hits = [...hooksBody.matchAll(/\b(use[A-Z]\w*|set[A-Z]\w*):/g)]
      const hit = hits.find((h) => h.index === hookStart)
      const idx0 = hits.indexOf(hit)
      return idx0 >= 0 && idx0 + 1 < hits.length ? hits[idx0 + 1].index : hooksBody.length
    })()
    const errBodies = refs.map((r) => bridgeBodies[r]).filter((x) => typeof x === 'string')
    // ★颗粒度对齐 A（2026-09-11）：错误码补「全文件扫描」——源码 98 唯一 code，原只渲染 61（hook 体无字面 CapError 时 0 行）。
    //   纳入规则：scoped（hook 切片 + bridge 方法体）+ 全文件中「前缀 === 本能力 slug」的 code（helper 函数体/throw 亦覆盖）。
    const capSlug = c.semantic.replace('capability.', '')
    const allErrCodes = extractErrorCodes(apiSrc)
    const scopedCodes = extractErrorCodes([hooksBody.slice(hookStart, hookEnd), ...errBodies].join('\n'))
    const errCodes = [...scopedCodes]
    for (const ec of allErrCodes) {
      if (errCodes.some((e) => e.code === ec.code)) continue
      if (ec.code.split('.')[0] === capSlug) errCodes.push(ec)
    }
    if (errCodes.length) {
      lines.push('## 错误码')
      lines.push('')
      lines.push('| code | 说明 |')
      lines.push('|---|---|')
      for (const e of errCodes) lines.push(`| \`${e.code}\` | ${e.message} |`)
      lines.push('')
      lines.push('> 平台不支持 → `*.unsupported` 族；业务按 code 分支处理，无需 try/catch。')
      lines.push('')
    }
    // ★兼容进度（uni-app 式全端对照）：端列/状态 = ENDS 注册表；判定逻辑与总览汇总**同源**（#1089）
    const endStatuses = capabilityEndStatuses({
      ends, refs, mpEquiv: c.mpEquiv, wxKeys, webKeys, root: ROOT, capSlug,
      appBridgeKeys: APP_BRIDGE_KEYS, pushCapabilities: PUSH_CAPABILITIES, verified: HOST_RUNTIME_VERIFIED_CAPS,
    })
    const capRows = ends.map((end) => ({ name: end.name, status: endStatuses[end.id].status, note: `${end.engine} · ${endStatuses[end.id].note}` }))
    lines.push(...compatSection(capRows, CAP_LEGEND_ZH))
    lines.push('> 铁律：能力原语全部返回 `Result<T>`（无回调 / 无全局对象）；平台不支持 → `Err` 显式降级，业务零平台分支。')
    lines.push('')
    // ★官网漏修：扩展接口段（该能力的额外 hook——富操作句柄）
    const extraHooks = CAP_EXTRA_HOOKS[c.semantic] ?? []
    if (extraHooks.length) {
      lines.push('## 扩展接口')
      lines.push('')
      lines.push(`除主 hook \`${hook}\` 外，本能力还提供以下操作接口：`)
      lines.push('')
      for (const eh of extraHooks) {
        const ehSig = iface.match(new RegExp(`${eh}(?:<[^>(]*>)?\\([^)]*\\):\\s*[^\\n]+`))
        lines.push(`### \`${eh}\``)
        lines.push('')
        if (ehSig) {
          lines.push('```ts')
          lines.push(ehSig[0].trim())
          lines.push('```')
          lines.push('')
          // ★颗粒度对齐 A：扩展接口**参数表**（原只渲染签名+返回结构，输入参数 0 文档）
          const ehParamM = ehSig[0].match(/\(([^)]*)\)/)
          const ehArgs = ehParamM ? parseSigArgs(ehParamM[1]) : []
          if (ehArgs.length) {
            lines.push('| 参数 | 类型 | 必填 | 说明 |')
            lines.push('|---|---|---|---|')
            for (const a of ehArgs) lines.push(`| \`${a.name}\` | \`${escMd(a.type || '—')}\` | ${a.optional ? '否' : '是'} | ${autoParamDoc(a)} |`)
            lines.push('')
          }
        }
        // 句柄方法表（返回的接口结构）——★TOC 优化：属性 h4、方法逐个 h4（进目录）
        const ehShape = hookShape(ehSig ? ehSig[0] : '', ifaces)
        const ehIface = ehShape.dataIface || ehShape.handleIface
        const ehT = ehShape.dataElemT || ehShape.handleT
        if (ehIface && (ehIface.props.length || ehIface.methods.length)) {
          if (ehIface.props.length) {
            lines.push(`#### \`${ehT}\` 的属性`)
            lines.push('')
            lines.push('| 属性 | 类型 | 必填 | 说明 |')
            lines.push('|---|---|---|---|')
            for (const pr of ehIface.props) lines.push(`| \`${pr.name}\` | \`${escMd(pr.type)}\` | ${pr.optional ? '否' : '是'} | ${oneline(pr.doc) || '—'} |`)
            lines.push('')
          }
          if (ehIface.methods.length) {
            lines.push(`#### \`${ehT}\` 的方法`)
            lines.push('')
            lines.push('| 方法 | 签名 | 说明 |')
            lines.push('|---|---|---|')
            for (const mm of ehIface.methods) lines.push(`| \`${mm.name}\` | \`${escMd(mm.sig)}\` | ${oneline(mm.doc) || '—'} |`)
            lines.push('')
            renderMethodDetails(lines, ehIface.methods, { hLevel: '####', paramCols: ['参数', '类型', '必填', '说明', '否', '是'], returnsLabel: '返回值', descLabel: '说明' })
            const erefs = collectRefTypes(ehIface.methods.map((m) => m.sig), ifaces)
            renderTypeRefs(lines, erefs, ifaces, { hLevel: '####', label: '类型引用', cols: ['属性/方法', '类型', '说明'] })
          }
        }
      }
    }
    lines.push('## 用法')
    lines.push('')
    lines.push('```ts')
    const zhUsage = usageOf(hook, 'zh')
    if (zhUsage) {
      // 句柄型/旗舰 hook 手写示例（值取典型场景——参数契约以「参数」表为准）
      lines.push(...zhUsage)
    } else if (handleT) {
      // 同步句柄兑底：无 Promise 无 res.ok——按返回值结构用
      const lv = (hook.replace(/^use/, '') || 'handle').charAt(0).toLowerCase() + hook.replace(/^use/, '').slice(1)
      lines.push(`const ${lv} = ${c.api}`)
      lines.push(`// ${handleT} 同步句柄——无 await、无 res.ok（方法/属性结构见「返回值」表）`)
    } else {
      // 数据/void 型：真实参数值（CAP_ARGS）+ 按返回类型的 data 用法行（CAP_DATA_HINTS）
      const required = params.filter((p) => !p.optional).map((p) => p.name)
      const args = CAP_ARGS[hook] ?? required.join(', ')
      const call = c.api.replace('()', `(${args})`)
      lines.push(`const res = await ${call}`)
      lines.push('')
      lines.push('if (res.ok) {')
      if (CAP_DATA_HINTS[hook]) lines.push(...CAP_DATA_HINTS[hook])
      else if (voidRet) lines.push('  // 调用成功（void 无载荷）')
      else lines.push('  console.log(res.data)')
      lines.push("} else if (res.error.code.endsWith('.unsupported')) {")
      lines.push('  // 平台不支持 → 降级路径')
      lines.push('}')
    }
    lines.push('```')
    lines.push('')
    // ★★平台特有专栏（用户反馈第 4 点）：仅在生命周期能力页渲染（话题表按端分组）
    //   ★设计：内容是**交叉引用**（话题 → 该用哪个能力），不另写一套说明——避免 C23/C25 那样的重复
    // ★平台专栏按**能力**取（PLATFORM_TOPICS[slug]）——数据驱动：有专栏就渲染（初版写死三页 + 全局表 = 内容相同，已修）
    renderPlatformTopics(lines, c.semantic.replace('capability.', ''), lifecycleMeta, HOOK_TO_SLUG, HOOK_STATUS, 'zh')
    lines.push('<!-- generated by website/scripts/gen-content.mjs · 源码 SSOT：packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->')
    writeDoc(path.join(OUT_CAP, `${c.semantic.replace('capability.', '')}.md`), lines.join('\n'))
    ok++
  }
  const idx = []
  idx.push('---')
  idx.push('title: 能力总览')
  idx.push('group: 总览')
  idx.push('order: 0')
  idx.push('---')
  idx.push('')
  idx.push('# 能力总览')
  idx.push('')
  idx.push(`> ${caps.length} 个能力原语——SSOT = \`PRIMITIVE_CATALOG\`（capability kind）+ \`CapabilityHooks\` 接口。**Hook 全部已实现**（API 就绪，双端桥/降级见各页兼容进度表）`)
  idx.push('')
  // ★#1089 全端兼容进度（用户需求：让开发者一目了然"目前全端能用到哪"）
  const cov = capabilityCoverage({
    caps, ends, hookRefs, wxKeys, webKeys, catOf, capOrder: CAP_CAT_ORDER,
    root: ROOT, appBridgeKeys: APP_BRIDGE_KEYS, pushCapabilities: PUSH_CAPABILITIES, verified: HOST_RUNTIME_VERIFIED_CAPS,
  })
  renderCoverage(idx, cov, {
    h2: '## 全端兼容进度',
    intro: '> 数字来自**源码事实**（与各能力页「兼容进度」表同一份判定）：✅ 直接可用 · ⚠️ 端已落地但桥未提供 → 调用返回 `*.unsupported` 显式降级 · 🟡 能力桥未接线 · ⬜ 端未开始（含"规划已入库"）。**覆盖率 = ✅ / 能力总数**——⚠️ 不计入覆盖，因为业务拿到的是 Err。',
    cols: '| 端 | ✅ 直接可用 | ⚠️ 需降级 | 🟡 未接线 | ⬜ 未开始 | 覆盖率 |',
    h3: '### 按类别（✅ / 该类总数）',
    catIntro: '> 横看一行 = 某个能力域在各端的落地程度；纵看一列 = 某端最薄弱的域。分母 = 该类别能力数。',
    catCols: '| 类别 | ' + ends.map((e) => e.name).join(' | ') + ' |',
    endName: (r) => r.name,
    catName: (c) => c,
  })
  // ★能力总览按类别分组（与侧栏分组同构，#403）
  const byCat = {}
  for (const c of caps) (byCat[catOf[c.semantic]] ??= []).push(c)
  for (const cat of Object.keys(byCat).sort((a, b) => CAP_CAT_ORDER.indexOf(a) - CAP_CAT_ORDER.indexOf(b))) {
    idx.push(`## ${cat}（${byCat[cat].length}）`)
    idx.push('')
    idx.push('| # | 能力 | API | 返回 | 小程序等价 |')
    idx.push('|---|---|---|---|---|')
    for (const c of byCat[cat]) {
      const slug = c.semantic.replace('capability.', '')
      idx.push(`| ${c.id} | [${c.semantic}](/docs/capability/${slug}) | \`${c.api}\` | \`${(c.props ?? [])[0] ?? '—'}\` | ${c.mpEquiv} |`)
    }
    idx.push('')
  }
  writeDoc(path.join(OUT_CAP, '00-capabilities-overview.md'), idx.join('\n'))
  return ok
}

// —— ①-EN 组件 overlay（★#481 生成器双语输出——zh 路径零改动，EN 变体由 COMP_EN 字段驱动） ——
// 对 COMP_EN 登记的 slug 额外产出 website/en/components/<slug>.md：文案全部取 EN 字段（desc/notes/props/events），
// 未登记的组件在英文态走 #noEn 回退（诚实降级，不混排中文）。
async function genComponentsEn(ir, ends) {
  const OUT = path.join(ROOT, 'website', 'en', 'components')
  const semanticMap = ir.TAG_SEMANTIC_MAP ?? ir.SEMANTIC_TAG_MAP ?? {}
  // 同 zh：只收录 SSOT 已登记组件（排除编译器内部产物如 p-svg-canvas）
  const dirs = fs
    .readdirSync(COMP_DIR)
    .filter((d) => fs.statSync(path.join(COMP_DIR, d)).isDirectory() && d.startsWith('p-') && semanticMap[d])
  const mpComp = (ir.MP_MAPPING_MATRIX ?? []).filter((i) => i.group === 'component')
  const tagKind = {}
  for (const p of ir.PRIMITIVE_CATALOG) if (p.tag) tagKind[p.tag] = p.kind
  const KIND_DOMAIN = { layout: '布局', ui: '内容与表单', shell: '页面外壳', gesture: '手势', engineering: '工程', capability: '能力入口' }
  const DOMAIN_ORDER = ['布局', '内容与表单', '页面外壳', '手势', '工程', '能力入口', '—']
  const domainOf = {}
  for (const dir of dirs) {
    const semantic = semanticMap[dir] ?? null
    const kind = tagKind[dir] ?? (semantic ? semantic.split('.')[0] : null) ?? '—'
    domainOf[dir] = KIND_DOMAIN[kind] ?? kind
  }
  const perDomain = {}
  const orderOf = {}
  for (const dir of Object.keys(domainOf).sort()) {
    perDomain[domainOf[dir]] = (perDomain[domainOf[dir]] ?? 0) + 1
    orderOf[dir] = DOMAIN_ORDER.indexOf(domainOf[dir]) * 1000 + perDomain[domainOf[dir]]
  }
  const mpLabelEn = (i) => `\`${i.mp}\` (${MP_STATUS_EN[i.status] ?? i.status})`
  const esc = (s) => String(s).replace(/\|/g, '\\|') // 表格单元格转义（docs 引擎按 | 分列）
  let ok = 0
  const indexRows = []
  for (const dir of dirs) {
    const page = COMP_EN[dir]
    if (!page) continue
    const vueFile = path.join(COMP_DIR, dir, 'index.vue')
    if (!fs.existsSync(vueFile)) continue
    const src = fs.readFileSync(vueFile, 'utf8')
    const props = parseProps(extractCall(src, 'defineProps') ?? '')
    const emits = parseEmits(src)
    const emitPayloads = parseEmitPayloads(src)
    const slots = parseSlots(src)
    const semantic = semanticMap[dir] ?? null
    const domain = domainOf[dir]
    const mpMatches = semantic ? mpComp.filter((i) => i.proteus.split(' / ').some((s) => s.includes(semantic))) : []
    const mpTextEn = mpMatches.slice(0, 4).map(mpLabelEn).join(' · ') + (mpMatches.length > 4 ? SHARED_EN.andMore(mpMatches.length) : '')
    const mpEquivEn = mpMatches.length ? mpTextEn : '—'
    const domainEn = DOMAIN_EN[domain] ?? domain
    const lines = []
    lines.push('---')
    lines.push(`title: ${dir}`)
    lines.push(`group: ${domain}`)
    lines.push(`order: ${orderOf[dir]}`)
    lines.push('---')
    lines.push('')
    lines.push(`# ${dir}`)
    lines.push('')
    lines.push(page.desc || SHARED_EN.genericDesc)
    lines.push('')
    lines.push(SHARED_EN.semanticCallout(domainEn))
    lines.push('')
    lines.push(SHARED_EN.semanticCols)
    lines.push('|---|---|---|')
    lines.push(`| ${semantic ?? '—'} | ${domainEn} | ${mpEquivEn} |`)
    lines.push('')
    const rows = []
    for (const end of ends) {
      let note
      if (end.id === 'mp-weixin') note = END_NOTE_EN['mp-weixin'](mpEquivEn !== '—' ? mpTextEn : '')
      else note = END_NOTE_EN[end.id] ?? END_NOTE_EN.prototype
      const endEn = ENDS_EN[end.id]
      rows.push({ name: endEn?.name ?? end.name, status: STATUS_MARK[end.status] ?? '⬜', note: `${endEn?.engine ?? end.engine} · ${note}` })
    }
    lines.push(SHARED_EN.hCompat)
    lines.push('')
    lines.push(SHARED_EN.compatCols)
    lines.push('|---|---|---|')
    for (const r of rows) lines.push(`| ${r.name} | ${r.status} | ${r.note} |`)
    lines.push('')
    lines.push(COMP_LEGEND_EN)
    lines.push('')
    if (props.length) {
      lines.push(SHARED_EN.hProps)
      lines.push('')
      lines.push(SHARED_EN.propsCols)
      lines.push('|---|---|---|---|---|')
      for (const p of props) {
        const doc = page.props?.[p.name] ?? '—'
        lines.push(`| \`${p.name}\` | ${esc(doc)} | \`${esc(p.type)}\` | ${p.default ? `\`${esc(p.default)}\`` : p.required ? `**${SHARED_EN.requiredYes}**` : '—'} | ${p.required ? `**${SHARED_EN.requiredYes}**` : SHARED_EN.requiredNo} |`)
      }
      lines.push('')
      // Props detail (EN — mirrors zh 属性详解)
      lines.push('### Prop details')
      lines.push('')
      for (const p of props) {
        const pd = page.props?.[p.name] ?? '—'
        lines.push(`#### \`${p.name}\``)
        lines.push('')
        lines.push(`- **Type**: \`${esc(p.type)}\`　**Default**: ${p.default ? `\`${esc(p.default)}\`` : '—'}　**Required**: ${p.required ? 'Yes' : 'No'}`)
        lines.push(`- **Doc**: ${esc(pd)}`)
        lines.push('')
      }
    }
    if (emits.length) {
      lines.push(SHARED_EN.hEvents)
      lines.push('')
      lines.push('| Event | Doc | Payload |')
      lines.push('|---|---|---|')
      const vmDocEn = (e) => {
        const m = e.match(/^update:(.+)$/)
        if (!m) return null
        const field = m[1] === 'modelValue' ? 'v-model value' : `\`${m[1]}\``
        return `Two-way binding: fires when ${field} changes (syncs the parent binding)`
      }
      for (const e of emits) {
        const doc = page.events?.[e] ?? vmDocEn(e) ?? '—'
        const payload = emitPayloads[e]
        lines.push(`| \`${e}\` | ${esc(doc)} | ${payload ? `\`${esc(payload)}\`` : '—'} |`)
      }
      lines.push('')
      // Event details (EN — mirrors zh 事件详解)
      lines.push('### Event details')
      lines.push('')
      for (const e of emits) {
        const doc = page.events?.[e] ?? vmDocEn(e) ?? '—'
        const payload = emitPayloads[e]
        lines.push(`#### \`${e}\``)
        lines.push('')
        lines.push(`- **Doc**: ${esc(doc)}`)
        lines.push(`- **Payload**: ${payload ? `\`${esc(payload)}\`` : 'none'}${e.startsWith('update:') ? ' (implicit v-model: the value itself)' : ''}`)
        lines.push('')
      }
    }
    // Slots section (EN — mirrors zh 插槽)
    if (slots.length) {
      lines.push('## Slots')
      lines.push('')
      lines.push('| Slot | Doc |')
      lines.push('|---|---|')
      for (const sl of slots) {
        const label = sl.name === 'default' ? 'default' : `\`${sl.name}\``
        const scopedNote = `scoped props: ${sl.props.map((x) => `\`${x}\``).join(', ')}`
        let doc
        if (sl.name === 'default') doc = sl.scoped ? `Default slot (${scopedNote})` : 'Default slot (main content)'
        else if (sl.scoped) doc = `Named + scoped slot (${scopedNote})`
        else doc = 'Named slot'
        lines.push(`| ${label} | ${doc} |`)
      }
      lines.push('')
    }
    if (page.notes?.length) {
      lines.push(SHARED_EN.hNotes)
      lines.push('')
      for (const n of page.notes) lines.push(`- ${n}`)
      lines.push('')
    }
    lines.push(SHARED_EN.hUsage)
    lines.push('')
    lines.push('```vue')
    lines.push(SHARED_EN.usageSample(dir, props[0]?.name))
    lines.push('```')
    lines.push('')
    lines.push('<!-- generated by website/scripts/gen-content.mjs (en overlay) · source SSOT: packages/components/' + dir + '/index.vue -->')
    fs.mkdirSync(OUT, { recursive: true })
    writeDoc(path.join(OUT, `${dir}.md`), lines.join('\n'))
    indexRows.push({ dir, props: props.length, emits: emits.length, domain })
    ok++
  }
  // 总览页 EN overlay（与 zh 00-components-overview 同源数据）
  const byDomain = {}
  for (const r of indexRows) (byDomain[r.domain] ??= []).push(r)
  const idx = []
  idx.push('---')
  idx.push(`title: ${OVERVIEW_EN.title}`)
  idx.push(`group: ${OVERVIEW_EN.group}`)
  idx.push(`order: ${OVERVIEW_EN.order}`)
  idx.push('---')
  idx.push('')
  idx.push(`# ${OVERVIEW_EN.title}`)
  idx.push('')
  idx.push(OVERVIEW_EN.intro(ok, Object.keys(byDomain).length))
  idx.push('')
  for (const domain of Object.keys(byDomain).sort((a, b) => DOMAIN_ORDER.indexOf(a) - DOMAIN_ORDER.indexOf(b))) {
    idx.push(`## ${DOMAIN_EN[domain] ?? domain} (${byDomain[domain].length})`)
    idx.push('')
    idx.push(OVERVIEW_EN.cols)
    idx.push('|---|---|---|')
    for (const r of byDomain[domain].sort((a, b) => a.dir.localeCompare(b.dir))) {
      idx.push(`| [${r.dir}](/docs/component/${r.dir}) | ${r.props} | ${r.emits} |`)
    }
    idx.push('')
  }
  if (indexRows.length) {
    fs.mkdirSync(OUT, { recursive: true })
    writeDoc(path.join(OUT, '00-components-overview.md'), idx.join('\n'))
  }
  return ok
}

// —— ②-EN 能力 overlay（★#481 生成器双语输出——zh 数据准备与 genCapabilities 同源 capContext；文案查 CAP_EN/CAP_SHARED_EN） ——
// 登记在 CAP_EN 的 slug 额外产出 website/en/capabilities/<slug>.md；未登记的走 #noEn 回退。
async function genCapabilitiesEn(ir, ends) {
  const OUT = path.join(ROOT, 'website', 'en', 'capabilities')
  const { caps, wxKeys, webKeys, ifaces, iface, hookDocs, hooksBody, bridgeBodies, hookRefs, catOf, orderOfCap, apiSrc } = capContext(ir)
  const esc = (s) => String(s).replace(/\|/g, '\\|')
  const docEn = (page, key, fallback = '—') => (page && page.params && page.params[key]) || fallback
  let ok = 0
  const done = []
  for (const c of caps) {
    const slug = c.semantic.replace('capability.', '')
    const page = CAP_EN[slug]
    if (!page) continue
    const hook = c.api.replace('()', '')
    const sigM = iface.match(new RegExp(`${hook}(?:<[^>(]*>)?\\([^)]*\\):\\s*[^\\n]+`))
    const lines = []
    lines.push('---')
    lines.push(`title: ${hook} (${c.semantic})`)
    lines.push(`group: ${catOf[c.semantic]}`)
    lines.push(`order: ${orderOfCap[c.semantic]}`)
    lines.push('---')
    lines.push('')
    lines.push(`# ${hook}`)
    lines.push('')
    // ★★★决策 #1084：EN 与 zh 结构对称——先答"what it does"，技术标识行后移
    lines.push(...capabilityIntro(c, { en: true }))
    lines.push(page.desc || CAP_SHARED_EN.noDataGeneric)
    lines.push('')
    lines.push(CAP_SHARED_EN.hSignature)
    lines.push('')
    lines.push('```ts')
    lines.push(sigM ? sigM[0] : `${c.api} → ${c.props?.[0] ?? 'Result<T>'}`)
    lines.push('```')
    lines.push('')
    const sigLine = sigM ? sigM[0] : ''
    const paramM = sigLine.match(/\(([^)]*)\)/)
    const params = []
    if (paramM && paramM[1].trim()) {
      for (const raw of paramM[1].split(',')) {
        const pm = raw.trim().match(/^(\w+)(\?)?:\s*(.+)$/)
        if (pm) params.push({ name: pm[1], optional: pm[2] === '?', type: pm[3].trim() })
      }
    }
    if (params.length) {
      lines.push(CAP_SHARED_EN.hParams)
      lines.push('')
      lines.push(CAP_SHARED_EN.paramCols)
      lines.push('|---|---|---|---|')
      for (const p of params) {
        lines.push(`| \`${p.name}\` | \`${esc(p.type)}\` | ${p.optional ? 'No' : 'Yes'} | ${esc(docEn(page, p.name))} |`)
      }
      lines.push('')
      for (const p of params) {
        const ti = ifaces[p.type]
        if (!ti || !ti.props.length) continue
        lines.push(CAP_SHARED_EN.nestedPropsTitle(p.name))
        lines.push('')
        lines.push(CAP_SHARED_EN.propCols)
        lines.push('|---|---|---|---|')
        for (const pr of ti.props) {
          lines.push(`| \`${pr.name}\` | \`${esc(pr.type)}\` | ${pr.optional ? 'No' : 'Yes'} | ${esc(docEn(page, `${p.name}.${pr.name}`))} |`)
        }
        lines.push('')
      }
    }
    const shape = hookShape(sigLine, ifaces)
    const dataT = shape.dataT
    const voidRet = shape.voidRet
    const handleT = shape.handleT
    lines.push(CAP_SHARED_EN.hReturns)
    lines.push('')
    if (handleT) {
      lines.push(CAP_SHARED_EN.directReturn(handleT))
      lines.push('')
    } else {
      lines.push(CAP_SHARED_EN.returnsIntro)
      lines.push('')
      lines.push(CAP_SHARED_EN.retCols)
      lines.push('|---|---|---|')
      lines.push(`| \`ok\` | \`boolean\` | ${esc(CAP_SHARED_EN.retOk)} |`)
      const di = shape.dataIface
      const dataNote = dataT === 'T' ? esc(CAP_SHARED_EN.retDataGeneric)
        : voidRet ? esc(CAP_SHARED_EN.retDataVoid)
        : `Success payload${di?.props.length ? ' (structure below)' : di?.methods.length ? ' (methods below)' : ''}`
      lines.push(`| \`data\` | \`${esc(dataT)}\` | ${dataNote} |`)
      lines.push(`| \`error\` | \`CapError\` | ${esc(CAP_SHARED_EN.retError)} |`)
      lines.push('')
    }
    // ★TOC 优化（2026-09-11）：EN 与 zh 结构对称——方法/属性/类型引用为 h2，条目为 h3
    const allPropsEn = [...(shape.dataIface?.props ?? [])]
    const allMethodsEn = [...(shape.dataIface?.methods ?? [])]
    if (handleT && shape.handleIface) {
      for (const pr of shape.handleIface.props) {
        if (pr.type.includes('=>') || pr.type.startsWith('(')) continue
        allPropsEn.push(pr)
      }
      allMethodsEn.push(...shape.handleIface.methods)
    }
    if (allMethodsEn.length) {
      lines.push(CAP_SHARED_EN.hMethods)
      lines.push('')
      const isLifecycleHandleEn = handleT === 'PageLifecycle' || handleT === 'AppLifecycle'
      const sheet = handleT === 'PageLifecycle' ? (LIFECYCLE_EVENT_EN.page ?? {}) : (LIFECYCLE_EVENT_EN.app ?? {})
      const docOfEn = (mm) => {
        if (isLifecycleHandleEn) {
          const d = sheet[methodToEvent(mm.name)]
          if (d) return d
        }
        return oneline((CAP_METHODS_EN[shape.dataElemT] && CAP_METHODS_EN[shape.dataElemT][mm.name]) || (handleT && CAP_METHODS_EN[handleT] && CAP_METHODS_EN[handleT][mm.name]) || '')
      }
      // 2026-09-30 feedback: doc-after-signature felt odd; some methods had no doc.
      // Table is now `Method | Doc` (signature lives in the h3 detail) and every method gets a doc.
      // Lifecycle handles add an "End support" column (per-method target support, same meta SSOT).
      if (isLifecycleHandleEn) {
        lines.push(CAP_SHARED_EN.methodColsWithEnds)
        lines.push(CAP_SHARED_EN.methodColsSep3)
        for (const mm of allMethodsEn) {
          const m = eventMetaOf(handleT, mm.name, lifecycleMeta)
          lines.push(`| [\`${mm.name}\`](#${mm.name.toLowerCase()}) | ${esc(docOfEn(mm))} | ${endSupportCellEn(m)} |`)
        }
      } else {
        lines.push(CAP_SHARED_EN.methodCols)
        lines.push(CAP_SHARED_EN.methodColsSep2)
        for (const mm of allMethodsEn) lines.push(`| [\`${mm.name}\`](#${mm.name.toLowerCase()}) | ${esc(docOfEn(mm) || '—')} |`)
      }
      lines.push('')
      if (isLifecycleHandleEn) {
        lines.push(`### ${CAP_SHARED_EN.hEndSupport}`)
        lines.push('')
        for (const mm of allMethodsEn) {
          const m = eventMetaOf(handleT, mm.name, lifecycleMeta)
          if (!m) continue
          const none = CAP_SHARED_EN.endNone
          const noteEn = LIFECYCLE_EVENT_NOTE_EN[methodToEvent(mm.name)]
          const src = srcEnOf(handleT, mm.name, m)
          lines.push(`- \`${mm.name}\`: MP ${src.mp ? `\`${src.mp}\`` : `— (${none})`} · Web ${src.web ? `\`${src.web}\`` : `— (${none})`} · App ${src.app ? `\`${src.app}\`` : `— (${none})`}${noteEn ? ` — ${noteEn}` : ''}`)
        }
        lines.push('')
      }
      for (const mm of allMethodsEn) {
        const doc = docOfEn(mm)
        lines.push(`### \`${mm.name}\``)
        lines.push('')
        lines.push('```ts')
        lines.push(mm.sig)
        lines.push('```')
        lines.push('')
        if (doc) { lines.push(`**${CAP_SHARED_EN.descLabel}**: ${doc}`); lines.push('') }
        const args = parseSigArgs(mm.args)
        if (args.length) {
          const pc = CAP_SHARED_EN.paramCols
          lines.push(`| ${pc[0]} | ${pc[1]} | ${pc[2]} | ${pc[3]} |`)
          lines.push('|---|---|---|---|')
          for (const a of args) lines.push(`| \`${a.name}\` | \`${esc(a.type || '—')}\` | ${a.optional ? CAP_SHARED_EN.requiredNo : CAP_SHARED_EN.requiredYes} | ${(mm.paramDocs && mm.paramDocs[a.name]) || '—'} |`)
          lines.push('')
        }
        lines.push(`**${CAP_SHARED_EN.returnsLabel}**: \`${esc(mm.ret)}\`${mm.returns ? ' -- ' + mm.returns : ''}`)
        lines.push('')
      }
    }
    if (allPropsEn.length) {
      lines.push(CAP_SHARED_EN.hProps)
      lines.push('')
      lines.push(CAP_SHARED_EN.propCols4)
      lines.push(CAP_SHARED_EN.propSep4)
      for (const pr of allPropsEn) {
        const doc = (page.dataProps && page.dataProps[pr.name]) || (page.directProps && page.directProps[pr.name]) || pr.doc || '—'
        lines.push(`| \`${pr.name}\` | \`${esc(pr.type)}\` | ${pr.optional ? 'No' : 'Yes'} | ${esc(oneline(doc))} |`)
      }
      lines.push('')
    }
    // ★颗粒度对齐 A：EN 类型引用同样**递归展开** + 「默认值」列（与 zh 对称）
    const refQueueEn = collectRefTypes([...allMethodsEn.map((m) => m.sig), ...allPropsEn.map((p) => p.type)], ifaces)
    const renderedEn = new Set()
    if (refQueueEn.length) {
      lines.push(CAP_SHARED_EN.hTypeRefs)
      lines.push('')
      while (refQueueEn.length) {
        const n = refQueueEn.shift()
        if (renderedEn.has(n) || !ifaces[n]) continue
        renderedEn.add(n)
        const rt = ifaces[n]
        lines.push(`### \`${n}\``)
        lines.push('')
        if (rt.doc) { lines.push(rt.doc); lines.push('') }
        if (rt.props.length) {
          lines.push('| Prop | Type | Default | Doc |')
          lines.push('|---|---|---|---|')
          for (const pr of rt.props) {
            const dflt = extractDefaultFromDoc(pr.doc)
            lines.push(`| \`${pr.name}\` | \`${esc(pr.type)}\` | ${dflt ? `\`${esc(dflt)}\`` : '—'} | ${pr.doc || '—'} |`)
            for (const r of collectRefTypes([pr.type], ifaces)) if (!renderedEn.has(r)) refQueueEn.push(r)
          }
          lines.push('')
        }
        if (rt.methods.length) {
          lines.push('| Method | Signature | Doc |')
          lines.push('|---|---|---|')
          for (const mm of rt.methods) {
            lines.push(`| \`${mm.name}\` | \`${esc(mm.sig)}\` | ${mm.doc || '—'} |`)
            for (const r of collectRefTypes([mm.sig], ifaces)) if (!renderedEn.has(r)) refQueueEn.push(r)
          }
          lines.push('')
        }
      }
    }
    const hookStart = hooksBody.indexOf(`${hook}:`)
    const hookEnd = (() => {
      const hits = [...hooksBody.matchAll(/\b(use[A-Z]\w*|set[A-Z]\w*):/g)]
      const hit = hits.find((h) => h.index === hookStart)
      const idx0 = hits.indexOf(hit)
      return idx0 >= 0 && idx0 + 1 < hits.length ? hits[idx0 + 1].index : hooksBody.length
    })()
    const refs = hookRefs[hook] ?? []
    const errBodies = refs.map((r) => bridgeBodies[r]).filter((x) => typeof x === 'string')
    // ★颗粒度对齐 A（2026-09-11）：错误码补「全文件扫描」——源码 98 唯一 code，原只渲染 61（hook 体无字面 CapError 时 0 行）。
    //   纳入规则：scoped（hook 切片 + bridge 方法体）+ 全文件中「前缀 === 本能力 slug」的 code（helper 函数体/throw 亦覆盖）。
    const capSlug = c.semantic.replace('capability.', '')
    const allErrCodes = extractErrorCodes(apiSrc)
    const scopedCodes = extractErrorCodes([hooksBody.slice(hookStart, hookEnd), ...errBodies].join('\n'))
    const errCodes = [...scopedCodes]
    for (const ec of allErrCodes) {
      if (errCodes.some((e) => e.code === ec.code)) continue
      if (ec.code.split('.')[0] === capSlug) errCodes.push(ec)
    }
    if (errCodes.length) {
      lines.push(CAP_SHARED_EN.hErrors)
      lines.push('')
      lines.push(CAP_SHARED_EN.errCols)
      lines.push('|---|---|')
      for (const e of errCodes) lines.push(`| \`${e.code}\` | ${esc((page.errors && page.errors[e.code]) || '—')} |`)
      lines.push('')
      lines.push(CAP_SHARED_EN.unsupportedNote)
      lines.push('')
    }
    const mpEquivEn = /[\u4e00-\u9fff]/.test(c.mpEquiv) ? '(wx-native equivalent; exact mapping in the zh version)' : c.mpEquiv // 目录 mpEquiv 含中文时 EN 降级
    // ★判定逻辑与 zh 页、总览汇总**同源**（#1089）——文案走 CAP_SHARED_EN.endNote，不在这里写第二份
    const endStatuses = capabilityEndStatuses({
      ends, refs, mpEquiv: mpEquivEn, wxKeys, webKeys, root: ROOT, capSlug,
      appBridgeKeys: APP_BRIDGE_KEYS, pushCapabilities: PUSH_CAPABILITIES, verified: HOST_RUNTIME_VERIFIED_CAPS,
      en: true, enNotes: CAP_SHARED_EN.endNote,
    })
    lines.push(CAP_SHARED_EN.hCompat)
    lines.push('')
    lines.push('| Target | Status | Notes |')
    lines.push('|---|---|---|')
    for (const end of ends) {
      const endEn = ENDS_EN[end.id]
      const st = endStatuses[end.id]
      lines.push(`| ${endEn?.name ?? end.name} | ${st.status} | ${endEn?.engine ?? end.engine} · ${st.note} |`)
    }
    lines.push('')
    lines.push(CAP_SHARED_EN.capLegend)
    lines.push('')
    lines.push(CAP_SHARED_EN.ironRule)
    lines.push('')
    // ★官网漏修：扩展接口段（EN 镜像——与 zh 结构对称，避免 en-drift）
    const extraHooksEn = CAP_EXTRA_HOOKS[c.semantic] ?? []
    if (extraHooksEn.length) {
      lines.push('## Extension interfaces')
      lines.push('')
      lines.push(`Beyond the primary hook \`${hook}\`, this capability also exposes these operation interfaces:`)
      lines.push('')
      for (const eh of extraHooksEn) {
        const ehSig = iface.match(new RegExp(`${eh}(?:<[^>(]*>)?\\([^)]*\\):\\s*[^\\n]+`))
        lines.push(`### \`${eh}\``)
        lines.push('')
        if (ehSig) {
          lines.push('```ts')
          lines.push(ehSig[0].trim())
          lines.push('```')
          lines.push('')
          const ehParamM = ehSig[0].match(/\(([^)]*)\)/)
          const ehArgs = ehParamM ? parseSigArgs(ehParamM[1]) : []
          if (ehArgs.length) {
            lines.push('| Param | Type | Required | Doc |')
            lines.push('|---|---|---|---|')
            for (const a of ehArgs) lines.push(`| \`${a.name}\` | \`${escMd(a.type || '—')}\` | ${a.optional ? 'No' : 'Yes'} | ${autoParamDoc(a)} |`)
            lines.push('')
          }
        }
        const ehShape = hookShape(ehSig ? ehSig[0] : '', ifaces)
        const ehIface = ehShape.dataIface || ehShape.handleIface
        const ehT = ehShape.dataElemT || ehShape.handleT
        if (ehIface && (ehIface.props.length || ehIface.methods.length)) {
          if (ehIface.props.length) {
            lines.push(`#### \`${ehT}\` props`)
            lines.push('')
            lines.push('| Prop | Type | Required | Doc |')
            lines.push('|---|---|---|---|')
            for (const pr of ehIface.props) lines.push(`| \`${pr.name}\` | \`${escMd(pr.type)}\` | ${pr.optional ? 'No' : 'Yes'} | ${oneline(pr.doc) || '—'} |`)
            lines.push('')
          }
          if (ehIface.methods.length) {
            lines.push(`#### \`${ehT}\` methods`)
            lines.push('')
            lines.push('| Method | Signature | Doc |')
            lines.push('|---|---|---|')
            for (const mm of ehIface.methods) lines.push(`| \`${mm.name}\` | \`${escMd(mm.sig)}\` | ${oneline(mm.doc) || '—'} |`)
            lines.push('')
            for (const mm of ehIface.methods) {
              lines.push(`#### \`${mm.name}\``)
              lines.push('')
              lines.push('```ts')
              lines.push(mm.sig)
              lines.push('```')
              lines.push('')
              if (mm.doc) { lines.push(`**Doc**: ${mm.doc}`); lines.push('') }
              const args = parseSigArgs(mm.args)
              if (args.length) {
                lines.push('| Param | Type | Required | Doc |')
                lines.push('|---|---|---|---|')
                for (const a of args) lines.push(`| \`${a.name}\` | \`${escMd(a.type || '—')}\` | ${a.optional ? 'No' : 'Yes'} | ${(mm.paramDocs && mm.paramDocs[a.name]) || '—'} |`)
                lines.push('')
              }
              lines.push(`**Returns**: \`${escMd(mm.ret)}\`${mm.returns ? ' -- ' + mm.returns : ''}`)
              lines.push('')
            }
            const erefs = collectRefTypes(ehIface.methods.map((m) => m.sig), ifaces)
            if (erefs.length) {
              lines.push('#### Referenced types')
              lines.push('')
              for (const n of erefs) {
                const rt = ifaces[n]
                if (rt.doc) { lines.push(`**\`${n}\`** — ${rt.doc}`); lines.push('') }
                if (rt.props.length) {
                  lines.push('| Prop/Method | Type | Doc |')
                  lines.push('|---|---|---|')
                  for (const pr of rt.props) lines.push(`| \`${pr.name}\` | \`${escMd(pr.type)}\` | ${oneline(pr.doc) || '—'} |`)
                  lines.push('')
                }
                if (rt.methods.length) {
                  lines.push('| Prop/Method | Type | Doc |')
                  lines.push('|---|---|---|')
                  for (const mm of rt.methods) lines.push(`| \`${mm.name}\` | \`${escMd(mm.sig)}\` | ${oneline(mm.doc) || '—'} |`)
                  lines.push('')
                }
              }
            }
          }
        }
      }
    }
    lines.push(CAP_SHARED_EN.hUsage)
    lines.push('')
    lines.push('```ts')
    const enUsage = usageOf(hook, 'en')
    if (enUsage) {
      lines.push(...enUsage)
    } else if (handleT || /^CapResult</.test(shape.retType)) {
      const lv = (hook.replace(/^use/, '') || 'handle').charAt(0).toLowerCase() + hook.replace(/^use/, '').slice(1)
      lines.push(...CAP_USAGE_EN.direct(c.api, lv, EN_ARG_PLACEHOLDERS[hook]))   // ★#1087 带可运行实参
    } else {
      const required = params.filter((p) => !p.optional).map((p) => p.name)
      const args = CAP_ARGS_EN[hook] ?? required.join(', ')
      const call = c.api.replace('()', `(${args})`)
      lines.push(...CAP_USAGE_EN.generic(call, CAP_DATA_HINTS_EN[hook], voidRet))
    }
    lines.push('```')
    lines.push('')
    // Platform notes (user feedback #4) — lifecycle capability pages only; content is cross-references
    renderPlatformTopics(lines, c.semantic.replace('capability.', ''), lifecycleMeta, HOOK_TO_SLUG, HOOK_STATUS, 'en')
    lines.push('<!-- generated by website/scripts/gen-content.mjs (en overlay) · source SSOT: packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->')
    fs.mkdirSync(OUT, { recursive: true })
    writeDoc(path.join(OUT, `${slug}.md`), lines.join('\n'))
    done.push({ slug, semantic: c.semantic, api: c.api, mpEquiv: c.mpEquiv, id: c.id })
    ok++
  }
  // 能力总览 EN overlay（只列 CAP_EN 已登记 slug——未翻译能力在 EN 态走 #noEn，总览不混排）
  const vis = caps.filter((c) => CAP_EN[c.semantic.replace('capability.', '')])
  const idx = []
  idx.push('---')
  idx.push(`title: ${CAP_OVERVIEW_EN.title}`)
  idx.push(`group: ${CAP_OVERVIEW_EN.group}`)
  idx.push(`order: ${CAP_OVERVIEW_EN.order}`)
  idx.push('---')
  idx.push('')
  idx.push(`# ${CAP_OVERVIEW_EN.title}`)
  idx.push('')
  idx.push(CAP_OVERVIEW_EN.intro(vis.length))
  idx.push('')
  // ★#1089 全端兼容进度（EN 镜像：同一份判定 + 同列结构，否则 check:en-drift 会红）
  const cov = capabilityCoverage({
    caps: vis, ends, hookRefs, wxKeys, webKeys, catOf, capOrder: CAP_CAT_ORDER,
    root: ROOT, appBridgeKeys: APP_BRIDGE_KEYS, pushCapabilities: PUSH_CAPABILITIES, verified: HOST_RUNTIME_VERIFIED_CAPS,
    en: true, enNotes: CAP_SHARED_EN.endNote,
  })
  renderCoverage(idx, cov, {
    h2: '## All-target compatibility',
    intro: '> Numbers come from **source facts** (same computation as each capability page\'s compat table): ✅ usable directly · ⚠️ target shipped but the bridge is absent → calls return `*.unsupported` and degrade explicitly · 🟡 capability bridge not wired · ⬜ target not started (including planned). **Coverage = ✅ / total** — ⚠️ does not count, because the caller gets an Err.',
    cols: '| Target | ✅ Usable | ⚠️ Degraded | 🟡 Not wired | ⬜ Not started | Coverage |',
    h3: '### By category (✅ / total in that category)',
    catIntro: '> Read a row for one capability domain across targets; read a column for one target\'s weakest domains. The denominator is the number of capabilities in that category.',
    catCols: '| Category | ' + ends.map((e) => ENDS_EN[e.id]?.name ?? e.name).join(' | ') + ' |',
    endName: (r) => ENDS_EN[r.id]?.name ?? r.name,
    catName: (c) => CAP_CAT_EN[c] ?? c,
  })
  const byCat = {}
  for (const c of vis) (byCat[catOf[c.semantic]] ??= []).push(c)
  for (const cat of Object.keys(byCat).sort((a, b) => CAP_CAT_ORDER.indexOf(a) - CAP_CAT_ORDER.indexOf(b))) {
    idx.push(`## ${CAP_CAT_EN[cat] ?? cat} (${byCat[cat].length})`)
    idx.push('')
    idx.push(CAP_OVERVIEW_EN.cols)
    idx.push('|---|---|---|---|---|')
    for (const c of byCat[cat]) {
      const slug = c.semantic.replace('capability.', '')
      const mpEn = /[\u4e00-\u9fff]/.test(c.mpEquiv) ? '—' : c.mpEquiv // 目录 mpEquiv 含中文时 EN 降级（zh 总览保留原文）
      idx.push(`| ${c.id} | [${c.semantic}](/docs/capability/${slug}) | \`${c.api}\` | \`${(c.props ?? [])[0] ?? '—'}\` | ${mpEn} |`)
    }
    idx.push('')
  }
  if (done.length) {
    fs.mkdirSync(OUT, { recursive: true })
    writeDoc(path.join(OUT, '00-capabilities-overview.md'), idx.join('\n'))
  }
  return ok
}

// —— main ——
const ir = await loadIr()
const capContextForSlugs = capContext(ir)
const ends = await loadEnds()
const lifecycleMeta = await loadLifecycleMeta()
/** 能力页 slug → catalog status（平台专栏只对 implemented 生成链接） */
const HOOK_STATUS = (() => {
  const m = {}
  for (const c of capContextForSlugs.caps) m[c.semantic.replace('capability.', '')] = c.status ?? 'planned'
  return m
})()

/** hook 名 → 能力页 slug（平台专栏的交叉引用用；如 useKeyboard → keyboard） */
const HOOK_TO_SLUG = (() => {
  const m = {}
  for (const c of capContextForSlugs.caps) {
    const slug = c.semantic.replace('capability.', '')
    const hookM = String(c.api ?? '').match(/^(use[A-Za-z0-9]+)/)
    if (hookM) m[hookM[1]] = slug
    // 别名（同一能力多 hook——与 CAP_EXTRA_HOOKS 同源）
    for (const extra of (CAP_EXTRA_HOOKS[c.semantic] ?? [])) m[extra] = slug
  }
  return m
})()
const nComp = genComponents(ir, ends)
const nCap = genCapabilities(ir, ends)
const nCompEn = await genComponentsEn(ir, ends)
const nCapEn = await genCapabilitiesEn(ir, ends)

if (collapsed.length) {
  console.error(`COLLAPSED: ${collapsed.length} 个生成页出现「表格塌成段落」形态（多行 JSDoc 被压平？）：`)
  for (const f of collapsed.slice(0, 20)) console.error(`  - ${f}`)
  console.error("  修法：检查该页对应源的 JSDoc 是否被 join(' ') 压平（块渲染保留行结构，cell 才用 oneline）")
  process.exit(1)
}
if (check) {
  if (drifts.length) {
    console.error(`DRIFT: ${drifts.length} 个生成页与源不一致——运行 npm run gen:content 并提交：`)
    for (const f of drifts.slice(0, 20)) console.error(`  - ${f}`)
    if (drifts.length > 20) console.error(`  … 另 ${drifts.length - 20} 个`)
    process.exit(1)
  }
  console.log(`CHECK OK — 组件/能力页与源一致（components ${nComp} · capabilities ${nCap}）`)
} else {
  console.log(`generated: components ${nComp} · capabilities ${nCap} · en components ${nCompEn} · en capabilities ${nCapEn}`)
}
