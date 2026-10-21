// tests/gates-sync.test.ts
// ★门禁通道一致性回归锁（2026-09-18 建；2026-10-21 收紧判据并**去掉镜像实现**）。
//
// 背景：CI 与本地 `pnpm verify` 曾是**两套重叠但不一致**的门禁集，各自都不完整，且缺的
//   正好是对方的强项——CI 有 vue-tsc/build-packages 而 verify 没有（本地「全绿」掩盖 tsc
//   才暴露的类型错误，实测 TS2322 漏到 CI）；verify 有 check:mp-attrs（主属性棘轮）而 CI 没有
//   （属性覆盖回退可推上去而 CI 不拦）。根因是「接线」靠人工记忆、无机器校验。
//
// ★★★2026-10-21（决策 #1157）：本文件原来自带一份 `coveredByCi()`，与
//   `scripts/check-gates-sync.mjs` 里的实现**互为镜像**（注释特意写过"改判据时必须同时改它的镜像"）。
//   镜像的代价是双份口径必然漂移，而更糟的是**两边一起错**：旧判据拿"脚本路径出现在 CI 文本里"
//   当接线证据 ⇒ ① 共享入口 `packages/cli/src/index.ts` 被 CI 广泛提及，经它的 `check:*`
//   在真加 CI 步骤前就绿；② 注释里提一句 `check:foo` 也算接线（实测 `check:baseline-freshness`
//   靠 ci.yml 那句"**非门禁**…不入 CI"的注释绿了很久）。
//   ⇒ 判定逻辑只留一份：`scripts/lib/gates-sync.mjs`（纯函数）；本测试改为**验证它**，
//     而不是复制它。
//
// 【判据】（人造 workflow 控形 + 真仓事实兜底）
//   ① 注释 / `name:` 字段 / `env:` 值 都不算命令；
//   ② 共享入口的不同子命令不得互相冒充（`knowledge layers` ≠ `knowledge check`）；
//   ③ `run: |` 块标量逐行提取、遇缩进回退即止；`check:*` 名字命中要词边界；
//   ④ 真仓：`check:knowledge` 真在跑 / `check:baseline-freshness` 不再靠注释假绿；
//   ⑤ 未接线集合 ⊆ LOCAL_ONLY 声明，且**豁免必须写理由**（空理由 = 未思考的豁免）。

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  extractRunCommands,
  hasToken,
  isCovered,
  refsOf,
  runsFile,
} from '../scripts/lib/gates-sync.mjs'

const ROOT = path.resolve(__dirname, '..')
const WF_DIR = path.join(ROOT, '.github', 'workflows')
const scripts = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts as Record<string, string>

const wfFiles = fs.readdirSync(WF_DIR).filter((f) => /\.ya?ml$/.test(f))
const REAL_RUNS = wfFiles.flatMap((f) => extractRunCommands(fs.readFileSync(path.join(WF_DIR, f), 'utf8')))
const RUN_TEXT = REAL_RUNS.join('\n')

/**
 * ★单一事实源：LOCAL_ONLY 声明从 `check-gates-sync.mjs` 解析（含理由）。
 *  历史教训（2026-09-29）：测试与脚本各维护一份白名单，实测漂移——新增 4 个 `check:ios-*`
 *  只登记在 .mjs ⇒ 测试红而脚本绿。⇒ 只解析、不复制。
 *  ★字符类必须含 `:`（`check:pushed:strict` 这类两端冒号的名字），否则在第二个冒号处停住 ⇒ 假红。
 */
function declaredLocalOnly(): Map<string, string> {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'check-gates-sync.mjs'), 'utf8')
  const block = src.match(/const LOCAL_ONLY\s*=\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
  const out = new Map<string, string>()
  // ★必须锚定行首缩进：否则 `// 'check:ghost': '理由'` 这种**被注释掉的**声明也会被解析进来
  //   ⇒ "把豁免注释掉"仍然生效（独立验证实测过：不锚定时 size=1，且理由足够长 ⇒ 断言假绿）。
  // ★值支持转义：理由里含 `\'` 时不至于把后半截丢掉（丢掉的后果是"理由非空"断言假绿）。
  for (const m of block.matchAll(/^ {2}'(check:[\w:-]+)'\s*:\s*'((?:[^'\\]|\\.)*)'/gm)) {
    out.set(m[1]!, m[2]!.replace(/\\'/g, "'"))
  }
  return out
}

