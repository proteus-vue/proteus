// tests/harmony-napi-registry.test.ts
// ★★★决策 #1156：**鸿蒙 napi 导出 ⇄ 类型声明 ⇄ HAR 入口 ⇄ ArkTS 使用** 一致性判据。
//
// 【为什么需要（本仓反复踩的同一形态）】
//   · #1121 `http.cancel`：宿主**早已实现并真机验过**，但没登记进 `host-invoke-contract`
//     ⇒ 门禁报「未知方法」、覆盖率数字低报。
//   · #1154 `http.tlsStats`：同一个坑；由 `check:host-invoke-contract` 抓出（45/46 → 46/47）。
//   · 本轮 #1156：给鸿蒙加 `hostTransportProbe` 时，**先写实现、后补 d.ts**——
//     而 C++ 编译门禁（`check:harmony-host-compile`）**只证明实现能编过**，
//     它看不见"ArkTS 侧能否 import 到它"（少一处声明 ⇒ 红线出现在**设备构建**，白跑一轮）。
//
// 【★真实的四层结构（第一版判据就在这里搞错了——把 HAR 入口当成 napi 模块）】
//     napi 实现  `proteus_host.cpp` 的 `napi_define_properties`（`libproteus_host.so`）
//   → 类型声明  `.../types/libproteus_host/index.d.ts`
//   → HAR 入口  `proteus_render/Index.ets` 的 `export { … } from 'libproteus_host.so'`
//   → ArkTS 用  `import { … } from 'proteus_render'`
//   ★`renderCommands` / `scrollRoot` / `setContentMode` 属**另一个** napi 模块（`libproteus_render.so`）；
//     第一版拿"ArkTS 用到的名字"去比 `libproteus_host` 的 d.ts ⇒ 报了一串**假红**
//     （它们本就不该在那个文件里）。⇒ 判据必须按**模块归属**分流，不能一把抓。
//
// 【诚实边界】本条只验**名字集合**（不验签名类型）：napi 面的签名都是 `(json: string) => string`
//   风格，签名由 d.ts 与实现各自维护；真机跑通仍是最终判据。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CPP = path.join(ROOT, 'hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_host.cpp')
const DTS_HOST = path.join(ROOT, 'hosts/harmony/host-app/proteus_render/src/main/cpp/types/libproteus_host/index.d.ts')
const DTS_RENDER = path.join(ROOT, 'hosts/harmony/host-app/proteus_render/src/main/cpp/types/libproteus_render/index.d.ts')
const HAR_INDEX = path.join(ROOT, 'hosts/harmony/host-app/proteus_render/Index.ets')
const ARKTS = path.join(ROOT, 'hosts/harmony/host-app/entry/src/main/ets/shell/Superapp.ets')

/** napi 导出名（两种真实形态：#1156 起探针族用宏 `PROTEUS_PROBE_EXPORT(name, Handler)`） */
function registeredNames(src: string): Set<string> {
  const out = new Set<string>()
  // ① 字面量描述符 `{"name", nullptr, Handler, …}`
  for (const m of src.matchAll(/^\s*\{"([A-Za-z_][A-Za-z0-9_]*)"\s*,\s*nullptr\s*,\s*[A-Za-z_][A-Za-z0-9_]*/gm)) out.add(m[1])
  /**
   * ② 宏形态 `PROTEUS_PROBE_EXPORT(hostXxx, HostXxx)`。
   * 【为什么必须认它】`proteus_host.cpp` 已在 `check:file-size` 的存量棘轮上（只减不增），
   *   每加一个探针 +2 行就超基线 ⇒ 探针族改用宏折成一行。而**判据不认新形态** ⇒
   *   报「未注册 hostTransportProbe」（实测：本判据自己红了两次，每次都因为"看的是旧形态"）。
   *   ★这是"门禁的覆盖面必须跟着实际形态走"的又一次实证（AGENTS.md 已记过同族：
   *     `pnpm verify` 内部再调 vitest ⇒ 外层 `deny-blind-tests` 看不见）。
   */
  for (const m of src.matchAll(/PROTEUS_PROBE_EXPORT\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*,/g)) out.add(m[1])
  return out
}

/** d.ts 的 `export const <name>` */
function declaredNames(src: string): Set<string> {
  return new Set([...src.matchAll(/^export const ([A-Za-z_][A-Za-z0-9_]*)\s*:/gm)].map((m) => m[1]))
}

/** HAR 入口：按来源模块分组的重导出名 `{ 'libproteus_host.so': Set, 'libproteus_render.so': Set }` */
function harExports(src: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  // ★★★必须用「非贪婪 + 锚到 `} from '模块'`」而不是 `[^}]*`：
  //   重导出块里**逐行带 ★ 注释**，其中一条是 `按下态直写 RenderNode（{} ⇒ 还原）`——
  //   里面就有 `{}` ⇒ `[^}]*` 会在那里提前截断，整块解析成空
  //   （本轮实测：`libproteus_render.so` 被解析成 0 项 ⇒ 误报 7 个"未重导出"假红）。
  //   ★这是"判据自己的解析器"第 N 次出问题：**先证解析器有效**（见测试 ①）再谈结论。
  for (const m of src.matchAll(/export\s*\{([\s\S]*?)\}\s*from\s*'([^']+)'/g)) {
    const mod = m[2]
    if (!out.has(mod)) out.set(mod, new Set())
    const set = out.get(mod)!
    // 先整块去掉行注释，再按逗号切（注释里也可能有逗号与花括号）
    for (const raw of m[1].replace(/\/\/[^\n]*/g, '').split(',')) {
      const name = raw.trim().split(/\s+as\s+/)[0].trim()
      if (name) set.add(name)
    }
  }
  return out
}

