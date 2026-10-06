#!/usr/bin/env node
// scripts/gen-css-feature-inventory.mjs —— ★★★CSS Web 全量能力清单（用户 2026-10-05 指定）
//
// 【它回答什么（用户原话）】「把所有 CSS Web 能力全都放到新的清单里面，然后我们的 CSS 引擎逐个实现，
//   实现一个就全端对齐视觉验收一个」——本脚本产出那份**总清单**：
//   `docs/generated/css-feature-inventory.{json,md}`。
//
// 【数据源（全离线——零联网）】
//   · **全量能力面**：`mdn-data`（本机 node_modules 已有·MDN 官方机器可读数据）
//     properties 651（490 standard / 107 nonstandard / 39 experimental / 15 obsolete）
//     + selectors + at-rules + functions + units —— 每项带 `syntax` / `inherited` / `initial` / `status` / `groups`
//   · **本仓语料用量**：examples/ + superapp/ + packages/components 的 .vue/.css 里各属性**出现次数**
//     （真实需求信号——决定优先级，不拍脑袋）
//   · **既有实现状态对账**：STYLE_IR_FIELDS（IR 注册表）· APP_*_FIELDS（编译器折叠面）·
//     STYLE_PROP_LEVELS（矩阵）· web-supports.json（Chromium 实测）
//
// 【每条目的字段（机器可读）】
//   id / kind / mdnStatus / groups / syntax / inherited / initial
//   ├── 实现四态：impl = implemented | partial | not-started | excluded（excluded 必带理由）
//   ├── 证据：inIrRegistry / irScope / inCompilerFold / matrixLevel / webSupport（实测）
//   └── 推进三件套：usage（语料次数）/ priority（P0–P2，按用量与常见度推导）/ acceptance（验收状态）
//
// 【优先级推导（可复核——不是人工拍）】
//   P0：语料在用的**未实现**属性（真实需求） ∪ 已实现的常用面
//   P1：标准属性且属常用分组（Box Model / Flexbox / Colors / Text / Background / Border）
//   P2：其余标准属性
//   excluded：nonstandard（-webkit-* 等）/ obsolete / 明确不做的**具名清单**（见 EXCLUDED_REASONS）
//
// 用法：
//   node scripts/gen-css-feature-inventory.mjs            # 生成 + 打印摘要
//   node scripts/gen-css-feature-inventory.mjs --check    # 漂移门禁
//   node scripts/gen-css-feature-inventory.mjs --update   # 写回产物
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_JSON = path.join(ROOT, 'docs/generated/css-feature-inventory.json')
const OUT_MD = path.join(ROOT, 'docs/generated/css-feature-inventory.md')
const CHECK = process.argv.includes('--check')
const UPDATE = process.argv.includes('--update')

/* ── ① mdn-data（本机）── */
const MDN_DIR = (() => {
  const pnpm = path.join(ROOT, 'node_modules/.pnpm')
  const dir = fs.readdirSync(pnpm).find((d) => d.startsWith('mdn-data@'))
  if (!dir) throw new Error('缺 mdn-data（npm 依赖树里应有——检查 pnpm install）')
  return path.join(pnpm, dir, 'node_modules/mdn-data')
})()
const mdnProps = JSON.parse(fs.readFileSync(path.join(MDN_DIR, 'css/properties.json'), 'utf-8'))
const mdnSelectors = JSON.parse(fs.readFileSync(path.join(MDN_DIR, 'css/selectors.json'), 'utf-8'))
const mdnAtRules = JSON.parse(fs.readFileSync(path.join(MDN_DIR, 'css/at-rules.json'), 'utf-8'))
const mdnFunctions = JSON.parse(fs.readFileSync(path.join(MDN_DIR, 'css/functions.json'), 'utf-8'))
const mdnUnits = JSON.parse(fs.readFileSync(path.join(MDN_DIR, 'css/units.json'), 'utf-8'))

/* ── ② 本仓语料用量（真实需求信号）── */
const compiler = await import(pathToFileURL(path.join(ROOT, 'packages/compiler/dist/index.js')).href)
const { STYLE_IR_FIELDS } = await import(
  pathToFileURL(path.join(ROOT, 'packages/contracts/dist/style-ir-registry.generated.js')).href
)
const { STYLE_PROP_LEVELS } = await import(pathToFileURL(path.join(ROOT, 'packages/contracts/dist/style.js')).href)

/** kebab↔camel（语料里两种写法都有：CSS 用 kebab、Vue `:style` 用 camel） */
const toKebab = (s) => s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
const toCamel = (s) => s.replace(/-([a-z])/g, (_m, c) => c.toUpperCase())
/** ★★★line-clamp 项（2026-10-08）：CSS 名 → IR 字段名别名表（个别能力折叠到**不同名**字段，
 *   名字对不上 ⇒ 实现态被判 not-started 的假阴性）。-webkit-line-clamp → lineClamp。 */
const FIELD_ALIAS = { '\u002dwebkit-line-clamp': 'lineClamp' }

function walkFiles(dir, exts, acc = []) {
  if (!fs.existsSync(dir)) return acc
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (!/^(node_modules|dist|\.)/.test(e.name)) walkFiles(p, exts, acc)
      continue
    }
    if (exts.some((x) => e.name.endsWith(x))) acc.push(p)
  }
  return acc
}

const USAGE = new Map() // kebab 属性名 → 次数
{
  const files = [
    ...walkFiles(path.join(ROOT, 'examples'), ['.vue', '.css']),
    ...walkFiles(path.join(ROOT, 'superapp'), ['.vue', '.css']),
    ...walkFiles(path.join(ROOT, 'packages/components'), ['.vue']),
  ]
  for (const f of files) {
    const raw = fs.readFileSync(f, 'utf-8')
    // ★★先剥 `<script>` 块（首版残留误报：script 里的 JS 对象 `{x: 0, y: 0}` 落进下面的 {} 匹配 ⇒
    //   把 SVG 的 x/y 计成 CSS 用法，实测 13/10 全是假的）——样式只可能来自 <style> / style="" / :style
    const src = raw.replace(/<script[\s\S]*?<\/script>/gi, '')
    // 只在**真正的样式上下文**里计数：
    //     ① CSS 声明块 `.foo { ... }`
    //     ② style="..." 内联属性
    //     ③ :style="{...}" 对象字面量
    const styleChunks = []
    for (const m of src.matchAll(/\{([^{}]*)\}/g)) styleChunks.push(m[1] ?? '')
    for (const m of src.matchAll(/\bstyle\s*=\s*"([^"]*)"/g)) styleChunks.push(m[1] ?? '')
    for (const m of src.matchAll(/\bstyle\s*=\s*'([^']*)'/g)) styleChunks.push(m[1] ?? '')
    for (const m of src.matchAll(/:style\s*=\s*"\s*\{([\s\S]*?)\}\s*"/g)) styleChunks.push(m[1] ?? '')
    const joined = styleChunks.join('\n')
    for (const [kebab] of Object.entries(mdnProps)) {
      const camel = toCamel(kebab)
      const escK = kebab.replace(/[-]/g, '\\-')
      let n = (joined.match(new RegExp(`(^|[\\s{;,'"])${escK}\\s*:`, 'g')) ?? []).length
      if (camel !== kebab) n += (joined.match(new RegExp(`(^|[\\s{,'"])${camel}\\s*:`, 'g')) ?? []).length
      if (n > 0) USAGE.set(kebab, (USAGE.get(kebab) ?? 0) + n)
    }
  }
}