/** 人造 workflow：缩进与真实 ci.yml 同形，把"像命令但不是命令"的三种形态都摆进去 */
const WF = [
  'name: CI',
  'jobs:',
  '  build:',
  '    steps:',
  '      # ★这行注释提到 check:commented —— 但注释不是命令',
  '      #   run: pnpm run check:commented',
  '      - name: 名字里带 check:named 的步骤（也不是命令）',
  '        env:',
  '          FLAG: check:enved',
  '        run: pnpm run check:real',
  '      - name: 共享入口（不同子命令）',
  '        run: npx tsx packages/cli/src/index.ts knowledge layers',
  '      - name: 共享入口（目标子命令）',
  '        run: npx tsx packages/cli/src/index.ts knowledge check --json',
  '      - name: 块标量',
  '        run: |',
  '          pnpm run check:block-first',
  '          node scripts/foo.mjs --check',
  '      - name: 块后同级命令',
  '        run: pnpm run check:after-block',
].join('\n')

const RUNS = extractRunCommands(WF)
const fixtureScripts: Record<string, string> = {
  'check:real': 'node scripts/real.mjs',
  'check:commented': 'node scripts/commented.mjs',
  'check:named': 'node scripts/named.mjs',
  'check:enved': 'node scripts/enved.mjs',
  'check:block-first': 'node scripts/block-first.mjs',
  'check:after-block': 'node scripts/after-block.mjs',
  'check:knowledge': 'npx tsx packages/cli/src/index.ts knowledge check',
  'check:indirect': 'pnpm run check:real',
}
const coverFixture = (name: string) =>
  isCovered({ name, cmd: fixtureScripts[name]!, runCommands: RUNS, scripts: fixtureScripts })

describe('extractRunCommands：只认会被执行的 run 命令', () => {
  it('注释行、name 字段、env 值都不算命令', () => {
    const all = RUNS.join('\n')
    expect(all, '注释里的 run: 被当成了命令').not.toContain('check:commented')
    expect(all, '步骤 name 里的 check: 被当成了命令').not.toContain('check:named')
    expect(all, 'env 值里的 check: 被当成了命令').not.toContain('check:enved')
  })

  it('run: | 块标量逐行展开，且遇到缩进回退即结束', () => {
    expect(RUNS).toContain('pnpm run check:block-first')
    expect(RUNS).toContain('node scripts/foo.mjs --check')
    expect(RUNS, '块结束后的同级命令被吞进块里').toContain('pnpm run check:after-block')
  })
})

describe('名字命中要求词边界', () => {
  it('check:deps 不被 check:deps-extra 顶替', () => {
    expect(hasToken('pnpm run check:deps-extra', 'check:deps')).toBe(false)
    expect(hasToken('pnpm run check:deps', 'check:deps')).toBe(true)
    expect(hasToken('  run: pnpm run check:deps && echo ok', 'check:deps')).toBe(true)
  })

  it('改名的死命令不冒充（check:knowledge.disabled 不是 check:knowledge）', () => {
    expect(hasToken('run: pnpm run check:knowledge.disabled', 'check:knowledge')).toBe(false)
  })
})

