// tests/harmony-fs-capability.test.ts
// ★★★#1210：鸿蒙 **`fs.*` 能力通道**的真机判据（三端对齐的地基）。
//
// 【它守什么】`fs.writeBytes` / `fs.readBytes` / `fs.remove` 在 Android/iOS 早已实现
//   （`FileTransferCapability` / `file-transfer-capability.swift`），鸿蒙一直缺这三个方法。
//   后果不是"少一个能力"，而是**下游一批能力整端不可用**：`getStorage` 在鸿蒙如实 unsupported
//   就是直接后果（#1209 的诚实边界）。
//
// 【★判据为什么必须看"逐字节 + 沙箱外侧"，而不是"方法能调通"】
//   · 只看 `ok:true` 会漏掉最危险的两类：**内容被改**（长度对但字节错）与**沙箱逃逸**
//     （写到沙箱外的用户数据/系统目录）。⇒ G2 逐字节比对，G4 还要核**沙箱外确实没有该文件**。
//   · G4 的两条（绝对路径 / `..`）必须都拒：只测一种的话，另一种落了都没人知道。
//
// 【★与 Android/iOS 的契约一致性（逐条对齐，不允许各写一套）】
//   方法名 / 参数 / 返回形状取自 `FileTransferCapability.java`：
//     `fs.writeBytes {path,bytes}` → `{path,size}` · `fs.readBytes {path}` → `{bytes,size}`
//     · `fs.remove {path}` → `{}`（**幂等**）
//
// 【诚实边界】
//   ① 只测 12 字节载荷（含边界字节 0/1/127/128/255）；**没有**测大文件（> 64 MiB 上限只核语义）；
//   ② 设备侧"沙箱外无逃逸文件"是**手工 hdc 核对**（记录在工作日志），本文件只断言回执 `ok:false`；
//   ③ 本判据跑的是"帧 → 通用能力分发 → 宿主方法"，与业务 `useStorage` 走同一通道，
//      但**不含** JS 侧封装（那由 `capability-app-storage.test.ts` 覆盖）。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), 'utf8')
const RES = 'hosts/harmony/results'
const WRITE = `${RES}/fs-probe-write.json`
const READ = `${RES}/fs-probe-read.json`
const REMOVE = `${RES}/fs-probe-remove-idempotent.json`
const ESC_ABS = `${RES}/fs-probe-escape-absolute.json`
const ESC_DOT = `${RES}/fs-probe-escape-dotdot.json`
const FS_H = 'hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_fs.h'

type Probe = { ok?: boolean; preview?: string; probe_diag?: string }
const load = (p: string): Probe => JSON.parse(read(p)) as Probe

/** 探针 preview 是宿主回执的 JSON 文本 */
const payloadOf = (p: string): { ok?: boolean; data?: Record<string, unknown>; reason?: string; missing?: boolean } =>
  JSON.parse(String(load(p).preview ?? '{}')) as {
    ok?: boolean
    data?: Record<string, unknown>
    reason?: string
    missing?: boolean
  }

/** 本单写入的测试载荷（非 ASCII 边界：0 / 1 / 127 / 128 / 255） */
const PAYLOAD = [0, 1, 127, 128, 255, 80, 82, 79, 84, 69, 85, 83]

