#!/usr/bin/env node
// scripts/check-host-variant-parity.mjs —— ★★★三端宿主「dev-host = 宿主」变体一致性门禁（2026-10-09）
//
// 【它防什么（用户点名）】「看下我们现在的 App 三端宿主是否是 **dev-host 调试基座即宿主** 的定位，
//   防止 **build 打包后丢失 dev 宿主的完整功能（dev 调试相关的除外）**」。
//   【本仓定位】**每个端只有一套壳**（`templates-host/<端>`），**dev 与 release 共用同一份壳文件**，
//   只靠一个**编译期常量**（Android/iOS 的 `ProteusBuildConfig.DEV`）切换：
//     · `DEV=true`（`proteus dev`）⇒ bundle 走 HTTP dev server + 开热刷/面板（dev 调试件）；
//     · `DEV=false`（`proteus build --package`）⇒ bundle 读内嵌资产 + **不创建** dev 调试件。
//   ⇒ 风险：若有人把**功能**误放进 `if (DEV)`、或把功能加到 **dev-only 文件**（DevOverlay）里，
//     则 **release 静默丢功能**（本地 dev 全绿、装出来少东西——与"提交≠交付"同族：没有任何机制提醒）。
//
// 【判据】① 每端**功能能力清单**必须都在**主壳**内（不被 DEV 门控 / 不在 dev-only 文件里）；
//         ② 变体模型齐备（android/ios：`ProteusBuildConfig.DEV` 常量 + dev 调试层以 `DEV` 早退）；
//         ③ release 隔离（android release manifest **不含** INTERNET）。
//   ★已知缺口走**具名登记**（KNOWN_GAPS，附理由 + 决策号）——不静默豁免；补齐后删登记。
//
// 用法：node scripts/check-host-variant-parity.mjs
// 退出码：0 通过 / 1 违反
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const T = (p) => path.join(ROOT, 'packages/cli/templates-host', p)
const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '')

