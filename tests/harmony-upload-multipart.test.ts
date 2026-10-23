// tests/harmony-upload-multipart.test.ts
// ★★★#1205：鸿蒙 **multipart 流式上传**（`upload`）的真机判据。
//
// 【它守的是什么】`useFetch` 的上传在 Android/iOS 都已实现（宿主自读沙箱文件、自拼 multipart、
//   JS 完全不碰字节），只有鸿蒙一直是 `fetch.unsupported`（#1203 的如实拒绝）。
//   本单用 RCP 的 multipart API（`contentOrPathOrCb` 走 `RCP_FILE_VALUE_TYPE_PATH`，
//   由平台流式读文件）实现。
//
// 【★★★为什么"请求成功"绝不能当判据】
//   上传失败最常见、也最危险的形态是：**请求 200、表单字段都在、但文件没了**。
//   本仓实测过同族（#1203 之前 upload 是静默忽略：服务端收到没有文件的请求、业务以为成功、
//   可能写入空记录）。⇒ 判据必须看**服务端解析出的结构**：
//     · 有 boundary 且与 `Content-Type` 里的一致；
//     · 普通表单字段名/值正确；
//     · 文件字段的 filename 正确；
//     · **文件字节 sha256 与源文件逐字节相等**（长度对但内容错照样是坏的）。
//   ⇒ 证据里同时入库**两份**：设备侧回执（`http-probe-upload.json`）与
//     **服务端回显**（`http-probe-upload-server.json`，第三方证据，不依赖设备自报）。
//
// 【★与 Android/iOS 的语义差异（如实登记，不粉饰）】
//   ① **boundary 由 RCP 生成**，不是 JS 传的那个 ⇒ 宿主必须剔除调用方的 `Content-Type`
//     （否则头里一个 boundary、体里另一个 ⇒ 服务端必然解析失败）。判据因此断言
//     "服务端收到的 Content-Type 里的 boundary == 实际解析用的 boundary"（同源）。
//   ② 表单字段顺序由平台 Map 决定 ⇒ **不是逐字节等价**（对多数服务端无影响，按 name 取值）。
//      ⇒ 判据只看结构，不看字节序。
//
// 【诚实边界】① 服务端是本机 `upload-probe-server.mjs`（够用的单层 multipart 解析）；
//   ② 只测小文件（577 B）；大文件的**内存有界**性质来自"路径交给平台读"的设计，
//      本轮**未用大文件实测内存**（savePath 的 64 MiB 内存实测是另一件事，不能外推）。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), 'utf8')
const RES = 'hosts/harmony/results'
const DEVICE = `${RES}/http-probe-upload.json`
const SERVER = `${RES}/http-probe-upload-server.json`
const UPLOAD_H = 'hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_http_upload.h'
const HTTP_H = 'hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_http.h'
const GUARD_H = 'hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_http_guard.h'

type Device = {
  ok?: boolean; status?: number; reason?: string
  probe_diag?: string; preview?: string
}
type Server = {
  requests?: number
  last?: {
    method?: string
    contentType?: string
    boundary?: string
    bodyBytes?: number
    fields?: Array<{ name: string; value: string }>
    file?: { name?: string; filename?: string; bytes?: number; sha256?: string } | null
  }
}

