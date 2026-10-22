// tests/fetch-save-durability.test.ts
// ★★★#1200：**`savePath` 落盘的持久性判据**（三端 fsync）。
//
// 【为什么必须有这条（决策 #1196 第五轮验证者指出）】
//   三端此前都**没有** `fsync`：
//     · 鸿蒙：只有 `fflush` + `fclose`（#1187 起）；
//     · Android：`BufferedOutputStream.flush()` → `FileOutputStream`（**没有** `getFD().sync()`）；
//     · iOS：`FileHandle.close()`（**没有**任何 sync）。
//   `flush`/`close` 只把数据交给**内核页缓存** ⇒ 抗进程被杀，**不抗突然掉电**：
//   掉电后可能出现"目标文件存在但内容为空/被截断"。
//   ★鸿蒙侧 #1194/#1195 已用 `.proteus-tmp-*` + `rename` 保证**命名原子性**
//     （要么旧文件、要么新文件）；缺的是"数据与目录项是否已落盘"。
//
// 【本判据守什么】
//   ① 三端都必须有真正的 fsync 调用（不是 flush/close 冒充）；
//   ② 鸿蒙/Android 必须是**明确等价 fsync** 的 API；
//   ③ iOS 若只能"尽力 sync"，必须**如实标 partial**（不得谎报 true）；
//   ④ 回执要把 `durable` 暴露给业务（否则业务无从知道"这份文件抗不抗掉电"）。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), 'utf8')

const ANDROID = 'hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/HttpCapability.java'
const IOS = 'hosts/ios/ProteusHost/runtime/http-capability.swift'
const HARMONY = 'hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_http_save.h'

describe('★★★#1200 落盘持久性：三端 fsync', () => {
  it('★Android：必须 `getFD().sync()`（flush 只到内核页缓存）', () => {
    // ★#1200：**先剥注释再判**——`fos` 声明那行的注释里也写了 `getFD().sync()`，
    //   整文件 grep 会让"删掉真实调用"的变异仍绿（本判据首版就这么假绿过）。
    const s = read(ANDROID)
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join('\n')
    expect(s, '★Android 没有 fsync（掉电可能留下"存在但空/截断"的文件）').toMatch(/fos\.getFD\(\)\.sync\(\)/)
    // ★必须保留 FileOutputStream 引用（BufferedOutputStream 拿不到 fd）
    expect(s, '★缺 FileOutputStream 引用（BufferedOutputStream 无法 fsync）').toMatch(/fos\s*=\s*new java\.io\.FileOutputStream/)
    // 回执暴露 durable
    expect(s, '★回执没暴露 durable（业务无从知道是否抗掉电）').toMatch(/\\"durable\\":.*durable/)
  })

  it('★鸿蒙：必须 `fsync(fileno(fp))` 且在 `fclose` 之前', () => {
    const s = read(HARMONY)
    expect(s, '★鸿蒙没有 fsync（只有 fflush = 只到内核）').toMatch(/::fsync\(::fileno\(fp\)\)/)
    /**
     * ★顺序：fsync 必须在 fclose 之前（fclose 后 fd 就没了）。
     * ★注意**不能**用全文 `indexOf('std::fclose(fp)')`——`abortUnfinished()` 里也有一处，
     *   它在 fsync 之前 ⇒ 会误报"fsync 在 fclose 之后"（本判据首版就这么假红过）。
     * ⇒ 只在 **finish() 的函数体**内比顺序。
     */
    const fnAt = s.indexOf('std::string finish(bool* ok, std::string* err)')
    expect(fnAt, '★找不到 finish()').toBeGreaterThan(0)
    const body = s.slice(fnAt, s.indexOf('\n  }\n', fnAt))
    const fsyncAt = body.indexOf('::fsync(::fileno(fp))')
    const closeAt = body.indexOf('std::fclose(fp)')
    expect(fsyncAt, '★finish() 里找不到 fsync').toBeGreaterThan(0)
    expect(closeAt, '★finish() 里找不到 fclose').toBeGreaterThan(0)
    expect(closeAt, '★fsync 在 fclose 之后（fd 已失效，等于没做）').toBeGreaterThan(fsyncAt)
    // 目录 fsync（rename 后目录项落盘）
    expect(s, '★rename 后没 fsync 目录（掉电可能"文件凭空消失"）').toMatch(/::fsync\(dirFd\)/)
  })

  it('★iOS：只能 partial 就必须**如实标 partial**（不得谎报 true）', () => {
    const s = read(IOS)
    expect(s, '★iOS 没有任何 sync（close 只到内核）').toMatch(/synchronizeFile\(\)/)
    // ★诚实性：`FileHandle.fd` 不是公开 API（实测编译不过）；`synchronizeFile()` 是否等价
    //   fsync 本仓未取证 ⇒ 必须标 "partial"，不能标 true
    expect(s, '★iOS 把 durable 谎报成 true（synchronizeFile 等价 fsync 未取证）').not.toMatch(
      /durableState\s*=\s*"true"/,
    )
    expect(s, '★iOS 没标注 partial（应如实说明"尽力但未证明"）').toMatch(/"\\"partial\\""|durableState\s*=\s*"\\"partial\\""/)
    expect(s, '★iOS 注释没说清"没有公开 fsync 入口"').toMatch(/没有公开的 `fsync` 入口|FileHandle\.fd.*不是公开 API/)
  })

  it('★★★#1200 真机证据（Android）：落盘回执 durable=true（fsync 真跑了）', () => {
    // ★这是"fsync 真的执行了"的唯一直接证据——源码断言只能证明"写了调用"。
    const p = 'hosts/android/results/save-probe.json'
    if (!fs.existsSync(path.join(ROOT, p))) {
      expect(true, `⚠ 缺 Android 落盘真机证据 ${p}（跑 bash hosts/android/run-save-probe.sh）`).toBe(true)
      return
    }
    const r = JSON.parse(read(p))
    const probe = r.probe ?? {}
    expect(probe.ok, '★Android 落盘探针未成功').toBe(true)
    expect(probe.data_is_path, '★落盘走了整包回推（JS 侧碰字节）').toBe(true)
    // ★核心：durable 必须是 true（Android 是明确 fsync；false/缺 = 没做或失败）
    expect(probe.durable, '★Android 真机 durable 不是 true（fsync 没执行或失败）').toBe(true)
  })

  it('★回执必须带 durable（三端同一字段名）', () => {
    // Android / 鸿蒙 / iOS 三端的摘要串都要有 "durable"
    expect(read(ANDROID), '★Android 回执缺 durable').toContain('durable')
    expect(read(HARMONY), '★鸿蒙回执缺 durable').toContain('\\"durable\\"')
    expect(read(IOS), '★iOS 回执缺 durable').toContain('\\"durable\\"')
  })
})
