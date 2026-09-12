// website/scripts/gen-content.mjs
// ★#390ii 组件/能力参考文档生成器（内容即数据——SSOT = 框架源码，产物勿手改）
//   ① website/content/components/*.md —— 59 个 p-* 组件：props/emits（解析 defineProps/defineEmits + JSDoc）
//      + 语义映射（component-ir TAG_SEMANTIC_MAP）+ 小程序等价（MP_MAPPING_MATRIX）
//   ② website/content/capabilities/*.md —— 50 个能力原语（PRIMITIVE_CATALOG kind=capability）
//      + 签名/返回类型（packages/api/src/capability.ts CapabilityHooks 接口 JSDoc）
//   幂等：重复运行输出一致（无时间戳）。用法：node website/scripts/gen-content.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { COMP_EN, DOMAIN_EN, MP_STATUS_EN, ENDS_EN, END_NOTE_EN, COMP_LEGEND_EN, SHARED_EN, OVERVIEW_EN, CAP_SHARED_EN, CAP_USAGE_EN, CAP_ARGS_EN, CAP_DATA_HINTS_EN, CAP_METHODS_EN, CAP_EN, CAP_CAT_EN, CAP_OVERVIEW_EN } from './gen-content-en.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const COMP_DIR = path.join(ROOT, 'src', 'components')
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
/** 写产物（--check 时改为比对；记录漂移文件） */
function writeDoc(p, content) {
  if (check) {
    const cur = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''
    if (cur !== content) drifts.push(path.relative(ROOT, p))
    return
  }
  fs.writeFileSync(p, content)
}

// —— component-ir SSOT（tsx 直接 import TS 源） ——
async function loadIr() {
  const mod = await import(pathToFileURL(path.join(ROOT, 'packages', 'component-ir', 'src', 'index.ts')).href)
  return mod
}

// —— 端注册表 SSOT（W-7 L-B：兼容进度表的端列/状态 = website/src/ends.ts） ——
async function loadEnds() {
  const mod = await import(pathToFileURL(path.join(ROOT, 'website', 'src', 'ends.ts')).href)
  return mod.ENDS
}

const STATUS_MARK = { '✅ 已落地': '✅', '🟡 部分落地': '🟡', '📋 规划已入库': '📋', '⬜ 未开始': '⬜' }
const MP_STATUS_LABEL = { ok: 'L1 原语', compat: 'L2 兼容层', private: '平台私有', missing: '缺失' }

// ★能力侧栏分组：50 能力按 9 类归组（生成器侧分类表，与组件 EXTRA_KIND「分类先行」同模式）
const CAP_CATEGORY = {
  fetch: '网络与通信', websocket: '网络与通信', 'socket-task': '网络与通信', socket: '网络与通信', 'local-service': '网络与通信', upload: '网络与通信', download: '网络与通信', 'data-channel': '网络与通信', bluetooth: '网络与通信', nfc: '网络与通信',
  device: '设备与系统', screen: '设备与系统', battery: '设备与系统', orientation: '设备与系统', brightness: '设备与系统', sensor: '设备与系统', vibrate: '设备与系统', network: '设备与系统', keyboard: '设备与系统', clipboard: '设备与系统', 'element-query': '设备与系统', intersection: '设备与系统', 'media-query': '设备与系统', 'screen-capture': '设备与系统', 'cache-manager': '设备与系统', ar: '设备与系统', beacon: '设备与系统', 'device-capability': '设备与系统',
  storage: '存储与文件', cookie: '存储与文件', 'file-system': '存储与文件', archive: '存储与文件',
  location: '位置与地图', map: '位置与地图',
  camera: '媒体与扫码', microphone: '媒体与扫码', live: '媒体与扫码', 'qr-code': '媒体与扫码', canvas: '媒体与扫码', video: '媒体与扫码', audio: '媒体与扫码', 'live-pusher': '媒体与扫码', 'image-edit': '媒体与扫码', 'media-processing': '媒体与扫码',
  login: '账号与支付', auth: '账号与支付', biometric: '账号与支付', 'face-id': '账号与支付', permission: '账号与支付', payment: '账号与支付', 'in-app-purchase': '账号与支付', privacy: '账号与支付',
  notification: '通知与分享', share: '通知与分享', shortcut: '通知与分享', sms: '通知与分享', contact: '通知与分享', 'phone-call': '通知与分享', calendar: '通知与分享', ad: '通知与分享', poster: '通知与分享', translation: '通知与分享',
  'app-lifecycle': '应用与生命周期', 'page-lifecycle': '应用与生命周期', background: '应用与生命周期', 'mini-program': '应用与生命周期', embedded: '应用与生命周期', extension: '应用与生命周期', preload: '应用与生命周期', idle: '应用与生命周期', window: '应用与生命周期', 'navigation-guard': '应用与生命周期',
  analytics: '可观测与调试', log: '可观测与调试', performance: '可观测与调试',
}
const CAP_CAT_ORDER = ['网络与通信', '设备与系统', '存储与文件', '位置与地图', '媒体与扫码', '账号与支付', '通知与分享', '应用与生命周期', '可观测与调试', '其他']

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

// 解析 api.ts 内 wxBridge/webBridge 实现的方法名集合（能力页 Web 列 ✅/⚠️ 的 SSOT——未实现 → Err 显式降级）
function extractFnKeys(src, fnName) {
  const start = src.indexOf(`function ${fnName}`)
  if (start < 0) return []
  const rest = src.slice(start)
  const endM = rest.search(/^}/m)
  const body = endM >= 0 ? rest.slice(0, endM) : rest
  return [...body.matchAll(/^ {4}([a-zA-Z]+):/gm)].map((x) => x[1])
}