/* ── ③ Web 实测支持（Chromium——已有源工件）── */
const webSupports = (() => {
  const p = path.join(ROOT, 'docs/generated/css-capability-sources/web-supports.json')
  if (!fs.existsSync(p)) return { properties: {} }
  return JSON.parse(fs.readFileSync(p, 'utf-8'))
})()

/* ── ④-b ★★简写/别名展开对账表（清单可信的前提 · 首版系统性盲区）──
 * 【首版的盲区（实测抓出）】清单只查"同名 IR 字段"⇒ 把**被编译器折叠成别的字段**的能力
 *   全判成未实现（实测：background/border/inset/overflow-x/grid-area/white-space… 全部假阴性）。
 *   而这些恰恰是**简写与别名**——它们的实现形态就是"展开成多个字段"。
 * 【本表（形态 → 展开产物 → 证据行）】用于把这类能力判为 implemented/partial：
 *   · to：展开到的 IR 字段（camelCase；全部在册才算 implemented）
 *   · evidence：编译器折叠位置（`文件:行` 或函数名——可 grep 复核）
 *   · note：语义说明
 */
const SHORTHAND_EXPANSION = {
  background: { to: ['backgroundColor'], partial: ['fillGradient'], evidence: 'vapor/template.ts:958-970（parseCssGradient + extractBackgroundColor）', note: '简写 → 纯色折 background-color；渐变折 fillGradient（引擎绘制通道）' },
  outline: { to: ['outlineWidth', 'outlineColor'], partial: ['outlineStyle', 'outlineOffset'], evidence: 'vapor/template.ts（outline 分支：parseBorderShorthand）', note: 'outline 简写 → width + color + style（★可按 outline-offset 偏移；宿主绘制，内核零改动）' },
  border: { to: ['borderWidth', 'borderColor'], partial: ['borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle'], evidence: 'vapor/template.ts（parseBorderShorthand）', note: 'border 简写 → 统一 width + color + 四边线型（★边框族收口批：dashed/dotted 已支持，宿主按线型绘制；double/groove 等仍诊断）' },
  'border-top': { to: ['borderTopWidth', 'borderTopColor'], partial: ['borderTopStyle'], evidence: 'vapor/template.ts（逐边分支）', note: '逐边简写（width/color/style 三件套；★线型批：dashed/dotted 支持）' },
  'border-right': { to: ['borderRightWidth', 'borderRightColor'], partial: ['borderRightStyle'], evidence: 'vapor/template.ts（逐边分支）', note: '逐边简写（width/color/style 三件套；★线型批：dashed/dotted 支持）' },
  'border-bottom': { to: ['borderBottomWidth', 'borderBottomColor'], partial: ['borderBottomStyle'], evidence: 'vapor/template.ts（逐边分支）', note: '逐边简写（width/color/style 三件套；★线型批：dashed/dotted 支持）' },
  'border-left': { to: ['borderLeftWidth', 'borderLeftColor'], partial: ['borderLeftStyle'], evidence: 'vapor/template.ts（逐边分支）', note: '逐边简写（width/color/style 三件套；★线型批：dashed/dotted 支持）' },
  'border-color': { to: ['borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor'], evidence: 'parser：四值展开', note: '四值简写' },
  'border-width': { to: ['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'], evidence: 'parser：四值展开', note: '四值简写' },
  'border-style': { to: ['borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle'], evidence: 'vapor/template.ts（★边框族收口批：1–4 值简写 + 单值四边 Style）', note: '线型简写（solid/dashed/dotted；none ⇒ 四边清零；double/groove 等诊断）', partial: [] },
  'border-radius': { to: ['borderRadius'], partial: ['borderRadiusCorners', 'borderRadiusPct'], evidence: 'vapor/template.ts:900-910', note: '统一半径 + 逐角掩码/百分比' },
  'border-top-left-radius': { to: ['borderRadius'], partial: ['borderRadiusCorners'], evidence: 'vapor/template.ts（★边框族收口批：逐角就地累积 + 合成）', note: '逐角长手（语义 = border-radius 四值；缺省 0——与简写同一输出形态：统一半径 + 掩码）' },
  'border-top-right-radius': { to: ['borderRadius'], partial: ['borderRadiusCorners'], evidence: 'vapor/template.ts（★边框族收口批：逐角就地累积 + 合成）', note: '逐角长手（语义 = border-radius 四值；缺省 0——与简写同一输出形态：统一半径 + 掩码）' },
  'border-bottom-right-radius': { to: ['borderRadius'], partial: ['borderRadiusCorners'], evidence: 'vapor/template.ts（★边框族收口批：逐角就地累积 + 合成）', note: '逐角长手（语义 = border-radius 四值；缺省 0——与简写同一输出形态：统一半径 + 掩码）' },
  'border-bottom-left-radius': { to: ['borderRadius'], partial: ['borderRadiusCorners'], evidence: 'vapor/template.ts（★边框族收口批：逐角就地累积 + 合成）', note: '逐角长手（语义 = border-radius 四值；缺省 0——与简写同一输出形态：统一半径 + 掩码）' },
  inset: { to: ['top', 'right', 'bottom', 'left'], evidence: 'CSE shorthand.ts（inset 分支）', note: 'inset 简写 → 四边' },
  'overflow-x': { to: ['overflow'], evidence: 'CSE shorthand.ts（overflow 分支）', note: '单轴 overflow（x/y 同值才可表达为 overflow——CSE 合并）', conditional: true },
  'overflow-y': { to: ['overflow'], evidence: '同上', note: '同上', conditional: true },
  gap: { to: ['rowGap', 'columnGap'], evidence: 'CSE shorthand.ts（gap 分支）', note: 'gap → 轴级 row-gap/column-gap' },
  'row-gap': { to: ['rowGap'], evidence: 'compute.ts（直接映射）', note: '轴级' },
  'column-gap': { to: ['columnGap'], evidence: '同上', note: '轴级' },
  flex: { to: ['flexGrow', 'flexShrink', 'flexBasis'], evidence: 'CSE shorthand.ts（flex 分支）', note: 'flex 简写展开' },
  'margin-block': { to: ['marginTop', 'marginBottom'], evidence: '逻辑属性（未接——P1 待评）', note: '逻辑属性族', notYet: true },
  'padding-block': { to: ['paddingTop', 'paddingBottom'], evidence: '同上', notYet: true, note: '逻辑属性族' },
  'white-space': { to: ['whiteSpace'], evidence: 'IR 注册表（B3 补映射）', note: '枚举（nowrap 等）' },
  'grid-area': { to: ['gridRow', 'gridColumn'], evidence: 'CSE（grid-* 映射，B3 补）', note: 'grid-area 简写 → row/column 放置' },
  // ★★★place-items 项（2026-10-08 · CSS Box Alignment 3）：`place-items: <align-items> <justify-items>` 简写展开。
  'place-items': { to: ['alignItems', 'justifyItems'], evidence: 'vapor/template.ts（place-items 分支）+ 内核 taffy justify_items', note: 'place-items 简写 → align-items + justify-items（单值 ⇒ 两轴同）' },
  'justify-self': { to: ['justifySelf'], evidence: 'CSE（枚举直通）', note: '盒对齐' },
  'align-self': { to: ['alignSelf'], evidence: 'IR 在册', note: '盒对齐' },
  transition: { to: [], evidence: 'animation 包（独立通道：transition 规格 → 内核动画）', note: '**独立通道**（非 CSS 字段）——见 packages/animation', separate: true },
  animation: { to: [], evidence: '批次 42（@keyframes 折叠 → 内核动画）+ packages/animation', note: '**独立通道**', separate: true },
  'animation-name': { to: [], evidence: '同上', separate: true, note: '**独立通道**' },
  'animation-duration': { to: [], evidence: '同上', separate: true, note: '**独立通道**' },
  'animation-delay': { to: [], evidence: '同上', separate: true, note: '**独立通道**' },
  'animation-iteration-count': { to: [], evidence: '同上', separate: true, note: '**独立通道**' },
  'animation-timing-function': { to: [], evidence: '同上', separate: true, note: '**独立通道**' },
  'transition-duration': { to: [], evidence: '同上', separate: true, note: '**独立通道**' },
  // ★★★transition-property/-timing-function 项（2026-10-08 · 同族收口）：CSS Transitions 家族的剩余长手——
  //   登记为**独立通道**（同兄弟 transition / transition-duration，指向 packages/animation）。
  //   · Web：原生基准（transition-property 列出参与过渡的属性）；
  //   · MP/Skyline：官方 WXSS 表**支持**（transition-property 接受 none/all/transform/opacity 等）；
  //   · App：**CSS 属性变化过渡机制未实现**（决策 #536 明记「CSS transition（属性变化触发）未做——无显式触发点，属独立课题」）；
  //     本框架的转场/动画由 packages/animation（路由/元素转场预设 + @keyframes 折叠）承接，非 CSS transition 属性语义。
  'transition-property': { to: [], evidence: 'packages/animation（独立通道：转场/动画规格 → 内核动画；CSS transition 属性变化过渡未做——#536）', separate: true, channel: 'independent', note: '**独立通道（CSS Transitions）**：transition 家族登记为独立通道（同 transition/transition-duration）。Web 原生 / MP 原生支持；**App 端 CSS 属性变化过渡未实现**（#536「无显式触发点，属独立课题」）——框架转场走 packages/animation。' },
  'transition-timing-function': { to: [], evidence: '同 transition-property（缓存曲线由内核 curve；见 packages/animation easing）', separate: true, channel: 'independent', note: '**独立通道（CSS Transitions）**：同 transition-property；缓动曲线概念由 packages/animation 的 easing 承接。' },
  // ★★★will-change 项（2026-10-08 · css:next P0·1× · CSS Will Change）：**合成/性能提示 —— 无视觉输出**。
  //   will-change 只提示「哪些属性即将变化」以便渲染器**提前提升合成层**——**不改变任何渲染像素**
  //   （规范：纯提示；渲染输出与不声明完全一致）。⇒ 四端视觉对齐框架对它**没有可对齐的视觉输出**。
  //   · Web：原生（提示；App/MP 无需等价物，像素一致）；· MP/Skyline：官方表仅接受 auto/contents（其余值丢弃，亦无视觉后果）；
  //   · App：无合成层提示面（自绘引擎自行决定层）⇒ **no-op**（静默丢弃无视觉代价，但仍**如实登记、不静默跳过**）。
  'will-change': { to: [], separate: true, channel: 'non-visual', evidence: 'CSS 规范（纯性能提示，无渲染输出）；p-progress 用法 will-change:width 为动画前的层提升提示', note: '**非视觉（合成/性能提示）——无渲染输出**：will-change 仅提示渲染器提前提升合成层，**不改变任何像素**（Web/MP/App 渲染输出与不声明一致）⇒ 视觉对齐框架**无可对齐项**；Web 原生提示 / MP 官方表仅接受 auto·contents / App 无合成提示面（no-op，如实登记不静默丢弃）。' },
  // ★★★background-image 项（2026-10-08 · 同 object-fit 归类）：**通道属性**——两种子集走两条通道（非编译器折叠的普通 IR 字段）。
  //   ① 渐变子集（linear-/radial-gradient）→ 引擎 `fillGradient` 通道（结构化属性 `fill-gradient` 的 CSS 语法糖，批次 33）；四端已交付并验证（#568：background-position 页 A–E 用例即 `background-image: linear-gradient(...)`）。
  //   ② url()/image-set() 图片子集 → **组件通道**（`<image>` 组件）——Web 原生 / MP 组件已交付，App 图片渲染另立项（#572）。
  //   ③ 多值（多层渐变）/逐层定位属具名边界（同 #568 ②）。
  'background-image': { to: [], separate: true, channel: 'independent', evidence: 'vapor/template.ts（`background-image`/`background` 的渐变 → 引擎 `fillGradient` 通道，批次 33）+ 验收页四端已验（#568 background-position 页 A–E 即 `background-image: linear-gradient`）', note: '**引擎渐变通道**：① 渐变子集（linear-gradient/radial-gradient）→ 引擎 `fillGradient`（结构化属性 `fill-gradient` 的 CSS 语法糖）——**四端已交付并验证（#568）**；② `url()`/`image-set()` 图片子集 → **组件通道**（`<image>` 组件）——Web 原生 / MP 组件已交付，**App 图片渲染另立项（#572）**；③ 多值（多层渐变）与逐层定位属具名边界（同 #568 ②）。' },
  'grid-template-areas': { to: [], evidence: '未接（CSE 支持 template-columns/rows；areas 未接）', note: '命名区域', notYet: true },
  'aspect-ratio': { to: ['aspectRatio'], evidence: 'IR 在册（engine-field）', note: '宽高比' },
  'object-fit': { to: [], separate: true, channel: 'component', evidence: '图片组件通道：Web `<image>` 模拟层 `mode`→CSS objectFit（packages/web/src/components/image.ts）+ MP 原生 `<image mode>`（built-in-components/image.ts）；主流端（微信/Skyline）同以 `<image mode>` 表达而非 CSS 属性', note: '**组件通道**（图片填充）：`object-fit` 作用于**替换内容**（图片/视频），本框架语义载体 = `<image mode>` / `p-image.fit`（Web objectFit · MP mode——已交付）；★App 自绘**暂无图片渲染**（无作用对象）⇒「App 图片渲染」独立立项' },
  'word-break': { to: [], evidence: '未接', notYet: true, note: '断词' },
  'text-shadow': { to: [], evidence: '未接', notYet: true, note: '文本阴影' },
  'mask': { to: [], evidence: '结构化属性通道（mask= 属性）', separate: true, note: 'CSS mask 写法待接（属性通道已通）' },
  // ★★★container-type 项（2026-10-08 · css:next P0·1× · CSS Conditional Rules）：**容器查询的使能器**——
  //   它的真实用途是开启 `@container` 条件规则（按**容器**宽度而非视口做条件样式）。
  //   · CSS `@container` / `@media` 条件块：App 端**无 CSS 引擎** ⇒ 编译期跳过（具名边界，同既有 @media 处置）；
  //   · 本框架的容器响应式由**独立通道** `@proteus-vue/fluid` 交付（`createContainerQuery`/`createSizeAwareObserver`，
  //     ResizeObserver 观察容器尺寸 + 容器级断点）——已被 p-formfactor/p-modal/p-sidebar/p-zone/p-split/p-toolbar 消费；
  //   · 单独把 `container-type` 折进 App 内核 = **no-op**（taffy 无 contain 模型）= 假绿 ⇒ 不折。
  'container-type': { to: [], separate: true, channel: 'independent', evidence: '@proteus-vue/fluid 的 createContainerQuery/createSizeAwareObserver（容器尺寸观察 + 容器级断点）+ capabilities.ts 的 containerQuery 能力检测；消费先例 = p-formfactor（@container 规则的组件）等 6 个组件', note: '**容器查询通道（使能器）**：`container-type` 是 `@container` 的**使能器**——其真实能力（按容器宽度的条件样式）由 `@proteus-vue/fluid` 的容器查询通道交付（已落地，组件已接入）；**CSS `@container` / `@media` 条件块在 App 端跳过**（无 CSS 引擎，具名边界）；单独折叠 `container-type` = no-op（不折）。' },
  // ★★★overscroll-behavior-x/-y 项（2026-10-08 · css:next P0·1× · CSS Overscroll Behavior）：**滚动行为（组件通道）**。
  //   语义 = 滚动到边界时**是否把滚动链传播给父/页面**（contain=不传播 / none=不滚且不传播 / auto=默认传播）。
  //   · 语料 1×：p-scrollable 下拉刷新（Web 端用 `overscroll-behavior-y:contain` 阻止链到页面）；
  //   · **App 端无作用对象**：App 只有**单一页面级滚动**（整树滚动，决策 #570），`overflow:auto/scroll` 在 App 域是**静态裁剪非滚动交互**（决策 #560）⇒ **无嵌套滚动容器 ⇒ 无滚动链**；过滚动动量由内核/平台控制；
  //   · **Skyline 官方属性表未收录** `overscroll-behavior`（引擎锁死）——Web 原生支持（基准）。
  //   ⇒ 语义载体 = **p-scrollable 组件**（组件通道）；单独折进 App 内核 = no-op（无滚动链可阻断）= 假绿 ⇒ 不折。
  'overscroll-behavior-y': { to: [], separate: true, channel: 'component', evidence: 'p-scrollable 组件（下拉刷新 scrollStyle.overscrollBehaviorY + 样式 .p-scrollable-bounce）；Web 原生支持', note: "**滚动行为（组件通道）**：语义 = 边界处**阻止滚动链传播**（contain/none/auto）。语义载体 = `p-scrollable` 组件；**App 端无作用对象**（单一页面滚动 + overflow 仅静态裁剪 ⇒ 无嵌套滚动链，过滚动由内核控制）；**Skyline 官方表未收录**（引擎锁死）。" },
  'overscroll-behavior-x': { to: [], separate: true, channel: 'component', evidence: '同 -y（同族）；Web 原生支持；App 无嵌套横向滚动链；Skyline 未收录', note: "**滚动行为（组件通道）**：同 `overscroll-behavior-y`（横向轴）。App 无嵌套横向滚动链（无作用对象）；Skyline 未收录（引擎锁死）。" },
}
/* ── ④-c 独立通道（动画/过渡/绘制声明——非 CSS 字段但真已实现）──
 *   ★这些能力**不走 IR 字段**（它们是"通道"：transition/animation 走 packages/animation 的
 *     规格→内核动画；mask 走结构化属性通道）——清单须如实标 implemented（否则又是假阴性）。
 */
