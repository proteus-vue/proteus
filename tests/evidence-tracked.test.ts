// tests/evidence-tracked.test.ts —— ★★★真机证据「入库即不得缺失」门禁单测（#1146）
//
// 【这张测试锁什么】
//   `scripts/check-evidence-tracked.mjs`：从 package.json 的 `check:*` 命令**自动推导**所有被引用的
//   `hosts/*/results/*.json`，断言它们①存在 ②已入库。
//
//   背景（#1144 → #1145 → 本条，同一条缺陷链的第三层）：
//     · #1144：鸿蒙 screen.mount 漏 env 替换 ⇒ executor 屏内容 0 节点（缺陷本身）
//     · #1145：check-app-screen-content 的入库证据缺失被静默跳过（为什么没发现）
//     · 本条：同类"产物缺失 ⇒ return 0（诚实跳过）"在另外六条判据上扩散
//       （check-app-stack / mount-layers / host-runtime / kernel-anim / platform-anim / embed-demo）
//       ★那句"诚实跳过"的原假设是"真机产物开发机上没有属正常"，但**这些产物已全部入库**
//         ⇒ 缺失只剩"被删/损坏"⇒ 不该算跳过验收（否则 git rm 一下门禁就变绿）。
//
// 【判据】
//   ① `--list` 能列出覆盖面（且条数 > 0——防正则腐化后"扫到 0 条却通过"）
//   ② 每条都标为已入库
//   ③ 删除一个被引用的证据 ⇒ 红（且指名文件与该文件被哪条 check:* 读取）
//   ④ 恢复后 ⇒ 绿
//   ★③④ 用临时把文件挪走再挪回——不碰 git 索引（避免测试污染工作树状态）。
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const GATE = path.join(ROOT, 'scripts', 'check-evidence-tracked.mjs')

function runGate(args: string[] = []): { ok: boolean; out: string } {
  try {
    const out = execFileSync('node', [GATE, ...args], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }).toString()
    return { ok: true, out }
  } catch (e) {
    const err = e as { status?: number; stdout?: Buffer; stderr?: Buffer }
    return { ok: false, out: (err.stdout?.toString() ?? '') + (err.stderr?.toString() ?? '') }
  }
}

describe('★真机证据「入库即不得缺失」门禁（#1146）', () => {
  it('① --list 覆盖面非空（防正则腐化后空跑）', () => {
    const r = runGate(['--list'])
    expect(r.ok, r.out).toBe(true)
    const m = /共 (\d+) 条/.exec(r.out)
    expect(m, `--list 应报出条数：\n${r.out}`).toBeTruthy()
    expect(Number(m![1]), '证据条数应 >= 10（当前 19）').toBeGreaterThanOrEqual(10)
  })

  it('② 当前工作树：全部存在且已入库', () => {
    const r = runGate()
    expect(r.ok, `证据应齐备：\n${r.out}`).toBe(true)
    expect(r.out).toMatch(/真机证据齐备/)
  })

  it('③ 删掉一个入库证据 ⇒ 红且指名文件与被哪条 check:* 读取', () => {
    const victim = path.join(ROOT, 'hosts/android/results/app-stack.json')
    const stash = `${victim}.test-stash`
    if (!fs.existsSync(victim)) throw new Error('夹具前置不满足：app-stack.json 不存在')
    fs.renameSync(victim, stash)
    try {
      const r = runGate()
      expect(r.ok, '入库证据被删应判红（原实现"诚实跳过"= 假绿）').toBe(false)
      expect(r.out).toMatch(/app-stack\.json 缺失/)
      expect(r.out, '应指出是谁在读它').toMatch(/check:app-stack/)
    } finally {
      fs.renameSync(stash, victim)
    }
  })

  it('⑤ 文档引用的 salvage 验收证据：全部可复核（存在 + 已入库）', () => {
    // ★#1147：.workbuddy/salvage 已整目录 gitignore（5447 个/6GB 草稿），但其中被
    //   docs/ai-tasks.json 的 verification 字段引用的 106 个文件**已入库**——
    //   本用例锁住"草稿可忽略、被引用的证据不能少"这条共存关系。
    const out = runGate(['--list'])
    expect(out.ok, out.out).toBe(true)
    expect(out.out, '应报出文档引用证据条数（0 说明解析口径腐化 ⇒ 静默空跑）').toMatch(/文档引用证据[^\n]*?\d+ 条可复核/)
    const m = /文档引用证据[^\n]*?(\d+) 条可复核/.exec(out.out)
    expect(Number(m![1]), '引用条数应 >= 10（当前 15）').toBeGreaterThanOrEqual(10)
  })

  it('⑥ .workbuddy/salvage 草稿已忽略，但已入库证据仍在版本控制里', () => {
    // 两条独立事实，缺一不可：
    //   · 草稿被忽略 ⇒ git status 不再常驻 5450 条（否则 test:coupled 的"改动文件数"被撑爆）
    //   · 已入库证据仍在 ⇒ 被引用的验收结论仍可复核
    const gitignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf-8')
    expect(gitignore, '应含 .workbuddy/salvage/ 忽略规则').toMatch(/^\.workbuddy\/salvage\/$/m)

    const tracked = execFileSync('git', ['ls-files', '.workbuddy/salvage'], { cwd: ROOT, encoding: 'utf-8' })
      .split('\n')
      .filter(Boolean)
    expect(tracked.length, '已入库的验收证据应保留（当前 106 个）').toBeGreaterThanOrEqual(50)

    const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '.workbuddy/salvage'], {
      cwd: ROOT,
      encoding: 'utf-8',
    })
      .split('\n')
      .filter(Boolean)
    expect(untracked.length, '草稿应被忽略（未跟踪项应为 0）').toBe(0)
  })

  it('④ 恢复后 ⇒ 绿（证明 ③ 的红来自删除，不是环境噪声）', () => {
    const r = runGate()
    expect(r.ok, `恢复后应通过：\n${r.out}`).toBe(true)
  })
})
