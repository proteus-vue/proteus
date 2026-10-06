#!/usr/bin/env node
// scripts/test-coupling.mjs —— ★★★内核改动的「配套断言」定向跑（2026-10-04 立 · 用户点名的低效率模式）
//
// 【用户原话（本工具的由来）】「我发现一个问题就是**编译器内核运行时规则修改总是忘了同步配套的断言**，
//   这个也是低效率方式，带来的后果就是**花大量的时间跑全量来为这些低效率债务买单**」。
//
// 【本轮实证（这个债务到底多贵）】S56b 双类名发射改完（ed4da92c），配套断言忘了同步：
//   compiler-mp-probe 7 条 + compiler-dispatch 1 条 + golden 快照 2 处 + 规则数/官网数字 4 处 ——
//   这些在全量里**连爆两轮**（每轮 ≈2-3 分钟）才被逐个发现（HEAD 上即红的遗留债务）。
//
// 【为什么既有机制不够】deny-blind-verify 的 TARGETED 表是**命令级粗粒度**：
//   `packages/compiler/` 只建议 `npx vitest run tests/compiler`——而本轮债务的重灾区
//   （`tests/golden.test.ts` / `tests/mp-transform.test.ts` / `tests/svg-spike-compiler-gaps.test.ts`）
//   文件名**不含 "compiler"**，永远不会被建议到（建议表的结构性盲区）。
//
// 【本工具】内核文件 → 配套测试的**精化映射表**（COUPLING，SSOT 在本文件）+ 按 git diff 推导 + **真跑**：
//   · 命中精化表 → 只跑配套测试（通常 5~15 秒——趁手感还在就把债务挖出来）；
//   · 改动落在内核包但未命中精化表 → **不静默**：打印提示（可 `--wide` 跑包级 import 面兜底，防表腐化）；
//   · **表自检**：表中测试文件不存在 ⇒ 当场红（防"表写错/文件改名"后工具静默失效——本仓门禁自身的教训）。
//
// 【诚实边界（为什么不是纯自动依赖分析）】静态 import 分析到不了"测试是否会碰该代码路径"这一层
//   （75 个测试直接用编译产物、91 个 import compiler 包——全列就不是"定向"了）。⇒ 表**人工精化**，
//   防腐化靠三条：①表自检 ②未命中时的宽面提示（不静默） ③本节规定的"何时更新表"纪律。
//
// 【何时更新本表（纪律）】新增/改名 **内核源文件**（packages/compiler/src、packages/runtime/src、
//   packages/plugin-vite/src）或新增**产物形态断言类测试**时，把配对关系加进 COUPLING——
//   漏加不致命（会落进宽面提示），但会让"定向"退化成"提示"。
//
// 【用法】
//   pnpm test:coupled                      # 按当前改动（相对 origin/main 的工作区+未推提交）推导并跑
//   pnpm test:coupled -- --list            # 只列（不跑）——先看会跑什么
//   pnpm test:coupled -- --since ed4da92c  # 指定 diff 基（复盘/验收：如从某次内核改动以来）
//   pnpm test:coupled -- --wide            # 未命中精化表的包也跑包级 import 面（慢一些，兜底）
//   pnpm test:coupled -- --explain         # 打印映射表本身（看覆盖面）
//
// 【退出码】0 = 通过/无需跑；非 0 = 测试失败；2 = 表腐化（表中文件不存在）/用法错误
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const valOf = (f) => {
  const i = argv.indexOf(f)
  return i >= 0 ? argv[i + 1] : undefined
}

/**
 * ★精化映射表（SSOT）：内核文件 → 配套测试。
 * 每条目：match（内核路径正则）/ tests（配套测试文件，相对 repo root）/ why（为什么是配套——给读者与维护者）。
 * ★表不追求完备（见头注"诚实边界"）：命中越准越好；未命中的内核改动走宽面提示，不静默。
 */