const SEPARATE_CHANNELS = new Set(['transition', 'animation', 'animation-name', 'animation-duration', 'animation-delay', 'animation-iteration-count', 'animation-timing-function', 'transition-duration', 'transition-property', 'transition-timing-function', 'will-change', 'mask'])


const EXCLUDED_REASONS = {
  float: '三端无法统一（Skyline/App 无浮动流）；Profile CSS001 已判 error',
  clear: '同 float（清除浮动语义不存在）',
  'print-color-adjust': '打印媒体不在目标面（App/Skyline 无打印）',
  'page': '分页媒体（@page）不在目标面',
  'orphans': '分页媒体属性',
  'widows': '分页媒体属性',
  cursor: '指针光标（触屏无光标；Web 端保留浏览器默认即可）',
  'user-select': '文本选择（App 端自绘无选区语义——v1 不做）',
  'caret-color': '文本插入符颜色（App 自绘输入未接）',
  'accent-color': '表单控件着色（App 端表单自绘另有通道）',
  'scrollbar-color': '滚动条着色（App 滚动条隐藏/自绘）',
  'scrollbar-width': '同上',
  'touch-action': '触控手势策略（App 端手势层在图层面统一处理）',
  'overscroll-behavior': '过滚动行为（App 端滚动动量由内核控制）',
  'resize': '元素手动缩放（App 端无此交互语义）',
  'all': '全属性重置简写（引擎面不支持整树重置；用显式声明）',
  'zoom': '非标准缩放（Chromium 专有）',
  'content': '::before/::after 内容注入（伪元素与内容注入均不在 Profile 内）',
  quotes: '引号嵌套（依赖 content 注入）',
  'counter-reset': 'CSS 计数器（依赖 content 注入）',
  'counter-increment': '同上',
  'list-style-type': '列表标记（App 端无列表标记渲染面——v1）',
  'list-style-position': '同上',
  'list-style-image': '同上',
  'list-style': '同上（简写）',
  'columns': '多列布局（三端一致性成本极高、使用率低）',
  'column-count': '同上',
  'column-width': '同上',
  'column-gap': '', // ← 注意：column-gap 已实现（flex gap），此处留空会误判——下面有守卫
  'column-rule': '多列分隔线（随多列布局）',
  'column-span': '同上',
  'column-fill': '同上',
  'break-before': '分页/多列（目标面外）',
  'break-after': '同上',
  'break-inside': '同上',
  'page-break-before': '同上（旧名）',
  'page-break-after': '同上',
  'page-break-inside': '同上',
  'text-emphasis': '着重号（三端字体绘图成本高、使用率低）',
  'text-emphasis-color': '同上',
  'text-emphasis-style': '同上',
  'text-emphasis-position': '同上',
  'text-align-last': '末行对齐（App 文本排版未接）',
  'text-justify': '两端对齐策略细化（同上）',
  hyphens: '自动断词（需词典——Profile L4 不做文本基础设施）',
  'font-variant-emoji': 'emoji 呈现策略（L4）',
  'font-feature-settings': 'OpenType 特性（L4）',
  'font-variant-ligatures': '连字（L4）',
  'font-kerning': '字距调整（L4）',
  'font-stretch': '字宽拉伸（L4——需多字重字体族）',
  'unicode-bidi': 'BiDi 算法控制（L4——复用平台能力）',
  direction: 'BiDi 方向（同上；App 端按平台默认）',
  'writing-mode': '书写模式（竖排等——三端成本高，v1 out）',
  'text-orientation': '同上',
  'text-combine-upright': '同上',
  'ruby-align': '注音排版（L4）',
  'ruby-position': '同上',
  'paint-order': 'SVG 绘制顺序（现有 svg-path 通道自管）',
  'stroke': 'SVG 呈现属性（App 走 svg-path/fill 通道，不进 CSS 面）',
  'fill': '同上',
  'stroke-width': '同上',
  'stroke-dasharray': '同上',
  'stroke-dashoffset': '同上',
  'stroke-linecap': '同上',
  'stroke-linejoin': '同上',
  'marker-start': ' SVG 标记（out）',
  'marker-mid': '同上',
  'marker-end': '同上',
  'mask-type': 'CSS Masking 类型（现有 mask 属性通道自管）',
  'clip-rule': 'SVG 裁剪规则（-out）',
  'fill-rule': 'SVG 填充规则（现有通道自管）',
  'flood-color': 'SVG 滤镜（-out）',
  'flood-opacity': '同上',
  'lighting-color': '同上',
  'stop-color': 'SVG 渐变停靠（现有 fill-gradient 通道自管）',
  'stop-opacity': '同上',
  'color-interpolation': 'SVG 插值（-out）',
  'color-interpolation-filters': '同上',
  'shape-rendering': 'SVG 渲染提示（-out）',
  'text-rendering': '文本渲染提示（-out）',
  'color-rendering': '同上',
  'image-rendering': '位图缩放算法提示（平台各异——现状登记）',
  'pointer-events': '', // 已实现（留空会误判——下面有守卫剔除）
  '-webkit-text-fill-color': 'nonstandard（前缀）',
  'forced-color-adjust': '强制色模式（目标面外）',
  'color-scheme': '配色方案声明（Web 端浏览器面；App 走主题 token）',
  'scroll-behavior': '平滑滚动（App 端滚动动画由内核控制）',
  'scroll-snap-type': '滚动吸附（App 端未接——登记待评估）',
  'scroll-snap-align': '同上',
  'scroll-margin': '同上（族）',
  'scroll-padding': '同上（族）',
  'view-transition-name': '视图过渡 API（Web 专有）',
  'animation-timeline': '滚动驱动动画（Chrome 新特性——三端语义未定）',
  'timeline-scope': '同上',
  'field-sizing': '表单尺寸（实验性）',
  'interpolate-size': '尺寸插值（实验性）',
}
// 从 EXCLUDED 里剔除"实际已实现"的（守卫：防手写清单与事实冲突）
for (const k of ['column-gap', 'pointer-events', 'cursor']) {
  if (STYLE_IR_FIELDS[toCamel(k)] || STYLE_PROP_LEVELS[toCamel(k)] || STYLE_PROP_LEVELS[k]) delete EXCLUDED_REASONS[k]
}
delete EXCLUDED_REASONS.cursor // cursor 保持 excluded（上面循环不删它——显式再删一次以澄清）
EXCLUDED_REASONS.cursor = '指针光标（触屏无光标；Web 端保留浏览器默认即可）'

