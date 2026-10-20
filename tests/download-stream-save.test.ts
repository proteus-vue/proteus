// tests/download-stream-save.test.ts
// ★★★#1119：download **流式落盘**（S3）的契约判据
//
// 【要证明什么（四件，缺一件都不算 S3）】
//   ① **JS 侧不碰字节**：`responseType:'path'` 必须走 `savePath` meta，**不得**再要求 `arraybuffer`
//      ★这条是"内存与文件大小解耦"的**结构证据**——只要还在拿 arraybuffer，就一定是整包驻留；
//   ② **不再有 JS 侧写盘**：宿主直写后 JS 不得再调 `fs.writeBytes`（那会把字节搬进 JS 堆）；
//   ③ **三端摘要形态都要能解析**：宿主可能回对象、也可能回字符串化 JSON；
//   ④ **路径校验同规则**：Android/iOS 都必须拒绝绝对路径与 `..`（分叉 = 迟早一边漏）。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), 'utf8')

const TRANSFER = 'packages/api/src/capability-transfer.ts'
const INVOKE = 'packages/api/src/capability-invoke.ts'
const ANDROID_HTTP = 'hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/HttpCapability.java'
const IOS_HTTP = 'hosts/ios/ProteusHost/runtime/http-capability.swift'
const ANDROID_FS = 'hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/FileTransferCapability.java'

