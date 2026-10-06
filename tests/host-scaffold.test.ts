// tests/host-scaffold.test.ts —— ★★★hosts 第二刀 Stage 2：`proteus create host` 生成器纯函数测试
//
// 【这张测试锁什么】`createHost`（最小宿主工程生成器）——判据：
//   ① 模板复制 + `{{appName}}`/`{{bundleName}}` 替换（AppScope/app.json5 含真包名）
//   ② 结构完整：AppScope / entry（最小壳 EntryAbility+MainPage）/ hvigorfile / build-profile.template
//   ③ runtime（HAR）复制：注入 runtimeDir → 落到 proteus_render/，排除构建产物（build/、BuildProfile.ets）
//   ④ 编译产物拷入：注入 projectRoot（含 dist/app/harmony/screen-content.json）→ rawfile/app-screen-content.json
//   ⑤ 最小壳**不依赖 dev**（无 superapp/bench 字符串——壳只用 runtime 通道）
//   ⑥ 参数解析 / 包名派生
import { describe, it, expect, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHost, parseCreateHostArgs, deriveBundleName } from '../packages/cli/src/host-scaffold'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-host-'))
const TEMPLATES = path.resolve('packages/cli/templates-host/harmony')

afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true })
})

/** 造一个假的 runtime（HAR）源目录：含 CMakeLists + 一个源 + 一个应排除的构建产物 */
function makeFakeRuntime(dir: string): string {
  fs.mkdirSync(path.join(dir, 'src/main/cpp/types/libproteus_render'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'build/default/intermediates'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'src/main/cpp/CMakeLists.txt'), 'project(proteus_render)\n')
  fs.writeFileSync(path.join(dir, 'src/main/cpp/proteus_render.cpp'), '// rt\n')
  fs.writeFileSync(path.join(dir, 'Index.ets'), 'export {}\n')
  fs.writeFileSync(path.join(dir, 'BuildProfile.ets'), '// generated\n') // 应被排除
  fs.writeFileSync(path.join(dir, 'build/default/intermediates/x.so'), 'bin') // 应被排除
  return dir
}

/** 造一个假项目根（含 harmony 屏内容产物） */
function makeFakeProject(dir: string): string {
  fs.mkdirSync(path.join(dir, 'dist/app/harmony'), { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'dist/app/harmony/screen-content.json'),
    JSON.stringify({ index: { nodes: [{ id: 1, tag: 'view' }] } }),
  )
  return dir
}

