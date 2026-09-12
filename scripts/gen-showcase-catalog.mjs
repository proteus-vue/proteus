#!/usr/bin/env node
// scripts/gen-showcase-catalog.mjs —— 生成 showcase 目录数据（组件/能力分组）
//
// ★单一事实源：官网内容（website/content/components/*.md + capabilities/*.md）——
//   分组（group）/排序（order）/名称/一句话描述全部取自官网内容，showcase 不再手抄一份。
// ★可点击性自动判定：扫描 showcase/subpackages/<pkg>/pages/*.vue，存在同名详情页才置 route
//   （目录页据 route 渲染「可点击」或「规划中」徽标——诚实反映实现进度，不假装已覆盖）。
//
// 用法：
//   node scripts/gen-showcase-catalog.mjs           # 生成 showcase/data/catalog.ts
//   node scripts/gen-showcase-catalog.mjs --check   # 校验快照是否最新（CI；漂移 exit 1）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const COMPONENTS_DIR = path.join(ROOT, 'website/content/components')
const CAPABILITIES_DIR = path.join(ROOT, 'website/content/capabilities')
const SP_COMPONENTS = path.join(ROOT, 'showcase/subpackages/components/pages')
const SP_CAPABILITIES = path.join(ROOT, 'showcase/subpackages/capabilities/pages')
const OUT = path.join(ROOT, 'showcase/data/catalog.ts')

/** 域展示顺序（官网内容 group → 稳定序；未列出的域排末尾按名排序） */
const COMPONENT_GROUP_ORDER = ['布局', '内容与表单', '页面外壳', '工程', '手势', '能力入口']
const CAPABILITY_GROUP_ORDER = [
  '网络与通信',
  '设备与系统',
  '媒体与扫码',
  '存储与文件',
  '应用与生命周期',
  '位置与地图',
  '通知与分享',
  '账号与支付',
  '可观测与调试',
  '其他',
]

/** 域一句话说明（目录页副标题——非官网内容字段，展示用） */
const GROUP_DESC = {
  布局: '网格 / 弹性栈 / 分区 / 安全区 / 滚动 / 虚拟列表',
  内容与表单: '文本 / 图标 / 图片 / 表单控件 / 按钮 / 进度 / 骨架屏',
  页面外壳: '页面 / 导航栏 / 弹窗 / 抽屉 / 轻提示 / 分段 / 标签栏',
  工程: '路由链接 / 转场 / 动画 / 错误边界',
  手势: '可拖拽 / 可滚动',
  能力入口: '扫码 / 选照片 / 定位',
  网络与通信: '请求 / WebSocket / 上传下载 / 蓝牙 / NFC',
  设备与系统: '传感器 / 电池 / 网络 / 剪贴板 / 屏幕 / 亮度',
  媒体与扫码: '相机 / 录音 / 视频 / 图片编辑 / 二维码',
  存储与文件: '存储 / 文件系统 / 压缩 / Cookie',
  应用与生命周期: '应用与页面生命周期 / 前后台 / 嵌入',
  位置与地图: '定位 / 地图 / 地址',
  通知与分享: '分享 / 订阅消息 / 短信 / 语音',
  账号与支付: '登录 / 支付 / 生物识别 / 联系人',
  可观测与调试: '日志 / 性能 / 埋点',
  其他: 'WiFi / Worker / 相册 / 更新 / 小程序',
}

/** 解析 md frontmatter（仅取顶层 `key: value`） */
function parseFrontmatter(src) {
  const m = src.match(/^---\n([\s\S]*?)\n---/)
  const fm = {}
  if (m) {
    for (const line of m[1].split('\n')) {
      const i = line.indexOf(':')
      if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim()
    }
  }
  return fm
}

/** 取正文「首个有意义行」作一句话描述（跳过标题/引用/空行/代码块），并做轻量清洗 */
function extractDesc(src) {
  const body = src.replace(/^---\n[\s\S]*?\n---\n/, '')
  let text = ''
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith('>') || line.startsWith('|') || line.startsWith('```')) continue
    text = line
    break
  }
  // 清洗：去 ★C数字 前缀；取「：」后主体；截断到首个括号/斜杠前
  text = text.replace(/^★?\s*C\d+\s*/, '')
  const colon = text.indexOf('：')
  if (colon >= 0 && colon < 24) text = text.slice(colon + 1)
  text = text.split(/（|\(/)[0].trim()
  return text || '语义原语'
}

/** 扫描目录下的详情页（.vue → 名字集合） */
function scanDetailPages(dir) {
  const set = new Set()
  if (!fs.existsSync(dir)) return set
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.vue')) set.add(f.slice(0, -'.vue'.length))
  return set
}

function buildComponents() {
  const pages = scanDetailPages(SP_COMPONENTS)
  const byGroup = new Map()
  let total = 0
  for (const f of fs.readdirSync(COMPONENTS_DIR)) {
    if (!f.endsWith('.md') || f.startsWith('00-')) continue
    const src = fs.readFileSync(path.join(COMPONENTS_DIR, f), 'utf8')
    const fm = parseFrontmatter(src)
    const name = fm.title || f.replace(/\.md$/, '')
    const group = fm.group || '其他'
    const item = {
      name,
      desc: extractDesc(src),
      route: pages.has(name) ? `/subpackages/components/pages/${name}` : '',
    }
    if (!byGroup.has(group)) byGroup.set(group, { order: Number(fm.order) || 9999, items: [] })
    byGroup.get(group).items.push({ ...item, order: Number(fm.order) || 9999 })
    total++
  }
  return { byGroup, total }
}

