#!/usr/bin/env node
// scripts/check-gates-sync.mjs —— ★门禁通道一致性（2026-09-18）
//
// 背景（本会话实测挖出的结构缺口）：CI（.github/workflows/*.yml）与本地 `pnpm verify`
//   是**两套重叠但不一致**的门禁集，各自都不完整，且缺的正好是对方的强项：
//     · CI 有根 `vue-tsc` / `build-packages`，而 `pnpm verify` **没有** →
//       本地「全绿」掩盖了 tsc 构建才暴露的类型错误（实测：TS2322 漏到 CI）。
//     · `pnpm verify` 有 `check:mp-attrs`（主属性棘轮）/ `check:pkg` / `check:showcase-catalog`，
//       而 CI **没有** → 属性覆盖回退可以推上去而 CI 不拦。
//   根因是**门禁的可靠性取决于它被接在哪**，而「接线」此前靠人工记忆、无机器校验。
//
// 本脚本把「接线」变成可机器判定的门禁：
//   ① 每个 `check:*` 脚本必须被**某个 workflow** 引用（含 pages.yml 等非 ci.yml 工作流），
//      或列入下方 LOCAL_ONLY 并给理由——新增门禁时若不接线、不说明，CI 当场红。
//   ② CI 与 verify 的**覆盖差集**必须为空（互为补集即为缺口）：凡 CI 有的形态门禁，
//      verify 亦应覆盖；反之亦然（依赖 dist 的步骤用 build-packages/vue-tsc 归并判定）。
//
// 用法：node scripts/check-gates-sync.mjs
// 退出码：0 通过 / 1 存在缺口
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WF_DIR = path.join(ROOT, '.github', 'workflows')

/**
 * 合理「仅本地」的门禁（不在 CI 跑），每条必须给理由。
 * ★判定标准：CI 无法满足其前置条件（需已部署环境 / 需人工介入 / 需真机）。
 */