describe('createHost（最小宿主工程生成）', () => {
  it('复制模板并替换 {{appName}}/{{bundleName}}', () => {
    const rt = makeFakeRuntime(path.join(TMP, 'rt1'))
    const r = createHost({
      platform: 'harmony',
      targetDir: path.join(TMP, 'h1'),
      appName: 'MyApp',
      bundleName: 'com.acme.myapp',
      templatesDir: TEMPLATES,
      runtimeDir: rt,
    })
    expect(r.ok).toBe(true)
    const app = JSON.parse(fs.readFileSync(path.join(r.targetDir, 'AppScope/app.json5'), 'utf-8'))
    expect(app.app.bundleName).toBe('com.acme.myapp')
    const str = fs.readFileSync(path.join(r.targetDir, 'AppScope/resources/base/element/string.json'), 'utf-8')
    expect(str).toContain('MyApp')
    // 无未替换占位
    const ohpkg = fs.readFileSync(path.join(r.targetDir, 'oh-package.json5'), 'utf-8')
    expect(ohpkg).not.toContain('{{')
  })

  it('结构完整：最小壳（EntryAbility + MainPage）+ 构建配置', () => {
    const r = createHost({
      platform: 'harmony',
      targetDir: path.join(TMP, 'h2'),
      appName: 'X',
      bundleName: 'com.acme.x',
      templatesDir: TEMPLATES,
      runtimeDir: makeFakeRuntime(path.join(TMP, 'rt2')),
    })
    const rel = new Set(r.files)
    expect(rel.has('oh-package.json5')).toBe(true)
    expect(rel.has('hvigorfile.ts')).toBe(true)
    expect(rel.has('build-profile.template.json5')).toBe(true)
    expect(rel.has('entry/src/main/ets/shell/EntryAbility.ets')).toBe(true)
    expect(rel.has('entry/src/main/ets/shell/MainPage.ets')).toBe(true)
    expect(rel.has('entry/src/main/module.json5')).toBe(true)
    expect(rel.has('proteus.host.json')).toBe(true)
    expect(rel.has('entry/src/main/cpp/CMakeLists.txt')).toBe(true)
    // 最小壳不依赖 dev 装置
    const ability = fs.readFileSync(path.join(r.targetDir, 'entry/src/main/ets/shell/EntryAbility.ets'), 'utf-8')
    expect(ability).toContain("from 'proteus_render'")
    expect(ability).not.toMatch(/superapp|proteus_bench|libproteus_bench/)
    const page = fs.readFileSync(path.join(r.targetDir, 'entry/src/main/ets/shell/MainPage.ets'), 'utf-8')
    expect(page).toContain('appScreenCommands')
    expect(page).not.toMatch(/superapp|proteus_bench/)
  })

  it('runtime（HAR）复制：落 proteus_render/，排除构建产物', () => {
    const r = createHost({
      platform: 'harmony',
      targetDir: path.join(TMP, 'h3'),
      appName: 'X',
      bundleName: 'com.acme.x',
      templatesDir: TEMPLATES,
      runtimeDir: makeFakeRuntime(path.join(TMP, 'rt3')),
    })
    expect(fs.existsSync(path.join(r.targetDir, 'proteus_render/src/main/cpp/CMakeLists.txt'))).toBe(true)
    expect(fs.existsSync(path.join(r.targetDir, 'proteus_render/Index.ets'))).toBe(true)
    // 排除项
    expect(fs.existsSync(path.join(r.targetDir, 'proteus_render/BuildProfile.ets'))).toBe(false)
    expect(fs.existsSync(path.join(r.targetDir, 'proteus_render/build'))).toBe(false)
    expect(r.runtimeDir).toBeTruthy()
  })

  it('编译产物拷入 rawfile（projectRoot 有 dist/app/harmony/screen-content.json）', () => {
    const r = createHost({
      platform: 'harmony',
      targetDir: path.join(TMP, 'h4'),
      appName: 'X',
      bundleName: 'com.acme.x',
      templatesDir: TEMPLATES,
      runtimeDir: makeFakeRuntime(path.join(TMP, 'rt4')),
      projectRoot: makeFakeProject(path.join(TMP, 'proj4')),
    })
    expect(r.screenContentCopied).toBe(true)
    const sc = JSON.parse(fs.readFileSync(path.join(r.targetDir, 'entry/src/main/resources/rawfile/app-screen-content.json'), 'utf-8'))
    expect(sc.index.nodes.length).toBe(1)
    // 占位 .gitkeep 已移除（有真产物）
    expect(fs.existsSync(path.join(r.targetDir, 'entry/src/main/resources/rawfile/.gitkeep'))).toBe(false)
  })

  it('目标目录非空 ⇒ 报错（不覆盖）', () => {
    const dir = path.join(TMP, 'h5')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'keep.txt'), 'x')
    expect(() =>
      createHost({
        platform: 'harmony',
        targetDir: dir,
        appName: 'X',
        bundleName: 'com.acme.x',
        templatesDir: TEMPLATES,
        runtimeDir: makeFakeRuntime(path.join(TMP, 'rt5')),
      }),
    ).toThrow(/非空/)
  })
})

describe('parseCreateHostArgs / deriveBundleName', () => {
  it('解析平台 + 目录 + 选项', () => {
    const a = parseCreateHostArgs(['harmony', 'host/harmony', '--name', 'Foo', '--bundle', 'com.acme.foo'])
    expect(a.platform).toBe('harmony')
    expect(a.targetDir).toBe('host/harmony')
    expect(a.appName).toBe('Foo')
    expect(a.bundleName).toBe('com.acme.foo')
  })
  it('未知平台报错', () => {
    expect(() => parseCreateHostArgs(['android', 'x'])).toThrow(/支持/)
  })
  it('包名派生（slug + reverse-DNS）', () => {
    expect(deriveBundleName('My Cool App')).toBe('com.example.my.cool.app')
    expect(deriveBundleName('')).toBe('com.example.app')
  })
})
