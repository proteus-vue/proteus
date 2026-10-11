#!/usr/bin/env node
// scripts/check-host-layering.mjs —— ★★★hosts/ 关注点分层门禁（2026-10-07 · 规约见 hosts/README-LAYERS.md）
//
// 【为什么需要（用户点名「宿主里开发者项目信息和项目无关的抽象实现混在一起」）】
//   `hosts/` 此前把三件不同寿命的东西混在同一目录树：**项目无关的引擎/运行时实现**、
//   绑定某应用身份的**项目壳**、以及**验证装置**。混装对"CLI 生成宿主 / 正式打包 / 安全维护"都是负担。
//   2026-10-07 第一刀把它们按 `runtime / shell / dev` 三层物理分开，本门禁把**分层本身**钉住——
//   否则下一个人图省事在 `runtime/` 里 import 项目路由，分层就塌了，而**编译照过**（与"三条红线工具层管"同源）。
//
// 【判据（违反即红）】
//   ① 三端三层目录齐备（缺层 = 该端还没分层）；
//   ② `runtime/**` 不得反向依赖 shell/dev —— 源码里不得出现：
//      · 项目/装置专名（superapp / showcase / lights / flip / ink / bench / demo 装置类名 …）；
//      · 具体项目的路由/屏内容产物（examples/router、app-screen-content、auto-routes）；
//      · 应用身份串（这里是"引擎不认应用身份"的落点）。
//   ③ `hosts/**` 下不得**被 git 跟踪**构建期产物（bundle / 夹具 / 生成代码）——按豁免白名单
//      （白名单是"刻意入库且有 `--check` 门禁防漂移"的，理由见 README-LAYERS §2 与各生成器头注）。
// 用法：node scripts/check-host-layering.mjs
// 退出码：0 通过 / 1 违反
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/* ── 各端三层落点（与 README-LAYERS.md §1 逐字一致）── */
const ENDS = {
  android: {
    label: 'Android (Java)',
    layers: {
      runtime: 'hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime',
      shell: 'hosts/android/app/src/main/java/dev/proteus/layoutcore/shell',
      dev: 'hosts/android/app/src/main/java/dev/proteus/layoutcore/dev',
    },
    ext: ['.java'],
  },
  ios: {
    label: 'iOS (Swift)',
    layers: {
      runtime: 'hosts/ios/ProteusHost/runtime',
      shell: 'hosts/ios/ProteusHost/shell',
      dev: 'hosts/ios/ProteusHost/dev',
    },
    ext: ['.swift'],
  },
  harmony: {
    label: '鸿蒙 (ArkTS/C++)',
    layers: {
      // ★★第二刀（2026-10-07）：runtime 已抽为**独立 HAR 模块**（proteus_render/）——
      //   含 render（直绘）+ host 桥（appScreen/壳生命周期）+ Rust 核；不再挂在 entry 内。
      runtime: 'hosts/harmony/host-app/proteus_render/src/main/cpp',
      shell: 'hosts/harmony/host-app/entry/src/main/ets/shell',
      dev: 'hosts/harmony/host-app/entry/src/main/ets/dev',
    },
    ext: ['.ets', '.ts', '.cpp', '.h'],
    extra: {
      // ★决策 #796：runtime 的 ArkTS 层（Index.ets / AppRuntimeDriver.ets）在 **HAR 根**——
      //   只扫 src/main/cpp 会漏掉"能力是否真归 runtime"（本轮实测：门禁正确报缺，是范围没到）。
      runtime: ['hosts/harmony/host-app/proteus_render/src/main/cpp', 'hosts/harmony/host-app/proteus_render'],
      shell: ['hosts/harmony/host-app/entry/src/main/ets/shell'],
      dev: ['hosts/harmony/host-app/entry/src/main/ets/dev', 'hosts/harmony/host-app/entry/src/main/cpp/dev'],
    },
  },
}

/* ── shell 里禁止反向依赖 dev（2026-10-07 第二刀新增）──
 *   ★触发：鸿蒙壳（EntryAbility/Superapp）曾 import dev 的 `libproteus_bench.so`（hostRtShellEvent/
 *     appScreenCommands/superappDrive）——runtime 形状的部分已迁 HAR；剩余 `superappDrive`（应用驱动，
 *     与 dev 的 screen.* 执行器簇深度耦合）**具名登记**，棘轮守（不得新增）。 */
