// tests/cli-repo-conformance.test.ts
// ★G-42 B5（proteus-host-container-plan batches B5）：仓库治理 CLI（`proteus conformance --repo <dir>`）
//   · parseConformanceArgs --repo 解析（不破坏既有 --backend/--only）
//   · scanRepoDirectory：合规仓库 0 命中 / fork 仓库命中（G-42.6 严禁 fork 机器化）
//   · formatRepoReport：PASS/FAIL 判定
//   · checkCapabilityAuthorization：权限网关（敏感能力须宿主授权——G-28 协同）
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseConformanceArgs } from '../packages/cli/src/conformance'
import { scanRepoDirectory, formatRepoReport, collectSourceFiles } from '../packages/cli/src/repo-conformance'
import { checkCapabilityAuthorization, SENSITIVE_CAPABILITIES } from '@proteus-vue/render-backend'

describe('G-42 B5 parseConformanceArgs --repo', () => {
  it('--repo <dir> 解析；无 --repo 时不产生字段（不破坏既有断言）', () => {
    expect(parseConformanceArgs(['--repo', './host-repo'])).toEqual({ repoDir: './host-repo' })
    expect(parseConformanceArgs(['--backend', './x.js#createBackend', '--only', 'C-03'])).toEqual({ backendSpec: './x.js#createBackend', only: 'C-03' })
    expect(parseConformanceArgs(['--repo', './r', '--only', 'C-08'])).toEqual({ repoDir: './r', only: 'C-08' })
  })

  it('--repo 缺参数 → 报错', () => {
    expect(() => parseConformanceArgs(['--repo'])).toThrow(/--repo 需要目录/)
  })
})

describe('G-42 B5 scanRepoDirectory（目录级 fork 扫描）', () => {
  let tmp: string
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-repo-'))
  })
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  function write(rel: string, content: string): void {
    const p = path.join(tmp, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, content)
  }

  it('合规仓库 → 0 命中（PASS）', () => {
    write('src/main.js', "import { createContainer } from '@proteus/container';")
    write('app.config.json', '{"name":"host-app"}')
    const result = scanRepoDirectory(tmp)
    expect(result.hits).toHaveLength(0)
    const { ok } = formatRepoReport(tmp, result)
    expect(ok).toBe(true)
  })

  it('fork 仓库 → 命中（FAIL；指纹文件+pattern 列出）', () => {
    write('vendor/core.js', "import x from '@proteus/core/internal/diff';")
    write('src/main.js', 'console.log(__PROTEUS_FORKED__)')
    const result = scanRepoDirectory(tmp)
    expect(result.hits.length).toBeGreaterThan(0)
    const { ok, text } = formatRepoReport(tmp, result)
    expect(ok).toBe(false)
    expect(text).toContain('vendor/core.js')
    expect(text).toContain('G-42.6')
  })

  it('跳过 node_modules/.git/dist（不误报依赖自身的目录）', () => {
    write('node_modules/@proteus-vue/core/internal/x.js', 'FORK_FINGERPRINT_PLACEHOLDER packages/core/src/')
    write('dist/bundle.js', 'packages/core/src/renderer')
    write('src/ok.js', 'import { createContainer } from "@proteus/container";')
    const result = scanRepoDirectory(tmp)
    expect(result.hits).toHaveLength(0)
    // collectSourceFiles 也应跳过
    const files = collectSourceFiles(tmp)
    expect(files.every((f) => !f.includes('node_modules') && !f.includes('dist'))).toBe(true)
  })
})

describe('G-42 B5 checkCapabilityAuthorization（权限网关——敏感能力须宿主授权）', () => {
  it('敏感能力未授权 → G39_AUTH 拒绝（location/camera 等）', () => {
    const r = checkCapabilityAuthorization(['storage', 'location'], { granted: ['storage'] })
    expect(r).toMatchObject({ ok: false, code: 'G39_AUTH', denied: ['location'] })
  })

  it('已授权 → 放行；非敏感能力不要求授权', () => {
    expect(checkCapabilityAuthorization(['storage', 'camera'], { granted: ['storage', 'camera'] }).ok).toBe(true)
    expect(checkCapabilityAuthorization(['fetch', 'analytics'], { granted: [] }).ok).toBe(true)
  })

  it('SENSITIVE_CAPABILITIES 含定位/相机/通讯录等敏感集', () => {
    for (const c of ['location', 'camera', 'contacts', 'payment', 'biometric']) {
      expect(SENSITIVE_CAPABILITIES).toContain(c)
    }
  })
})