// ★★逻辑属性族具名排除（2026-10-05 · 边框族收口批清单审计）：border-inline-* / border-block-* /
//   margin-block-* / inset-inline-* / padding-inline-* / inline-size / block-size / overflow-block 等
//   **70 条**（匹配 = /(^|-)(inline|block)(-|$)/，-ms- 前缀除外）。
//   【为什么排除】逻辑属性的一切语义都由**书写模式**决定——writing-mode / direction 均已具名 excluded
//   （竖排不做、BiDi 复用平台默认）；在横排 LTR（唯一开放形态）下逻辑属性 ≡ 对应物理属性
//   （inline-start→left / block-start→top），没有独立语义面可对齐。
//   【为什么不留 not-started】无理由的 not-started 会以 P1 进入"可推项"排序 ⇒ 误导下一项选择
//   （与"不静默"纪律同源：状态本身就是信息）。
//   【出路】待书写模式进目标面时移除本循环——编译器侧一行映射（逻辑→物理）即可落地。
for (const kebab of Object.keys(mdnProps)) {
  if (kebab.startsWith('-ms-')) continue
  if (!/^(inline|block)-size$/.test(kebab) && !/-(inline|block)(-|$)/.test(kebab)) continue
  if (!(kebab in EXCLUDED_REASONS)) {
    EXCLUDED_REASONS[kebab] =
      '逻辑属性（依赖书写模式——横排 LTR 下 ≡ 对应物理属性；与 writing-mode 的 excluded 一致，v1 统一物理写法）'
  }
}

