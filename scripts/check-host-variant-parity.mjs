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

console.log('三端宿主变体一致性门禁（dev-host = 宿主：单一壳 + dev 件门控 + 功能齐全）')
for (const n of notes) console.log(`  ▸ ${n}`)
if (problems.length) {
  console.error(`\n❌ 违反（${problems.length}）：`)
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log('✅ 三端宿主变体一致（每端单一壳；功能清单齐全；dev 件以 DEV 门控；android release 无 INTERNET）')