const LOCAL_ONLY = {
  // ★需 macOS + Xcode 工具链（swiftc / JavaScriptCore）——CI 跑在 ubuntu-latest，无法执行。
  //   覆盖：iOS 竖切 M1 链路（Vue → Dispatcher → native 后端 → JSC 桥 → 宿主树）。
  'check:ios-host': '需 macOS + Xcode（swiftc/JavaScriptCore）；CI 为 ubuntu-latest',
  'check:ios-perf': '同上（性能基线需真实 JavaScriptCore；真机数字另需模拟器/设备）',
  'check:ios-exp-docs': '文档↔实验数字一致性；依赖 hosts/ios/experiments/results/（本机跑出的产物，不入库）',
  'check:ios-exp-compile': '实验代码（模拟器/真机两变体）可编译性；需 Xcode 工具链（CI 为 ubuntu-latest）',
  // ★iOS 自绘宿主的类型检查（零设备、零签名）——需 macOS + Xcode（iphoneos SDK）。
  //   背景：`run-selfdraw.sh` 是唯一编译 selfdraw-scene.swift 的地方且需真机+签名
  //   ⇒ 改宿主代码本地无任何检查（实测触发：加自定义字体注册通道时）。
  'check:ios-selfdraw-compile': '需 macOS + Xcode（iphoneos SDK 做 swiftc -typecheck）；CI 为 ubuntu-latest',
  // ★★「提交 ≠ 交付」门禁（2026-09-28 新增，背景：一天 111 个提交漏推送 —— 用户指出）。
  //   CI 里跑它**没有意义**：CI 的 checkout 是 detached HEAD（或 `refs/pull/*`），
  //   "本地领先 upstream N 个提交"这个状态在 CI 中天然为 0 ⇒ **恒绿，属假门禁**。
  //   它的作用域是**开发机收尾**：`pnpm verify` 结束时提醒；收尾用 `check:pushed:strict` 强制。
  //   ⇒ 归入 LOCAL_ONLY 而非接 CI（接了反而给人"CI 在管这件事"的错觉）。
  'check:pushed': '面向开发机收尾；CI 的 detached HEAD 下恒为 0 ⇒ 接 CI 是假门禁',
  'check:pushed:strict': '同上（strict 只是把提醒改为 exit 1，供收尾显式调用）',
  // ★★「含官网改动 ≠ 官网已上线」门禁（2026-09-29 新增，背景：9 个 website 提交无 [deploy] 标记，
  //   线上停在 2026-09-27 —— 用户指出）。CI 里跑它**没有意义**：CI 的 checkout 正是"被部署的那棵树"，
  //   "[deploy] 之后有无 website 改动"在 CI 视角天然自洽（且 dev 分支形态下结论失真）⇒ 假门禁。
  //   它的作用域是**开发机收尾**：`pnpm verify` 末尾提醒；发布收尾用 strict 强制。
  'check:deploy-pending': '面向开发机收尾（本地 git 历史中 [deploy] 之后 website/** 是否仍有改动）；CI 视角天然自洽 ⇒ 假门禁',
  'check:deploy-pending:strict': '同上（strict 只是把提醒改为 exit 1，供发布收尾显式调用）',
  // ★卡 I2「平台层零舍入」静态门禁（2026-09-29 新增）。扫描面是 **hosts/**（Android/iOS 宿主源码）——
  //   那部分不参与 CI 的 TS 构建（真机宿主需 NDK/Xcode），CI 上跑它只会扫到空集 ⇒ 假门禁。
  //   它的作用域是**开发机**：改宿主代码后立刻拦下"平台侧再舍入一次"。
  'check:host-rounding': '扫描 hosts/（Android/iOS 宿主源码）——CI 不构建宿主，扫不到任何文件 ⇒ 假门禁',
  // ★C3 编译期基线：绝对毫秒跨机不可比（本仓既有认识：异构 CI 同机可达 1.6×），
  //   判据虽以比值为主（体积膨胀比），但全量/增量仍带宽松绝对上界 ⇒
  //   在 CI 共享 runner 上会因机器差异产生噪声红。⇒ 归**开发机**：改编译器后本地跑。
  'check:compile-baseline': '绝对耗时跨机不可比（阈值含 3× 宽松上界）；CI 共享 runner 波动会产生噪声红 ⇒ 开发机跑',
  // ★V2 绑定矩阵：生成物依赖 **showcase 全量编译**（128 文件，约 3 秒）+ 依赖 compiler dist。
  //   CI 上需先 build-packages（本仓已有该步），但生成物本身入库 ⇒ CI 只需 --check（比对），
  //   实测 --check 也需重跑编译（约 3 秒）⇒ 可以接 CI。★但为与 compile-baseline 一致（同一族基线类门禁），
  //   暂归开发机：避免"改编译器后 CI 与本地各红一次"的低效流程。
  'check:binding-matrix': '与 check:compile-baseline 同族（生成物基线类）；改编译器后本地跑一次即可，避免 CI/本地各红一次',
  // ★C4 漏点报告：与上两者同族（生成物基线类，依赖 showcase 全量编译 ~40s）。
  //   ★且它是**棘轮**（degraded/unsupported 只降不升）——新写法引入 degraded 时本地立刻可见，
  //   不必等 CI；改编译器诊断文案后需 --update（人工确认）。
  'check:gap-report': '与 check:binding-matrix 同族（生成物基线棘轮）；依赖 showcase 全量编译，开发机跑',
  // ★S1/S2（Android JS 引擎）：需 `.tools/quickjs`（下载获取）+ NDK 交叉编译产物。
  //   CI（ubuntu）没有这两者；且该引擎是 **Android 宿主专用**，CI 上跑无意义。
  'check:js-engine-build': '需 .tools/quickjs（下载获取）+ NDK 交叉编译产物；CI 为 ubuntu-latest ⇒ 跑不了',
  'check:js-engine': '需 .tools/quickjs/qjs（本机引擎）；CI 无该环境 ⇒ 归开发机（真机前先过它，再上 S3）',
  // ★指令流夹具漂移门禁：生成器需跑真实 TS 编码器 + 适配器（依赖 build-packages dist）。
  //   ★且它在 `build-and-run.sh` 里**每次构建都会重生成** ⇒ 真机测试抓不到漂移（只有"克隆后不构建"才踩到）。
  //   归开发机：改协议/编码器后本地跑一次即可（CI 上跑需完整 dist 链，成本高于收益）。
  'check:ops-fixture': '生成器依赖 TS 编码器 + 适配器（需 build-packages dist）；且漂移只在"克隆后不构建"时踩到 ⇒ 开发机跑',
  // ★16 KB 对齐门禁（2026-09-29，用户真机反馈触发）：需 NDK（llvm-readelf）+ Android 构建产物。
  //   CI（ubuntu）无 NDK 与 hosts/android 产物 ⇒ 跑不了；开发机在"改宿主/链接参数后"跑。
  'check:16kb-align': '需 NDK（llvm-readelf 读 ELF 段对齐）+ hosts/android 构建产物；CI 无该环境',
  // ★shell 变量边界门禁（$VAR<全角> 会被 bash 当变量名一部分）：纯静态扫描、**不依赖构建**。
  //   ★本可接 CI，但它扫的是 hosts/**/*.sh（CI 不怎么跑那些）——归开发机与 16kb 一并跑即可。
  'check:shell-i18n-vars': '扫 hosts/**/*.sh 的静态门禁；与 check:16kb-align 同批在开发机跑（改脚本后）',
  // ★S3b bundle 构建门禁：需 build-packages dist（render-backend）+ 产物断言。
  //   与 check:js-engine 同族（Android JS 链路的零设备判据）。
  'check:android-bundle': '构建 Android 侧 IIFE bundle（需 render-backend dist）；与 check:js-engine 同族，开发机跑',
  // ★Android 宿主编译检查（2026-09-29，与 check:ios-selfdraw-compile 同源盲区）：
  //   编译宿主需 Android SDK（android.jar）+ JDK；CI 为 ubuntu-latest，不装 Android SDK ⇒ 跑不了。
  'check:android-host-compile': '需 Android SDK（android.jar）+ JDK 17；CI 为 ubuntu-latest，未装 Android SDK',
  // ★平台动画判据（容器级 + 逐节点）：**输入是真机产物**（platform-anim*.json，由 adb pull 取回）
  //   且 App 是**广播触发**（需真机 + adb）⇒ CI 无法执行。它的配套是"零设备也能守"的
  //   `check:android-host-compile`（宿主代码可编译）+ `check:acceptance-stub`（装置可用），
  //   三者分工：编译守形态 / 桩测守装置 / 本条守真机行为。
  'check:android-platform-anim': '需真机产物（adb pull 的 platform-anim*.json）；CI 无设备',
  // ★hook 接线检查（2026-09-29）：CI 上 `.zcode/config.json` 不存在（gitignored）⇒ 该门禁
  //   走"未安装但给出指引"分支并**返回 0**（不判红是刻意的：CI 本来就不需要本地 hook）。
  //   ⇒ 归入"仅本地"是因为**它的判据只在本地才有意义**（CI 恒为"未安装"）。
  'check:hook-wiring': '检查本地 .zcode/config.json 的三条红线 hook 接线；CI 无该文件（走"给出安装指引"分支，恒通过）',
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const scripts = pkg.scripts ?? {}

/** 读取所有 workflow 文本（含 pages.yml / consistency.yml 等） */
function workflowText() {
  if (!fs.existsSync(WF_DIR)) return ''
  return fs
    .readdirSync(WF_DIR)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => fs.readFileSync(path.join(WF_DIR, f), 'utf8'))
    .join('\n')
}
const CI_TEXT = workflowText()