const COUPLING = [
  // ★★★G-61 B1（2026-10-05）：**CSE 编译期 CSS 引擎**（L-A 唯一实现——收集/长手展开/索引/
  //   右→左匹配/五级层叠/继承/计算值/IR 映射）。全模块统一配对：
  //   · cse-core：内核单测（34 条——逐级层叠/长手竞争/继承/计算值/IR 映射/trace）
  //   · cse-parity-web：**判据①-b**（113 用例 / 153 项 vs 真 Chromium getComputedStyle）
  //   · cse-explain：explain --style 的 trace 端到端
  {
    match: /^packages\/compiler\/src\/cse\//,
    tests: ['tests/cse-core.test.ts', 'tests/e2e-cse-parity.test.ts', 'tests/cse-explain.test.ts', 'tests/cse-dynamic.test.ts', 'tests/e2e-cse-dynamic.test.ts', 'tests/cse-dynamic-integration.test.ts', 'tests/appliers-conformance.test.ts', 'tests/degrade-conformance.test.ts', 'tests/app-ir-switch.test.ts'],
    why: 'CSE 编译期 CSS 引擎（五级层叠/长手竞争/继承/计算值/IR 映射）——判据①-b 逐属性比对 + trace',
  },
  {
    match: /^packages\/compiler\/src\/template\.ts$/,
    tests: [
      'tests/mp-transform.test.ts',
      'tests/compiler-mp-probe.test.ts',
      'tests/golden.test.ts',
      'tests/compiler-dispatch.test.ts',
      'tests/mp-global-layer-inject.test.ts',
      'tests/mp-mount-layers-compile.test.ts',
    ],
    why: '模板 → wxml 产物（类名/作用域后缀/事件绑定/指令/插槽）——产物形态断言与快照的重灾区',
  },
  {
    match: /^packages\/compiler\/src\/script\.ts$/,
    tests: [
      'tests/mp-transform.test.ts',
      'tests/compiler-script-topcall.test.ts',
      'tests/svg-spike-compiler-gaps.test.ts',
      'tests/compiler-rewrite-guards.test.ts',
      'tests/lifecycle-callback.test.ts',
      'tests/plain-const-bare-ref.test.ts',
      'tests/app-config-mp.test.ts',
      'tests/mp-global-layer-inject.test.ts',
      'tests/compiler-ir-m4.test.ts',
      // ★GP7（2026-10-04）：App 壳 script 约束（useRoute 报错/大集合告警）+ 页面内存桥
      'tests/global-layer-memory-gp7.test.ts',
    ],
    why: '脚本 → js 产物（生命周期/ref 改写/watch/TS 类型剥除/顶层调用）——js 形态断言',
  },
  {
    match: /^packages\/compiler\/src\/style\.ts$/,
    tests: ['tests/mp-transform.test.ts', 'tests/compiler-mp-probe.test.ts', 'tests/golden.test.ts'],
    why: '样式 → wxss 产物（scoped 选择器/px 转换/语义基样式）',
  },
  {
    match: /^packages\/compiler\/src\/index\.ts$/,
    tests: ['tests/mp-transform.test.ts', 'tests/golden.test.ts'],
    why: '编译入口编排（compileVueSfc 管线：模板/脚本/样式的组装与校验）',
  },
  {
    match: /^packages\/compiler\/src\/transforms\//,
    tests: [
      'tests/registry-drift.test.ts',
      'tests/compiler-ir-m5.test.ts',
      'tests/compiler-dispatch.test.ts',
      'tests/transforms.test.ts',
    ],
    // 规则注册表是"同源工件"的源头：规则数进快照（ir-m5）、官网数字（stats.ts）、参考页（gen-reference）
    cmds: ['pnpm check:stats', 'cd website && npx tsx scripts/gen-reference.mjs'],
    why: '规则注册表 SSOT（增删规则 ⇒ 规则数快照 + 官网数字 + 参考页三处同源工件）',
  },
  {
    match: /^packages\/compiler\/src\/vue-compat\.ts$/,
    tests: [
      'tests/vue-compat-aligned.test.ts',
      'tests/vue-compat-compile.test.ts',
      'tests/vue-compat-matrix.test.ts',
      'tests/mp-transform.test.ts',
    ],
    why: 'Vue 能力基准线矩阵（对齐状态/降级策略——vue import 扫描与 fail-closed 行为）',
  },
  {
    match: /^packages\/compiler\/src\/validate/,
    tests: ['tests/compiler-validate-platform.test.ts', 'tests/compiler-validate-wxml-platform.test.ts'],
    why: '产物校验器（js/wxml 平台约束）',
  },
  {
    match: /^packages\/compiler\/src\/sfc-macros\.ts$/,
    tests: ['tests/sfc-macros.test.ts', 'tests/sfc-macros-conformance.test.ts', 'tests/vue-compat-define-options.test.ts'],
    why: 'SFC 宏提取（defineProps/defineEmits/defineOptions…）',
  },
  {
    match: /^packages\/compiler\/src\/es5\.ts$/,
    tests: ['tests/mp-transform.test.ts'],
    why: 'ES5 安全转译（?? / ?. / 解构 / 展开——产物形态）',
  },
  {
    match: /^packages\/compiler\/src\/(layer-safety|scroll-safety)\.ts$/,
    tests: ['tests/layer-safety.test.ts', 'tests/scroll-safety.test.ts', 'tests/mp-mount-layers-compile.test.ts'],
    why: '层级/滚动安全契约（编译期检查）',
  },
  {
    match: /^packages\/compiler\/src\/platform-(macros|variant)\.ts$/,
    tests: ['tests/platform-macros.test.ts', 'tests/platform-variant.test.ts'],
    why: '平台宏与变体解析（MP/Web 条件编译）',
  },
  {
    match: /^packages\/compiler\/src\/svg-lower\.ts$/,
    tests: ['tests/svg-to-image.test.ts', 'tests/svg-anim.test.ts', 'tests/svg-canvas.test.ts', 'tests/svg-hit.test.ts'],
    why: 'SVG 降级（自绘/位图路径）',
  },
  {
    match: /^packages\/compiler\/src\/gap-counter\.ts$/,
    tests: ['tests/gap-counter.test.ts'],
    why: '漏点记录（downgrade/unsupported 分列）',
  },
  {
    match: /^packages\/compiler\/src\/overrides\.ts$/,
    tests: ['tests/overrides.test.ts', 'tests/registry-drift.test.ts'],
    why: '规则禁用/覆盖（disabled 集合与 trace）',
  },
  {
    match: /^packages\/compiler\/src\/tags\.ts$/,
    tests: ['tests/transforms.test.ts', 'tests/web-tap-event.test.ts', 'tests/p-gesture-batch.test.ts'],
    why: '标签/事件映射表（TAG_MAP / EVENT_MAP / 手势）',
  },
  {
    match: /^packages\/compiler\/src\/fluid-layout\.ts$/,
    tests: ['tests/fluid-layout.test.ts', 'tests/fluid-layout-components.test.ts'],
    why: '柔性流式布局求解',
  },
  {
    match: /^packages\/compiler\/src\/explain\.ts$/,
    tests: ['tests/explain.test.ts', 'tests/explain-vapor-gaps.test.ts'],
    why: '转换说明输出（CLI explain）',
  },
  {
    match: /^packages\/compiler\/src\/vapor\//,
    // Vapor 线是**独立子系统**（编译器内的一等公民：expr/slots/events/模板/样式对象…）
    // ——25 个 vapor-*.test.ts 是其测试面；改 vapor/ 下任一文件时跑这些（--wide 兜底更全）。
    tests: [
      'tests/vapor-v3.test.ts',
      'tests/vapor-expr-program.test.ts',
      'tests/vapor-events.test.ts',
      'tests/vapor-scoped-slots.test.ts',
      'tests/vapor-style-object.test.ts',
      'tests/vapor-lifecycle.test.ts',
      'tests/vapor-ts-syntax-and-scope-destructure.test.ts',
      // ★2026-10-04：App 端 CSS 支持面 SSOT（APP_*_FIELDS 导出 + 三表分层对照棘轮）
      'tests/app-css-surface.test.ts',
      // ★C1 最小切片（2026-10-04）：SFC <style> 单类规则 → class→节点样式
      'tests/vapor-class-styles.test.ts',
      // ★B4（2026-10-07 · 决策 #604 ⑨）：HandlerAction 联合成员（加 op:'nav'）的**类型收窄守卫**断言——
      //   此前漏网（vitest 不做类型检查）⇒ 只有 vue-tsc 才报；补进映射防再漏。
      'tests/slot-runtime-dispatch.test.ts',
      'tests/vapor-emits.test.ts',
      'tests/vapor-v3-e2e.test.ts',
    ],
    why: 'Vapor 子系统（表达式/槽位/事件/生命周期/样式对象——独立测试体系）+ App CSS 支持面 SSOT',
  },
  {
    match: /^packages\/compiler\/src\/ir\//,
    tests: [
      'tests/compiler-ir-m1.test.ts',
      'tests/compiler-ir-m2.test.ts',
      'tests/compiler-ir-m3.test.ts',
      'tests/compiler-ir-m4.test.ts',
      'tests/compiler-ir-m5.test.ts',
    ],
    why: 'CompilerIR 语义快照构建（M1–M5 各批的投影）',
  },
  {
    match: /^packages\/compiler\/src\/style-safety\//,
    tests: [
      'tests/style-safety.test.ts',
      'tests/style-safety-b2.test.ts',
      'tests/style-safety-b3.test.ts',
      'tests/style-check-cli.test.ts',
    ],
    why: '样式安全白名单/可达性检查（style-safety 子包）',
  },
  {
    match: /^packages\/plugin-vite\/src\//,
    tests: [
      'tests/mp-global-layer-inject.test.ts',
      'tests/overlay-host-inject.test.ts',
      'tests/cache.test.ts',
      // ★B1（2026-10-04）：npm/别名/子路径/path-polyfill 解析链
      'tests/module-npm-b1.test.ts',
      'tests/module-import.test.ts',
      'tests/mp-transform-exclude.test.ts',
      'tests/component-b4.test.ts',
      // ★GP7（2026-10-04）：共享状态模块内存记账（stats/unmount/预算）+ 烘焙值调用点
      'tests/global-layer-memory-gp7.test.ts',
    ],
    why: 'MP 插件（壳片段注入/宿主注入/编译缓存键）',
  },
  {
    match: /^packages\/runtime\/src\/(pageLifecycle|index|setDataBridge)\.ts$/,
    tests: ['tests/runtime.test.ts', 'tests/lifecycle.test.ts', 'tests/lifecycle-callback.test.ts', 'tests/engineering.test.ts'],
    why: '运行时生命周期/桥（页面钩子注册、setData 批量桥）',
  },
]

