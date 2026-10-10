#!/usr/bin/env node
// scripts/check-dactyl-visual-nonblocking.mjs —— ★★★Dactyl §7.3 **自洽性红线门禁**（2026-10-10 · 决策 #780）
//
// 【要证明什么（`15-dactyl-demo.md` §7.3）】Dactyl 的**全部装饰动效只允许使用合成属性**
//   （`translation / scale / alpha / rotation`）——由 Morpheus 编译期判定、RenderThread 直接更新 RenderNode、
//   **主线程零参与每帧**。否则**demo 自己就成了压力源**：测到的是"装饰有多贵"而非"输入链路有多快"
//   （这正是本方案与"炫技 demo"的分界线）。
//
// 【判据（机器推导）】扫 Dactyl 工程（`demos/dactyl/**/*.vue`）的 CSS 块：
//   ① **禁** `transition:` / `animation:` / `@keyframes` 声明**非合成属性**（width/height/margin/padding/
//      top/left/right/bottom/flex-*/grid-*/font-*…）——它们是逐帧重排/重绘，会让装饰成为瓶颈；
//   ② **允许**transition/animation 只动合成属性（transform/translate/scale/rotate/opacity）；
//   ③ **正向断言**：Dactyl 的跟手运动走 `v-follow`（⇒ 内核 `translate`，**合成属性**，非 CSS transition）
//      —— 即"运动不靠 CSS 动画"（本工程的核心主张）。
//   `:active`（L1 按下态）改 `background-color` 属**绘制通道**（S1.1 原生即时，非逐帧装饰），**不在禁令内**。
//
// 【诚实边界】本门禁只做**静态 AST/正则**判定（`.vue` 的 CSS 文本）；"合成属性 vs 布局属性"的**完整**
//   判定由编译器（Morpheus §5-bis）负责——本门禁是**兜底红线**（防有人为"更炫"改用非合成属性）。
//   ★作用域 = **`demos/dactyl/src/pages/**`（Dactyl 场景）**——应用壳（`router/RouterView.vue`）是通用
//     App 管道（与其它 Proteus 应用同款，含框架自带的入场动画），非 Dactyl 场景自持的装饰。
//
// 用法：node scripts/check-dactyl-visual-nonblocking.mjs
// 退出码：0 通过 / 1 命中 / 2 环境错（工程缺失）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PROJ = path.join(ROOT, 'demos/dactyl')

/** 合成属性白名单（§7.3：allowed for decorative animation）。 */
const COMPOSITED = new Set([
  'transform', 'translate', 'scale', 'rotate', 'rotatex', 'rotatey', 'rotatez', 'opacity',
])
/** 非合成（布局/绘制）属性——出现在 transition/animation 里即违规。 */
const NON_COMPOSITED = new Set([
  'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'top', 'left', 'right', 'bottom', 'inset',
  'flex', 'flex-grow', 'flex-shrink', 'flex-basis', 'gap', 'row-gap', 'column-gap',
  'grid-template-columns', 'grid-template-rows', 'grid-auto-columns', 'grid-auto-rows',
  'font-size', 'line-height', 'letter-spacing', 'border-radius', 'border-width',
  'background-color', 'color', 'box-shadow', 'filter', 'blur',
])

let failed = false
const fail = (m) => { console.error(`  ✗ ${m}`); failed = true }

/** 递归收集 .vue 文件。 */
function collect(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist') continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) collect(p, out)
    else if (e.name.endsWith('.vue')) out.push(p)
  }
  return out
}

/** 递归收集 .css 文件（Dactyl 的全局样式表——`src/styles/*.css`）。 */
function collectCss(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist') continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) collectCss(p, out)
    else if (e.name.endsWith('.css')) out.push(p)
  }
  return out
}

/**
 * ★★★**同名 `@keyframes` 重复检测**（2026-10-10 · 决策 #791⑧ · 用户实测抓出的坑）：
 *   CSS **同名 `@keyframes` 后者静默覆盖前者**（无任何报错）——人工复制粘贴极易留下重复块，
 *   导致改的是"看起来对"的那份、**生效的却是另一份**（真机现象：涟漪"没效果"= 被调试版 opacity-only 覆盖）。
 *   返回重复出现的 keyframes 名清单。
 */
function duplicateKeyframes(css) {
  const names = new Map()
  for (const m of css.matchAll(/@keyframes\s+([\w-]+)/gi)) {
    const n = m[1].toLowerCase()
    names.set(n, (names.get(n) ?? 0) + 1)
  }
  return [...names.entries()].filter(([, c]) => c > 1).map(([n, c]) => `${n}×${c}`)
}

/** 从 `<style>…</style>` 里取全部 CSS（含 scoped）。 */
function stylesOf(src) {
  const out = []
  const re = /<style[^>]*>([\s\S]*?)<\/style>/gi
  let m
  while ((m = re.exec(src)) !== null) out.push(m[1])
  return out.join('\n')
}

/** 解析一条 `transition:`/`animation:` 声明里出现的属性名（只切**顶层逗号**——`cubic-bezier(a,b,c,d)` 内含逗号）。 */
function propsInDecl(value) {
  const parts = []
  let depth = 0, cur = ''
  for (const ch of value) {
    if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue }
    cur += ch
  }
  parts.push(cur)
  const props = []
  for (const part of parts) {
    const t = part.trim().split(/\s+/)[0]
    if (t) props.push(t.toLowerCase())
  }
  return props
}