function buildCapabilities() {
  const pages = scanDetailPages(SP_CAPABILITIES)
  const byGroup = new Map()
  let total = 0
  for (const f of fs.readdirSync(CAPABILITIES_DIR)) {
    if (!f.endsWith('.md') || f.startsWith('00-')) continue
    const src = fs.readFileSync(path.join(CAPABILITIES_DIR, f), 'utf8')
    const fm = parseFrontmatter(src)
    const title = fm.title || ''
    const hook = (title.match(/^(use[A-Za-z0-9]+)/) || [])[1] || title
    const id = (title.match(/（([^）]+)）/) || [])[1] || ''
    const slug = f.replace(/\.md$/, '')
    const group = fm.group || '其他'
    const item = {
      name: hook,
      id,
      desc: extractDesc(src),
      route: pages.has(slug) ? `/subpackages/capabilities/pages/${slug}` : '',
    }
    if (!byGroup.has(group)) byGroup.set(group, { order: Number(fm.order) || 9999, items: [] })
    byGroup.get(group).items.push({ ...item, order: Number(fm.order) || 9999 })
    total++
  }
  return { byGroup, total }
}

function orderGroups(byGroup, orderList) {
  const names = [...byGroup.keys()]
  return names
    .sort((a, b) => {
      const ia = orderList.indexOf(a)
      const ib = orderList.indexOf(b)
      const ra = ia < 0 ? 999 : ia
      const rb = ib < 0 ? 999 : ib
      return ra - rb || a.localeCompare(b)
    })
    .map((name) => {
      const g = byGroup.get(name)
      const items = g.items.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
      return { name, desc: GROUP_DESC[name] || '', items }
    })
}

function renderGroups(groups, indent = '  ') {
  const lines = []
  for (const g of groups) {
    lines.push(`${indent}{`)
    lines.push(`${indent}  name: ${JSON.stringify(g.name)},`)
    lines.push(`${indent}  desc: ${JSON.stringify(g.desc)},`)
    lines.push(`${indent}  items: [`)
    for (const it of g.items) {
      const idPart = it.id ? ` id: ${JSON.stringify(it.id)},` : ''
      lines.push(`${indent}    { name: ${JSON.stringify(it.name)},${idPart} desc: ${JSON.stringify(it.desc)}, route: ${JSON.stringify(it.route)} },`)
    }
    lines.push(`${indent}  ],`)
    lines.push(`${indent}},`)
  }
  return lines.join('\n')
}

const comp = buildComponents()
const cap = buildCapabilities()
const compGroups = orderGroups(comp.byGroup, COMPONENT_GROUP_ORDER)
const capGroups = orderGroups(cap.byGroup, CAPABILITY_GROUP_ORDER)
const compReady = compGroups.reduce((n, g) => n + g.items.filter((i) => i.route).length, 0)
const capReady = capGroups.reduce((n, g) => n + g.items.filter((i) => i.route).length, 0)

const out = `// showcase/data/catalog.ts —— 组件/能力目录数据（AUTO-GENERATED by scripts/gen-showcase-catalog.mjs，勿手动编辑）
// ★单一事实源：官网内容 website/content/{components,capabilities}/*.md（分组/排序/名称/描述）。
// ★route 非空 = 该条目已有详情页（目录页渲染为可点击）；空 = 规划中（诚实标注）。
// 重新生成：node scripts/gen-showcase-catalog.mjs
export interface CatalogItem {
  /** 组件名（p-button）或 Hook 名（useCamera） */
  name: string
  /** 能力原语标识（capability.camera；组件为空） */
  id?: string
  /** 一句话描述 */
  desc: string
  /** 详情页路径（'' = 规划中） */
  route: string
}

export interface CatalogGroup {
  name: string
  desc: string
  items: CatalogItem[]
}

/** 组件：${compGroups.length} 域 / ${comp.total} 个（已备详情页 ${compReady}） */
export const COMPONENT_GROUPS: CatalogGroup[] = [
${renderGroups(compGroups)}
]

/** 能力：${capGroups.length} 域 / ${cap.total} 个（已备详情页 ${capReady}） */
export const CAPABILITY_GROUPS: CatalogGroup[] = [
${renderGroups(capGroups)}
]

export const CATALOG_STATS = {
  componentGroups: ${compGroups.length},
  componentTotal: ${comp.total},
  componentReady: ${compReady},
  capabilityGroups: ${capGroups.length},
  capabilityTotal: ${cap.total},
  capabilityReady: ${capReady},
}
`

const check = process.argv.includes('--check')
if (check) {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : ''
  if (cur !== out) {
    console.error('[gen-showcase-catalog] 目录数据与官网内容不一致（快照过期）——请运行 node scripts/gen-showcase-catalog.mjs')
    process.exit(1)
  }
  console.log('[gen-showcase-catalog] 快照一致 ✓')
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, out)
  console.log(
    `[gen-showcase-catalog] 已生成 showcase/data/catalog.ts——组件 ${compGroups.length} 域/${comp.total} 个（详情 ${compReady}）· 能力 ${capGroups.length} 域/${cap.total} 个（详情 ${capReady}）`,
  )
}