/** 宽面兜底：这些包的内核改动若未命中精化表 ⇒ 提示（并可用 --wide 跑 import 面） */
const WIDE_PACKAGES = [
  { pkg: 'packages/compiler/', importPat: /@proteus-vue\/compiler(?![-\w])|packages\/compiler\/src/ },
  { pkg: 'packages/runtime/', importPat: /@proteus-vue\/runtime(?![-\w])|packages\/runtime\/src/ },
  { pkg: 'packages/plugin-vite/', importPat: /@proteus-vue\/plugin-vite(?![-\w])|packages\/plugin-vite\/src/ },
]

// ── ① 表自检（防表腐化：文件改名/写错后工具静默失效——本仓"门禁自身要门禁"同款）──
const tableErrors = []
for (const entry of COUPLING) {
  for (const t of entry.tests) {
    if (!fs.existsSync(path.join(ROOT, t))) tableErrors.push(`${entry.match} → ${t}（文件不存在）`)
  }
}
if (tableErrors.length) {
  console.error('✗ 耦合表腐化（表中测试文件不存在——改名/移动后须同步本表）：')
  for (const e of tableErrors) console.error('  · ' + e)
  process.exit(2)
}

// ── ⑥ 覆盖率自检（元腐化防线：新增内核文件必须落进精化表，或显式豁免）──
//   【为什么需要】表是人工精化的 ⇒ 新增 packages/compiler/src/*.ts 时若没人更新表，
//     该文件的改动只会落进"宽面提示"（--wide 兜底）——定向精度悄悄退化（本仓"门禁自身的腐化"同款）。
//   ⇒ 把"内核文件是否被表覆盖"变成可机器判定的检查：未覆盖且未豁免 ⇒ 报告（不阻断主流程，
//     因为旧文件可能确实没有专属配套；但**新增**文件会立刻可见）。
//   ★豁免清单：有专属测试但走"包级 import 面"更合适的、或纯类型/工具文件（无产物影响）。
const COVERAGE_EXEMPT = new Set([
  'packages/compiler/src/types.ts', // 纯类型（无运行时产物流）
  'packages/compiler/src/trace.ts', // trace 结构定义（由各环节自身测试覆盖）
  'packages/compiler/src/model-path.ts', // 路径工具（被 script 测试面覆盖）
])
if (has('--coverage')) {
  const kernelFiles = []
  //   ★扫描面 = compiler 全包（内核主战场，表须全覆盖）+ runtime **仅声明的覆盖面**
  //     （runtime 含 pinia/style-safety 等独立域，各有自己的测试体系，不纳入本表的覆盖义务）
  const dirs = ['packages/compiler/src']
  const runtimeCovered = ['packages/runtime/src/pageLifecycle.ts', 'packages/runtime/src/index.ts', 'packages/runtime/src/setDataBridge.ts']
  for (const dir of dirs) {
    const walk = (d) => {
      for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
        const rel = path.join(d, e.name).replace(/\\/g, '/')
        if (e.isDirectory()) walk(rel)
        else if (/\.ts$/.test(e.name) && !/\.d\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name)) kernelFiles.push(rel)
      }
    }
    walk(dir)
  }
  const uncovered = kernelFiles.filter((f) => !COVERAGE_EXEMPT.has(f) && !COUPLING.some((e) => e.match.test(f)))
  // runtime 声明的覆盖面之外的文件：只提示不计入失败（见上）
  const runtimeUncovered = fs.existsSync(path.join(ROOT, 'packages/runtime/src'))
    ? [...new Set(['pageLifecycle.ts', 'index.ts', 'setDataBridge.ts'].map((x) => 'packages/runtime/src/' + x))]
        .filter((f) => fs.existsSync(path.join(ROOT, f)) && !COUPLING.some((e) => e.match.test(f)))
    : []
  void runtimeCovered
  void runtimeUncovered
  console.log(`[test:coupled] 覆盖率：内核源文件 ${kernelFiles.length} 个，表覆盖 ${kernelFiles.length - uncovered.length - COVERAGE_EXEMPT.size} 个、豁免 ${COVERAGE_EXEMPT.size} 个`)
  if (uncovered.length) {
    console.log('\n⚠ 未落进精化表的内核文件（新增文件须补表，或加入 COVERAGE_EXEMPT 说明）：')
    for (const f of uncovered) console.log('  · ' + f)
    process.exit(1)
  }
  console.log('✅ 全部内核文件已被精化表覆盖或显式豁免')
  process.exit(0)
}

