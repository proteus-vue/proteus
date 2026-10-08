// packages/cli/src/doctor/checks/project.ts —— §4.4 project 组（工程完整性；吸收 health.ts）
//
// 【框架仓跳过（重要）】doctor 在**框架仓也跑**（CI §11）——而框架仓不是 Proteus 工程（无
//   proteus.config.ts）⇒ project 组在此**不适用**（否则 CI 因 config-file error 被阻断）。
//   判据 = 有 `packages/layout-core-rust/Cargo.toml`（框架仓签名）。
import type { DoctorCheck, DoctorContext } from '../types'
import { ok, skip, fail } from './util'

/** 框架仓签名（自身是框架、非消费工程） */
function isFrameworkRepo(ctx: DoctorContext): boolean {
  return ctx.exists('packages/layout-core-rust/Cargo.toml')
}
/** project 组统一条件：非框架仓 */
const notFramework = (ctx: DoctorContext): boolean => !isFrameworkRepo(ctx)

export const PROJECT_CHECKS: DoctorCheck[] = [
  {
    id: 'project/config-file',
    group: 'project',
    title: 'proteus.config.ts',
    level: 'error',
    appliesTo: notFramework,
    run(ctx) {
      return ctx.exists('proteus.config.ts')
        ? ok('project/config-file', 'proteus.config.ts', '存在')
        : fail({ checkId: 'project/config-file', level: 'error', code: 'PT-ER-001', title: 'proteus.config.ts 缺失', expected: 'proteus.config.ts（Proteus 工程）', actual: '不存在（当前目录可能不是 Proteus 工程）', fix: { command: 'proteus gen config', description: '生成配置骨架' }, evidence: [{ command: 'ls proteus.config.ts', note: 'ENOENT' }] })
    },
  },
  {
    id: 'project/pages-dir',
    group: 'project',
    title: 'pagesDir',
    level: 'error',
    appliesTo: (ctx) => notFramework(ctx) && ctx.exists('proteus.config.ts'),
    run(ctx) {
      const raw = ctx.readFile('proteus.config.ts') ?? ''
      const m = raw.match(/pagesDir\s*:\s*['"]([^'"]+)['"]/)
      const pagesDir = m ? m[1] : 'pages'
      return ctx.exists(pagesDir)
        ? ok('project/pages-dir', 'pagesDir', `${pagesDir} ✓`)
        : fail({ checkId: 'project/pages-dir', level: 'error', code: 'PT-ER-002', title: 'pagesDir 不存在', expected: `目录 ${pagesDir}`, actual: '不存在', fix: { description: 'proteus.config.pagesDir 指向错误' }, evidence: [{ command: `ls ${pagesDir}`, note: 'ENOENT' }] })
    },
  },
  {
    id: 'project/app-config',
    group: 'project',
    title: 'app.config.ts',
    level: 'warn',
    appliesTo: (ctx) => notFramework(ctx) && ctx.exists('proteus.config.ts'),
    run(ctx) {
      return ctx.exists('app.config.ts')
        ? ok('project/app-config', 'app.config.ts', '存在')
        : fail({ checkId: 'project/app-config', level: 'warn', code: 'PT-ER-004', title: '缺少 app.config.ts（可选）', expected: 'app.config.ts（应用级运行时配置）', actual: '不存在', fix: { command: 'proteus gen config', description: '生成骨架' }, evidence: [{ command: 'ls app.config.ts', note: 'ENOENT' }] })
    },
  },
  {
    id: 'project/appid',
    group: 'project',
    title: 'appid（小程序端）',
    level: 'error',
    appliesTo: (ctx) => notFramework(ctx) && ctx.targets.includes('skyline') && ctx.exists('proteus.config.ts'),
    run(ctx) {
      const raw = ctx.readFile('proteus.config.ts') ?? ''
      const m = raw.match(/appid\s*:\s*['"]([^'"]+)['"]/)
      if (!m) return skip('project/appid', 'appid（小程序端）', '未声明 appid')
      const appid = m[1]
      const valid = /^wx[0-9a-f]{16}$/.test(appid)
      return valid
        ? ok('project/appid', 'appid（小程序端）', `${appid} ✓`)
        : fail({ checkId: 'project/appid', level: 'error', code: 'PT-ER-005', title: 'appid 无效或为占位', expected: 'wx + 16 位十六进制', actual: appid, fix: { description: 'IDE 导入 / automator 体检会失败——填真实 appid' }, evidence: [{ note: `appid=${appid}` }] })
    },
  },
  {
    id: 'project/scripts',
    group: 'project',
    title: '必要 npm scripts',
    level: 'warn',
    appliesTo: (ctx) => ctx.exists('package.json'),
    run(ctx) {
      const pkg = ctx.projectPackage()
      const scripts = (pkg?.scripts as Record<string, string>) ?? {}
      const wanted = ['build:web', 'build:mp', 'dev'].filter((s) => !scripts[s])
      return wanted.length < 3
        ? ok('project/scripts', '必要 npm scripts', Object.keys(scripts).filter((s) => /build|dev/.test(s)).slice(0, 4).join(', ') || '（有构建入口）')
        : fail({ checkId: 'project/scripts', level: 'warn', code: 'PT-ER-007', title: '缺构建/开发入口 script', expected: 'build:web / build:mp / dev 至少一个', actual: '均缺失', fix: { description: '补齐 npm scripts' }, evidence: [{ note: `scripts=${Object.keys(scripts).join(',') || '(空)'}` }] })
    },
  },
]