/* ── ⑤ 实现状态判定（按证据——不拍脑袋）── */
const KNOWN_ENGINE_CHANNELS = new Set([
  // 走"结构化属性通道"而非 CSS 属性的能力（映射到对应 CSS 名便于清单归位）
  'clip-path', 'mask', 'background-image', // fill-gradient 通道 = background-image 的渐变子集
])

function implOf(kebab, camelRaw) {
  // ★别名：CSS 名 → IR 字段（-webkit-line-clamp → lineClamp）
  const camel = FIELD_ALIAS[kebab] ?? camelRaw
  const inIr = camel in STYLE_IR_FIELDS
  const irSpec = inIr ? STYLE_IR_FIELDS[camel] : undefined
  // ★★矩阵表是 **camelCase 键**（`textAlign`/`whiteSpace`…）——首版只查 kebab ⇒ 所有多词属性
  //   matrixLevel 系统性为 null（`text-align` 已被误报过）。双查：camel 优先、kebab 兜底
  //   （单字键如 `color` 两者相同，不冲突）。
  const matrixLevelOf = STYLE_PROP_LEVELS[camel] ?? STYLE_PROP_LEVELS[kebab]
  const inMatrix = matrixLevelOf !== undefined
  // excluded 判定（具名理由 或 nonstandard/obsolete）
  const meta = mdnProps[kebab]
  const status = meta?.status ?? 'unknown'
  if (status === 'nonstandard' || status === 'obsolete') {
    return { impl: 'excluded', note: `MDN 状态 ${status}（不进目标面）`, inIr, inMatrix, inCompilerFold: false, irScope: undefined }
  }
  if (kebab in EXCLUDED_REASONS) {
    return { impl: 'excluded', note: EXCLUDED_REASONS[kebab], inIr, inMatrix, inCompilerFold: false, irScope: undefined }
  }
  if (inIr) {
    return { impl: 'implemented', note: `IR 注册表在册（scope=${irSpec.scope}${inMatrix ? ` · 矩阵 ${matrixLevelOf}` : ''}）`, inIr, inMatrix, matrixLevel: matrixLevelOf ?? null, inCompilerFold: Boolean(irSpec.sources.compiler), irScope: irSpec.scope }
  }
  if (inMatrix) {
    return { impl: 'partial', note: `在 CSS 矩阵（${matrixLevelOf}）但未进 IR 注册表——待四同步`, inIr, inMatrix, matrixLevel: matrixLevelOf ?? null, inCompilerFold: false, irScope: undefined }
  }
  // ★★简写/别名对账（④-b——清单可信的关键）：该能力**展开成别的字段**（不是同名字段）
  const exp = SHORTHAND_EXPANSION[kebab]
  if (exp) {
    if (exp.separate) {
      return { impl: 'implemented', channel: exp.channel ?? 'independent', note: `**独立通道**：${exp.note}（证据：${exp.evidence}）`, inIr, inMatrix, inCompilerFold: false, irScope: undefined, expansion: { to: [], evidence: exp.evidence, note: exp.note, separate: true } }
    }
    if (exp.notYet) {
      return { impl: 'not-started', note: `未接：${exp.note}（证据：${exp.evidence}）`, inIr, inMatrix, inCompilerFold: false, irScope: undefined, expansion: { to: [], evidence: exp.evidence, note: exp.note, notYet: true } }
    }
    const to = exp.to ?? []
    const inIrCount = to.filter((f) => f in STYLE_IR_FIELDS).length
    if (to.length > 0 && inIrCount === to.length && !exp.notYet) {
      const partialNote = exp.partial ? `（附：${exp.partial.join('/')} 部分支持）` : ''
      return {
        impl: exp.conditional ? 'partial' : 'implemented',
        note: `**简写展开**：${to.join(' + ')}${partialNote}——${exp.note}（证据：${exp.evidence}）`,
        inIr,
        inMatrix,
        inCompilerFold: false,
        irScope: undefined,
        expansion: { to, evidence: exp.evidence, note: exp.note, ...(exp.conditional ? { conditional: true } : {}) },
      }
    }
  }
  if (KNOWN_ENGINE_CHANNELS.has(kebab)) {
    return { impl: 'partial', note: '有结构化属性通道（非 CSS 属性形态）——CSS 写法待接', inIr, inMatrix, inCompilerFold: false, irScope: undefined }
  }
  return { impl: 'not-started', note: '', inIr, inMatrix, inCompilerFold: false, irScope: undefined }
}