if (has('--explain')) {
  console.log('═══ 内核 ↔ 配套测试 映射表（scripts/test-coupling.mjs · COUPLING）═══')
  for (const e of COUPLING) {
    console.log(`\n${e.match}`)
    console.log(`  为什么：${e.why}`)
    for (const t of e.tests) console.log(`  · ${t}`)
    if (e.cmds) for (const c of e.cmds) console.log(`  $ ${c}`)
  }
  process.exit(0)
}

// ── ② 推导改动集（默认：相对 origin/main 的工作区 + 已提交未推；--since 覆盖）──
function gitLines(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf-8' })
      .trim()
      .split('\n')
      .filter(Boolean)
  } catch {
    return []
  }
}

let base = valOf('--since')
if (!base) {
  const mb = gitLines(['merge-base', 'HEAD', 'origin/main'])[0]
  base = mb || 'origin/main'
}

const changed = new Set()
for (const l of gitLines(['diff', '--name-only', base])) changed.add(l)
for (const l of gitLines(['diff', '--name-only'])) changed.add(l) // 工作区（未暂存）
for (const l of gitLines(['diff', '--name-only', '--cached'])) changed.add(l) // 暂存区
// ★未跟踪的新文件也要算（实测盲区：新建 packages/compiler/src/xxx.ts 还未 git add 时，
//   前三行 diff 全部看不到该文件 ⇒ 工具漏判——正是"新增内核文件"这一最需要定向的场景）
for (const l of gitLines(['ls-files', '--others', '--exclude-standard'])) changed.add(l)
if (changed.size === 0) {
  console.log(`[test:coupled] 相对 ${base} 无改动——无需定向跑（干净树/新会话自动跳过）`)
  process.exit(0)
}

