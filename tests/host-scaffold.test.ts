// tests/host-scaffold.test.ts —— ★★★hosts 第二/三刀：`proteus create host` 生成器纯函数测试
//
// 【这张测试锁什么】`createHost`（最小宿主工程生成器，harmony + ios 两端）——判据：
//   ① 模板复制 + `{{appName}}`/`{{bundleName}}`/`{{bundleId}}` 替换
//   ② 结构完整（逐端）
//   ③ runtime 单元复制（harmony=HAR 目录；ios=**多源集** runtime/ + platform/），排除构建产物
//   ④ 编译产物拷入（逐端落点）
//   ⑤ 最小壳**不依赖 dev**（无 superapp/bench/showcase 等）
//   ⑥ 参数解析 / 包名派生
import { describe, it, expect, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHost, parseCreateHostArgs, deriveBundleName } from '../packages/cli/src/host-scaffold'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-host-'))
const TPL_HARMONY = path.resolve('packages/cli/templates-host/harmony')
const TPL_IOS = path.resolve('packages/cli/templates-host/ios')
const TPL_ANDROID = path.resolve('packages/cli/templates-host/android')

afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true })
})

/** 造一个假的 harmony runtime（HAR）：含 CMakeLists + 源 + 应排除的构建产物 */
function makeFakeHarmonyRuntime(dir: string): string {
  fs.mkdirSync(path.join(dir, 'src/main/cpp/types/libproteus_render'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'build/default/intermediates'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'src/main/cpp/CMakeLists.txt'), 'project(proteus_render)\n')
  fs.writeFileSync(path.join(dir, 'src/main/cpp/proteus_render.cpp'), '// rt\n')
  fs.writeFileSync(path.join(dir, 'Index.ets'), 'export {}\n')
  fs.writeFileSync(path.join(dir, 'BuildProfile.ets'), '// generated\n') // 应被排除
  fs.writeFileSync(path.join(dir, 'build/default/intermediates/x.so'), 'bin') // 应被排除
  return dir
}

/** 造一个假的 ios runtime 源集（runtime/ + platform/） */
function makeFakeIosRuntime(runtimeDir: string, platformDir: string): void {
  fs.mkdirSync(runtimeDir, { recursive: true })
  fs.writeFileSync(path.join(runtimeDir, 'selfdraw-scene.swift'), '// engine\n')
  fs.writeFileSync(path.join(runtimeDir, 'proteus-host-controller.swift'), '// ctl\n')
  fs.mkdirSync(path.join(runtimeDir, 'build'), { recursive: true })
  fs.writeFileSync(path.join(runtimeDir, 'build/x.o'), 'bin') // 应被排除
  fs.mkdirSync(platformDir, { recursive: true })
  fs.writeFileSync(path.join(platformDir, 'ProteusTextAdapter.swift'), '// adapter\n')
}

/** 造一个假项目根（含 harmony 或 ios 屏内容产物） */
function makeFakeProject(dir: string, platform: 'harmony' | 'ios' | 'android'): string {
  fs.mkdirSync(path.join(dir, `dist/app/${platform}`), { recursive: true })
  fs.writeFileSync(path.join(dir, `dist/app/${platform}/screen-content.json`), JSON.stringify({ index: { nodes: [{ id: 1, tag: 'view' }] } }))
  return dir
}

/** 造一个假的 android runtime 产物目录（含 proteus-runtime.aar） */
function makeFakeAndroidRuntime(dir: string): string {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'proteus-runtime.aar'), 'PK\x03\x04fake-aar')
  return dir
}

