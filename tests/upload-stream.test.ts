// tests/upload-stream.test.ts
// ★★★#1120：**流式上传**（S3）的契约判据
//
// 【要证明什么（四件，缺一件都不算 S3）】
//   ① **JS 侧不碰文件字节**：走 `upload` meta，不调 `fs.readBytes`、不传 `data`；
//   ② **boundary 只生成一次**：头里的与 meta 里的必须一致（两次生成必然对不上 ⇒ 服务端解析不出文件）；
//   ③ **宿主边读边发**：不得攒整包（不用 readAll 读文件），且要能预知总长（定长而非 chunked）；
//   ④ **五端 tag 同号** + 结构体编解码往返一致（含空 formData）。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), 'utf8')
const codeOnly = (p: string): string =>
  read(p).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

const TRANSFER = 'packages/api/src/capability-transfer.ts'
const WIRE = 'packages/api/src/invoke-wire.ts'
const ANDROID_HTTP = 'hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/HttpCapability.java'
const IOS_HTTP = 'hosts/ios/ProteusHost/runtime/http-capability.swift'

describe('★#1120 流式上传 · JS 侧契约', () => {
  it('★必须走 upload meta（不读字节、不传 data）', () => {
    const s = codeOnly(TRANSFER)
    expect(s, '★未声明 upload ⇒ 仍会把整文件读进 JS').toMatch(/upload:\s*\{/)
    expect(s, '★仍调 fs.readBytes 读整文件').not.toMatch(/readFromHost\s*\(/)
    const start = s.indexOf('export function createAppUpload')
    expect(start).toBeGreaterThan(0)
    const seg = s.slice(start, start + 1800)
    expect(seg, '★上传请求仍带 data（一旦给了就是整包）').not.toMatch(/\bdata:\s*body\b/)
    expect(seg, '★JS 侧仍在拼 multipart').not.toMatch(/buildMultipart\s*\(/)
  })

  it('★boundary 只生成一次，头与 meta 共用同一个变量', () => {
    const s = read(TRANSFER)
    const start = s.indexOf('export function createAppUpload')
    const seg = s.slice(start, start + 1800)
    // 只应出现一次模板生成
    const gens = seg.match(/----ProteusBoundary/g) ?? []
    expect(gens.length, '★boundary 生成了多次（头与 meta 必然对不上）').toBe(1)
    expect(seg, 'boundary 未同时用于 Content-Type 与 meta').toMatch(/boundary=\$\{boundary\}/)
    expect(seg, 'meta 里未复用同一个 boundary 变量').toMatch(/boundary,\s*\n/)
  })

  it('有 filePath 才走；缺了明确报错（不静默）', () => {
    const s = read(TRANSFER)
    expect(s).toMatch(/上传需要 filePath/)
  })
})

describe('★#1120 线格式 · upload 结构体', () => {
  it('TS 侧 tag 10 + 结构体编解码', () => {
    const w = read(WIRE)
    expect(w, '缺 UploadPath tag').toMatch(/UploadPath:\s*10,?/)
    expect(w, '缺 UploadSpec 类型').toMatch(/export interface UploadSpec/)
    expect(w, '缺编码函数').toMatch(/function writeUploadSpec/)
    expect(w, '缺解码函数').toMatch(/function readUploadSpec/)
    // 五个字段都要编（少一个宿主就拼不出合法 multipart）
    for (const f of ['path', 'fieldName', 'filename', 'boundary']) {
      expect(w.includes(f), `结构体缺字段 ${f}`).toBe(true)
    }
  })

  it('五端都用同一个 tag 号（10）', () => {
    expect(read('hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/InvokeWire.java'), 'Java').toMatch(/TAG_UPLOAD_PATH = 10/)
    expect(read('hosts/ios/ProteusHost/runtime/InvokeWire.swift'), 'Swift').toMatch(/TAG_UPLOAD_PATH: UInt8 = 10/)
    expect(read('hosts/harmony/host-app/entry/src/main/ets/runtime/InvokeWire.ts'), 'ArkTS').toMatch(/TAG_UPLOAD_PATH: number = 10/)
    expect(read('hosts/harmony/host-app/proteus_render/src/main/cpp/invoke_wire.h'), 'C++').toMatch(/TAG_UPLOAD_PATH = 10/)
  })

  it('★splitFramePayload 必须识别 upload（否则整个结构被 JSON 编进请求体）', () => {
    const s = read('packages/api/src/capability-invoke.ts')
    expect(s, 'upload 未从 args 折进 meta').toMatch(/meta\.upload = v as/)
  })
})

describe('★#1120 宿主实现 · 边读边发', () => {
  it('Android：FileInputStream 逐块写 + 定长流式 + 复用沙箱校验', () => {
    const s = read(ANDROID_HTTP)
    const start = s.indexOf('private static InvokeWire.ResolveFrame performStreamUpload')
    expect(start, '找不到 performStreamUpload').toBeGreaterThan(0)
    const seg = s.slice(start, start + 6000)
    expect(seg, '★未边读边写').toMatch(/while \(\(n = in\.read\(buf\)\) > 0\)/)
    // ★断言**分发调用点**（本仓已 4 次踩到"只查符号名 ⇒ 把分支关掉也全绿"）
    expect(s, '★upload 分支未真正分发到 performStreamUpload').toMatch(
      /f\.upload != null && f\.upload\.path != null[\s\S]{0,400}performStreamUpload\(f, url, method, timeoutMs\)/,
    )
    expect(seg, '缺峰值块记账').toMatch(/peakChunkBytes/)
    // ★★★#1160 换栈后口径：换栈前是 `conn.setFixedLengthStreamingMode(total)`，
    //   换 OkHttp 后是 **`RequestBody.contentLength()` 返回已知总长**（OkHttp 据此发定长请求，
    //   不用 chunked）。性质相同：multipart 总长可预知 ⇒ 定长发送。⇒ 断言锁性质，不锁 API 名。
    expect(seg, '★未用定长流式（应能预知 multipart 总长：contentLength() 返回 total）').toMatch(
      /contentLength\(\)\s*\{\s*return\s+total/,
    )
    expect(seg, '未复用沙箱校验').toMatch(/FileTransferCapability\.resolve/)
    // 不得用 readAll 读上传文件（那是整包）
    expect(seg, '★用 readAll 读了文件（整包进内存）').not.toMatch(/readAll\(\s*new java\.io\.FileInputStream/)
  })

  it('Android：multipart 段顺序与断点格式正确', () => {
    const s = read(ANDROID_HTTP)
    expect(s, '缺普通字段段构造').toMatch(/private static String normalFieldsHead/)
    expect(s, '缺文件字段段构造').toMatch(/private static String fileFieldHead/)
    // 结尾分隔形如 `utf8Bytes("\r\n--" + up.boundary + "--\r\n")`——用片段分别断言，避免多层转义
    // 结尾分隔形如 `utf8Bytes("\r\n--" + up.boundary + "--\r\n")`
    expect(s, '缺结尾分隔（boundary 两侧的 --）').toMatch(/\+ up\.boundary \+ "--/)
  })

  it('iOS：拼临时文件 + uploadTask(fromFile:)（自定义 InputStream 四轮真机全败后换的方案）', () => {
    const s = read(IOS_HTTP)
    // ★真机连试 4 轮自定义 InputStream 全部"请求发出但服务端收不到"⇒ 换官方 fromFile 路径。
    //   ★判据锁的是**性质**（内存有界），不是某条具体 API。
    expect(s, '缺 packMultipartToTemp').toMatch(/static func packMultipartToTemp/)
    expect(s, '未用官方 uploadTask(fromFile:)').toMatch(/uploadTask\(with: req, fromFile: packed\.url\)/)
    expect(s, '拼装时未限制块大小（内存会随文件增长）').toMatch(/var buf = \[UInt8\]\(repeating: 0, count: chunkSize\)/)
    expect(s, '★上传临时文件未在收尾删除').toMatch(/removeItem\(at: tmp\)/)
    expect(s, '仍残留自定义 InputStream（已证明不可靠，应删除）').not.toMatch(/final class MultipartStream: InputStream/)
    expect(s, '未复用沙箱校验').toMatch(/sandboxSource/)
  })
})

describe('★#1120 探针装置', () => {
  it('探针必须检查"峰值块与文件无关"与"服务端内容正确"', () => {
    const s = read('hosts/shared/bridge/entry-superapp-probes.ts')
    expect(s, '缺 appUploadProbe').toMatch(/export function appUploadProbe/)
    expect(s, '未校验服务端收到的字节数').toMatch(/server_bytes/)
    expect(s, '未校验服务端 first/last').toMatch(/first_ok/)
  })

  it('判据脚本必须断言峰值块远小于文件大小', () => {
    const s = read('hosts/android/run-upload-probe.sh')
    expect(s, '缺峰值块断言').toMatch(/peak_chunk_bytes/)
    expect(s, '默认样本太小（测不出整包 vs 边读边发）').toMatch(/SIZE_MIB="\$\{PROTEUS_UPLOAD_PROBE_SIZE_MIB:-8\}"/)
  })
})