/** 从一条 npm script 命令里提取它调用的脚本文件 + 内联 check: 引用 */
function refsOf(cmd) {
  // ★2026-09-29 扩面：原正则只认 `scripts/` 与 `website/scripts/` 前缀 ⇒
  //   `hosts/**/*.mjs` 这类脚本**结构性无法被识别为"已接线"**（实测：新增
  //   `check:acceptance-stub`（`node hosts/android/acceptance-stub.mjs`）明明写进了 ci.yml，
  //   本门禁仍报"未接线"）。⇒ 改为匹配**任意相对路径**下的 .mjs/.ts/.js 脚本。
  const files = cmd.match(/(?:^|\s)(?:npx\s+tsx\s+)?(?:[\w.-]+\/)+[\w.-]+\.(?:mjs|ts|js)/g) ?? []
  const sub = cmd.match(/pnpm run (check:[\w-]+)/g)?.map((m) => m.replace('pnpm run ', '')) ?? []
  return { files: files.map((f) => f.trim()), sub }
}

/** 某 check:* 或脚本文件是否真被 CI 引用 */
function coveredByCi(name, cmd) {
  if (CI_TEXT.includes(name)) return true
  const { files, sub } = refsOf(cmd)
  if (files.some((f) => CI_TEXT.includes(f))) return true
  // 经 pnpm run 间接引用：递归查子脚本
  return sub.some((s) => scripts[s] && coveredByCi(s, scripts[s]))
}

