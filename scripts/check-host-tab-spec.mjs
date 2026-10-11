#!/usr/bin/env node
// scripts/check-host-tab-spec.mjs —— ★★★B（决策 #800）：tab 栏**能力归属**门禁（防回归）
//
// 【演进史（两次教训叠起来）】
//   ① 2026-10-08（B2·G6）：tab 栏视觉规格曾硬编码在**三端各一份** ⇒ 收敛成共享常量 TAB_BAR_SPEC，
//      门禁查"宿主不得再出现图标/标签映射字面量（⌂/✉/☺、"首页"）"。
//   ② 2026-10-11（B · #800）：规格"下发"没收住**实现**——三端 + 参考/模板两个壳族共**六份**建栏/合并/
//      兜底/高亮逻辑，实测漂移（模板=项目真值优先、参考=规格优先；"•"/"☺"/人形符号三种图标兜底；
//      鸿蒙模板整个没有 tab 栏）。⇒ 实现收敛进**各端 runtime 的 TabChrome**（一份），壳只装配，
//      内容（文案/字形/角标）由 gen-routes 在**生成期合并成最终值**（auto-routes 的 tabItems）。
//
// 【判据（双向）】
//   ① 三端 runtime **必须**有 TabChrome 实现（缺 ⇒ 能力未落地）；
//   ② **六壳**（参考宿主 ×3 + CLI 模板 ×3）**不得**出现 tab 栏实现特征：
//      · 建栏/合并/兜底代码（buildTabBar/highlightTab/tabIcons/tabShortLabel/"•" 图标回退…）；
//      · 硬编码图标/标签映射字面量（⌂/✉/☺、"首页" 条件映射）——旧判据并入；
//      · 壳必须引用 runtime 的 ProteusTabChrome（装配点存在）。
//   ★六壳清单 = 能力归属检查的完整消费面（框架实测：只查参考宿主会漏掉"模板才是未来所有宿主"）。
//
// 用法：node scripts/check-host-tab-spec.mjs
// 退出码：0 通过 / 1 违反
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const problems = []

/** ① 三端 runtime —— TabChrome 唯一实现（每端给出实现锚点正则）。 */
const RUNTIME_TARGETS = [
  { rel: 'hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/ProteusTabChrome.java', re: /class ProteusTabChrome/ },
  { rel: 'hosts/ios/ProteusHost/runtime/tab-chrome.swift', re: /final class ProteusTabChrome/ },
  { rel: 'hosts/harmony/host-app/proteus_render/TabChrome.ets', re: /export struct ProteusTabChrome/ },
]

/** ② 六壳 —— 参考宿主 ×3 + CLI 模板 ×3（不得重实现；必须装配 runtime chrome）。 */
const SHELL_TARGETS = [
  'hosts/android/app/src/main/java/dev/proteus/layoutcore/shell/SuperappActivity.java',
  'hosts/ios/ProteusHost/shell/superapp-scene.swift',
  'hosts/harmony/host-app/entry/src/main/ets/shell/Superapp.ets',
  'packages/cli/templates-host/android/src/dev/proteus/layoutcore/AppActivity.java',
  'packages/cli/templates-host/ios/shell/ProteusApp.swift',
  'packages/cli/templates-host/harmony/entry/src/main/ets/shell/MainPage.ets',
]

/** 壳内 tab 实现特征（命中即"壳内重实现"——应归 runtime）。
 *  ★只扫代码行（剥注释）：文档提及/装配注释不算实现。 */
const SHELL_IMPL_MARKERS = [
  { re: /buildTabBar|highlightTab/, why: '建栏/高亮实现（应归 runtime TabChrome）' },
  { re: /\btabIcons\b|\btbIcons\b|tabShortLabel|\btbLabels\b/, why: '图标/标签合并实现（应在生成期合并 + runtime 渲染）' },
  { re: /["'](?:⌂|✉|☺)["']/, why: '硬编码图标映射字面量（应来自项目声明的 glyph）' },
  { re: /["']•["']/, why: '图标"•"兜底（未声明 glyph 就不画——静默画点是旧漂移形态）' },
  { re: /["']首页["']\s*[,:?]/, why: '硬编码标签映射（文案应在生成期合并）' },
]

/** 剥注释（保行结构；.java/.swift/.ets/.ts 通用）。 */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

// ① runtime 必须有实现
for (const t of RUNTIME_TARGETS) {
  const p = path.join(ROOT, t.rel)
  if (!fs.existsSync(p)) { problems.push(`✗ runtime 缺 TabChrome 实现文件：${t.rel}（能力未落地——不许只写在壳里）`); continue }
  const src = fs.readFileSync(p, 'utf-8')
  if (!t.re.test(src)) problems.push(`✗ ${t.rel}: 未匹配实现锚点 ${t.re}（文件名在但实现不在）`)
}

// ② 六壳：不得重实现 + 必须装配
for (const rel of SHELL_TARGETS) {
  const p = path.join(ROOT, rel)
  if (!fs.existsSync(p)) { problems.push(`✗ 缺壳文件：${rel}`); continue }
  const code = stripComments(fs.readFileSync(p, 'utf-8'))
  if (!code.includes('ProteusTabChrome')) {
    problems.push(`✗ ${rel}: 未装配 runtime TabChrome（tab 栏能力必须由壳装配——换壳不漏接）`)
  }
  for (const m of SHELL_IMPL_MARKERS) {
    if (m.re.test(code)) problems.push(`✗ ${rel}: 壳内重实现 tab 栏（命中 ${m.re}）：${m.why}`)
  }
}

// ③ 共享规格不得再含"项目内容"缺省（icons/labels 曾硬编码 index/messages/mine ⇒ dactyl l2..l6 全"•"）
{
  const specPath = path.join(ROOT, 'packages/render-backend/src/tab-bar-spec.ts')
  const codeSpec = stripComments(fs.readFileSync(specPath, 'utf-8'))
  if (/icons:\s*\{/.test(codeSpec) || /labels:\s*\{/.test(codeSpec)) {
    problems.push('✗ packages/render-backend/src/tab-bar-spec.ts: TAB_BAR_SPEC 仍含 icons/labels 内容缺省——项目内容（文案/字形）应来自 router.tabBar 声明（生成期合并），规格只含视觉面')
  }
}

if (problems.length) {
  console.error(`✗ tab 栏能力归属门禁未过（${problems.length}）：`)
  for (const p2 of problems) console.error(`  - ${p2}`)
  process.exit(1)
}
console.log('✅ tab 栏能力归属（runtime 一实现 × 六壳零重实现 · 内容来自生成期合并）')