const SHELL_FORBIDDEN_DEV = [
  { re: /libproteus_bench\.so|proteus_bench/, why: 'dev 装置模块（proteus_bench）——shell 不应依赖 dev' },
  { re: /\bsuperappDrive\b|\bsuperappBoot\b/, why: 'dev 应用驱动（superappBoot/Drive）——待拆分' },
  { re: /\b(bench4050|hitProbe|recycleProbe|spliceProbe|textProbe|vaporProbe|sfcStressProbe|jsvmProbe|memProbe)\b/, why: 'dev 探针符号' },
  // ★第三刀：iOS 参考宿主壳分发到 dev 装置场景（最小宿主不含这些分支，只走 superapp/渲染路径）
  { re: /\b(ShowcaseScene|AppStackScene|HostRuntimeScene)\b/, why: 'dev 装置场景（iOS：showcase/app-stack/host-runtime）——参考宿主壳专用，最小壳不应依赖' },
]
// 壳→dev 的**具名登记**（命中数棘轮；待第二刀后端拆分清零）
const SHELL_MIXED_FILES = {
  // ★第四刀（2026-10-09）：鸿蒙壳的 superappDrive/superappScreen 已下沉到 runtime HAR
  //   （proteus_host 导出 hostAppBoot/Drive/Render，实现见 host_app_runtime_impl.h）——壳改依赖
  //   `proteus_render` 的 hostAppDrive/hostAppRender ⇒ 鸿蒙壳**不再反向依赖 dev**（本条登记已清零移除）。
  // ★第三刀：iOS **参考宿主**壳把场景分发到 dev 装置（Showcase/AppStack/HostRuntime）。这是"参考宿主含装置"
  //   的固有形态；**最小宿主**（CLI 生成）不含这些分支。命中数棘轮守（不得新增 dev 依赖）。
  'hosts/ios/ProteusHost/shell/selfdraw-app.swift': {
    reason: 'iOS 参考宿主壳分发到 dev 装置场景（showcase/app-stack/host-runtime）；最小壳模板不含',
    maxHits: 5,   // 2026-10-07 实测：HostRuntimeScene.run/handleTraitChange/handleTransition + AppStackScene.run + ShowcaseScene.run
  },
}

/* ── runtime 里禁止出现的项目/装置专名（正则；命中即"反向依赖"）── */
// ★★防误报（2026-10-07 实测）：内核 API 名含同形子串（`proteus_layout_flip` 命中 `flip`）——
//   故演示装置名用**词边界 + 专名形态**（`lights`/`flip` 只在非 `proteus_layout_` 前缀处才算），
//   且超短词（flip/ink）要求大写起始（类名/类型名，如 `FlipDemoActivity`）避免撞普通词。
const RUNTIME_FORBIDDEN = [
  { re: /\bsuperapp\b/i, why: '具体应用名（superapp）——runtime 不认应用身份' },
  { re: /app-screen-content/i, why: '项目屏内容产物（app-screen-content）——属 shell/dev' },
  { re: /auto-routes|\bexamples\/router\b/, why: '具体项目路由表（examples/router·auto-routes）' },
  { re: /\bshowcase\b/i, why: '演示装置名（showcase）——属 dev' },
  { re: /\blights\b/i, why: '节目装置名（lights）——属 dev' },
  { re: /\bmorpheus\b/i, why: '演示装置名（morpheus）——属 dev' },
  { re: /(?:^|[^A-Za-z_])(?:Lights|Flip|Ink|InkScroll)DemoActivity\b/, why: 'dev 装置类名（Android Demo Activity）' },
  { re: /\b(MainActivity|L4Activity|StressSfcActivity|LightsHost|MirrorHit|OpsFixture)\b/, why: 'dev 装置类名（Android）' },
  { re: /\b(calayer-scene|l4-scene|layout-core-bench|app-stack-scene|host-runtime-scene|showcase-scene)\b/, why: 'dev 装置场景名（iOS）' },
  // ★第三刀补强（2026-10-07）：上面的 lowercase 模式只命中**字符串字面量**里的场景名——
  //   而 runtime 反向依赖的真实形态是**引用 scene 类型**（如 `ShowcaseScene.run(...)`，无裸词）。
  //   实测：`let x = ShowcaseScene.self` 不被上面任何模式命中 ⇒ 补一条**类型名**模式。
  { re: /\b(ShowcaseScene|SuperappScene|HostRuntimeScene|AppStackScene|CalayerScene|LayoutCoreBench)\b/, why: 'shell/dev 场景类型（iOS）——runtime 不得引用' },
]
// 允许在注释里出现（提及/说明不算依赖）——只扫**代码行**（剥注释后）
const stripComments = (src, ext) => {
  if (ext === '.java' || ext === '.swift' || ext === '.cpp' || ext === '.h' || ext === '.ets' || ext === '.ts') {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  }
  return src
}