describe('文件命中要求路径 + 位置参数（关掉共享入口的假绿通道）', () => {
  const cmd = 'npx tsx packages/cli/src/index.ts knowledge check'
  const file = 'packages/cli/src/index.ts'

  it('同一路径但不同子命令 ⇒ 不算接线', () => {
    expect(runsFile(cmd, file, ['npx tsx packages/cli/src/index.ts knowledge layers'])).toBe(false)
  })

  it('路径只出现在注释里 ⇒ 不算接线（注释先被剔除）', () => {
    const runs = extractRunCommands('      #   run: npx tsx packages/cli/src/index.ts knowledge check')
    expect(runsFile(cmd, file, runs)).toBe(false)
  })

  it('同子命令（带额外 flag）⇒ 算接线', () => {
    expect(runsFile(cmd, file, ['npx tsx packages/cli/src/index.ts knowledge check --json'])).toBe(true)
  })

  it('位置参数必须按序出现', () => {
    expect(runsFile(cmd, file, ['node scripts/x.mjs check knowledge'])).toBe(false)
  })

  it('★多命令串联：第一段也要能匹配（`&&` 后的尾巴不是位置参数）', () => {
    expect(runsFile(cmd, file, ['npx tsx packages/cli/src/index.ts knowledge check && echo done'])).toBe(true)
  })

  it('★同一段里位置参数被凑齐但语义不同的形态（`knowledge --check`）——按词匹配，不按语义', () => {
    // 如实登记：这是判据的已知残余（只做词匹配）。此处断言"会被判成命中"，
    // 是为了让口径**显式可见**，而不是让读者以为语义级校验已经做了。
    expect(runsFile(cmd, file, ['npx tsx packages/cli/src/index.ts knowledge --check'])).toBe(true)
  })

  it('无位置参数时退化为路径匹配（`--check` 这类 flag 不参与）', () => {
    expect(runsFile('node scripts/a.mjs --check', 'scripts/a.mjs', ['node scripts/b.mjs'])).toBe(false)
    expect(runsFile('node scripts/a.mjs --check', 'scripts/a.mjs', ['node scripts/a.mjs --check'])).toBe(true)
  })

  it('★flag 语义必须对上：`--check`（只比对）不得被 `--update`（写回）顶替', () => {
    const cmd = 'node scripts/gen-x.mjs --check'
    expect(runsFile(cmd, 'scripts/gen-x.mjs', ['node scripts/gen-x.mjs --update'])).toBe(false)
    expect(runsFile(cmd, 'scripts/gen-x.mjs', ['node scripts/gen-x.mjs --check'])).toBe(true)
    // CI 多带 flag（更严）应仍算接线：判据是「本地要的 flag 都在」
    expect(runsFile(cmd, 'scripts/gen-x.mjs', ['node scripts/gen-x.mjs --check --strict'])).toBe(true)
  })
})

describe('isCovered：三档接线 + 间接引用', () => {
  it('直接名字命中', () => {
    expect(coverFixture('check:real')).toMatchObject({ covered: true, via: 'name' })
  })

  it('注释 / name 字段 / env 提及 都不算接线', () => {
    for (const n of ['check:commented', 'check:named', 'check:enved']) {
      expect(coverFixture(n), `${n} 被注释或字段值判成了接线`).toMatchObject({ covered: false })
    }
  })

  it('块标量里的命令算接线', () => {
    expect(coverFixture('check:block-first')).toMatchObject({ covered: true, via: 'name' })
    expect(coverFixture('check:after-block')).toMatchObject({ covered: true, via: 'name' })
  })

  it('经 pnpm run 间接引用 ⇒ via=sub', () => {
    expect(coverFixture('check:indirect')).toMatchObject({ covered: true, via: 'sub', detail: 'check:real' })
  })

  it('脚本路径命中但子命令不符 ⇒ 不接线（本轮修掉的假绿形态）', () => {
    // ★人造文本里两行都在（layers 与 check），所以这里单独喂"只有 layers"的命令表
    const onlyLayers = ['npx tsx packages/cli/src/index.ts knowledge layers']
    const r = isCovered({
      name: 'check:knowledge',
      cmd: fixtureScripts['check:knowledge']!,
      runCommands: onlyLayers,
      scripts: fixtureScripts,
    })
    expect(r).toMatchObject({ covered: false })
  })
})

