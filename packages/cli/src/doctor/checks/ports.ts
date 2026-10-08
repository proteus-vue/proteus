// packages/cli/src/doctor/checks/ports.ts —— §4.6 ports 组（端口占用；web/skyline 条件启用）
import type { DoctorCheck } from '../types'
import { ok, fail } from './util'

/** dev server 常用端口候选（与 plugin-vite 缺省一致的主要几个） */
const DEV_PORTS = [5173, 5174, 3000]
/** 微信工具自动化端口（E2E 需要，见 mp-e2e） */
const IDE_PORT = 9420

export const PORTS_CHECKS: DoctorCheck[] = [
  {
    id: 'ports/dev-server',
    group: 'ports',
    title: 'dev server 端口',
    level: 'warn',
    appliesTo: (ctx) => ctx.targets.includes('web'),
    async run(ctx) {
      const busy: number[] = []
      const free: number[] = []
      for (const p of DEV_PORTS) {
        // eslint-disable-next-line no-await-in-loop
        const f = await ctx.portFree(p)
        ;(f ? free : busy).push(p)
      }
      return busy.length === DEV_PORTS.length
        ? fail({ checkId: 'ports/dev-server', level: 'warn', code: 'PT-EE-020', title: 'dev server 端口均被占用', expected: `以下空闲其一：${DEV_PORTS.join(' / ')}`, actual: `全占用：${busy.join(', ')}`, fix: { command: '释放端口或 proteus dev --port <n>' }, evidence: DEV_PORTS.map((p) => ({ note: `port ${p}: ${busy.includes(p) ? 'busy' : 'free'}` })) })
        : ok('ports/dev-server', 'dev server 端口', `空闲：${free.join(', ')}`)
    },
  },
  {
    id: 'ports/ide-port',
    group: 'ports',
    title: '微信工具自动化端口',
    level: 'warn',
    appliesTo: (ctx) => ctx.targets.includes('skyline'),
    async run(ctx) {
      const free = await ctx.portFree(IDE_PORT)
      return free
        ? ok('ports/ide-port', '微信工具自动化端口', `${IDE_PORT} 空闲`)
        : fail({ checkId: 'ports/ide-port', level: 'warn', code: 'PT-EE-020', title: '微信工具自动化端口被占用', expected: `${IDE_PORT} 空闲（E2E 需要）`, actual: '被占用', fix: { description: '关闭占用该端口的进程（可能是残留 wechatide）' }, evidence: [{ note: `port ${IDE_PORT}: busy` }] })
    },
  },
]