// ★#406 颗粒度批：TS 接口解析（能力页参数/返回值属性表的 SSOT——capability.ts 内 60+ 接口属性带 JSDoc）
//   提取 export interface X { ... } 的逐属性：名称/类型/可选(?)/前置 JSDoc 首行
//   ★#490 补方法成员：句柄型接口（CookieJar/BackgroundAPI/FSAdapter…）的结构本体是方法——属性通道排除 '): ' 行，这里成对补齐
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
        // 方法行（含 `(` 或 `):` 形态）→ 跳过且清零文档缓冲
        if (/\(/.test(t)) { pdoc = ''; continue }
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
        .filter(Boolean)
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
      return { doc: prose.join(' '), paramDocs, returns }
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
      doc: jsdoc ? jsdoc.replace(/\/\*\*|\*\//g, '').split('\n').map((l) => l.replace(/^\s*\*\s?/, '').trim()).filter(Boolean).join(' ') : '',
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

// ★详细文档（2026-09-11）：方法签名 → 参数列表（名称/类型/可选；与 JSDoc @param 合并）
function parseSigArgs(argsStr) {
  if (!argsStr || !argsStr.trim()) return []
  const out = []
  // 顶层逗号切分（跳过尖括号/圆括号/方括号/花括号内）
  let depth = 0
  let cur = ''
  for (const ch of argsStr) {
    if ('<([{'.includes(ch)) depth++
    else if ('>)]}'.includes(ch)) depth--
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = '' } else cur += ch
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
      for (const pr of ti.props) lines.push(`| \`${pr.name}\` | \`${escMd(pr.type)}\` | ${pr.doc || '—'} |`)
      lines.push('')
    }
    if (ti.methods.length) {
      lines.push(`| ${cols[0]} | ${cols[1]} | ${cols[2]} |`)
      lines.push('|---|---|---|')
      for (const mm of ti.methods) lines.push(`| \`${mm.name}\` | \`${escMd(mm.sig)}\` | ${mm.doc || '—'} |`)
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
        lines.push(`| \`${pr.name}\` | \`${escMd(pr.type)}\` | ${dflt ? `\`${escMd(dflt)}\`` : '—'} | ${pr.doc || '—'} |`)
        for (const r of collectRefTypes([pr.type], ifaces)) if (!rendered.has(r)) queue.push(r)
      }
      lines.push('')
    }
    if (ti.methods.length) {
      lines.push('| 方法 | 签名 | 说明 |')
      lines.push('|---|---|---|')
      for (const mm of ti.methods) {
        lines.push(`| \`${mm.name}\` | \`${escMd(mm.sig)}\` | ${mm.doc || '—'} |`)
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
  const retT = sigLine.match(/CapResult<([^<>]+(?:<[^<>]+>)?)>/)
  const dataT = retT ? retT[1].trim() : ''
  const voidRet = /CapResult<void>/.test(sigLine)
  const handleT = !/^Promise</.test(retType) && /^[A-Z]\w*$/.test(retType) ? retType : ''
  const dataElemT = dataT.endsWith('[]') ? dataT.slice(0, -2) : dataT
  const dataIface = dataElemT ? ifaces[dataElemT] : undefined
  const handleIface = handleT ? ifaces[handleT] : undefined
  return { retType, dataT, voidRet, handleT, dataElemT, dataIface, handleIface }
}

// 从实现体提取 CapError('code', 'msg') 错误码（能力页错误码表 SSOT）
function extractErrorCodes(body) {
  const out = []
  if (typeof body !== 'string') return out
  // ★颗粒度对齐 A：消息引号放宽（单/双/反引号模板串）——原只认单引号 → file-system.* 等模板串消息的 code 全丢。
  for (const m of body.matchAll(/CapError\(\s*'([^']+)'\s*,\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)/g)) {
    const code = m[1]
    if (!out.some((e) => e.code === code)) out.push({ code, message: m[2] ?? m[3] ?? m[4] ?? '' })
  }
  return out
}

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
  const notes = lines.slice(1).filter((l) => !l.startsWith('src/components'))
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
        default: note = '端原型映射——组件级接线未开始'
      }
      compRows.push({ name: end.name, status: STATUS_MARK[end.status] ?? '⬜', note: `${end.engine} · ${note}` })
    }
    lines.push(...compatSection(compRows, '> 状态口径：✅ 端已落地·本组件可用；🟡 端原型映射·组件级接线未开始；⬜ 端未开始。端架构对照（引擎 / 运行时 / 持久化）见 [端与成熟度](/docs/framework/ends-matrix)。'))
    if (props.length) {
      lines.push('## Props')
      lines.push('')
      lines.push('| 属性 | 说明 | 类型 | 默认值 | 必填 |')
      lines.push('|---|---|---|---|---|')
      for (const p of props) {
        // 说明：源码 JSDoc 优先，公约属性兑底（COMMON_PROP_DOCS——pid/disabled 等跨组件公约语义）；escMd 防描述/默认值竖线断列
        const doc = p.doc !== '—' ? p.doc : COMMON_PROP_DOCS[p.name] ?? '—'
        lines.push(`| \`${p.name}\` | ${escMd(doc)} | \`${escMd(p.type)}\` | ${p.default ? `\`${escMd(p.default)}\`` : p.required ? '**是**' : '—'} | ${p.required ? '**是**' : '否'} |`)
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
    lines.push(`<!-- generated by website/scripts/gen-content.mjs · 源码 SSOT：src/components/${dir}/index.vue -->`)
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
  return ok
}

// —— ② 能力页 ——
// ★#481 数据准备抽共享（zh 路径行为不变——同一函数输出必须与重构前逐字节一致）：zh 与 EN pass 同源
function capContext(ir) {
  const caps = ir.PRIMITIVE_CATALOG.filter((p) => p.kind === 'capability')
  const apiSrc = fs.readFileSync(path.join(ROOT, 'packages', 'api', 'src', 'capability.ts'), 'utf8')
  const wxKeys = new Set(extractFnKeys(apiSrc, 'wxBridge'))
  const webKeys = new Set(extractFnKeys(apiSrc, 'webBridge'))
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
  const cleanDoc = (t) => t.split('\n').map((l) => l.replace(/^\s*\*\s?/, '').trim()).filter(Boolean).join(' ')
  while ((m = re.exec(iface))) hookDocs[m[2]] = cleanDoc(m[1])
  const hooksBody = apiSrc.slice(apiSrc.indexOf('export function createCapabilityHooks'))
  const reLine = /\/\/\s*(.+?)\s*\n\s*(use[A-Z]\w*|set[A-Z]\w*):/g
  while ((m = reLine.exec(hooksBody))) if (!hookDocs[m[2]]) hookDocs[m[2]] = m[1].trim()
  const bridgeIface = apiSrc.slice(apiSrc.indexOf('export interface CapabilityBridge'), apiSrc.indexOf('export interface CapabilityHooks'))
  const bridgeDocs = {}
  const reBridge = new RegExp(`${JSDOC}\\s*\\n\\s*(\\w+)\\??\\s*\\(`, 'g')
  while ((m = reBridge.exec(bridgeIface))) bridgeDocs[m[2]] = cleanDoc(m[1])
  const keyHits = [...hooksBody.matchAll(/\b(use[A-Z]\w*|set[A-Z]\w*):/g)]
  const hookRefs = {}
  for (let k = 0; k < keyHits.length; k++) {
    const hook = keyHits[k][1]
    const end = k + 1 < keyHits.length ? keyHits[k + 1].index : hooksBody.length
    const refs = [...hooksBody.slice(keyHits[k].index, end).matchAll(/bridge\.(\w+)\(/g)].map((x) => x[1])
    hookRefs[hook] = [...new Set(refs)]
    if (hookDocs[hook]) continue
    const bm = refs[0]
    if (bm && bridgeDocs[bm]) hookDocs[hook] = bridgeDocs[bm].replace(/^C\d+\s+/, '')
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
  // ★#407：旗舰 hook 的真实用法示例（SSOT = 签名；示例值按参数语义给典型值）
  // ★#490 扩全：句柄型 hook（返回方法集/同步状态）通用模板完全失效或误导（await 非句柄）——逐个手写；
  //   纯数据/void 型由 CAP_ARGS（真实参数值）+ CAP_DATA_HINTS（按返回类型的 data 用法行）差异化生成，不再 50 页一版
  const USAGE_EXAMPLES = {
    useFetch: [
      "const res = await useFetch<{ id: number; name: string }>('/api/user/1')",
      '',
      'if (res.ok) {',
      '  console.log(res.data.name) // 响应自动 JSON 反序列化',
      "} else if (res.error.code === 'fetch.unsupported') {",
      '  // 桥未提供 request → 降级路径',
      '}',
    ],
    useWebSocket: [
      "const res = await useWebSocket('wss://echo.example.com')",
      '',
      'if (res.ok) {',
      '  const ws = res.data',
      "  const off = ws.on('message', (payload) => console.log('收到:', payload))",
      "  ws.send('hello')",
      "  // off() 取消订阅；ws.close(1000, 'done') 关闭连接",
      "} else if (res.error.code.endsWith('.unsupported')) {",
      '  // 平台不支持 → 降级路径',
      '}',
    ],
    useSocketTask: [
      "const res = await useSocketTask('wss://echo.example.com')",
      '',
      'if (res.ok) {',
      '  const task = res.data',
      "  task.onMessage((msg) => console.log('收到:', msg))",
      "  await task.send('hello')",
      "  // await task.close(1000, 'done')；task.isConnected() 查询连接态",
      "} else if (res.error.code.endsWith('.unsupported')) {",
      '  // 平台不支持 → 降级路径',
      '}',
    ],
    useDataChannel: [
      "const res = await useDataChannel({ channelId: 'room-42' })",
      '',
      'if (res.ok) {',
      '  const channel = res.data',
      "  channel.onMessage((msg) => console.log('通道消息:', msg))",
      "  await channel.send('hello')",
      "} else if (res.error.code.endsWith('.unsupported')) {",
      '  // 数据通道需宿主桥 → 降级路径',
      '}',
    ],
    useCookie: [
      'const res = await useCookie()',
      '',
      'if (res.ok) {',
      '  const jar = res.data',
      "  jar.set('theme', 'dark', 86400)",
      "  console.log('theme =', jar.get('theme'), '· 共', Object.keys(jar.list()).length, '条')",
      "  // jar.remove('theme') 删除",
      "} else if (res.error.code.endsWith('.unsupported')) {",
      '  // 平台不支持 → 降级路径',
      '}',
    ],
    useBackground: [
      'const res = await useBackground()',
      '',
      'if (res.ok) {',
      '  const bg = res.data',
      "  const off = bg.onEvent((e) => console.log(e.type === 'enter-background' ? '进入后台' : '回到前台', e.time))",
      '  // off() 取消订阅',
      "} else if (res.error.code.endsWith('.unsupported')) {",
      '  // 平台不支持 → 降级路径',
      '}',
    ],
    useLive: [
      "const res = await useLive({ roomId: 'room-42', mode: 'video' })",
      '',
      'if (res.ok) {',
      "  console.log('房间状态:', res.data.status())",
      '  // await res.data.leave() 退出房间',
      "} else if (res.error.code.endsWith('.unsupported')) {",
      '  // 直播需宿主桥 → 降级路径',
      '}',
    ],
    useMap: [
      "const res = await useMap('map-1')",
      '',
      'if (res.ok) {',
      '  const map = res.data',
      '  await map.moveTo(31.2304, 121.4737, 12) // 上海人民广场，缩放 12',
      '  const region = await map.getRegion()',
      "  if (region.ok) console.log('中心:', region.data.latitude, region.data.longitude)",
      "} else if (res.error.code.endsWith('.unsupported')) {",
      '  // 地图需宿主集成 → 降级路径',
      '}',
    ],
    useMiniProgram: [
      'const res = await useMiniProgram()',
      '',
      'if (res.ok) {',
      "  await res.data.navigate({ appId: 'wx1234567890abcdef', path: 'pages/index', extraData: { from: 'proteus' } })",
      "} else if (res.error.code.endsWith('.unsupported')) {",
      '  // web 无对等 API → Err 显式降级',
      '}',
    ],
    useAnalytics: [
      'const analytics = useAnalytics() // 同步句柄——无 await、无 res.ok',
      '',
      "await analytics.track('page_view', { page: '/home' })",
      '// web 无标准上报 API → track 返回 Err（诚实降级，不抛异常）',
    ],
    useLog: [
      'const logger = useLog() // 同步句柄——无 await、无 res.ok',
      '',
      "await logger.log('启动完成', { ts: Date.now() })",
      "await logger.warn('内存偏高')",
      "await logger.error('请求失败', { code: 500 })",
    ],
    usePerformance: [
      'const perf = usePerformance() // 同步句柄——无 await、无 res.ok',
      '',
      'if (perf.ok) {',
      '  const ents = await perf.data.getEntries("navigation")',
      "  if (ents.ok) console.log('导航耗时:', ents.data[0]?.duration, 'ms')",
      '  perf.data.report(101, performance.now()) // 上报平台性能监控指标',
      '  const obs = perf.data.createObserver()',
      '  obs.observe((list) => console.log("新条目:", list.length))',
      "} else if (perf.error.code === 'performance.unsupported') {",
      '  // 平台不支持 → 降级路径',
      '}',
    ],
    usePreload: [
      'const pre = usePreload() // 同步句柄——无 await、无 res.ok',
      '',
      'if (pre.ok) {',
      '  await pre.data.assets([{ src: "/assets/title.woff", type: "font" }])',
      '  await pre.data.subpackage("workers") // 预下载 workers 分包',
      '  // await pre.data.skylineView() / await pre.data.webview()',
      "} else if (pre.error.code === 'preload.unsupported') {",
      '  // Web 无标准预加载 → 降级路径（<link rel=preload>）',
      '}',
    ],
    useImageEdit: [
      'const edit = useImageEdit() // 同步句柄——无 await、无 res.ok',
      '',
      'if (edit.ok) {',
      '  const cropped = await edit.data.crop("wxfile://tmp/a.png", "1:1")',
      "  if (cropped.ok) console.log('裁剪结果:', cropped.data)",
      '  const edited = await edit.data.edit("wxfile://tmp/a.png")',
      "} else if (edit.error.code === 'image-edit.unsupported') {",
      '  // Web 无微信编辑 UI → 降级路径（canvas 自实现）',
      '}',
    ],
    useSocket: [
      'const sock = useSocket() // 同步句柄——无 await、无 res.ok',
      '',
      'if (sock.ok) {',
      '  const udp = sock.data.udp()',
      '  await udp.bind(8080)',
      "  udp.onMessage((m) => console.log('收到:', m.remoteAddress, m.remotePort))",
      "  await udp.send('192.168.1.1', 9000, 'ping')",
      '  // 或 TCP：const tcp = sock.data.tcp(); await tcp.connect({ address, port })',
      "} else if (sock.error.code === 'socket.unsupported') {",
      '  // Web 浏览器不支持裸 socket → 降级路径（WebSocket/WebRTC）',
      '}',
    ],
    useMediaProcessing: [
      'const mp = useMediaProcessing() // 同步句柄——无 await、无 res.ok',
      '',
      'if (mp.ok) {',
      '  const c = mp.data.container()',
      "  await c.addTrack({ kind: 'video', src: 'a.mp4' })",
      "  const out = await c.export() // 合成导出视频",
      "  const d = mp.data.videoDecoder()",
      "  await d.start({ source: 'a.mp4' })",
      '  const frame = await d.getFrameData() // 取帧',
      "} else if (mp.error.code === 'media-processing.unsupported') {",
      '  // Web 无标准媒体合成 → 降级路径（WebCodecs 编排）',
      '}',
    ],
    useAppLifecycle: [
      'const app = useAppLifecycle() // 同步句柄——无 await、无 res.ok',
      '',
      "console.log('当前阶段:', app.phase)",
      "const off = app.onShow(() => console.log('回到前台'))",
      '// app.onLaunch(...) / app.onHide(...)；off() 取消订阅',
    ],
    usePageLifecycle: [
      'const page = usePageLifecycle() // 同步句柄——无 await、无 res.ok',
      '',
      "console.log('页面阶段:', page.phase)",
      "const off = page.onShow(() => console.log('页面可见'))",
      '// page.onLoad(...) / page.onHide(...)；off() 取消订阅',
    ],
    useFileSystem: [
      'const fs = useFileSystem() // 同步句柄——无 await、无 res.ok',
      '',
      "const res = await fs.writeFile('logs/app.log', 'hello proteus')",
      'if (res.ok) {',
      "  const read = await fs.readFile('logs/app.log')",
      "  if (read.ok) console.log('内容:', read.data)",
      '}',
      "// fs.exists(path) / fs.remove(path)；web 无 FS Access API → 内存降级（supported 仍为 true）",
    ],
    useKeyboard: [
      'const kb = useKeyboard() // 同步句柄——无 await、无 res.ok',
      '',
      "console.log('键盘高度:', kb.info.height, '可见:', kb.info.visible)",
      "const off = kb.onChange((info) => console.log('键盘高度变化:', info.height, info.visible))",
      '// off() 取消订阅',
    ],
    useAuth: [
      'const auth = useAuth() // 同步状态——auth.isAuthenticated 可直接绑定 UI',
      '',
      'if (!auth.isAuthenticated) {',
      '  const res = await auth.login() // 渠道由宿主桥决定；无 login 桥 → Err 显式降级',
      "  if (res.ok) console.log('登录成功，token 已托管')",
      '}',
      '// auth.setToken(token) 手动接管会话；await auth.logout() 登出；auth.subscribe(cb) 订阅登录态',
    ],
    useStorage: [
      'const store = useStorage() // 同步句柄——无 await、无 res.ok',
      '',
      "store.set('theme', 'dark')",
      "console.log('theme =', store.get('theme'))",
      "// store.remove(key) / store.clear()；响应式增强：createReactiveStorage(store, reactive)",
    ],
    useCanvas: [
      "const c = useCanvas('myCanvas') // 同步句柄——无 await、无 res.ok",
      '',
      'if (c.ok) {',
      '  const ctx = c.data.createContext()',
      '  if (ctx.ok) {',
      "    ctx.data.setFillStyle('#5b8cff')",
      '    ctx.data.beginPath()',
      '    ctx.data.arc(60, 60, 40, 0, Math.PI * 2)',
      '    ctx.data.fill()',
      '    ctx.data.draw() // 提交绘制（wx 异步；web 即时）',
      '  }',
      '  // 导出：await c.data.toTempFilePath({ fileType: "png" })',
      '  // 2D node（requestAnimationFrame）：await c.data.node()',
      "} else if (c.error.code === 'canvas.unsupported') {",
      '  // 桥未提供画布 API → 降级路径',
      '}',
    ],
    useElement: [
      "const q = useElement('box') // 同步句柄——无 await、无 res.ok",
      '',
      'if (q.ok) {',
      '  const rect = await q.data.boundingClientRect() // 几何',
      "  if (rect.ok) console.log('宽高:', rect.data.width, rect.data.height)",
      '  // await q.data.scrollOffset() / q.data.size() / q.data.fields({ node: true })',
      '  // await q.data.batch([".item", "#footer"]) 批量',
      "} else if (q.error.code === 'element.unsupported') {",
      '  // 桥未提供查询 API → 降级路径',
      '}',
    ],
    useIntersection: [
      'const obs = useIntersection({ thresholds: [0.5] }) // 同步句柄——无 await、无 res.ok',
      '',
      'if (obs.ok) {',
      '  obs.data',
      '    .relativeToViewport()',
      "    .observe('.lazy-item', (res) => {",
      "      if (res.intersectionRatio >= 0.5) console.log('进入视口:', res.id)",
      '    })',
      '  // obs.data.disconnect() 停止观察（释放）',
      "} else if (obs.error.code === 'element.unsupported') {",
      '  // 桥未提供交叉观察 API → 降级路径',
      '}',
    ],
    useMediaQuery: [
      'const mq = useMediaQuery() // 同步句柄——无 await、无 res.ok',
      '',
      'if (mq.ok) {',
      "  mq.data.observe({ minWidth: 600, orientation: 'landscape' }, (res) => {",
      "    console.log('宽屏:', res.matches)",
      '  })',
      '  // mq.data.disconnect() 停止观察',
      "} else if (mq.error.code === 'element.unsupported') {",
      '  // 桥未提供媒体查询 API → 降级路径',
      '}',
    ],
    useVideo: [
      "const v = useVideo('myVideo') // 同步句柄——无 await、无 res.ok",
      '',
      'if (v.ok) {',
      '  await v.data.play()',
      '  await v.data.seek(12) // 跳到第 12 秒',
      '  await v.data.playbackRate(1.5) // 1.5 倍速',
      "  v.data.on('ended', () => console.log('播放结束'))",
      "} else if (v.error.code === 'video.unsupported') {",
      '  // 桥未提供视频 API → 降级路径',
      '}',
    ],
    useAudio: [
      "const a = useAudio('https://cdn.example.com/bgm.mp3') // 同步句柄——无 await、无 res.ok",
      '',
      'if (a.ok) {',
      '  a.data.setVolume(0.8)',
      '  a.data.setLoop(true)',
      '  await a.data.play()',
      "  a.data.on('ended', () => console.log('播放结束'))",
      '  // a.data.destroy() 释放资源',
      "} else if (a.error.code === 'audio.unsupported') {",
      '  // 桥未提供音频 API → 降级路径',
      '}',
    ],
    useLivePusher: [
      "const pusher = useLivePusher('livePusher') // 同步句柄——无 await、无 res.ok",
      '',
      'if (pusher.ok) {',
      '  await pusher.data.start() // 开始推流',
      '  await pusher.data.switchCamera() // 切换前后摄像头',
      "  const shot = await pusher.data.snapshot() // 截图",
      "  pusher.data.on('netstatus', (s) => console.log('网络:', s))",
      "} else if (pusher.error.code === 'live-pusher.unsupported') {",
      '  // Web 无标准推流 API → 降级路径（宿主桥）',
      '}',
    ],
    useAd: [
      'const ad = useAd() // 同步句柄——无 await、无 res.ok',
      '',
      'if (ad.ok) {',
      "  const rv = ad.data.rewardedVideo('adunit-xxxx') // 同 id 复用实例",
      '  rv.onClose((res) => {',
      "    if (res.isEnded) console.log('观看完毕，发放奖励')",
      '  })',
      '  await rv.load()',
      '  await rv.show()',
      "} else if (ad.error.code === 'ad.unsupported') {",
      '  // Web 无广告联盟标准 API → 降级路径（宿主桥）',
      '}',
    ],
    usePrivacy: [
      'const privacy = usePrivacy() // 同步句柄——无 await、无 res.ok',
      '',
      'if (privacy.ok) {',
      '  const setting = await privacy.data.getSetting()',
      "  if (setting.ok && setting.data.needAuthorization) {",
      '    // 用户在页面触发隐私接口但未同意 → 弹自家协议 UI',
      '    privacy.data.onNeedAuthorization((res) => {',
      "      console.log('需同意:', res.privacyContractName)",
      '    })',
      '    await privacy.data.openContract() // 或打开微信隐私协议页',
      '  }',
      "} else if (privacy.error.code === 'privacy.unsupported') {",
      '  // Web 无微信隐私协议标准 → 降级路径（宿主自建 Cookie 同意）',
      '}',
    ],
    useScreenCapture: [
      'const sc = useScreenCapture() // 同步句柄——无 await、无 res.ok',
      '',
      'if (sc.ok) {',
      "  const st = await sc.data.getRecordingState()",
      "  if (st.ok) console.log('录屏状态:', st.data)",
      "  sc.data.onUserCapture(() => console.log('用户截屏了'))",
      "  const pip = await sc.data.isPictureInPictureActive()",
      "} else if (sc.error.code === 'screen-capture.unsupported') {",
      '  // Web 无标准录屏状态 API → 降级路径',
      '}',
    ],
    useCacheManager: [
      "const cm = useCacheManager({ mode: 'weakNetwork', maxAge: 60 }) // 同步句柄",
      '',
      'if (cm.ok) {',
      "  await cm.data.addRules([{ pattern: 'https://api.example.com/*', method: 'GET' }])",
      '  await cm.data.start()',
      "  cm.data.on('enterWeakNetwork', () => console.log('进入弱网，启用缓存'))",
      "} else if (cm.error.code === 'cache-manager.unsupported') {",
      '  // Web 无对等 → 降级路径（Service Worker / Cache Storage）',
      '}',
    ],
    useIdle: [
      'const idle = useIdle() // 同步句柄——无 await、无 res.ok',
      '',
      'if (idle.ok) {',
      '  const id = await idle.data.request((d) => {',
      '    // 在空闲时间做非关键工作（d.timeRemaining() 剩余 ms）',
      '    console.log("空闲剩余:", d.timeRemaining(), "ms")',
      '  }, 2000)',
      '  // if (id.ok) await idle.data.cancel(id.data)',
      "} else if (idle.error.code === 'idle.unsupported') {",
      '  // 平台不支持 → 降级路径',
      '}',
    ],
    useWindow: [
      'const win = useWindow() // 同步句柄——无 await、无 res.ok',
      '',
      'if (win.ok) {',
      '  await win.data.setSize(1280, 720) // PC 端调整窗口（需屏幕足够大）',
      "} else if (win.error.code === 'window.unsupported') {",
      '  // 非 PC 端 / Web 无标准 → 降级路径',
      '}',
    ],
    useNavigationGuard: [
      'const guard = useNavigationGuard() // 同步句柄——无 await、无 res.ok',
      '',
      'if (guard.ok) {',
      "  await guard.data.enable('表单未保存，确认离开？')",
      '  // 保存成功后：await guard.data.disable()',
      "} else if (guard.error.code === 'navigation-guard.unsupported') {",
      '  // 平台不支持 → 降级路径',
      '}',
    ],
    useAR: [
      "const ar = useAR() // 同步句柄——无 await、无 res.ok",
      '',
      "if (ar.ok) {",
      "  const supported = await ar.data.isSupported('v2')",
      '  if (supported.ok && supported.data) {',
      "    const session = ar.data.createSession({ track: { plane: {} }, version: 'v2' })",
      '    await session.start()',
      "    session.on('update', (frame) => console.log('AR 帧:', frame))",
      '  }',
      "} else if (ar.error.code === 'ar.unsupported') {",
      '  // 平台不支持视觉算法 → 降级路径',
      '}',
    ],
    useBeacon: [
      'const beacon = useBeacon() // 同步句柄——无 await、无 res.ok',
      '',
      'if (beacon.ok) {',
      '  beacon.data.onServiceChange((res) => console.log("Beacon 服务:", res.available))',
      '  beacon.data.onUpdate((res) => console.log("发现:", res.beacons.length, "个 Beacon"))',
      "} else if (beacon.error.code === 'beacon.unsupported') {",
      '  // 平台不支持 → 降级路径',
      '}',
    ],
    useLocalService: [
      'const mdns = useLocalService() // 同步句柄——无 await、无 res.ok',
      '',
      'if (mdns.ok) {',
      '  mdns.data.onFound((svc) => console.log("发现服务:", svc.serviceName, svc.ip, svc.port))',
      '  mdns.data.onLost((svc) => console.log("服务离开:", svc.serviceName))',
      '  mdns.data.onDiscoveryStop(() => console.log("搜索停止"))',
      "} else if (mdns.error.code === 'local-service.unsupported') {",
      '  // 平台不支持 mDNS → 降级路径',
      '}',
    ],
    useTranslation: [
      'const tr = useTranslation() // 同步句柄——无 await、无 res.ok',
      '',
      'if (tr.ok) {',
      '  tr.data.onTrigger((res) => console.log("用户触发翻译:", res.locale, res.type))',
      '  tr.data.onOff(() => console.log("用户取消翻译"))',
      "} else if (tr.error.code === 'translation.unsupported') {",
      '  // 平台不支持 → 降级路径',
      '}',
    ],
    usePoster: [
      'const poster = usePoster() // 同步句柄——无 await、无 res.ok',
      '',
      'if (poster.ok) {',
      '  poster.data.onGenerate((res) => console.log("海报已生成:", res.src))',
      "} else if (poster.error.code === 'poster.unsupported') {",
      '  // 平台不支持 → 降级路径',
      '}',
    ],
    useDeviceCapability: [
      'const cap = useDeviceCapability() // 同步句柄——无 await、无 res.ok',
      '',
      'if (cap.ok) {',
      '  const hevc = await cap.data.supportsHevc()',
      '  if (hevc.ok) console.log("支持 HEVC 硬解:", hevc.data)',
      "} else if (cap.error.code === 'device-capability.unsupported') {",
      '  // 平台无法探测 → 降级路径（按不支持处理）',
      '}',
    ],
  }
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
    if (doc) {
      lines.push(doc)
      lines.push('')
    }
    lines.push(`> 能力原语 ${c.id} · \`${c.semantic}\` · 返回 \`${(c.props ?? [])[0] ?? 'Result<T>'}\` · **Hook 已实现**（API 就绪，双端桥见下表）`)
    lines.push('')
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
        const desc = ti?.doc || COMMON_PARAM_DOCS[p.name] || '—'
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
      lines.push('`Promise<CapResult<T>>`——铁律：无回调、无 try/catch 义务，`res.ok` 分支处理：')
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
    if (allMethods.length) {
      lines.push('## 方法')
      lines.push('')
      lines.push('| 方法 | 签名 | 说明 |')
      lines.push('|---|---|---|')
      for (const mm of allMethods) lines.push(`| [\`${mm.name}\`](#${mm.name.toLowerCase()}) | \`${escMd(mm.sig)}\` | ${mm.doc ? mm.doc.replace(/^C\d+\s+/, '') : '—'} |`)
      lines.push('')
      renderMethodDetails(lines, allMethods, { hLevel: '###', paramCols: ['参数', '类型', '必填', '说明', '否', '是'], returnsLabel: '返回值', descLabel: '说明' })
    }
    // ## 属性（h2）
    if (allProps.length) {
      lines.push('## 属性')
      lines.push('')
      lines.push('| 属性 | 类型 | 必填 | 说明 |')
      lines.push('|---|---|---|---|')
      for (const pr of allProps) lines.push(`| \`${pr.name}\` | \`${escMd(pr.type)}\` | ${pr.optional ? '否' : '是'} | ${pr.doc || '—'} |`)
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
    // ★兼容进度（uni-app 式全端对照）：端列/状态 = ENDS 注册表；Web 列 ✅/⚠️ 由 webBridge 实际方法集推导
    const wxMissing = refs.filter((r) => !wxKeys.has(r))
    const webMissing = refs.filter((r) => !webKeys.has(r))
    const capRows = []
    for (const end of ends) {
      let status = STATUS_MARK[end.status] ?? '⬜'
      let note = ''
      switch (end.id) {
        case 'mp-weixin':
          status = wxMissing.length ? '⚠️' : '✅'
          note = wxMissing.length ? `wx 桥未提供 ${wxMissing.join('/')} → Err 显式降级` : `wx 桥 → ${c.mpEquiv}`
          break
        case 'web':
          if (!refs.length) {
            note = 'webBridge 平台桥（wx 缺席时默认注入）'
          } else if (webMissing.length) {
            status = '⚠️'
            note = `webBridge 未提供 ${webMissing.join('/')} → Err 显式降级（平台无直通 API）`
          } else {
            note = 'webBridge 实现（平台 API 直连）'
          }
          break
        case 'headless': note = 'mock 桥注入（测试 / SSR 档）'; break
        case 'flutter': note = '同一 JS 逻辑层——能力桥未接线'; break
        case 'quick-app': note = '端未开始'; break
        default: note = '端原型映射——能力桥未接线'
      }
      capRows.push({ name: end.name, status, note: `${end.engine} · ${note}` })
    }
    lines.push(...compatSection(capRows, '> 状态口径：✅ 端已落地·本能力可用；⚠️ 端已落地·桥未提供→Err 显式降级；🟡 端原型映射·能力桥未接线；⬜ 端未开始。端架构对照见 [端与成熟度](/docs/framework/ends-matrix)。'))
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
            for (const pr of ehIface.props) lines.push(`| \`${pr.name}\` | \`${escMd(pr.type)}\` | ${pr.optional ? '否' : '是'} | ${pr.doc || '—'} |`)
            lines.push('')
          }
          if (ehIface.methods.length) {
            lines.push(`#### \`${ehT}\` 的方法`)
            lines.push('')
            lines.push('| 方法 | 签名 | 说明 |')
            lines.push('|---|---|---|')
            for (const mm of ehIface.methods) lines.push(`| \`${mm.name}\` | \`${escMd(mm.sig)}\` | ${mm.doc || '—'} |`)
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
    if (USAGE_EXAMPLES[hook]) {
      // 句柄型/旗舰 hook 手写示例（值取典型场景——参数契约以「参数」表为准）
      lines.push(...USAGE_EXAMPLES[hook])
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
    lines.push('<!-- generated by website/scripts/gen-content.mjs (en overlay) · source SSOT: src/components/' + dir + '/index.vue -->')
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
    lines.push(page.desc || CAP_SHARED_EN.noDataGeneric)
    lines.push('')
    lines.push(CAP_SHARED_EN.callout(c.id, c.semantic, (c.props ?? [])[0] ?? 'Result<T>'))
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
      lines.push(CAP_SHARED_EN.methodCols)
      lines.push('|---|---|---|')
      for (const mm of allMethodsEn) {
        const doc = (CAP_METHODS_EN[shape.dataElemT] && CAP_METHODS_EN[shape.dataElemT][mm.name]) || (handleT && CAP_METHODS_EN[handleT] && CAP_METHODS_EN[handleT][mm.name]) || '—'
        lines.push(`| [\`${mm.name}\`](#${mm.name.toLowerCase()}) | \`${esc(mm.sig)}\` | ${esc(doc)} |`)
      }
      lines.push('')
      for (const mm of allMethodsEn) {
        const doc = (CAP_METHODS_EN[shape.dataElemT] && CAP_METHODS_EN[shape.dataElemT][mm.name]) || (handleT && CAP_METHODS_EN[handleT] && CAP_METHODS_EN[handleT][mm.name]) || ''
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
        lines.push(`| \`${pr.name}\` | \`${esc(pr.type)}\` | ${pr.optional ? 'No' : 'Yes'} | ${esc(doc)} |`)
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
    const wxMissing = refs.filter((r) => !wxKeys.has(r))
    const webMissing = refs.filter((r) => !webKeys.has(r))
    const mpEquivEn = /[\u4e00-\u9fff]/.test(c.mpEquiv) ? '(wx-native equivalent; exact mapping in the zh version)' : c.mpEquiv // 目录 mpEquiv 含中文时 EN 降级
    lines.push(CAP_SHARED_EN.hCompat)
    lines.push('')
    lines.push('| Target | Status | Notes |')
    lines.push('|---|---|---|')
    for (const end of ends) {
      let status = STATUS_MARK[end.status] ?? '⬜'
      let note
      switch (end.id) {
        case 'mp-weixin':
          status = wxMissing.length ? '⚠️' : '✅'
          note = CAP_SHARED_EN.endNote.mp(wxMissing, mpEquivEn)
          break
        case 'web':
          if (!refs.length) note = CAP_SHARED_EN.endNote.webNoRefs
          else if (webMissing.length) {
            status = '⚠️'
            note = CAP_SHARED_EN.endNote.webMissing(webMissing)
          } else note = CAP_SHARED_EN.endNote.webOk
          break
        case 'headless': note = CAP_SHARED_EN.endNote.headless; break
        case 'flutter': note = CAP_SHARED_EN.endNote.flutter; break
        case 'quick-app': note = CAP_SHARED_EN.endNote['quick-app']; break
        default: note = CAP_SHARED_EN.endNote.prototype
      }
      const endEn = ENDS_EN[end.id]
      lines.push(`| ${endEn?.name ?? end.name} | ${status} | ${endEn?.engine ?? end.engine} · ${note} |`)
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
            for (const pr of ehIface.props) lines.push(`| \`${pr.name}\` | \`${escMd(pr.type)}\` | ${pr.optional ? 'No' : 'Yes'} | ${pr.doc || '—'} |`)
            lines.push('')
          }
          if (ehIface.methods.length) {
            lines.push(`#### \`${ehT}\` methods`)
            lines.push('')
            lines.push('| Method | Signature | Doc |')
            lines.push('|---|---|---|')
            for (const mm of ehIface.methods) lines.push(`| \`${mm.name}\` | \`${escMd(mm.sig)}\` | ${mm.doc || '—'} |`)
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
                  for (const pr of rt.props) lines.push(`| \`${pr.name}\` | \`${escMd(pr.type)}\` | ${pr.doc || '—'} |`)
                  lines.push('')
                }
                if (rt.methods.length) {
                  lines.push('| Prop/Method | Type | Doc |')
                  lines.push('|---|---|---|')
                  for (const mm of rt.methods) lines.push(`| \`${mm.name}\` | \`${escMd(mm.sig)}\` | ${mm.doc || '—'} |`)
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
    if (CAP_USAGE_EN[hook]) {
      lines.push(...CAP_USAGE_EN[hook])
    } else if (handleT) {
      const lv = (hook.replace(/^use/, '') || 'handle').charAt(0).toLowerCase() + hook.replace(/^use/, '').slice(1)
      lines.push(...CAP_USAGE_EN.direct(c.api, lv))
    } else {
      const required = params.filter((p) => !p.optional).map((p) => p.name)
      const args = CAP_ARGS_EN[hook] ?? required.join(', ')
      const call = c.api.replace('()', `(${args})`)
      lines.push(...CAP_USAGE_EN.generic(call, CAP_DATA_HINTS_EN[hook], voidRet))
    }
    lines.push('```')
    lines.push('')
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
const ends = await loadEnds()
const nComp = genComponents(ir, ends)
const nCap = genCapabilities(ir, ends)
const nCompEn = await genComponentsEn(ir, ends)
const nCapEn = await genCapabilitiesEn(ir, ends)

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