// ★★★独立验证（异会话子代理）给出的"假绿构造"——逐条变成判据，否则收紧只是纸面上的
describe('独立验证给出的假绿构造必须失效', () => {
  const mk = (lines: string[]) => extractRunCommands(lines.join('\n'))
  const S = { 'check:foo': 'node scripts/gate-foo.mjs' }
  const judge = (name: string, cmd: string, runs: string[]) =>
    isCovered({ name, cmd, runCommands: runs, scripts: S })

  it('`echo "注意 check:foo"` 不算接线（不执行门禁的段被跳过）', () => {
    expect(judge('check:foo', S['check:foo']!, mk(['      - run: echo "注意 check:foo 不要漏"'])).covered).toBe(false)
  })

  it('`--note=check:foo` 不算接线（名字命中要求包管理器调用形态）', () => {
    expect(judge('check:foo', S['check:foo']!, mk(['      - run: node scripts/x.mjs --note=check:foo'])).covered).toBe(false)
  })

  it('`grep -r check:foo docs/` 不算接线', () => {
    expect(judge('check:foo', S['check:foo']!, mk(['      - run: grep -r check:foo docs/'])).covered).toBe(false)
  })

  it('把整条命令 echo 出来（共享入口）不算接线（文件匹配也跳过非执行段）', () => {
    const runs = mk(['      - run: echo "npx tsx packages/cli/src/index.ts knowledge check"'])
    expect(
      judge('check:knowledge', 'npx tsx packages/cli/src/index.ts knowledge check', runs).covered,
    ).toBe(false)
  })

  it('★兄弟脚本顶替：三脚本串联的 check:* 只跑了其中一个 ⇒ 不算接线', () => {
    const two = 'node scripts/a-gate.mjs && node scripts/b-gate.mjs'
    expect(judge('check:two', two, ['node scripts/b-gate.mjs']).covered).toBe(false)
    expect(judge('check:two', two, ['node scripts/a-gate.mjs']).covered).toBe(false)
    expect(judge('check:two', two, ['node scripts/a-gate.mjs && node scripts/b-gate.mjs']).covered).toBe(true)
  })

  it('块标量显式缩进指示符（`run: |2`）也要能解析', () => {
    const runs = mk(['        run: |2', '          pnpm run check:foo'])
    expect(runs).toContain('pnpm run check:foo')
  })

  it('块内行尾注释被剔除（`echo ok # 注意 check:q` 不该留下名字）', () => {
    const runs = mk(['        run: |', '          echo ok # 注意 check:q'])
    expect(runs.join('\n')).not.toContain('check:q')
  })

  it('★`.json` 不被当成 `.js` 脚本（数据文件不是门禁）', () => {
    expect(refsOf('python3 hosts/android/check-app-stack.py hosts/android/results/app-stack.json').files).toEqual([])
    expect(refsOf('node scripts/gen-icons.mjs && node scripts/check-icons.mjs').files).toEqual([
      'scripts/gen-icons.mjs',
      'scripts/check-icons.mjs',
    ])
  })
})


