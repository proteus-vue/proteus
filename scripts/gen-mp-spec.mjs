// scripts/gen-mp-spec.mjs
// ★权威标尺：生成微信小程序官方能力清单快照（docs/generated/miniprogram-official-spec.json）
//   背景：覆盖度门禁此前由**手写矩阵**（MP_MAPPING_MATRIX）驱动 → 自证同义反复（矩阵不登记则永不红）。
//   本脚本从**官方来源**抽取权威清单，让门禁以「官方有什么」为标尺。
//
//   ① 组件：官方组件索引页（developers.weixin.qq.com/miniprogram/dev/component/）→ 页面内所有 /component/<tag>.html 链接
//   ② API：官方类型定义 miniprogram-api-typings 的 `interface Wx`（离线可解析，CI 友好）
//
//   用法：node scripts/gen-mp-spec.mjs          （生成/覆盖快照）
//         node scripts/gen-mp-spec.mjs --check  （比对快照，漂移 exit 1——防快照与官方脱节）
//   幂等：无时间戳；输出按字典序排序。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'docs', 'generated', 'miniprogram-official-spec.json')
const TYPINGS = path.join(ROOT, 'node_modules', 'miniprogram-api-typings', 'types', 'wx', 'lib.wx.api.d.ts')
const check = process.argv.includes('--check')

// —— ① 组件：官方索引页链接（离线缺网络时保留已存快照的组件集） ——
//
// ★★2026-09-24 实测缺陷：官方索引页会摘掉仍然**在线**的组件链接。实例——`reward`：
//   索引页 HTML 中 0 处提及，但 `reward.html` 仍 HTTP 200 + 63KB 正文
//   （对照：不存在的路径回 404 + 6.8KB 外壳；`view` 65KB / `button` 83KB）⇒ 页面真实存在。
//   若只按索引页刷新 → **静默丢真组件**（权威标尺凭空缩水，override 表里的 private 登记
//   沦为死条目且无人察觉）。故：对「已存快照有、线上索引无」的差集逐个探测页面存活，
//   仍存活者保留（来源注记点名），真下线者（404/空壳）才移除。
async function probeComponentPageAlive(tag) {
  try {
    const res = await fetch(`https://developers.weixin.qq.com/miniprogram/dev/component/${tag}.html`, {
      headers: { 'user-agent': 'Mozilla/5.0 (proteus-spec-gen)' },
    })
    if (!res.ok) return false
    const body = await res.text()
    // 双判据：状态码 + 正文体量（防 SPA 站「soft-404 也回 200」把空壳当存活）
    return body.length > 20_000
  } catch {
    return false
  }
}

async function fetchComponents() {
  const url = 'https://developers.weixin.qq.com/miniprogram/dev/component/'
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (proteus-spec-gen)' } })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const html = await res.text()
    const tags = new Set()
    for (const m of html.matchAll(/href="\/miniprogram\/dev\/component\/([a-z0-9-]+)\.html"/g)) tags.add(m[1])
    if (!tags.size) throw new Error('组件链接抽取为空')
    // 索引页漏链校验（见上方 2026-09-24 说明）：探测成本仅限差集（通常 0–2 项）
    const kept = []
    const gone = []
    if (fs.existsSync(OUT)) {
      const cur = JSON.parse(fs.readFileSync(OUT, 'utf8'))
      for (const tag of cur.components ?? []) {
        if (tags.has(tag)) continue
        if (await probeComponentPageAlive(tag)) {
          tags.add(tag)
          kept.push(tag)
        } else {
          gone.push(tag)
        }
      }
    }
    const notes = []
    if (kept.length) notes.push(`索引页已摘链但页面仍存活，保留：${kept.join(', ')}`)
    if (gone.length) notes.push(`页面已下线，移除：${gone.join(', ')}`)
    return { tags: [...tags].sort(), source: 'online' + (notes.length ? `（${notes.join('；')}）` : '') }
  } catch (e) {
    // 离线回退：沿用已存快照
    if (fs.existsSync(OUT)) {
      const cur = JSON.parse(fs.readFileSync(OUT, 'utf8'))
      return { tags: cur.components, source: 'cached (offline: ' + e.message + ')' }
    }
    throw new Error('无法获取官方组件清单且无缓存：' + e.message)
  }
}

// —— ② API：官方 typings `interface Wx` 方法名 ——
function extractApis() {
  if (!fs.existsSync(TYPINGS)) throw new Error('缺少官方 typings（miniprogram-api-typings）：' + TYPINGS)
  const src = fs.readFileSync(TYPINGS, 'utf8')
  const start = src.indexOf('    interface Wx {')
  if (start < 0) throw new Error('typings 中未找到 `interface Wx`')
  let body = src.slice(start)
  // ★先剥离 JSDoc 注释块——否则示例代码里的 `if (`/`resolve (` 等会被误当方法名
  body = body.replace(/\/\*\*[\s\S]*?\*\//g, '')
  const names = new Set()
  for (const m of body.matchAll(/^\s{8}([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/gm)) names.add(m[1])
  return [...names].sort()
}

const comp = await fetchComponents()
const apis = extractApis()
const spec = {
  _comment: '微信小程序官方能力清单快照（权威标尺）——由 scripts/gen-mp-spec.mjs 生成，勿手改。',
  componentsSource: 'https://developers.weixin.qq.com/miniprogram/dev/component/',
  apisSource: 'miniprogram-api-typings `interface Wx`',
  // ★来源注记落盘（非 online 时）：摘链保留/下线的组件名必须能被 review 看到——
  //   只打 stdout 的话，移除真发生过后 `--check` 照样绿，人无从察觉。
  ...(comp.source === 'online' ? {} : { componentsNote: comp.source }),
  componentCount: comp.tags.length,
  apiCount: apis.length,
  components: comp.tags,
  apis,
}

const serialized = JSON.stringify(spec, null, 2) + '\n'
// ★下线是「权威标尺缩水」的强信号（与「索引页摘链」不同，页面真没了）：必须显式告警，
//   不能只靠快照 diff 被人看见——本仓纪律：静默失败最危险。
if (comp.source.includes('页面已下线')) {
  console.warn(`[gen-mp-spec] ⚠ 检测到官方页面已下线（将从标尺移除）：${comp.source}`)
}
if (check) {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : ''
  // 离线回退时组件来源不同但内容相同——比对时忽略 _comment 之外的差异
  if (cur !== serialized) {
    const curObj = cur ? JSON.parse(cur) : {}
    const sameComponents = JSON.stringify(curObj.components) === JSON.stringify(spec.components)
    const sameApis = JSON.stringify(curObj.apis) === JSON.stringify(spec.apis)
    if (sameComponents && sameApis) {
      console.log(`[gen-mp-spec] --check OK（内容一致；来源注记 ${comp.source}）`)
      process.exit(0)
    }
    console.error('[gen-mp-spec] ❌ 快照与官方来源不一致（漂移）——重跑 gen-mp-spec 刷新')
    console.error('  components 当前', spec.components.length, '对照', curObj.components?.length)
    console.error('  apis 当前', spec.apis.length, '对照', curObj.apis?.length)
    process.exit(1)
  }
  console.log('[gen-mp-spec] --check OK')
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, serialized)
  console.log(`[gen-mp-spec] 生成 ${path.relative(ROOT, OUT)}：组件 ${spec.componentCount} · API ${spec.apiCount}（组件来源 ${comp.source}）`)
}