describe('createHost · harmony（第二刀样板）', () => {
  it('复制模板并替换 {{appName}}/{{bundleName}}', () => {
    const r = createHost({
      platform: 'harmony',
      targetDir: path.join(TMP, 'h1'),
      appName: 'MyApp',
      bundleName: 'com.acme.myapp',
      templatesDir: TPL_HARMONY,
      runtimeDir: makeFakeHarmonyRuntime(path.join(TMP, 'rt-h1')),
    })
    const app = JSON.parse(fs.readFileSync(path.join(r.targetDir, 'AppScope/app.json5'), 'utf-8'))
    expect(app.app.bundleName).toBe('com.acme.myapp')
    expect(fs.readFileSync(path.join(r.targetDir, 'oh-package.json5'), 'utf-8')).not.toContain('{{')
  })

  it('结构完整 + runtime HAR 复制 + 排除构建产物', () => {
    const r = createHost({
      platform: 'harmony',
      targetDir: path.join(TMP, 'h2'),
      appName: 'X',
      bundleName: 'com.acme.x',
      templatesDir: TPL_HARMONY,
      runtimeDir: makeFakeHarmonyRuntime(path.join(TMP, 'rt-h2')),
    })
    const rel = new Set(r.files)
    for (const f of ['oh-package.json5', 'entry/src/main/ets/shell/EntryAbility.ets', 'entry/src/main/ets/shell/MainPage.ets', 'entry/src/main/cpp/CMakeLists.txt']) {
      expect(rel.has(f), f).toBe(true)
    }
    expect(fs.existsSync(path.join(r.targetDir, 'proteus_render/src/main/cpp/CMakeLists.txt'))).toBe(true)
    expect(fs.existsSync(path.join(r.targetDir, 'proteus_render/BuildProfile.ets'))).toBe(false)
    expect(fs.existsSync(path.join(r.targetDir, 'proteus_render/build'))).toBe(false)
    // 壳不依赖 dev
    const ability = fs.readFileSync(path.join(r.targetDir, 'entry/src/main/ets/shell/EntryAbility.ets'), 'utf-8')
    expect(ability).toContain("from 'proteus_render'")
    expect(ability).not.toMatch(/superapp|proteus_bench/)
  })

  it('编译产物拷入 rawfile', () => {
    const r = createHost({
      platform: 'harmony',
      targetDir: path.join(TMP, 'h3'),
      appName: 'X',
      bundleName: 'com.acme.x',
      templatesDir: TPL_HARMONY,
      runtimeDir: makeFakeHarmonyRuntime(path.join(TMP, 'rt-h3')),
      projectRoot: makeFakeProject(path.join(TMP, 'proj-h3'), 'harmony'),
    })
    expect(r.screenContentCopied).toBe(true)
    expect(fs.existsSync(path.join(r.targetDir, 'entry/src/main/resources/rawfile/app-screen-content.json'))).toBe(true)
  })
})

describe('createHost · ios（第三刀样板）', () => {
  it('复制模板 + 替换 {{appName}}/{{bundleId}}', () => {
    const rt = path.join(TMP, 'rt-i1'); const pf = path.join(TMP, 'pf-i1')
    makeFakeIosRuntime(rt, pf)
    const r = createHost({
      platform: 'ios',
      targetDir: path.join(TMP, 'i1'),
      appName: 'MyApp',
      bundleName: 'dev.acme.myapp',
      templatesDir: TPL_IOS,
      runtimeDirs: [rt, pf],
    })
    expect(r.ok).toBe(true)
    const plist = fs.readFileSync(path.join(r.targetDir, 'Info.plist'), 'utf-8')
    expect(plist).toContain('<string>dev.acme.myapp</string>')
    expect(plist).toContain('MyApp')
    expect(plist).not.toContain('{{')
  })

  it('结构完整 + 多源集复制（runtime/ + platform/）+ 排除构建产物', () => {
    const rt = path.join(TMP, 'rt-i2'); const pf = path.join(TMP, 'pf-i2')
    makeFakeIosRuntime(rt, pf)
    const r = createHost({
      platform: 'ios',
      targetDir: path.join(TMP, 'i2'),
      appName: 'X',
      bundleName: 'dev.acme.x',
      templatesDir: TPL_IOS,
      runtimeDirs: [rt, pf],
    })
    const rel = new Set(r.files)
    for (const f of ['Info.plist', 'proteus.host.json', 'shell/ProteusApp.swift']) expect(rel.has(f), f).toBe(true)
    expect(fs.existsSync(path.join(r.targetDir, 'runtime/selfdraw-scene.swift'))).toBe(true)
    expect(fs.existsSync(path.join(r.targetDir, 'runtime/proteus-host-controller.swift'))).toBe(true)
    expect(fs.existsSync(path.join(r.targetDir, 'platform/ProteusTextAdapter.swift'))).toBe(true)
    expect(fs.existsSync(path.join(r.targetDir, 'runtime/build'))).toBe(false) // 排除
    // 壳不依赖 dev（无 showcase/app-stack/host-runtime 场景）
    const app = fs.readFileSync(path.join(r.targetDir, 'shell/ProteusApp.swift'), 'utf-8')
    expect(app).toContain('ProteusHostController')
    expect(app).not.toMatch(/showcase|superapp|proteus_bench|HostRuntimeScene|ShowcaseScene/i)
  })

  it('编译产物拷入 app-screen-content.json', () => {
    const rt = path.join(TMP, 'rt-i3'); const pf = path.join(TMP, 'pf-i3')
    makeFakeIosRuntime(rt, pf)
    const r = createHost({
      platform: 'ios',
      targetDir: path.join(TMP, 'i3'),
      appName: 'X',
      bundleName: 'dev.acme.x',
      templatesDir: TPL_IOS,
      runtimeDirs: [rt, pf],
      projectRoot: makeFakeProject(path.join(TMP, 'proj-i3'), 'ios'),
    })
    expect(r.screenContentCopied).toBe(true)
    const sc = JSON.parse(fs.readFileSync(path.join(r.targetDir, 'app-screen-content.json'), 'utf-8'))
    expect(sc.index.nodes.length).toBe(1)
  })
})