describe('★#1119 download 流式落盘 · JS 侧契约', () => {
  it('★`path` 语义必须带 savePath（不得再要求 arraybuffer）', () => {
    const s = read(TRANSFER)
    const start = s.indexOf('export function createAppDownload')
    expect(start, '找不到 createAppDownload').toBeGreaterThan(0)
    const seg = s.slice(start, start + 2600)
    expect(seg, '★未声明 savePath ⇒ download 仍整包进 JS 内存').toMatch(/savePath/)
    // ★关键：path 分支不得再出现 responseType:'arraybuffer'（那意味着整包回推）
    const pathBranch = seg.slice(seg.indexOf('if (wantPath)'), seg.indexOf('const responseType'))
    expect(pathBranch, '★path 分支仍要求 arraybuffer（整包回推）').not.toMatch(/arraybuffer/)
  })

  it('★不再是"JS 收字节 → 调 fs.writeBytes 写盘"', () => {
    const s = read(TRANSFER)
    // ★只查**代码行**（注释里保留着历史说明"曾经这么干过"，那是文档不是实现）
    const code = s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
    expect(code, '★仍在 JS 侧写盘（writeToHost 已删）').not.toMatch(/writeToHost\s*\(/)
  })

  it('内部 savePath 是沙箱相对路径（不拼绝对路径）', () => {
    const s = read(TRANSFER)
    expect(s, '内部落盘路径应以 download/ 开头（沙箱相对）').toMatch(/`download\/\$\{Date\.now\(\)\}/)
  })
})

describe('★#1119 线格式 · savePath', () => {
  it('TS 侧 tag 9 编解码往返', () => {
    // ★tag 定义在 invoke-wire.ts（线格式 SSOT），InvokeMeta 字段在 capability-invoke.ts
    const w = read('packages/api/src/invoke-wire.ts')
    const s = read(INVOKE)
    expect(w, '缺 SavePath tag').toMatch(/SavePath:\s*9,?/)
    expect(w, 'encode 未写 SavePath TLV').toMatch(/MetaTagInvoke\.SavePath/)
    expect(s, 'savePath 未进 InvokeMeta').toMatch(/savePath\?: string/)
    expect(s, 'splitFramePayload 未识别 savePath（会被当成 body 字段）').toMatch(/META_STR = \['url', 'contentType', 'savePath'\]/)
    expect(w, 'decode 未读 SavePath TLV').toMatch(/case MetaTagInvoke\.SavePath/)
  })

  it('五端都用同一个 tag 号（9）', () => {
    expect(read('hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/InvokeWire.java'), 'Java').toMatch(/TAG_SAVE_PATH = 9/)
    expect(read('hosts/ios/ProteusHost/runtime/InvokeWire.swift'), 'Swift').toMatch(/TAG_SAVE_PATH: UInt8 = 9/)
    expect(read('hosts/harmony/host-app/entry/src/main/ets/runtime/InvokeWire.ts'), 'ArkTS').toMatch(/TAG_SAVE_PATH: number = 9/)
    expect(read('hosts/harmony/host-app/proteus_render/src/main/cpp/invoke_wire.h'), 'C++').toMatch(/TAG_SAVE_PATH = 9/)
  })
})

describe('★#1119 宿主实现 · 边收边写', () => {
  it('Android：边收边写盘（不攒整包）+ 峰值块约束', () => {
    const s = read(ANDROID_HTTP)
    expect(s, '缺落盘路径分支').toMatch(/performSaveToFile/)
    // ★断言**分发调用点**，不是符号名——只查符号名的话，把分支关掉（if (false)）也会绿
    //   （本轮破坏性验证实测踩到）
    expect(s, '★savePath 分支未真正分发到落盘（`if (false)` 也能过符号名断言）').toMatch(
      /f\.savePath != null && !f\.savePath\.isEmpty\(\)[\s\S]{0,400}performSaveToFile\(f, url, method, timeoutMs\)/,
    )
    const start = s.indexOf('private static InvokeWire.ResolveFrame performSaveToFile')
    expect(start, '找不到 performSaveToFile').toBeGreaterThan(0)
    const seg = s.slice(start, start + 8000)
    // ★核心：不得 readAll（那会攒整包）
    expect(seg, '★落盘路径仍在攒整包（readAll）').not.toMatch(/readAll\(/)
    expect(seg, '落盘路径未边收边写').toMatch(/os\.write\(buf, 0, n\)/)
    expect(seg, '缺峰值块记账（判据无法证明内存与文件无关）').toMatch(/peakChunkBytes/)
    // 超限要删残包（不静默留半截文件）
    expect(seg, '超限/失败未清残包').toMatch(/out\.delete\(\)/)
  })

  it('Android：落盘路径复用 fs 的沙箱校验（不另写一份）', () => {
    const s = read(ANDROID_HTTP)
    expect(s, '落盘未复用 FileTransferCapability.resolve').toMatch(/FileTransferCapability\.resolve/)
    const fsSrc = read(ANDROID_FS)
    expect(fsSrc, 'resolve 应放宽为包内可见（HTTP 要用同一份）').toMatch(/^\s{4}static File resolve\(Context ctx, String path\)/m)
  })

  it('Android：appContext 必须真的被注入（否则落盘恒报上下文不可用）', () => {
    const s = read('hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/HostCapabilities.java')
    expect(s, '★未注入 appContext ⇒ setAppContext 是死代码').toMatch(/HttpCapability\.setAppContext\(activity\)/)
  })

  it('iOS：边收边写 + 同样的路径校验规则', () => {
    const s = read(IOS_HTTP)
    expect(s, '缺落盘注册').toMatch(/registerSaving/)
    expect(s, '缺沙箱解析').toMatch(/static func sandboxFile/)
    const start = s.indexOf('static func sandboxFile')
    const seg = s.slice(start, start + 900)
    expect(seg, '★未拒绝绝对路径（两端规则必须一致）').toMatch(/hasPrefix\("\/"\)/)
    expect(seg, '★未拒绝 ..').toMatch(/seg == "\.\."/)
    expect(s, '落盘未边收边写').toMatch(/savedHandle\?\.write\(data\)/)
    // 超限删残包
    expect(s, '超限未删残包').toMatch(/removeItem\(at: target\)/)
  })

  it('两端落盘上限同值（1 GiB）', () => {
    expect(read(ANDROID_HTTP), 'Android').toMatch(/MAX_SAVE_BYTES = 1024L \* 1024 \* 1024/)
    expect(read(IOS_HTTP), 'iOS').toMatch(/MAX_SAVE_BYTES = 1024 \* 1024 \* 1024/)
  })
})

describe('★#1119 探针装置', () => {
  it('探针必须检查"JS 不碰字节"与"峰值块与文件无关"', () => {
    const s = read('hosts/shared/bridge/entry-superapp-probes.ts')
    expect(s, '缺 appSaveProbe').toMatch(/export function appSaveProbe/)
    expect(s, '★未检查 data 是路径（无法证明 JS 不碰字节）').toMatch(/data_is_path/)
    expect(s, '未校验读回内容').toMatch(/readback_mismatch/)
  })

  it('判据脚本必须断言峰值块远小于文件大小', () => {
    const s = read('hosts/android/run-save-probe.sh')
    expect(s, '缺峰值块断言').toMatch(/peak_chunk_bytes/)
    // ★默认文件要够大（4 KiB 测不出整包驻留 vs 边收边写）
    expect(s, '默认样本太小（测不出差别）').toMatch(/SIZE_MIB="\$\{PROTEUS_SAVE_PROBE_SIZE_MIB:-8\}"/)
  })
})
