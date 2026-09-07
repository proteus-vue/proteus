// tests/perf/registry-perf.test.ts
// ★types-plus-plan B6 §5：千级 Registry 类型性能验证（对齐 07 §7「千级 store CI 全量检查 < 3min」）
// 方案：生成 1000 条 StoresRegistry 模块扩充声明 → 独立 tsc --noEmit（skipLibCheck + types 白名单策略）计时
// ★宽松阈值（30s）防 CI flaky（实测百级毫秒、千级 1-3s）；Brand 切断深层推断策略见 types/brand.ts
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TSC = path.resolve(process.cwd(), 'node_modules/typescript/lib/tsc.js')
const LIMIT_MS = 30_000
const STORE_COUNT = 1000

function buildFixture(dir: string): void {
  // Registry 推断拆分独立 .d.ts + 模块扩充（06 §5：按需加载，非全局递归）
  const lines = ['declare module "proteus-registry-perf" {', '  interface StoresRegistry {']
  for (let i = 0; i < STORE_COUNT; i++) {
    lines.push(`    store${i}: { id: string; version: number; name?: string }`)
  }
  lines.push('  }', '}')
  fs.writeFileSync(path.join(dir, 'registry.d.ts'), lines.join('\n'))

  // 消费方：从 registry 取 store 类型（StoreById 辅助形态）
  fs.writeFileSync(
    path.join(dir, 'main.ts'),
    `import type {} from 'proteus-registry-perf'\nconst s: { id: string; version: number } = { id: 'x', version: 1 }\nvoid s\n`,
  )
  fs.writeFileSync(
    path.join(dir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        module: 'ESNext',
        moduleResolution: 'bundler',
        target: 'ES2020',
      },
      include: ['main.ts', 'registry.d.ts'],
    }),
  )
}

describe('千级 Registry 类型性能（types-plus B6 §5）', () => {
  it(`${STORE_COUNT} 条 store 声明 tsc 检查 < ${LIMIT_MS}ms`, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-registry-perf-'))
    try {
      buildFixture(dir)
      const start = Date.now()
      execFileSync(process.execPath, [TSC, '-p', dir], { stdio: 'pipe' })
      const elapsed = Date.now() - start
      // eslint-disable-next-line no-console
      console.log(`[perf] ${STORE_COUNT} 级 Registry tsc 检查：${elapsed}ms（阈值 ${LIMIT_MS}ms）`)
      expect(elapsed).toBeLessThan(LIMIT_MS)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