function main() {
  console.log('═══ Dactyl 自洽性红线门禁（§7.3：装饰只许合成属性）═══')
  if (!fs.existsSync(PROJ)) {
    console.error(`✗ 缺 Dactyl 工程：${path.relative(ROOT, PROJ)}`)
    return 2
  }
  const vues = collect(path.join(PROJ, 'src', 'pages'))
  if (vues.length === 0) { console.error('✗ Dactyl 工程 src/pages 无 .vue 文件'); return 2 }

  let sawFollow = false
  for (const f of vues) {
    const src = fs.readFileSync(f, 'utf-8')
    const rel = path.relative(ROOT, f)
    if (/v-follow\b/.test(src)) sawFollow = true

    // ① transition 声明：动非合成属性 ⇒ 违规（property 列表在值里）
    const css = stylesOf(src)
    for (const m of css.matchAll(/(?:^|[;{\s])transition\s*:\s*([^;}]+)/gi)) {
      for (const p of propsInDecl(m[1])) {
        if (p === 'none' || p === 'initial' || p === 'inherit') continue
        if (COMPOSITED.has(p)) continue
        if (p === 'all') { fail(`${rel}：\`transition\` 动 \`all\`（含非合成属性）——只允许显式列合成属性（transform/opacity…）`); continue }
        if (NON_COMPOSITED.has(p)) {
          fail(`${rel}：\`transition\` 动**非合成属性** \`${p}\`——逐帧重排/重绘会让装饰成为压力源（§7.3）`)
        } else {
          fail(`${rel}：\`transition\` 动未知属性 \`${p}\`——合成属性白名单外一律拒绝（拿不准就不动它）`)
        }
      }
    }
    // ② `animation` 简写：属性不在简写里（是 name/duration/timing/iteration）——其动的是哪个属性
    //    由被引用的 `@keyframes` 决定（下一段的 @keyframes 扫描覆盖）。只需**不把 name 当属性**。
    //    （若引用的是别处定义的 keyframes，本门禁看不到其体——诚实边界：Dactyl 的 keyframes 均同文件。）
    // ③ @keyframes 里出现非合成属性（关键帧动画若改布局属性同样违规）
    for (const m of css.matchAll(/@keyframes\s+[\w-]+\s*\{([\s\S]*?)\n\s*\}/g)) {
      const body = m[1]
      for (const p of NON_COMPOSITED) {
        const re = new RegExp(`(?:^|[;{\\s])${p.replace(/[-]/g, '\\-')}\\s*:`, 'i')
        if (re.test(body)) fail(`${rel}：@keyframes 改**非合成属性** \`${p}\`——关键帧只许动合成属性（§7.3）`)
      }
    }
  }

  // ③ 正向断言：Dactyl 的跟手运动走 v-follow（内核 translate，合成属性）
  if (!sawFollow) {
    fail('Dactyl 工程未使用 `v-follow`——跟手运动应走内核合成 translate（不是 CSS transition/JS 逐帧）')
  }

  // ④ ★★★全局样式表（`src/styles/*.css`）同样过 §7.3 + **同名 @keyframes 重复检测**（#791⑧）
  const cssFiles = collectCss(path.join(PROJ, 'src', 'styles'))
  for (const f of cssFiles) {
    const rel = path.relative(ROOT, f)
    const css = fs.readFileSync(f, 'utf-8')
    for (const m of css.matchAll(/(?:^|[;{\s])transition\s*:\s*([^;}]+)/gi)) {
      for (const p of propsInDecl(m[1])) {
        if (p === 'none' || p === 'initial' || p === 'inherit') continue
        if (COMPOSITED.has(p)) continue
        if (p === 'all') { fail(`${rel}：\`transition\` 动 \`all\`（含非合成属性）`); continue }
        if (NON_COMPOSITED.has(p)) fail(`${rel}：\`transition\` 动**非合成属性** \`${p}\`（§7.3）`)
        else fail(`${rel}：\`transition\` 动未知属性 \`${p}\`（合成属性白名单外一律拒绝）`)
      }
    }
    for (const m of css.matchAll(/@keyframes\s+[\w-]+\s*\{([\s\S]*?)\n\s*\}/g)) {
      const body = m[1]
      for (const p of NON_COMPOSITED) {
        const re = new RegExp(`(?:^|[;{\\s])${p.replace(/[-]/g, '\\-')}\\s*:`, 'i')
        if (re.test(body)) fail(`${rel}：@keyframes 改**非合成属性** \`${p}\`（§7.3）`)
      }
    }
    const dups = duplicateKeyframes(css)
    if (dups.length > 0) {
      fail(`${rel}：**同名 @keyframes 重复**（${dups.join(' · ')}）——CSS 同名后者**静默覆盖**前者，` +
        `极易"改的那份没生效"（#791⑧ 真机踩坑）；删重复块只留一处`)
    }
  }

  if (failed) {
    console.error('\n✗ Dactyl 自洽性红线被破坏（§7.3）——见上。')
    console.error('  正确做法：装饰动效只用 `transform/translate/scale/rotate/opacity`；运动走 `v-follow`（内核合成）。')
    return 1
  }
  console.log(`  ✓ 扫 ${vues.length} 个 .vue：transition/animation/@keyframes **零非合成属性** · 跟手走 v-follow（合成 translate）`)
  console.log('\n✅ Dactyl 自洽性红线通过（装饰只含合成属性 · demo 不是自己的压力源 · §7.3）')
  return 0
}

process.exit(main())