/* ── 产物豁免白名单（刻意入库；入库理由见 README-LAYERS §2）── */
const TRACKED_ARTIFACT_ALLOW = new Set([
  'hosts/android/app/src/main/java/dev/proteus/layoutcore/dev/OpsFixture.java',   // 克隆免生成即编译（--check 门禁防漂移）
  'hosts/android/bridge/vapor-ab-render.generated.ts',                           // entry-vapor 类型检查输入（tsc 先于生成器）
  'hosts/android/app/src/main/assets/browser-layout.json',                       // canonical 同步副本（check:cross-end-golden 非构建期读）
])
// 产物形态（被跟踪即"疑似产物"）：bundle-*.js / 生成物 *.generated.ts / assets|rawfile|fixtures 下的 .js|.json
const isArtifact = (rel) => {
  const b = path.basename(rel)
  if (/^bundle-.*\.js$/.test(b)) return true
  if (/\.generated\.(ts|js)$/.test(b)) return true
  if (/(^|\/)(assets|rawfile|fixtures)\//.test(rel) && /\.(js|json)$/.test(b)) return true
  return false
}

const problems = []

/* ── ★混装登记（诚实边界）：已知"壳+引擎混装"的文件——本轮整文件归位、不拆段（见 README-LAYERS §4）。 ──
 *   对这些文件，禁止名检查降级为 **命中数棘轮**（不得超过登记值；新增即红 ⇒ 逼着拆分或显式更新登记）。
 *   第二刀（runtime 抽包 / 壳最小化）时应把它们拆干净并从本表移除。 */
const RUNTIME_MIXED_FILES = {
  // ★第三刀（2026-10-07）：原 selfdraw-scene.swift 混装已拆（应用入口/场景分发 → shell/selfdraw-app.swift），
  //   runtime/ 现**零反向依赖** —— 本表暂无登记（保持空表；新增混装须登记理由 + 命中数棘轮）。
}
const root = (rel) => path.join(ROOT, rel)
const filesUnder = (rel, exts) => {
  const d = root(rel)
  if (!fs.existsSync(d)) return []
  // ★跳过构建/依赖目录（决策 #796：harmony 的 runtime 根含 oh_modules/build——扫进去会误报且慢）
  const SKIP_DIRS = new Set(['build', 'oh_modules', 'node_modules', '.hvigor', '.cxx', '.idea', '.preview', 'thirdparty'])
  const out = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory() && SKIP_DIRS.has(e.name)) continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (exts.some((x) => e.name.endsWith(x))) out.push(p)
    }
  }
  walk(d)
  return out
}

/* ── ① 三层齐备 ── */
for (const [end, cfg] of Object.entries(ENDS)) {
  for (const [layer, rel] of Object.entries(cfg.layers)) {
    if (!fs.existsSync(root(rel))) problems.push(`① ${cfg.label}: 缺 ${layer} 层目录（${rel}）——该端尚未分层`)
  }
}