/* ── ⑥ 优先级推导（用量 + 分组常见度）── */
const COMMON_GROUPS = /(Box Model|Flexbox|Colors|Text|Font|Background|Border|Basic User Interface|Display|Positioning|Inline Layout|Overflow|Grid|Transforms|Animations|Transitions|Images|Box Alignment|Logical Properties|Scroll Snap)/i

function priorityOf(kebab, implInfo, usage) {
  if (implInfo.impl === 'excluded') return 'excluded'
  if (implInfo.impl === 'implemented') return 'done'
  if (usage > 0) return 'P0' // 语料在用但未实现的——真实需求，最优先
  const meta = mdnProps[kebab]
  const groups = (meta?.groups ?? []).join(' ')
  if (meta?.status === 'standard' && COMMON_GROUPS.test(groups)) return 'P1'
  return 'P2'
}

/* ── ⑦ 组装清单 ── */
const toEntry = (kebab, kind) => {
  const camel = toCamel(kebab)
  const meta = kind === 'property' ? mdnProps[kebab] : undefined
  const implInfo = kind === 'property' ? implOf(kebab, camel) : { impl: 'not-started', note: '', inIr: false, inMatrix: false, inCompilerFold: false, irScope: undefined }
  const usage = USAGE.get(kebab) ?? 0
  return {
    id: kebab,
    kind,
    mdnStatus: meta?.status ?? 'standard',
    groups: meta?.groups ?? [],
    inherited: meta?.inherited ?? false,
    initial: meta?.initial ?? null,
    syntax: meta?.syntax ?? null,
    impl: implInfo.impl,
    implNote: implInfo.note,
    channel: implInfo.channel ?? null, // ★非编译器折叠的投递通道（component / independent / non-visual〔无视觉输出——合成/性能提示〕）——verify 据此把 parity/ends 判 n/a
    evidencedBy: {
      inIrRegistry: implInfo.inIr,
      irScope: implInfo.irScope ?? null,
      inCompilerFold: implInfo.inCompilerFold,
      matrixLevel: implInfo.matrixLevel ?? null,
      webSupport: webSupports.properties?.[kebab]?.supported ?? null,
    },
    usage,
    priority: kind === 'property' ? priorityOf(kebab, implInfo, usage) : 'P2',
    acceptance: implInfo.impl === 'implemented' ? 'pending' : 'none', // 验收状态（逐项推进时更新——见 verify-css-feature）
  }
}