/** 每端：主壳文件（dev 与 release **共用**）+ 端名 + dev-only 文件（功能不得只落这里）。 */
const ENDS = {
  android: {
    label: 'Android',
    shell: ['android/src/dev/proteus/layoutcore/AppActivity.java'],
    devOnly: ['android/src/dev/proteus/layoutcore/DevOverlay.java'],
    /** 变体常量（编译期 DEV/DEV_URL）——单一壳的唯一分叉点。 */
    variantConst: 'android/src/dev/proteus/layoutcore/ProteusBuildConfig.java',
    devConstRe: /static\s+final\s+boolean\s+DEV\b/,
    /** dev 调试层须以 DEV 早退（release 零残留）。 */
    devGuard: { file: 'android/src/dev/proteus/layoutcore/DevOverlay.java', re: /if\s*\(\s*!?\s*ProteusBuildConfig\.DEV\s*\)\s*return/ },
  },
  ios: {
    label: 'iOS',
    shell: ['ios/shell/ProteusApp.swift'],
    devOnly: ['ios/shell/ProteusDevOverlay.swift'],
    variantConst: 'ios/shell/ProteusBuildConfig.swift',
    devConstRe: /static\s+let\s+DEV\s*=\s*(?:true|false)/,
    devGuard: { file: 'ios/shell/ProteusApp.swift', re: /if\s+ProteusBuildConfig\.DEV\s*\{/ },
  },
  harmony: {
    label: '鸿蒙',
    shell: ['harmony/entry/src/main/ets/shell/MainPage.ets', 'harmony/entry/src/main/ets/shell/EntryAbility.ets'],
    devOnly: ['harmony/entry/src/main/ets/dev/DevWatch.ets', 'harmony/entry/src/main/ets/dev/DevOverlay.ets'],
    // ★决策 #728：鸿蒙 dev 通道落地 ⇒ 有了编译期变体常量（与 android/ios 同模型）。
    variantConst: 'harmony/entry/src/main/ets/shell/ProteusBuildConfig.ets',
    devConstRe: /export\s+const\s+DEV\s*:\s*boolean\s*=/,
    /** dev 调试件（DevWatch）须门控创建（主壳 `if (DEV …)`）——release 零残留。 */
    devGuard: { file: 'harmony/entry/src/main/ets/shell/MainPage.ets', re: /if\s*\(\s*DEV\s*\|\|/ },
  },
}

/** 功能能力清单（**release 必须保留**——dev 调试相关的**不在此列**）。每端给一个"存在即合格"的正则。 */
const CAPS = [
  { id: 'runtime', name: '运行期启动/实例化', android: /__proteusSuperappBootJson/, ios: /__proteusSuperappBootJson/, harmony: /hostAppRender/ },
  { id: 'render', name: '上屏（建树/直绘）', android: /renderCurrent/, ios: /renderCurrent/, harmony: /renderCommands/ },
  { id: 'back', name: '返回（栈/系统返回）', android: /onBackPressed/, ios: /goBack/, harmony: /onBackPress/ },
  { id: 'scroll', name: '滚动 + 松手惯性', android: /scroll|fling/i, ios: /scrollDrag|startMomentum/, harmony: /scrollRoot|startMomentum/ },
  { id: 'safeArea', name: '安全区 / edge-to-edge', android: /setDecorFitsSystemWindows|setStatusBarColor/, ios: /safeArea|additionalSafeAreaInsets/, harmony: /getWindowAvoidArea|setWindowLayoutFullScreen/ },
  { id: 'splash', name: '启动占位（防黑屏）', android: /LaunchPlaceholder/, ios: /LaunchPlaceholder/, harmony: /LaunchPlaceholder/ },
]

/** ★已知缺口（具名登记：理由 + 决策号；补齐后删除）——不静默豁免。 */
const KNOWN_GAPS = {
  // （当前无缺口：鸿蒙启动占位已于 #731 接上）
}

const problems = []
const notes = []

/* ── ② 变体模型：dev 与 release **共用同一份主壳**（单一基座）── */
for (const [end, cfg] of Object.entries(ENDS)) {
  if (cfg.variantConst) {
    const vc = read(T(cfg.variantConst))
    if (!vc) problems.push(`② ${cfg.label}: 缺变体常量文件 ${cfg.variantConst}（dev/release 的唯一分叉点）`)
    else if (!cfg.devConstRe.test(vc)) problems.push(`② ${cfg.label}: ${cfg.variantConst} 未见 DEV 常量（dev/release 无法区分）`)
  }
  if (cfg.devGuard) {
    const g = read(T(cfg.devGuard.file))
    if (!g) problems.push(`② ${cfg.label}: 缺 dev 调试层 ${cfg.devGuard.file}`)
    else if (!cfg.devGuard.re.test(g)) problems.push(`② ${cfg.label}: dev 调试层未以 DEV 早退（release 会有残留）—— ${cfg.devGuard.file} 缺 \`if (!DEV) return\``)
  }
}

/* ── ① 功能能力清单必须都在**主壳**内 ── */
for (const [end, cfg] of Object.entries(ENDS)) {
  const shellText = cfg.shell.map((f) => read(T(f))).join('\n')
  if (!shellText.trim()) { problems.push(`① ${cfg.label}: 主壳文件缺失（${cfg.shell.join(', ')}）`); continue }
  for (const cap of CAPS) {
    const re = cap[end]
    if (re.test(shellText)) continue
    const gapKey = `${end}:${cap.id}`
    if (KNOWN_GAPS[gapKey]) { notes.push(`① ${cfg.label} 缺「${cap.name}」——已具名登记：${KNOWN_GAPS[gapKey]}`); continue }
    problems.push(`① ${cfg.label}: 主壳缺功能「${cap.name}」——**release 会丢失该功能**（dev 调试相关的除外，此处不是）`)
  }
}

/* ── ③ release 隔离：android release manifest 不含 INTERNET（dev 变体才有）── */
{
  const rel = read(T('android/AndroidManifest.xml'))
  const dev = read(T('android/AndroidManifest.dev.xml'))
  if (!rel) problems.push('③ Android: 缺 release manifest（AndroidManifest.xml）')
  else if (/android\.permission\.INTERNET/.test(rel)) problems.push('③ Android: **release manifest 含 INTERNET**（应仅 dev 变体有）')
  if (dev && !/android\.permission\.INTERNET/.test(dev)) problems.push('③ Android: dev manifest 缺 INTERNET（dev server 走 HTTP 需要）')
}

/* ── ④ dev 宿主 **UI/DX 规格**（决策 #732；逐模块规格见语义文档 §8.5）──
 *   反面教训：鸿蒙 dev 层一度"只有 toast、无角标/菜单/编辑态、toast 弹底部、菜单居中 dialog"。
 *   ★只对**已有 dev 视觉层的端**断言（Android/iOS 已落地；鸿蒙本批对齐）。 */
const DEV_UI_SPEC = {
  android: [
    { re: /Gravity\.TOP\s*\|\s*Gravity\.END/, why: 'DEV 角标须右上角（TOP|END）' },
    { re: /Gravity\.TOP\s*\|\s*Gravity\.CENTER_HORIZONTAL/, why: 'toast 须顶部居中（非底部）' },
    { re: /setEdited\s*\(/, why: '须有编辑态（DEV ✎ + 琥珀）' },
    { re: /toggleSheet|buildSheet/, why: '须有底部 sheet 菜单' },
  ],
  ios: [
    { re: /trailingAnchor[^\n]*-10/, why: 'DEV 角标须右上（trailing -10）' },
    { re: /centerXAnchor[^\n]*host\.centerXAnchor/, why: 'toast 须水平居中' },
    { re: /func setEdited|markEdited/, why: '须有编辑态' },
    { re: /toggleSheet|buildSheet/, why: '须有底部 sheet 菜单' },
  ],
  harmony: [
    { re: /alignItems\(HorizontalAlign\.End\)/, why: 'DEV 胶囊须右上角（容器 alignItems End）' },
    { re: /alignItems\(HorizontalAlign\.Center\)/, why: 'toast 须顶部居中（容器 alignItems Center）' },
    { re: /this\.edited\b/, why: '须有编辑态（DEV ✎ + 琥珀）' },
    { re: /sheetOn/, why: '须有底部 sheet 菜单（非居中 dialog）' },
    { re: /showAlertDialog\)/, why: '菜单不得用居中 dialog（应底部 sheet）', negate: true },
  ],
}
const DEV_UI_FILE = {
  android: 'android/src/dev/proteus/layoutcore/DevOverlay.java',
  ios: 'ios/shell/ProteusDevOverlay.swift',
  harmony: 'harmony/entry/src/main/ets/shell/MainPage.ets',
}
for (const [end, specs] of Object.entries(DEV_UI_SPEC)) {
  const src = read(T(DEV_UI_FILE[end]))
  if (!src) { problems.push(`④ ${ENDS[end].label}: 缺 dev 视觉层文件（${DEV_UI_FILE[end]}）`); continue }
  for (const s of specs) {
    const hit = s.re.test(src)
    if (s.negate) { if (hit) problems.push(`④ ${ENDS[end].label}: dev UI 规格违反——${s.why}`) }
    else if (!hit) problems.push(`④ ${ENDS[end].label}: dev UI 规格缺项——${s.why}`)
  }
}
// ④b 源码映射：鸿蒙 /tree 须带 `file`（取运行期 currentContent），否则面板跳不了编辑器
{
  const impl = read(path.join(ROOT, 'hosts/harmony/host-app/proteus_render/src/main/cpp/host_app_runtime_impl.h'))
  if (impl && !/__proteusHostAppTree/.test(impl)) {
    problems.push('④ 鸿蒙: hostAppRender 未取 `__proteusHostAppTree`（/tree 不带 file ⇒ 面板无源码映射）')
  }
}

/* ── ⑤ dev 宿主 **sheet 逐像素规格 + 标准弹窗语义**（决策 #734/#735；三端一致）──
 *   逐像素：sheet 仅上两角圆角 + grab 把手 + 按钮圆角 10。
 *   标准弹窗语义（#735）：**遮罩 + 点外关 + 把手下拉关闭**（比"只点胶囊"更好用；两端旧做法一并升级）。 */
const SHEET_SPEC = {
  android: [
    { re: /setCornerRadii/, why: 'sheet 须上两角圆角（setCornerRadii）' },
    { re: /grab/i, why: '须 grab 把手' },
    { re: /setCornerRadius\(10 \* density\)/, why: '按钮圆角 10' },
    { re: /scrim/, why: '须遮罩（#735）' },
    { re: /onTouch|setOnTouchListener/, why: '须把手下拉关闭（#735）' },
  ],
  ios: [
    { re: /maskedCorners/, why: 'sheet 须仅上两角圆角（maskedCorners）' },
    { re: /grab/, why: '须 grab 把手' },
    { re: /reset\.layer\.cornerRadius = 10/, why: '按钮圆角 10' },
    { re: /scrim/, why: '须遮罩（#735）' },
    { re: /UIPanGestureRecognizer/, why: '须把手下拉关闭（#735）' },
  ],
  harmony: [
    { re: /borderRadius\(\{ topLeft: 16, topRight: 16 \}\)/, why: 'sheet 须仅上两角圆角' },
    { re: /borderRadius\(2\)/, why: '须 grab 把手（36×4 r2）' },
    { re: /ButtonType\.Normal\)\.borderRadius\(10\)/, why: '按钮圆角 10（非默认全圆角）' },
    { re: /#66000000/, why: '须遮罩（#735）' },
    { re: /PanGesture\(\{ direction: PanDirection\.Vertical \}\)/, why: '须把手下拉关闭（#735）' },
    { re: /\.transition\(TransitionEffect\.opacity/, why: '遮罩须淡入淡出转场（#736）' },
    { re: /TransitionEffect\.move\(TransitionEdge\.BOTTOM\)/, why: '面板须从底部滑入滑出（#736）' },
  ],
}
const SHEET_SPEC_FILE = {
  android: 'android/src/dev/proteus/layoutcore/DevOverlay.java',
  ios: 'ios/shell/ProteusDevOverlay.swift',
  harmony: 'harmony/entry/src/main/ets/shell/MainPage.ets',
}
for (const [end, specs] of Object.entries(SHEET_SPEC)) {
  const src = read(T(SHEET_SPEC_FILE[end]))
  if (!src) continue
  for (const s of specs) {
    const hit = s.re.test(src)
    if (s.negate) { if (hit) problems.push(`⑤ ${ENDS[end].label}: sheet 规格违反——${s.why}`) }
    else if (!hit) problems.push(`⑤ ${ENDS[end].label}: sheet 规格缺项——${s.why}`)
  }
}

console.log('三端宿主变体一致性门禁（dev-host = 宿主：单一壳 + dev 件门控 + 功能齐全 + dev UI/sheet 规格）')
for (const n of notes) console.log(`  ▸ ${n}`)
if (problems.length) {
  console.error(`\n❌ 违反（${problems.length}）：`)
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log('✅ 三端宿主变体一致（每端单一壳；功能清单齐全；dev 件以 DEV 门控；android release 无 INTERNET）')