/* ── ② runtime 不得反向依赖 shell/dev ── */
for (const [end, cfg] of Object.entries(ENDS)) {
  const rtDirs = [cfg.layers.runtime, ...(cfg.extra?.runtime ?? [])]
  for (const d of rtDirs) {
    for (const f of filesUnder(d, cfg.ext)) {
      const rel = path.relative(ROOT, f)
      const src = stripComments(fs.readFileSync(f, 'utf-8'), path.extname(f))
      const hits = RUNTIME_FORBIDDEN.filter(({ re }) => re.test(src))
      if (hits.length === 0) continue
      const mixed = RUNTIME_MIXED_FILES[rel]
      if (mixed) {
        // 命中数棘轮：统计全部相关模式的出现次数，不得超过登记值
        const total = RUNTIME_FORBIDDEN.reduce((n, { re }) => n + ((src.match(new RegExp(re.source, 'gi')) || []).length), 0)
        if (total > mixed.maxHits) {
          problems.push(`② ${rel}: 混装登记已超限（${total} > ${mixed.maxHits}）——新增了 runtime→shell/dev 依赖，请拆分而非加登记`)
        }
        continue
      }
      for (const { why } of hits) {
        problems.push(`② ${rel}: runtime 出现禁止项「${why}」——应移到 shell/ 或 dev/`)
      }
    }
  }
}

/* ── ②b shell 不得反向依赖 dev（第二刀新增）── */
for (const [end, cfg] of Object.entries(ENDS)) {
  const shDirs = [...new Set([cfg.layers.shell, ...(cfg.extra?.shell ?? [])])]
  for (const d of shDirs) {
    for (const f of filesUnder(d, cfg.ext)) {
      const rel = path.relative(ROOT, f)
      const src = stripComments(fs.readFileSync(f, 'utf-8'), path.extname(f))
      const hits = SHELL_FORBIDDEN_DEV.filter(({ re }) => re.test(src))
      if (hits.length === 0) continue
      const mixed = SHELL_MIXED_FILES[rel]
      if (mixed) {
        const total = SHELL_FORBIDDEN_DEV.reduce((n, { re }) => n + ((src.match(new RegExp(re.source, 'gi')) || []).length), 0)
        if (total > mixed.maxHits) {
          problems.push(`②b ${rel}: 壳→dev 混装登记已超限（${total} > ${mixed.maxHits}）——新增了 shell→dev 依赖，请拆分而非加登记`)
        }
        continue
      }
      for (const { why } of hits) {
        problems.push(`②b ${rel}: shell 出现禁依赖「${why}」——应移到 runtime(HAR) 或壳内自持`)
      }
    }
  }
}

/* ── ④ **能力归属**（2026-10-11 · 决策 #796 · 用户点名）──
 * 【为什么有它】用户：「宿主能力应该是做一次所有宿主都收益啊，比如安卓宿主对以后所有安卓的宿主都生效」。
 *   反模式实证（本轮）：泵/动画驱动写在**壳**里 ⇒ ① Android 只写在 CLI 模板壳、框架参考壳从未接
 *   （**框架壳上泵从不跑**）；② 鸿蒙被抄进两个壳（参考 + 模板）——同一能力多处实现，换壳必漏。
 *   规则：**平台无关的宿主动力（能力）归 runtime**；壳只提供"最小上下文 + 回执出口"。
 * 【判据（双向）】
 *   ① runtime **必须**给出该能力的实现锚点（正则命中）——否则"能力根本没落地"；
 *   ② **壳不得再出现**该能力的实现特征（驱动循环/状态字段）——否则就是"壳内重实现"（漏接源头）。
 *   ★已知合法例外走 KNOWN_GAPS 具名登记（附理由），不静默豁免。 */
/** ★★各端**壳文件全集**（能力归属检查用）——两张来源都算"壳"：
 *   ① 框架参考宿主（`hosts/<端>/`，见 ENDS.layers.shell / extra.shell）；
 *   ② **CLI 模板壳**（`packages/cli/templates-host/<端>/`）——★它才是"以后所有<端>宿主"的来源：
 *      只扫 hosts/ 会漏掉模板壳里偷偷重实现的能力（本轮实测：门禁漏判模板壳的注入破坏）。
 *   ★文件名锚点（清单形式）：新增壳文件时加到这里（漏加 ⇒ 该文件不被能力归属检查覆盖）。 */
const TEMPLATE_SHELL_FILES = {
  android: ['packages/cli/templates-host/android/src/dev/proteus/layoutcore/AppActivity.java'],
  ios: ['packages/cli/templates-host/ios/shell/ProteusApp.swift'],
  harmony: ['packages/cli/templates-host/harmony/entry/src/main/ets/shell/MainPage.ets'],
}

