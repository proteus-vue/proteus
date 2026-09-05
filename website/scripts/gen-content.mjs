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
import { COMP_EN, DOMAIN_EN, MP_STATUS_EN, ENDS_EN, END_NOTE_EN, COMP_LEGEND_EN, SHARED_EN, OVERVIEW_EN, CAP_SHARED_EN, CAP_USAGE_EN, CAP_EN, CAP_CAT_EN, CAP_OVERVIEW_EN } from './gen-content-en.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const COMP_DIR = path.join(ROOT, 'src', 'components')
const OUT_COMP = path.join(ROOT, 'website', 'content', 'components')
const OUT_CAP = path.join(ROOT, 'website', 'content', 'capabilities')

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
  fetch: '网络与通信', websocket: '网络与通信', 'socket-task': '网络与通信', upload: '网络与通信', download: '网络与通信', 'data-channel': '网络与通信', bluetooth: '网络与通信', nfc: '网络与通信',
  device: '设备与系统', screen: '设备与系统', battery: '设备与系统', orientation: '设备与系统', brightness: '设备与系统', sensor: '设备与系统', vibrate: '设备与系统', network: '设备与系统', keyboard: '设备与系统', clipboard: '设备与系统',
  storage: '存储与文件', cookie: '存储与文件', 'file-system': '存储与文件', archive: '存储与文件',
  location: '位置与地图', map: '位置与地图',
  camera: '媒体与扫码', microphone: '媒体与扫码', live: '媒体与扫码', 'qr-code': '媒体与扫码',
  login: '账号与支付', auth: '账号与支付', biometric: '账号与支付', 'face-id': '账号与支付', permission: '账号与支付', payment: '账号与支付', 'in-app-purchase': '账号与支付',
  notification: '通知与分享', share: '通知与分享', shortcut: '通知与分享', sms: '通知与分享', contact: '通知与分享', 'phone-call': '通知与分享', calendar: '通知与分享',
  'app-lifecycle': '应用与生命周期', 'page-lifecycle': '应用与生命周期', background: '应用与生命周期', 'mini-program': '应用与生命周期', embedded: '应用与生命周期', extension: '应用与生命周期',
  analytics: '可观测与调试', log: '可观测与调试',
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
function extractInterfaces(src) {
  const out = {}
  const re = /(?:\/\*\*((?:[^*]|\*(?!\/))*)\*\/\s*\n)?export interface (\w+)(?:<[^>]*>)? \{([^\0]*?)\n\}/g
  let m
  while ((m = re.exec(src))) {
    const [, jsdoc, name, body] = m
    const props = []
    // 逐属性：前置 JSDoc（可跨行，tempered）或行尾 // 注释；方法成员/JSDoc 内文行不入表（CapabilityBridge.tel 假阳性教训）
    const pre = /((?:\/\*\*(?:[^*]|\*(?!\/))*\*\/\s*\n)?)(\s*)(\w+)(\?)?:\s*([^\n]+)/g
    let p
    while ((p = pre.exec(body))) {
      if (/\):\s/.test(p[5])) continue // 方法参数碎片（login(provider?: string): Promise<...> 的内参）——真实属性类型不含 '): '
      let doc = ''
      if (p[1]) {
        doc = p[1].replace(/\/\*\*|\*\//g, '').split('\n').map((l) => l.replace(/^\s*\*\s?/, '').trim()).filter(Boolean).join(' ')
      } else if (/\/\//.test(p[5])) {
        doc = p[5].split('//').pop().trim()
      }
      props.push({ name: p[3], optional: p[4] === '?', type: p[5].replace(/\/\/.*$/, '').trim(), doc })
    }
    out[name] = {
      doc: jsdoc ? jsdoc.replace(/\/\*\*|\*\//g, '').split('\n').map((l) => l.replace(/^\s*\*\s?/, '').trim()).filter(Boolean).join(' ') : '',
      props,
    }
  }
  return out
}

// 从实现体提取 CapError('code', 'msg') 错误码（能力页错误码表 SSOT）
function extractErrorCodes(body) {
  const out = []
  for (const m of body.matchAll(/CapError\(\s*'([^']+)'\s*,\s*'([^']+)'/g)) {
    if (!out.some((e) => e.code === m[1])) out.push({ code: m[1], message: m[2] })
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
  return out.trim().replace(/[},\s]+$/, '').replace(/\s+/g, ' ').replace(/\{\s+$/, '{}')
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
  const names = [...em[1].matchAll(/['"`]([a-zA-Z-]+)['"`]/g)].map((x) => x[1])
  return [...new Set(names)]
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
  const dirs = fs.readdirSync(COMP_DIR).filter((d) => fs.statSync(path.join(COMP_DIR, d)).isDirectory() && d.startsWith('p-'))
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
        // 说明：源码 JSDoc 优先，公约属性兑底（COMMON_PROP_DOCS——pid/disabled 等跨组件公约语义）
        const doc = p.doc !== '—' ? p.doc : COMMON_PROP_DOCS[p.name] ?? '—'
        lines.push(`| \`${p.name}\` | ${doc} | \`${p.type}\` | ${p.default ? `\`${p.default}\`` : p.required ? '**是**' : '—'} | ${p.required ? '**是**' : '否'} |`)
      }
      lines.push('')
    }
    if (emits.length) {
      lines.push('## Events')
      lines.push('')
      lines.push('| 事件 | 说明 |')
      lines.push('|---|---|')
      for (const e of emits) {
        lines.push(`| \`${e}\` | ${COMMON_EVENT_DOCS[e] ?? '—'} |`)
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
    lines.push(`<${dir}${props[0] ? ` :${props[0].name}="…"` : ''}>`)
    lines.push(`  <p-text>内容</p-text>`)
    lines.push(`</${dir}>`)
    lines.push('```')
    lines.push('')
    lines.push(`<!-- generated by website/scripts/gen-content.mjs · 源码 SSOT：src/components/${dir}/index.vue -->`)
    fs.writeFileSync(path.join(OUT_COMP, `${dir}.md`), lines.join('\n'))
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
  fs.writeFileSync(path.join(OUT_COMP, '00-components-overview.md'), idx.join('\n'))
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
  const bridgeBodies = { ...extractBridgeBodies(apiSrc, 'wxBridge'), ...extractBridgeBodies(apiSrc, 'webBridge') }
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
  return { caps, wxKeys, webKeys, ifaces, bridgeBodies, iface, hookDocs, hooksBody, hookRefs, catOf, orderOfCap }
}

function genCapabilities(ir, ends) {
  fs.mkdirSync(OUT_CAP, { recursive: true })
  const { caps, wxKeys, webKeys, ifaces, bridgeBodies, iface, hookDocs, hooksBody, hookRefs, catOf, orderOfCap } = capContext(ir)
  // ★#407：旗舰 hook 的真实用法示例（SSOT = 签名；示例值按参数语义给典型值）
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
        lines.push(`| \`${p.name}\` | \`${t}\` | ${p.optional ? '否' : '是'} | ${desc} |`)
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
          lines.push(`| \`${pr.name}\` | \`${pr.type}\` | ${pr.optional ? '否' : '是'} | ${pr.doc || '—'} |`)
        }
        lines.push('')
      }
    }
    // 返回值：CapResult<T> → ok/data/error + T 的接口属性表（AuthState/CompatStorage 等非 Promise 返回另行识别）
    const retT = sigLine.match(/CapResult<([^<>]+(?:<[^<>]+>)?)>/)
    const dataT = retT ? retT[1].trim() : ''
    const voidRet = /CapResult<void>/.test(sigLine)
    const directT = ['AuthState', 'CompatStorage'].find((t) => sigLine.includes(`: ${t}`))
    lines.push('## 返回值')
    lines.push('')
    if (directT) {
      lines.push(`返回 \`${directT}\`（同步句柄/状态对象）。`)
      lines.push('')
    } else {
      lines.push('`Promise<CapResult<T>>`——铁律：无回调、无 try/catch 义务，`res.ok` 分支处理：')
      lines.push('')
      lines.push('| 属性 | 类型 | 说明 |')
      lines.push('|---|---|---|')
      lines.push(`| \`ok\` | \`boolean\` | 成功 \`true\` / 失败 \`false\` |`)
      lines.push(dataT === 'T'
        ? '| \`data\` | \`T\` | 成功载荷——泛型，由响应内容推导（如 JSON 自动反序列化） |'
        : voidRet ? '| \`data\` | \`void\` | 成功时无载荷 |' : `| \`data\` | \`${dataT}\` | 成功载荷${ifaces[dataT]?.props.length ? '（结构见下）' : ''} |`)
      lines.push('| \`error\` | \`CapError\` | 失败时存在：\`code\`（机器码）/ \`message\`（人读原因）/ \`cause\`（原始异常） |')
      lines.push('')
    }
    if (dataT && ifaces[dataT]?.props.length) {
      lines.push(`#### \`data\`（\`${dataT}\`）的属性`)
      lines.push('')
      lines.push('| 属性 | 类型 | 必填 | 说明 |')
      lines.push('|---|---|---|---|')
      for (const pr of ifaces[dataT].props) {
        lines.push(`| \`${pr.name}\` | \`${pr.type}\` | ${pr.optional ? '否' : '是'} | ${pr.doc || '—'} |`)
      }
      lines.push('')
    } else if (directT && ifaces[directT]?.props.length) {
      lines.push(`#### \`${directT}\` 的属性`)
      lines.push('')
      lines.push('| 属性 | 类型 | 说明 |')
      lines.push('|---|---|---|')
      for (const pr of ifaces[directT].props) {
        if (pr.type.includes('=>') || pr.type.startsWith('(')) continue // 方法成员不入属性表（useAuth 的 login/logout 等——句柄方法）
        lines.push(`| \`${pr.name}\` | \`${pr.type}\` | ${pr.doc || '—'} |`)
      }
      lines.push('')
    }
    // 错误码表：hook 条目切片 + 关联桥方法实现体中 CapError('code', 'msg') 全量提取
    const hookStart = hooksBody.indexOf(`${hook}:`)
    const hookEnd = (() => {
      const hits = [...hooksBody.matchAll(/\b(use[A-Z]\w*|set[A-Z]\w*):/g)]
      const hit = hits.find((h) => h.index === hookStart)
      const idx0 = hits.indexOf(hit)
      return idx0 >= 0 && idx0 + 1 < hits.length ? hits[idx0 + 1].index : hooksBody.length
    })()
    const errBodies = refs.map((r) => bridgeBodies[r]).filter(Boolean)
    const errCodes = extractErrorCodes([hooksBody.slice(hookStart, hookEnd), ...errBodies].join('\n'))
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
    lines.push('## 用法')
    lines.push('')
    if (USAGE_EXAMPLES[hook]) {
      // 旗舰 hook 手写示例（值取典型场景——参数契约以「参数」表为准）
      lines.push('```ts')
      lines.push(...USAGE_EXAMPLES[hook])
      lines.push('```')
    } else if (directT) {
      // 同步句柄/状态对象：无 Promise 无 res.ok——按返回值结构用
      const varName = hook.replace(/^use/, '').replace(/^set[A-Z]/, (m0) => m0.toLowerCase()) || 'handle'
      const lv = varName.charAt(0).toLowerCase() + varName.slice(1)
      lines.push('```ts')
      lines.push(`const ${lv} = ${c.api}`)
      lines.push(`// ${directT} 同步句柄——属性/方法结构见「返回值」表（无 await、无 res.ok）`)
      lines.push('```')
    } else {
      // 带参 hook：传必填参数名（契约见「参数」表）；无参 hook 保持无参调用
      const required = params.filter((p) => !p.optional).map((p) => p.name)
      const call = required.length ? c.api.replace('()', `(${required.join(', ')})`) : c.api
      lines.push('```ts')
      lines.push(`const res = await ${call}`)
      lines.push('')
      lines.push('if (res.ok) {')
      lines.push('  console.log(res.data)')
      lines.push("} else if (res.error.code.endsWith('.unsupported')) {")
      lines.push('  // 平台不支持 → 降级路径')
      lines.push('}')
      lines.push('```')
    }
    lines.push('')
    lines.push('<!-- generated by website/scripts/gen-content.mjs · 源码 SSOT：packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->')
    fs.writeFileSync(path.join(OUT_CAP, `${c.semantic.replace('capability.', '')}.md`), lines.join('\n'))
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
  fs.writeFileSync(path.join(OUT_CAP, '00-capabilities-overview.md'), idx.join('\n'))
  return ok
}

// —— ①-EN 组件 overlay（★#481 生成器双语输出——zh 路径零改动，EN 变体由 COMP_EN 字段驱动） ——
// 对 COMP_EN 登记的 slug 额外产出 website/en/components/<slug>.md：文案全部取 EN 字段（desc/notes/props/events），
// 未登记的组件在英文态走 #noEn 回退（诚实降级，不混排中文）。
async function genComponentsEn(ir, ends) {
  const OUT = path.join(ROOT, 'website', 'en', 'components')
  const dirs = fs.readdirSync(COMP_DIR).filter((d) => fs.statSync(path.join(COMP_DIR, d)).isDirectory() && d.startsWith('p-'))
  const semanticMap = ir.TAG_SEMANTIC_MAP ?? ir.SEMANTIC_TAG_MAP ?? {}
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
    }
    if (emits.length) {
      lines.push(SHARED_EN.hEvents)
      lines.push('')
      lines.push(SHARED_EN.eventsCols)
      lines.push('|---|---|')
      for (const e of emits) lines.push(`| \`${e}\` | ${esc(page.events?.[e] ?? '—')} |`)
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
    fs.writeFileSync(path.join(OUT, `${dir}.md`), lines.join('\n'))
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
    fs.writeFileSync(path.join(OUT, '00-components-overview.md'), idx.join('\n'))
  }
  return ok
}

// —— ②-EN 能力 overlay（★#481 生成器双语输出——zh 数据准备与 genCapabilities 同源 capContext；文案查 CAP_EN/CAP_SHARED_EN） ——
// 登记在 CAP_EN 的 slug 额外产出 website/en/capabilities/<slug>.md；未登记的走 #noEn 回退。
async function genCapabilitiesEn(ir, ends) {
  const OUT = path.join(ROOT, 'website', 'en', 'capabilities')
  const { caps, wxKeys, webKeys, ifaces, iface, hookDocs, hooksBody, bridgeBodies, hookRefs, catOf, orderOfCap } = capContext(ir)
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
    const retT = sigLine.match(/CapResult<([^<>]+(?:<[^<>]+>)?)>/)
    const dataT = retT ? retT[1].trim() : ''
    const voidRet = /CapResult<void>/.test(sigLine)
    const directT = ['AuthState', 'CompatStorage'].find((t) => sigLine.includes(`: ${t}`))
    lines.push(CAP_SHARED_EN.hReturns)
    lines.push('')
    if (directT) {
      lines.push(CAP_SHARED_EN.directReturn(directT))
      lines.push('')
    } else {
      lines.push(CAP_SHARED_EN.returnsIntro)
      lines.push('')
      lines.push(CAP_SHARED_EN.retCols)
      lines.push('|---|---|---|')
      lines.push(`| \`ok\` | \`boolean\` | ${esc(CAP_SHARED_EN.retOk)} |`)
      if (dataT === 'T') lines.push(`| \`data\` | \`T\` | ${esc(CAP_SHARED_EN.retDataGeneric)} |`)
      else if (voidRet) lines.push(`| \`data\` | \`void\` | ${esc(CAP_SHARED_EN.retDataVoid)} |`)
      else lines.push(`| \`data\` | \`${esc(dataT)}\` | Success payload${ifaces[dataT]?.props.length ? ' (structure below)' : ''} |`)
      lines.push(`| \`error\` | \`CapError\` | ${esc(CAP_SHARED_EN.retError)} |`)
      lines.push('')
    }
    if (dataT && ifaces[dataT]?.props.length) {
      lines.push(CAP_SHARED_EN.dataPropsTitle(dataT))
      lines.push('')
      lines.push(CAP_SHARED_EN.propCols)
      lines.push('|---|---|---|---|')
      for (const pr of ifaces[dataT].props) {
        lines.push(`| \`${pr.name}\` | \`${esc(pr.type)}\` | ${pr.optional ? 'No' : 'Yes'} | ${esc((page.dataProps && page.dataProps[pr.name]) || '—')} |`)
      }
      lines.push('')
    } else if (directT && ifaces[directT]?.props.length) {
      lines.push(CAP_SHARED_EN.directPropsTitle(directT))
      lines.push('')
      lines.push(CAP_SHARED_EN.retCols)
      lines.push('|---|---|---|')
      for (const pr of ifaces[directT].props) {
        if (pr.type.includes('=>') || pr.type.startsWith('(')) continue
        lines.push(`| \`${pr.name}\` | \`${esc(pr.type)}\` | ${esc((page.directProps && page.directProps[pr.name]) || '—')} |`)
      }
      lines.push('')
    }
    const hookStart = hooksBody.indexOf(`${hook}:`)
    const hookEnd = (() => {
      const hits = [...hooksBody.matchAll(/\b(use[A-Z]\w*|set[A-Z]\w*):/g)]
      const hit = hits.find((h) => h.index === hookStart)
      const idx0 = hits.indexOf(hit)
      return idx0 >= 0 && idx0 + 1 < hits.length ? hits[idx0 + 1].index : hooksBody.length
    })()
    const refs = hookRefs[hook] ?? []
    const errBodies = refs.map((r) => bridgeBodies[r]).filter(Boolean)
    const errCodes = extractErrorCodes([hooksBody.slice(hookStart, hookEnd), ...errBodies].join('\n'))
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
    lines.push(CAP_SHARED_EN.hUsage)
    lines.push('')
    lines.push('```ts')
    if (CAP_USAGE_EN[hook]) {
      lines.push(...CAP_USAGE_EN[hook])
    } else if (directT) {
      const varName = hook.replace(/^use/, '').replace(/^set[A-Z]/, (m0) => m0.toLowerCase()) || 'handle'
      const lv = varName.charAt(0).toLowerCase() + varName.slice(1)
      lines.push(...CAP_USAGE_EN.direct(c.api, lv))
    } else {
      const required = params.filter((p) => !p.optional).map((p) => p.name)
      const call = required.length ? c.api.replace('()', `(${required.join(', ')})`) : c.api
      lines.push(...CAP_USAGE_EN.generic(call))
    }
    lines.push('```')
    lines.push('')
    lines.push('<!-- generated by website/scripts/gen-content.mjs (en overlay) · source SSOT: packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->')
    fs.mkdirSync(OUT, { recursive: true })
    fs.writeFileSync(path.join(OUT, `${slug}.md`), lines.join('\n'))
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
    fs.writeFileSync(path.join(OUT, '00-capabilities-overview.md'), idx.join('\n'))
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
console.log(`generated: components ${nComp} · capabilities ${nCap} · en components ${nCompEn} · en capabilities ${nCapEn}`)