describe('createHost · android（第四刀样板）', () => {
  it('复制模板 + 替换 {{appName}}（Manifest）', () => {
    const r = createHost({
      platform: 'android',
      targetDir: path.join(TMP, 'a1'),
      appName: 'MyApp',
      bundleName: 'dev.proteus.layoutcore',
      templatesDir: TPL_ANDROID,
      runtimeDirs: [makeFakeAndroidRuntime(path.join(TMP, 'rt-a1'))],
    })
    const mf = fs.readFileSync(path.join(r.targetDir, 'AndroidManifest.xml'), 'utf-8')
    expect(mf).toContain('MyApp')
    expect(mf).toContain('dev.proteus.layoutcore')       // 同包
    expect(mf).not.toContain('{{')
  })

  it('结构完整 + runtime AAR 落 libs/ + 壳不依赖 dev', () => {
    const r = createHost({
      platform: 'android',
      targetDir: path.join(TMP, 'a2'),
      appName: 'X',
      bundleName: 'dev.proteus.layoutcore',
      templatesDir: TPL_ANDROID,
      runtimeDirs: [makeFakeAndroidRuntime(path.join(TMP, 'rt-a2'))],
    })
    const rel = new Set(r.files)
    for (const f of ['AndroidManifest.xml', 'src/dev/proteus/layoutcore/AppActivity.java']) expect(rel.has(f), f).toBe(true)
    expect(fs.existsSync(path.join(r.targetDir, 'libs/proteus-runtime.aar'))).toBe(true)
    const app = fs.readFileSync(path.join(r.targetDir, 'src/dev/proteus/layoutcore/AppActivity.java'), 'utf-8')
    expect(app).toContain('VaporRenderHost')
    expect(app).not.toMatch(/superapp|MainActivity|LightsHost|showcase|morpheus/i)
  })

  it('编译产物拷入 assets', () => {
    const r = createHost({
      platform: 'android',
      targetDir: path.join(TMP, 'a3'),
      appName: 'X',
      bundleName: 'dev.proteus.layoutcore',
      templatesDir: TPL_ANDROID,
      runtimeDirs: [makeFakeAndroidRuntime(path.join(TMP, 'rt-a3'))],
      projectRoot: makeFakeProject(path.join(TMP, 'proj-a3'), 'android'),
    })
    expect(r.screenContentCopied).toBe(true)
    expect(fs.existsSync(path.join(r.targetDir, 'app/src/main/assets/app-screen-content.json'))).toBe(true)
  })
})

describe('createHost · 通用', () => {
  it('目标目录非空 ⇒ 报错（不覆盖）', () => {
    const rt = path.join(TMP, 'rt-g'); const pf = path.join(TMP, 'pf-g')
    makeFakeIosRuntime(rt, pf)
    const dir = path.join(TMP, 'g1')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'keep.txt'), 'x')
    expect(() => createHost({ platform: 'ios', targetDir: dir, appName: 'X', bundleName: 'dev.a.x', templatesDir: TPL_IOS, runtimeDirs: [rt, pf] })).toThrow(/非空/)
  })
})

describe('parseCreateHostArgs / deriveBundleName', () => {
  it('解析平台 + 目录 + 选项（harmony / ios 都合法）', () => {
    expect(parseCreateHostArgs(['harmony', 'host/harmony', '--name', 'Foo']).platform).toBe('harmony')
    expect(parseCreateHostArgs(['android', 'host/android']).platform).toBe('android')
    const a = parseCreateHostArgs(['ios', 'host/ios', '--name', 'Bar', '--bundle', 'dev.acme.bar'])
    expect(a.platform).toBe('ios')
    expect(a.bundleName).toBe('dev.acme.bar')
  })
  it('未知平台报错', () => {
    expect(() => parseCreateHostArgs(['harmony2', 'x'])).toThrow(/支持/)
  })
  it('包名派生（slug + reverse-DNS）', () => {
    expect(deriveBundleName('My Cool App')).toBe('com.example.my.cool.app')
    expect(deriveBundleName('', 'dev')).toBe('dev.example.app')
  })
})