describe('★★★#1210 鸿蒙 fs.* 能力通道（真机证据）', () => {
  it('★★★G1 写入：回执 {path,size} 且 size == 载荷长度', () => {
    expect(fs.existsSync(path.join(ROOT, WRITE)), `缺证据 ${WRITE}（跑 run-http-probe.sh --cap-method=fs.writeBytes）`).toBe(true)
    const p = payloadOf(WRITE)
    expect(p.ok, `★写入失败：${p.reason ?? ''}`).toBe(true)
    expect(String(p.data?.['path'] ?? ''), '★回执 path 不符').toBe('fs-probe/roundtrip.bin')
    expect(Number(p.data?.['size']), '★回执 size 与载荷长度不符').toBe(PAYLOAD.length)
  })

  it('★★★G2 读回**逐字节**等于写入内容（不是只看长度）', () => {
    expect(fs.existsSync(path.join(ROOT, READ)), `缺证据 ${READ}`).toBe(true)
    const p = payloadOf(READ)
    expect(p.ok, `★读取失败：${p.reason ?? ''}`).toBe(true)
    const bytes = p.data?.['bytes'] as number[] | undefined
    expect(Array.isArray(bytes), '★回执没有 bytes 数组').toBe(true)
    // ★核心：逐字节（长度对但内容错 = 坏的；UTF-8 编码错位 / &0xFF 截断都能被抓到）
    expect(bytes, `★读回的字节与写入不一致（期望 ${PAYLOAD.join(',')}，实得 ${(bytes ?? []).join(',')}）`).toEqual(PAYLOAD)
    expect(Number(p.data?.['size']), '★size 与 bytes 长度不符').toBe(PAYLOAD.length)
  })

  it('★★★G3 删除**幂等**：删两次都成功（与 Android/iOS 同语义）', () => {
    expect(fs.existsSync(path.join(ROOT, REMOVE)), `缺证据 ${REMOVE}`).toBe(true)
    const p = payloadOf(REMOVE)
    // ★"删不存在的文件也算成功"是**契约**（清理路径不该因文件已不在而失败）；
    //   若实现改成"不存在就报错"，这条会红——那是三端语义分叉。
    expect(p.ok, `★第二次删除失败（应幂等）：${p.reason ?? ''}`).toBe(true)
  })

  it('★★★G4 沙箱逃逸**两种都拒**（绝对路径 + `..` 穿越）', () => {
    for (const [file, label] of [
      [ESC_ABS, '绝对路径'],
      [ESC_DOT, '`..` 穿越'],
    ] as const) {
      expect(fs.existsSync(path.join(ROOT, file)), `缺证据 ${file}（${label} 组）`).toBe(true)
      const p = payloadOf(file)
      expect(p.ok, `★${label}没有被拒绝 ⇒ 可写到沙箱外（安全缺陷）`).toBe(false)
      // ★必须是 failed 而不是 missing：missing 会让业务误判"本端无此能力"
      expect(p.missing, `★${label} 被报成 missing（应 failed：能力存在但参数非法）`).not.toBe(true)
      expect(String(p.reason ?? ''), `★${label} 的拒绝原因没点明"沙箱相对路径"`).toContain('沙箱相对路径')
    }
  })

  it('★★实现要点：沙箱校验复用同一份（不各写一套）+ 原子写 + 读上限', () => {
    const h = read(FS_H)
    /**
     * ★去注释后再断言——本文件第一版直接对原文匹配 `/fsSandboxRoot\s*\(/`，
     *   结果命中的是**注释里**那句"为什么不新建 fsSandboxRoot()"的说明 ⇒ 假红。
     *   这与本仓记过多次的「正则命中注释」同源（#1191 J1/J2、#1203 的 tlsError 断言）。
     */
    const code = h
      .replace(/\/\*[\s\S]*?\*\//g, '')   // 块注释
      .replace(/^\s*\/\/.*$/gm, '')       // 整行行注释
    // ★沙箱根与路径校验必须复用既有实现（两份必然漂移，而这是安全边界）
    /**
     * ★★★**必须逐方法计数**（本文件第一版只断言"文件里出现了 resolveSandboxPath"）：
     *   `fs.writeBytes` / `fs.readBytes` / `fs.remove` **三个方法各自都要校验**，
     *   只留一处也能喂绿 —— 实测变异（把 writeBytes 那处的 resolveSandboxPath 换成裸拼路径）
     *   在第一版判据下**全绿**，而那就是"写可以逃逸、读不能"的严重不对称。
     *   ⇒ 计数必须 **>= 3**（三个方法各一次）。
     */
    const sandboxChecks = (code.match(/resolveSandboxPath\(/g) ?? []).length
    expect(sandboxChecks, `★沙箱校验调用只出现 ${sandboxChecks} 次（writeBytes/readBytes/remove 应各一次 ⇒ 至少 3）`).toBeGreaterThanOrEqual(3)
    expect(code, '★自己新开了沙箱根状态（应复用 httpSandboxRoot 这一份事实来源）').not.toMatch(/fsSandboxRoot\s*\(/)
    // ★写入原子性：`.part` + rename（业务永远看不到半个文件）
    expect(code, '★写入不是原子替换（中断会留半个文件）').toMatch(/\.part/)
    expect(code, '★写后没 fsync（掉电可能丢）').toMatch(/::fsync\(::fileno\(fp\)\)/)
    // ★读上限与 Android/iOS 同值 64 MiB
    expect(code, '★读上限不是 64 MiB（与 Android/iOS 不一致）').toMatch(/64LL\s*\*\s*1024LL\s*\*\s*1024LL/)
  })

  it('★★档位正确：fs.* 真的接进能力分发（不是"写了没人调"）', () => {
    const impl = read('hosts/harmony/host-app/proteus_render/src/main/cpp/host_app_runtime_impl.h')
    expect(impl, '★fs.* 没有接进 screenInvokeDispatch（写了但没人调 = 静默失效）').toMatch(
      /method\.rfind\("fs\.", 0\) == 0\)\s*\{\s*std::string o;\s*if \(proteus::fs::dispatch/,
    )
  })
})