// ── ③ 映射：命中精化条目 → 配套测试；未命中内核包 → 记宽面提示 ──
const picked = new Map() // test 文件 → Set<来源说明>
const cmds = new Set()
const wideHits = new Map() // 包 → 改动文件[]
const kernelChanged = []
for (const f of changed) {
  let hit = false
  for (const entry of COUPLING) {
    if (!entry.match.test(f)) continue
    hit = true
    for (const t of entry.tests) {
      if (!picked.has(t)) picked.set(t, new Set())
      picked.get(t).add(f)
    }
    if (entry.cmds) for (const c of entry.cmds) cmds.add(c)
  }
  for (const w of WIDE_PACKAGES) {
    if (!f.startsWith(w.pkg)) continue
    kernelChanged.push(f)
    if (!hit) {
      if (!wideHits.has(w.pkg)) wideHits.set(w.pkg, [])
      wideHits.get(w.pkg).push(f)
    }
  }
}

const testFiles = [...picked.keys()].sort()

// ── ④ 报告：将跑什么、为什么 ──
console.log(`[test:coupled] diff 基：${base}（改动 ${changed.size} 个文件）`)
if (kernelChanged.length) console.log(`[test:coupled] 内核改动：${kernelChanged.length} 个（${kernelChanged.slice(0, 6).join(', ')}${kernelChanged.length > 6 ? ' …' : ''}）`)
for (const [pkg, files] of wideHits) {
  const pat = WIDE_PACKAGES.find((w) => w.pkg === pkg).importPat
  const wide = fs
    .readdirSync(path.join(ROOT, 'tests'))
    .filter((n) => n.endsWith('.test.ts'))
    .filter((n) => pat.test(fs.readFileSync(path.join(ROOT, 'tests', n), 'utf-8')))
  console.log(`\n⚠ ${pkg} 有 ${files.length} 个改动文件**未命中精化表**（防表腐化提示；漏加不致命，会退化为提示）：`)
  for (const f of files) console.log(`  · ${f}`)
  console.log(`  该包 import 面共 ${wide.length} 个测试文件——补表（scripts/test-coupling.mjs）或 --wide 兜底：`)
  console.log(`  $ pnpm test:coupled -- --wide`)
}

