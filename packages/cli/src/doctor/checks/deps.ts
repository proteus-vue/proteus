// packages/cli/src/doctor/checks/deps.ts —— §4.3 deps 组（依赖与版本一致性）
//
// 【零逻辑复制】`deps/declared` 复用 `scripts/check-deps.mjs`（框架仓专用）；版本一致性判据见 §4.3。
import type { DoctorCheck } from '../types'
import { ok, fail } from './util'

export const DEPS_CHECKS: DoctorCheck[] = [
  {
    id: 'deps/installed',
    group: 'deps',
    title: 'node_modules',
    level: 'error',
    run(ctx) {
      return ctx.exists('node_modules')
        ? ok('deps/installed', 'node_modules', '存在')
        : fail({ checkId: 'deps/installed', level: 'error', code: 'PT-ED-002', title: '依赖未安装', expected: 'node_modules/ 存在', actual: '缺失', fix: { command: 'pnpm install' }, evidence: [{ command: 'ls node_modules', note: 'ENOENT' }] })
    },
  },
  {
    id: 'deps/workspace-links',
    group: 'deps',
    title: 'workspace 链接',
    level: 'error',
    run(ctx) {
      const pkg = ctx.projectPackage()
      if (!pkg) return ok('deps/workspace-links', 'workspace 链接', '（无 package.json，跳过）')
      const deps = { ...((pkg.dependencies as Record<string, string>) ?? {}), ...((pkg.devDependencies as Record<string, string>) ?? {}) }
      const fw = Object.keys(deps).filter((d) => d.startsWith('@proteus-vue/'))
      if (!fw.length) return ok('deps/workspace-links', 'workspace 链接', '（无 @proteus-vue/* 依赖）')
      // ★判据 = 该包**自己声明的入口**（main/exports），不是写死的 dist/index.js——
      //   本仓 `@proteus-vue/components` 是**源形态**包（main=./index.ts，无 dist），写死会假红。
      const entryOf = (d: string): string => {
        const raw = ctx.readFile(`node_modules/${d}/package.json`)
        if (raw) {
          try {
            const p = JSON.parse(raw) as { main?: string; exports?: { '.': { import?: string; default?: string } | string } }
            const dot = p.exports?.['.']
            const exp = typeof dot === 'string' ? dot : dot?.import ?? dot?.default
            if (exp) return `node_modules/${d}/${exp.replace(/^\.\//, '')}`
            if (p.main) return `node_modules/${d}/${p.main.replace(/^\.\//, '')}`
          } catch { /* fallthrough to default */ }
        }
        return `node_modules/${d}/dist/index.js`
      }
      const missing = fw.filter((d) => !ctx.exists(entryOf(d)))
      return missing.length === 0
        ? ok('deps/workspace-links', 'workspace 链接', `${fw.length} 个 @proteus-vue/* 就绪（入口可解析）`)
        : fail({ checkId: 'deps/workspace-links', level: 'error', code: 'PT-ED-002', title: 'workspace 链接不完整', expected: `${fw.length} 个 @proteus-vue/* 的入口文件可解析`, actual: `${missing.length} 个缺入口：${missing.slice(0, 5).join(', ')}`, fix: { command: 'pnpm install  # prepare 钩子重建 dist' }, evidence: missing.slice(0, 5).map((d) => ({ command: `ls ${entryOf(d)}`, note: 'ENOENT' })) })
    },
  },
  {
    id: 'deps/declared',
    group: 'deps',
    title: '依赖声明完整性',
    level: 'warn',
    // 仅框架仓（有 scripts/check-deps.mjs）
    appliesTo: (ctx) => ctx.exists('scripts/check-deps.mjs'),
    run(ctx) {
      const ev = ctx.runCmd('node', ['scripts/check-deps.mjs'], { timeoutMs: 20000 })
      // 输出含「缺失依赖 0 个」⇒ 通过
      const missingMatch = (ev.stdout ?? '').match(/缺失依赖\s*(\d+)\s*个/)
      const missing = missingMatch ? Number(missingMatch[1]) : null
      if (ev.exitCode === 0 && missing === 0) return ok('deps/declared', '依赖声明完整性', '零缺失')
      return fail({ checkId: 'deps/declared', level: 'warn', code: 'PT-ED-004', title: '存在未声明依赖', expected: 'check-deps 零缺失', actual: missing != null ? `${missing} 个缺失` : (ev.stderr ?? ev.note ?? '检查失败'), fix: { command: 'node scripts/check-deps.mjs --fix-list' }, evidence: [ev] })
    },
  },
  {
    id: 'deps/dist-freshness',
    group: 'deps',
    title: 'CLI dist 新鲜度',
    level: 'warn',
    appliesTo: (ctx) => ctx.exists('packages/cli/src/index.ts'),
    run(ctx) {
      const fromDist = 'packages/cli/dist/index.js'
      const fromSrc = 'packages/cli/src/index.ts'
      if (!ctx.exists(fromDist)) return fail({ checkId: 'deps/dist-freshness', level: 'warn', code: 'PT-ED-005', title: 'CLI dist 缺失', expected: fromDist, actual: '不存在', fix: { command: 'pnpm build:packages' }, evidence: [{ command: `ls ${fromDist}`, note: 'ENOENT' }] })
      const d = ctx.runCmd('stat', ['-f', '%m', fromDist], { timeoutMs: 3000 })
      const s = ctx.runCmd('stat', ['-f', '%m', fromSrc], { timeoutMs: 3000 })
      const dm = Number(d.stdout)
      const sm = Number(s.stdout)
      if (Number.isFinite(dm) && Number.isFinite(sm) && dm < sm) {
        return fail({ checkId: 'deps/dist-freshness', level: 'warn', code: 'PT-ED-005', title: 'CLI dist 陈旧', expected: 'dist 不早于 src', actual: `dist(${dm}) < src(${sm})`, fix: { command: 'pnpm build:packages' }, evidence: [d, s] })
      }
      return ok('deps/dist-freshness', 'CLI dist 新鲜度', 'dist 不早于 src')
    },
  },
]