describe('★真实仓库（不可造假的事实）', () => {
  const names = Object.keys(scripts).filter((k) => k.startsWith('check:'))
  const covered = new Set(
    names
      .filter((n) => isCovered({ name: n, cmd: scripts[n]!, runCommands: REAL_RUNS, scripts }).covered)
      .map((n) => n),
  )
  const localOnly = declaredLocalOnly()

  it('每个 check:* 都被 CI 真执行（或按 LOCAL_ONLY 声明豁免）', () => {
    const unwired = names.filter((n) => !covered.has(n)).filter((n) => !localOnly.has(n))
    expect(unwired, `未接入任何 workflow：${unwired.join(', ')}（接线或在 check-gates-sync.mjs 登记 LOCAL_ONLY）`).toEqual([])
  })

  it('豁免必须写理由（空理由 = 未思考的豁免）', () => {
    const noReason = [...localOnly.entries()].filter(([, why]) => why.trim().length < 6).map(([k]) => k)
    expect(localOnly.size, 'LOCAL_ONLY 一个键都没解析到 ⇒ 正则失效，上一条会假绿').toBeGreaterThan(40)
    expect(noReason, `LOCAL_ONLY 缺理由：${noReason.join(', ')}`).toEqual([])
  })

  it('口径自洽：覆盖集与"仅本地"声明不得重叠（重叠 = 声明多余或判据漏了）', () => {
    const both = [...covered].filter((n) => localOnly.has(n))
    expect(both, `既被 CI 覆盖又挂在 LOCAL_ONLY：${both.join(', ')}`).toEqual([])
  })

  it('防"空集假绿"：真仓既有已覆盖门禁、也有仅本地门禁（两侧都非空才说明判据在分辨）', () => {
    const uncovered = names.filter((n) => !covered.has(n))
    expect(covered.size, '覆盖集小得离谱 ⇒ 解析器坏了').toBeGreaterThan(50)
    expect(uncovered.length, '一条都不需要本地声明 ⇒ 要么 CI 全跑、要么判据把什么都判成已接线').toBeGreaterThan(5)
  })

  it('★check:knowledge 真在 CI 里跑（#1153 接的那一步）', () => {
    expect(covered.has('check:knowledge'), 'check:knowledge 在 CI 里没被真执行').toBe(true)
  })

  it('★check:baseline-freshness 不再靠注释假绿（它自己声明"非门禁"）', () => {
    expect(covered.has('check:baseline-freshness')).toBe(false)
    expect(localOnly.has('check:baseline-freshness'), '既然不接 CI，就必须在 LOCAL_ONLY 声明理由').toBe(true)
  })

  it('★verify 链含 build-packages + 根 vue-tsc（本地无类型盲区）', () => {
    const verify = scripts.verify ?? ''
    expect(verify, 'verify 缺 build-packages（vue-tsc 需 dist）').toContain('build-packages')
    expect(verify, 'verify 缺根 vue-tsc').toMatch(/vue-tsc --noEmit/)
  })

  it('★CI 含属性棘轮与降级门禁（主标尺不得被删/漏接线；注释里提到不算）', () => {
    for (const pat of ['audit-component-attrs.mjs', 'audit-degradation.mjs', 'check-consistency.js']) {
      expect(RUN_TEXT, `CI 的 run 命令里缺 ${pat}`).toContain(pat)
    }
  })

  // ★旧版有、改写后一度丢掉的断言（独立验证指出）：CI 里必须**真跑**构建与类型检查。
  //   丢掉它 ⇒ 有人删掉 ci.yml 的 vue-tsc 步骤时 `pnpm test` 仍全绿。
  it('★CI 真跑 build-packages + vue-tsc（构建与类型检查不可缺席）', () => {
    expect(RUN_TEXT, 'CI 的 run 命令里缺 build-packages').toContain('build-packages')
    expect(RUN_TEXT, 'CI 的 run 命令里缺 vue-tsc --noEmit').toMatch(/vue-tsc --noEmit/)
  })

  it('破坏性语义：判据既不是恒真也不是恒假', () => {
    const fake = isCovered({
      name: 'check:definitely-not-wired-xyz',
      cmd: 'node scripts/no-such-gate.mjs',
      runCommands: REAL_RUNS,
      scripts,
    })
    expect(fake.covered).toBe(false)
    expect(covered.has('check:degradation'), '真仓里已接线的门禁被判成未接线 ⇒ 判据恒假').toBe(true)
  })

  it('refsOf 仍能识别带目录的脚本路径（2026-09-29 的扩面没被回退）', () => {
    expect(refsOf('node hosts/android/acceptance-stub.mjs').files).toEqual(['hosts/android/acceptance-stub.mjs'])
    expect(refsOf('npx tsx packages/cli/src/index.ts knowledge check').files).toEqual(['packages/cli/src/index.ts'])
    expect(refsOf('pnpm run check:real').subs).toEqual(['check:real'])
  })

  it('workflow 解析没退化成空集（199 行量级；空集会令上面所有断言假绿）', () => {
    expect(REAL_RUNS.length).toBeGreaterThan(50)
  })
})