const failures = []
const notes = []

/* ---------- ① 每个 check:* 必须接线（CI 或 LOCAL_ONLY 声明） ---------- */
const checkNames = Object.keys(scripts).filter((k) => k.startsWith('check:'))
for (const name of checkNames) {
  if (coveredByCi(name, scripts[name])) continue
  if (name in LOCAL_ONLY) {
    notes.push(`仅本地（已声明）：${name} —— ${LOCAL_ONLY[name]}`)
    continue
  }
  failures.push(
    `${name} 未接入任何 workflow，也未在 LOCAL_ONLY 声明理由（新增门禁必须接线，或写明为何 CI 跑不了）`,
  )
}

/* ---------- ② verify 链与 CI 的覆盖差集 ---------- */
// verify 里的形态门禁（脚本文件维度）：CI 缺则报；反方向由 ① 覆盖（CI 有的未必在 verify）
const verifyCmd = scripts.verify ?? ''
const verifyRefs = new Set(refsOf(verifyCmd).files)
// 依赖 dist 的步骤：verify 必须含 build-packages + 根 vue-tsc（CI 的强项，本地盲区）
const VERIFY_MUST_HAVE = [
  { file: 'scripts/build-packages.mjs', why: '提供 dist（vue-tsc / 子路径解析需要）' },
]
for (const { file, why } of VERIFY_MUST_HAVE) {
  if (!verifyRefs.has(file) && !verifyCmd.includes(file)) {
    failures.push(`verify 链缺 ${file}（${why}）——CI 有而本地没有 = 本地「全绿」存在盲区`)
  }
}
if (!/vue-tsc/.test(verifyCmd)) {
  failures.push('verify 链缺根 `vue-tsc --noEmit`（CI 有而本地没有 = 类型错误本地不可见）')
}

/* ---------- ③ CI 侧关键步骤存在性（防被误删） ---------- */
const CI_MUST_HAVE = [
  { pat: 'vue-tsc', why: '根类型检查' },
  { pat: 'build-packages', why: '包构建' },
  { pat: 'audit-component-attrs.mjs', why: '属性棘轮（主标尺）' },
  { pat: 'audit-degradation.mjs', why: '降级声明门禁' },
  { pat: 'check-consistency.js', why: '跨层一致性' },
]
for (const { pat, why } of CI_MUST_HAVE) {
  if (!CI_TEXT.includes(pat)) failures.push(`CI 缺关键步骤 ${pat}（${why}）——被误删或未接线`)
}

/* ---------- 报告 ---------- */
console.log('门禁通道一致性检查（CI ⟷ verify）')
console.log(`  package.json 的 check:* 共 ${checkNames.length} 个`)
for (const n of notes) console.log(`  ℹ ${n}`)
if (failures.length) {
  console.error(`\n❌ 发现 ${failures.length} 处接线缺口：`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`  ✅ 全部 check:* 已接线（CI 覆盖 ${checkNames.length - Object.keys(LOCAL_ONLY).length} 个` +
  `${Object.keys(LOCAL_ONLY).length ? ` + 声明仅本地 ${Object.keys(LOCAL_ONLY).length} 个` : ''}）`)
console.log('  ✅ verify 链含 build-packages + 根 vue-tsc（本地与 CI 无覆盖盲区）')
console.log('  ✅ CI 关键步骤齐备')
console.log('\n✅ 门禁通道一致（接线不再依靠人工记忆）')