/** ★壳内重实现的**具名登记**（键 `${end}:${cap.id}:shell`；补齐后删登记）。 */
const SHELL_OWNERSHIP_GAPS = {
  // （当前无：三端驱动均已归 runtime——Android SuperappRuntimeHost / iOS superapp-runtime-host.swift / 鸿蒙 AppRuntimeDriver）
}

const OWNERSHIP = [
  {
    id: 'v-pump',
    name: 'v-pump 周期驱动',
    // runtime 必须实现（每端给出实现锚点正则）
    runtimeMust: {
      android: /pullPumpsDeferred|startPumpLoop/,                       // SuperappRuntimeHost
      ios: /func pullPumps|startPumpLoop/,                              // superapp-runtime-host.swift
      harmony: /class AppRuntimeDriver[\s\S]*startPumpLoop/,          // AppRuntimeDriver.ets（HAR）
    },
    // 壳**不得**再出现（实现特征；注释剥离后判）
    shellForbidden: {
      android: /pullPumps\(\s*\)/,
      ios: /pumpLink\s*=|startPumpLoop\(/,
      harmony: /hostAppPumpTick\s*\(|attachAnimations\s*\(/,
    },
  },
]
for (const cap of OWNERSHIP) {
  for (const [end, cfg] of Object.entries(ENDS)) {
    // ① runtime 必须实现
    const rtDirs = [cfg.layers.runtime, ...(cfg.extra?.runtime ?? [])]
    let found = false
    for (const d of rtDirs) {
      for (const f of filesUnder(d, cfg.ext)) {
        const src = stripComments(fs.readFileSync(f, 'utf-8'), path.extname(f))
        if (cap.runtimeMust[end].test(src)) { found = true; break }
      }
      if (found) break
    }
    // iOS 的 runtime 单元还含 platform 目录（host-capabilities 等）——若上面没命中，再扫 runtime 目录
    if (!found) problems.push(`④ ${cfg.label}: runtime 缺「${cap.name}」实现——能力未落地（不许只写在壳里）`)
    // ② 壳不得重实现（**两类壳都查**：框架参考宿主 + CLI 模板壳——后者是"未来所有宿主"的来源）
    const shDirs = [...new Set([cfg.layers.shell, ...(cfg.extra?.shell ?? [])])]
    const shellFiles = []
    for (const d of shDirs) for (const f of filesUnder(d, cfg.ext)) shellFiles.push(f)
    for (const rel of (TEMPLATE_SHELL_FILES[end] ?? [])) {
      const abs = root(rel)
      if (fs.existsSync(abs)) shellFiles.push(abs)
    }
    {
      for (const f of shellFiles) {
        const rel = path.relative(ROOT, f)
        const src = stripComments(fs.readFileSync(f, 'utf-8'), path.extname(f))
        if (!cap.shellForbidden[end].test(src)) continue
        const gapKey = `${end}:${cap.id}:shell`
        if (SHELL_OWNERSHIP_GAPS[gapKey]) { notes.push(`④ ${rel}: 壳内「${cap.name}」已具名登记：${SHELL_OWNERSHIP_GAPS[gapKey]}`); continue }
        problems.push(`④ ${rel}: 壳内重实现了「${cap.name}」——应归 runtime（能力做一次全壳受益；本仓实测漏接源头）`)
      }
    }
  }
}

/* ── ③ 无被跟踪的构建产物（按白名单）── */
let tracked = ''
try {
  tracked = execFileSync('git', ['ls-files', '--', 'hosts/'], { cwd: ROOT, encoding: 'utf-8' })
} catch { tracked = '' }
for (const rel of tracked.split('\n').filter(Boolean)) {
  if (!isArtifact(rel)) continue
  if (TRACKED_ARTIFACT_ALLOW.has(rel)) continue
  problems.push(`③ ${rel}: 构建期产物被 git 跟踪（应由构建脚本再生，不入库）——如确需入库，加进本脚本的白名单并说明理由`)
}

if (problems.length) {
  console.error(`✗ hosts 分层门禁：${problems.length} 处违反（规约见 hosts/README-LAYERS.md）`)
  for (const p of problems) console.error(`    - ${p}`)
  process.exit(1)
}
console.log('✅ hosts 分层合规（三端 runtime/shell/dev 齐备 · runtime 无反向依赖 · 无被跟踪产物）')