if (testFiles.length === 0) {
  console.log('\n[test:coupled] 无命中精化表的配套测试——（未命中内核包则无提示）')
  process.exit(0)
}

console.log(`\n[test:coupled] 将跑 ${testFiles.length} 个配套测试文件：`)
for (const t of testFiles) console.log(`  · ${t}   ← ${[...picked.get(t)].join(', ')}`)
if (cmds.size) {
  console.log('\n[test:coupled] 另有同源工件命令（规则注册表类改动建议顺跑）：')
  for (const c of cmds) console.log(`  $ ${c}`)
}

if (has('--list')) {
  console.log('\n（--list：仅列出，未执行）')
  process.exit(0)
}

// ── ⑤ 真跑（定向 vitest——带文件过滤，非全量，不触 deny-blind-tests 红线）──
//   --wide：union 精化集 + 内核包的全部 import 面（慢一些，用于"表未覆盖"的改动兜底）
const runSet = new Set(testFiles)
if (has('--wide')) {
  for (const w of WIDE_PACKAGES) {
    for (const n of fs.readdirSync(path.join(ROOT, 'tests'))) {
      if (!n.endsWith('.test.ts')) continue
      if (w.importPat.test(fs.readFileSync(path.join(ROOT, 'tests', n), 'utf-8'))) runSet.add('tests/' + n)
    }
  }
  console.log(`[test:coupled] --wide：union 精化集后共 ${runSet.size} 个测试文件`)
}
console.log('')
const t0 = Date.now()
const r = spawnSync('npx', ['vitest', 'run', ...[...runSet].sort()], { cwd: ROOT, stdio: 'inherit' })
const secs = ((Date.now() - t0) / 1000).toFixed(1)
if (r.status === 0) {
  console.log(`\n[test:coupled] ✅ 配套断言全绿（${secs}s）——内核改动与断言已同步`)
  process.exit(0)
}
console.error(`\n[test:coupled] ✗ 配套断言有红（${secs}s）——**这正是"忘了同步的断言债务"**：`)
console.error('  修断言（对准契约）或修实现；不要跳过（全量也只是再发现一次，且更慢）。')
process.exit(r.status ?? 1)