/** ArkTS 的 `import { … } from 'proteus_render'` */
function importedFromHar(src: string): Set<string> {
  const out = new Set<string>()
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'proteus_render'/g)) {
    for (const raw of m[1].split(',')) {
      const name = raw.trim().split(/\s+as\s+/)[0].trim()
      if (name) out.add(name)
    }
  }
  return out
}

describe('★★★#1156 鸿蒙 napi ⇄ d.ts ⇄ HAR 入口 ⇄ ArkTS 四方一致', () => {
  const registered = registeredNames(fs.readFileSync(CPP, 'utf8'))
  const declaredHost = declaredNames(fs.readFileSync(DTS_HOST, 'utf8'))
  const declaredRender = declaredNames(fs.readFileSync(DTS_RENDER, 'utf8'))
  const exports = harExports(fs.readFileSync(HAR_INDEX, 'utf8'))
  const imported = importedFromHar(fs.readFileSync(ARKTS, 'utf8'))

  it('① 解析器自证有效（防"正则没命中 ⇒ 空集恒真"的假绿）', () => {
    expect(registered.size).toBeGreaterThan(10)
    expect(declaredHost.size).toBeGreaterThan(10)
    expect(declaredRender.size).toBeGreaterThan(5)
    expect(exports.size).toBeGreaterThanOrEqual(2)
    expect(imported.size).toBeGreaterThan(5)
  })

  it('② 每个 `proteus_host` napi 导出都有 d.ts 声明（缺 ⇒ ArkTS 编译期才报错，白跑一轮构建）', () => {
    const missing = [...registered].filter((n) => !declaredHost.has(n)).sort()
    expect(missing, `libproteus_host 缺 d.ts 声明：${missing.join(' ')}`).toEqual([])
  })

  it('③ HAR 从 `libproteus_host.so` 重导出的名字，必须在它自己的 d.ts 里（按模块归属分流）', () => {
    const fromHost = exports.get('libproteus_host.so') ?? new Set<string>()
    expect(fromHost.size).toBeGreaterThan(5)
    const missing = [...fromHost].filter((n) => !declaredHost.has(n)).sort()
    expect(missing, `HAR 重导出但 libproteus_host d.ts 缺：${missing.join(' ')}`).toEqual([])
  })

  it('④ HAR 从 `libproteus_render.so` 重导出的名字，必须在它自己的 d.ts 里', () => {
    const fromRender = exports.get('libproteus_render.so') ?? new Set<string>()
    expect(fromRender.size).toBeGreaterThan(5)
    const missing = [...fromRender].filter((n) => !declaredRender.has(n)).sort()
    expect(missing, `HAR 重导出但 libproteus_render d.ts 缺：${missing.join(' ')}`).toEqual([])
  })

  it('⑤ ArkTS 用到的名字必须被 HAR 入口重导出（缺 ⇒ 编译期红线）', () => {
    const surface = new Set<string>()
    for (const s of exports.values()) for (const n of s) surface.add(n)
    const missing = [...imported].filter((n) => !surface.has(n)).sort()
    expect(missing, `ArkTS 在 import 但 HAR 未重导出：${missing.join(' ')}`).toEqual([])
  })

  it('⑥ 传输层取证入口四层齐全（#1156 的具体契约）', () => {
    expect(registered.has('hostTransportProbe'), 'proteus_host.cpp 未注册 hostTransportProbe').toBe(true)
    expect(declaredHost.has('hostTransportProbe'), 'libproteus_host d.ts 缺 hostTransportProbe').toBe(true)
    expect(exports.get('libproteus_host.so')?.has('hostTransportProbe'), 'Index.ets 未重导出 hostTransportProbe').toBe(true)
    expect(imported.has('hostTransportProbe'), 'Superapp.ets 未 import hostTransportProbe').toBe(true)
  })

  it('⑦ 对照：既有 HTTP 探针入口四层仍齐全（防回归）', () => {
    for (const n of ['hostHttpProbe', 'hostAppRender', 'hostRtShellInstall']) {
      expect(registered.has(n), `未注册：${n}`).toBe(true)
      expect(declaredHost.has(n), `d.ts 缺：${n}`).toBe(true)
      expect(exports.get('libproteus_host.so')?.has(n), `Index.ets 未重导出：${n}`).toBe(true)
    }
  })
})