const properties = Object.keys(mdnProps).map((k) => toEntry(k, 'property'))
const selectors = Object.keys(mdnSelectors).map((k) => ({
  id: k,
  kind: 'selector',
  mdnStatus: mdnSelectors[k].status ?? 'standard',
  groups: mdnSelectors[k].groups ?? [],
  syntax: mdnSelectors[k].syntax ?? null,
  impl: 'not-started',
  implNote: '',
  evidencedBy: { inIrRegistry: false, irScope: null, inCompilerFold: false, matrixLevel: null, webSupport: null },
  usage: 0,
  priority: 'P1', // 选择器面（CSE 已支持类/元素/id/通配/后代/子组合/结构伪类/:not/:deep/:root——见 cse/parse.ts）
  acceptance: 'none',
}))
// ★★★条件 at-rule 通道（2026-10-08 · css:next）：`@media`（视口/环境条件）与 `@supports`（特性检测）
//   ——**跨端控制结构**，其语义由 **`@proteus-vue/fluid` 独立通道**交付（与 `container-type` 同族）：
//   · 视口/容器断点 → createContainerQuery / resolveBreakpoint / createAdaptiveController（**容器**而非视口，车机/多窗口）；
//   · prefers-reduced-motion → shouldReduceMotion / createDeviceEnv · orientation/display-mode(折叠) → readDisplayMode；
//   · hover/pointer → probePointer · 特性检测(@supports) → detectFluidCapabilities（probe 式）。
//   ⇒ 归类为 `channel: 'independent'`（css:verify 判 parity/ends = n/a），**非**编译器折叠面。
//   ★具名边界（FLD001 / W-6，决策 #279）：手写 `@media` 在 App 端**无对等**（无 CSS 引擎）⇒ 框架规定响应式走 fluid；
//     `docs/compiler.md` 已记「@container / @media 条件块 App 端跳过」。
const COND_AT_RULE_CHANNEL = {
  '@media': '视口/环境条件（responsive + prefers-*）。语义由 @proteus-vue/fluid 独立通道交付——视口/容器断点走 createContainerQuery/resolveBreakpoint/createAdaptiveController（以**容器**为基准）；prefers-reduced-motion 走 shouldReduceMotion/createDeviceEnv；orientation/display-mode(折叠) 走 readDisplayMode；hover/pointer 走 probePointer。★具名边界（决策 #279 FLD001 / W-6）：手写 @media 在 App 端无对等（无 CSS 引擎）⇒ 框架规定响应式用 fluid 容器查询（禁止手写 @media）；Web/MP 由各自 CSS 引擎原生处理。',
  '@supports': 'CSS 特性检测。语义由 @proteus-vue/fluid 的 detectFluidCapabilities（probe 式运行时能力检测：clamp/grid/containerQuery/flexGap/aspectRatio）与 formSupports 交付（运行时能力分支，非样式表条件块）；App 端无 CSS 引擎 ⇒ @supports 块跳过（具名边界）。Web/MP 由各自 CSS 引擎原生处理。',
}
const atRules = Object.keys(mdnAtRules).map((k) => ({
  id: k,
  kind: 'at-rule',
  mdnStatus: mdnAtRules[k].status ?? 'standard',
  syntax: mdnAtRules[k].syntax ?? null,
  impl: ['@layer', '@keyframes'].includes(k) ? 'implemented' : COND_AT_RULE_CHANNEL[k] ? 'implemented' : 'not-started',
  implNote: k === '@layer' ? 'CSE 五级层叠含 @layer（含 important 反转）' : k === '@keyframes' ? '动画通道（批次 42）' : COND_AT_RULE_CHANNEL[k] ? `**独立通道（@proteus-vue/fluid）**：${COND_AT_RULE_CHANNEL[k]}` : '',
  channel: COND_AT_RULE_CHANNEL[k] ? 'independent' : null,
  evidencedBy: { inIrRegistry: false, irScope: null, inCompilerFold: false, matrixLevel: null, webSupport: null },
  usage: 0,
  // ★已实现 ⇒ done（不留在 P0/P1——否则"可推项"计数把已完成的算进去）
  priority: ['@layer', '@keyframes'].includes(k) || COND_AT_RULE_CHANNEL[k] ? 'done' : 'P1',
  acceptance: 'none',
}))
const MATH_FNS = ['min()', 'max()', 'clamp()']
const functions = Object.keys(mdnFunctions).map((k) => ({
  id: k,
  kind: 'function',
  mdnStatus: mdnFunctions[k].status ?? 'standard',
  syntax: mdnFunctions[k].syntax ?? null,
  // ★★★数学/计算函数项（2026-10-08 · css:next）：min()/max()/clamp() + calc() 已实现（CSE + 折叠面同口径）
  // ★★★var() 项（2026-10-08 · css:next）：收口为 implemented（含 fallback/嵌套 + **var 简写展开**：值含 var() 的简写在 compute 期替换后展开）
  impl: MATH_FNS.includes(k) || k === 'calc()' || k === 'var()' ? 'implemented' : 'not-started',
  implNote: MATH_FNS.includes(k)
    ? 'CSE + App 折叠面**px-only** 常量化（全参数绝对化 ⇒ 折单 px；含 %/vw ⇒ 诊断不静默丢）'
    : k === 'calc()' ? 'CSE + App 折叠面**同口径**（共享 calc-fold.ts）：完整算术（+ - * / 与括号）+ env(safe-area-*) fallback；含 %/相对单位 ⇒ 诊断不静默丢'
    : k === 'var()' ? 'CSE 支持（含 fallback/嵌套；编译期字面替换 + **值含 var() 的简写在 compute 期替换后展开**——此前 parse 期误当单值展开 ⇒ 多值令牌对单边非法丢弃）' : '',
  evidencedBy: { inIrRegistry: false, irScope: null, inCompilerFold: MATH_FNS.includes(k) || k === 'calc()', matrixLevel: null, webSupport: null },
  usage: 0,
  priority: MATH_FNS.includes(k) || k === 'calc()' || k === 'var()' ? 'done' : 'P1',
  acceptance: 'none',
}))
const units = Object.keys(mdnUnits).map((k) => ({
  id: k,
  kind: 'unit',
  mdnStatus: mdnUnits[k].status ?? 'standard',
  syntax: mdnUnits[k].syntax ?? null,
  impl: ['px', 'em', 'rem', '%', 'vw', 'vh', 'pt', 'rpx'].includes(k) ? 'implemented' : 'not-started',
  implNote: k === 'rpx' ? '小程序语义单位（编译期折算 dp——CSE 长度归一）' : '',
  evidencedBy: { inIrRegistry: false, irScope: null, inCompilerFold: false, matrixLevel: null, webSupport: null },
  usage: 0,
  // ★已实现 ⇒ done（`pt` 曾漏——列表里两处不一致会误报"可推项"）
  priority: ['px', 'em', 'rem', '%', 'vw', 'vh', 'rpx', 'pt'].includes(k) ? 'done' : 'P1',
  acceptance: 'none',
}))