describe('★★★#1205 鸿蒙 multipart 上传（upload）真机判据', () => {
  it('★★★服务端收到了完整 multipart：boundary 同源 + 字段 + 文件字节 sha256 一致', () => {
    expect(fs.existsSync(path.join(ROOT, SERVER)),
      `缺服务端证据 ${SERVER}（跑 upload-probe-server.mjs + run-http-probe.sh --upload-path=…）`).toBe(true)
    const srv = JSON.parse(read(SERVER)) as Server
    const last = srv.last ?? {}
    // ★必须是 POST（GET 没有体语义 ⇒ 上传永远发不出去，而客户端仍可能收 200）
    expect(last.method, '★上传必须是 POST').toBe('POST')
    // ★boundary 必须存在，且 `Content-Type` 里声明的与实际用的是**同一个**
    //   （两处不同源 = 服务端必然 missing boundary，Android 侧踩过同族）
    expect(String(last.boundary ?? ''), '★服务端没解析出 boundary').not.toBe('')
    expect(String(last.contentType ?? ''), '★Content-Type 里的 boundary 与实际不一致').toContain(
      `boundary=${last.boundary}`,
    )
    // ★有体（不是空请求）
    expect(Number(last.bodyBytes), '★请求体为空 ⇒ multipart 根本没发出去').toBeGreaterThan(0)
    // ★表单字段（上传的附加数据）
    const fields = last.fields ?? []
    expect(fields.map((f) => f.name), '★服务端没收到表单字段 title').toContain('title')
    expect(fields.find((f) => f.name === 'title')?.value, '★字段值不符').toBe('hello')
    // ★文件字段：filename + 字节数 + **sha256**
    const file = last.file
    expect(file, '★服务端没解析到文件字段（= 文件根本没上传）').toBeTruthy()
    expect(file?.filename, '★文件名不符').toBe('up-src.txt')
    expect(Number(file?.bytes), '★文件字节数不符').toBe(577)
    /**
     * ★★★**逐字节对拍**（这条是本判据的核心，不能退化成"有个 64 位字符串"）。
     *   基准来自**设备 OS 的 `sha256sum`**（第三方测量，不是我们自报），
     *   由 `run-http-probe.sh` 写进设备侧证据的 `deviceSourceSha256`。
     *   ⇒ 断言"服务端收到的字节 == 设备上源文件的字节"。
     *   ★只看长度/只看"请求成功"会漏掉最危险的形态：**请求成功、字段都在、文件内容却是错的**。
     */
    const dev = JSON.parse(read(DEVICE)) as { deviceSourceSha256?: string }
    const baseline = String(dev.deviceSourceSha256 ?? '')
    expect(baseline, '★缺设备侧基准 sha256（无法对拍 ⇒ 判据会退化成只看长度）').toHaveLength(64)
    expect(String(file?.sha256 ?? ''), '★服务端文件 sha256 ≠ 设备源文件 sha256（内容被改或发错了文件）').toBe(baseline)
  })

  it('★★设备侧回执与证据自洽（不是只看客户端成功，但也不能自相矛盾）', () => {
    expect(fs.existsSync(path.join(ROOT, DEVICE)), `缺设备侧证据 ${DEVICE}`).toBe(true)
    const d = JSON.parse(read(DEVICE)) as Device
    expect(d.ok, '★设备侧请求未成功').toBe(true)
    expect(Number(d.status), '★状态码应为 200').toBe(200)
    // ★探针诊断里必须真的带了 uploadPath（否则这轮根本没测上传，证据是别的场景的）
    const diag = JSON.parse(String(d.probe_diag ?? '{}')) as { uploadPath?: string }
    expect(String(diag.uploadPath ?? ''), '★这轮探针没带 uploadPath ⇒ 证据不是上传场景').toBe('download/up-src.txt')
    // ★设备回执里的 preview 是服务端回显（探针把响应体带回来了）⇒ 必须含文件字段
    expect(String(d.preview ?? ''), '★回执里没有服务端回显的文件信息').toContain('"file"')
  })

  it('★upload 不再被前置拒绝（#1203 的拒绝分支必须已移除）', () => {
    const g = read(GUARD_H)
    expect(g, '★guard 里仍在拒绝 upload（本单已实现，拒绝分支必须去掉）').not.toMatch(
      /fetch\.unsupported[\s\S]{0,120}multipart 上传/,
    )
  })

  it('★★实现要点：路径交给平台读（不是把整个文件读进内存）', () => {
    const u = read(UPLOAD_H)
    // ★核心：必须用 `RCP_FILE_VALUE_TYPE_PATH`（由平台流式读文件）
    expect(u, '★没走 PATH 模式 ⇒ 可能把整个文件读进内存（内存峰值 = 文件大小）').toMatch(
      /RCP_FILE_VALUE_TYPE_PATH/,
    )
    // ★路径长度硬约束必须显式校验（`char[128]`），不能静默截断
    expect(u, '★没校验路径长度（RCP_MAX_PATH_LEN）⇒ 超长会被截断成别的文件').toMatch(/RCP_MAX_PATH_LEN/)
    expect(u, '★没校验文件名长度（RCP_MAX_FILENAME_LEN）').toMatch(/RCP_MAX_FILENAME_LEN/)
    // ★沙箱路径校验必须走既有实现（三层防护：非空/非绝对/无 ..）
    expect(u, '★没用 resolveSandboxPath（沙箱逃逸风险）').toMatch(/resolveSandboxPath/)
  })

  it('★★上传时剔除调用方 Content-Type（否则头体 boundary 不同源 ⇒ 服务端解析失败）', () => {
    const h = read(HTTP_H)
    expect(h, '★没剔除调用方 Content-Type ⇒ 头里 JS 的 boundary、体里 RCP 的 boundary').toMatch(
      /isUpload\s*&&\s*lk\s*==\s*"content-type"\)\s*continue/,
    )
    // ★upload 时不得再挂整包 body（否则会覆盖 multipart 的 content）
    expect(h, '★upload 时仍挂了整包 body ⇒ 覆盖 multipart，文件不会被发送').toMatch(/if\s*\(!isUpload\s*&&\s*!f\.body\.empty\(\)\)/)
  })
})