const all = [...properties, ...selectors, ...atRules, ...functions, ...units]
const summary = {
  total: all.length,
  byKind: all.reduce((acc, e) => ((acc[e.kind] = (acc[e.kind] ?? 0) + 1), acc), {}),
  byImpl: all.reduce((acc, e) => ((acc[e.impl] = (acc[e.impl] ?? 0) + 1), acc), {}),
  byPriority: all.reduce((acc, e) => ((acc[e.priority] = (acc[e.priority] ?? 0) + 1), acc), {}),
  // ★推进视角：真正"待实现且值得做"的（P0/P1 且非 excluded）
  actionable: all.filter((e) => e.impl !== 'implemented' && e.impl !== 'excluded').length,
  actionableP0: all.filter((e) => e.priority === 'P0').length,
}

const content =
  JSON.stringify(
    {
      _note:
        '★★★CSS Web 全量能力清单（用户 2026-10-05 指定：要"所有 CSS Web 能力"入清单、逐个实现、逐个全端视觉验收）。' +
        '数据源：mdn-data（MDN 官方机器可读——本机依赖树）+ 本仓语料用量（真实需求信号）+ 既有实现证据对账。' +
        '推进纪律：① 每实现一项 = CSE 支持 + IR 注册（INV-CE-07 四同步）+ parity 用例（真 Chromium）+ 三端 applier + 全端视觉验收；' +
        '② 验收装置：node scripts/verify-css-feature.mjs <id>（parity 真跑 + 三端状态 + 验收包）；' +
        '③ excluded 条目均带理由（具名清单——不静默丢）。',
      generatedFrom: {
        mdnData: 'node_modules/.pnpm/mdn-data@*/node_modules/mdn-data/css/*.json',
        corpusUsage: 'examples/ + superapp/ + packages/components（属性出现次数）',
        irRegistry: 'packages/contracts/src/style-ir-registry.generated.ts',
        matrix: 'packages/contracts/src/style.ts（STYLE_PROP_LEVELS）',
        webSupports: 'docs/generated/css-capability-sources/web-supports.json',
      },
      summary,
      entries: all,
    },
    null,
    2,
  ) + '\n'

/* ── ⑧ MD 摘要（人读——按优先级分组列 actionable）── */
const mdLines = [
  '# CSS Web 全量能力清单（自动生成——勿手改；生成器 scripts/gen-css-feature-inventory.mjs）',
  '',
  `> 总 ${summary.total} 项（${Object.entries(summary.byKind).map(([k, v]) => `${k} ${v}`).join(' · ')}）`,
  `> 实现：${Object.entries(summary.byImpl).map(([k, v]) => `**${k}** ${v}`).join(' · ')}`,
  `> 优先级：${Object.entries(summary.byPriority).map(([k, v]) => `${k} ${v}`).join(' · ')}`,
  `> ★**可推项（非已实现/非排除）**：${summary.actionable}（其中 **P0 ${summary.actionableP0}**）`,
  '',
  '## P0 —— 语料在用但未实现（真实需求，最优先）',
  '',
  '| 属性 | MDN 状态 | 分组 | 语料用量 | 实现 | 说明 |',
  '|---|---|---|---|---|---|',
  ...properties.filter((e) => e.priority === 'P0').slice(0, 60).map((e) => `| \`${e.id}\` | ${e.mdnStatus} | ${e.groups.join(', ') || '—'} | ${e.usage} | ${e.impl} | ${e.implNote || '—'} |`),
  '',
  '## P1 —— 标准且常用分组（未实现）',
  '',
  '| 属性 | 分组 | 实现 |',
  '|---|---|---|',
  ...properties.filter((e) => e.priority === 'P1').slice(0, 80).map((e) => `| \`${e.id}\` | ${e.groups.join(', ') || '—'} | ${e.impl} |`),
  '',
  '（P2 与 excluded 全量见 JSON；本 MD 只列推进面）',
  '',
]
const md = mdLines.join('\n')

const problems = []
if (CHECK || !UPDATE) {
  const prevJson = fs.existsSync(OUT_JSON) ? fs.readFileSync(OUT_JSON, 'utf-8') : ''
  if (prevJson !== content) problems.push('清单与重算不一致——跑 `--update`（若确为数据/代码变更）')
}
if (UPDATE) {
  fs.writeFileSync(OUT_JSON, content)
  fs.writeFileSync(OUT_MD, md)
}

console.log('CSS Web 全量能力清单（用户指定：全量入库 + 逐项推进）')
console.log(`  总 ${summary.total} 项：${Object.entries(summary.byKind).map(([k, v]) => `${k} ${v}`).join(' · ')}`)
console.log(`  实现：${Object.entries(summary.byImpl).map(([k, v]) => `${k} ${v}`).join(' · ')}`)
console.log(`  优先级：${Object.entries(summary.byPriority).map(([k, v]) => `${k} ${v}`).join(' · ')}`)
console.log(`  ★可推项：${summary.actionable}（P0 ${summary.actionableP0}）`)
if (problems.length) {
  console.log('')
  for (const p of problems) console.log(`  ❌ ${p}`)
  process.exit(1)
}
if (UPDATE) console.log(`\n✅ 已写 ${path.relative(ROOT, OUT_JSON)} + ${path.relative(ROOT, OUT_MD)}`)
