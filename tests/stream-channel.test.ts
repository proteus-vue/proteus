// tests/stream-channel.test.ts
// ★★★#1118 流式通道（S3 的"流式 + 背压"）——**JS 消费侧**的契约判据
//
// 【要证明什么（四件，缺一件都不算流式可用）】
//   ① **按块消费**：宿主逐块回推 ⇒ `onChunk` 收到每一块（不是最后才给整包）；
//   ② **不提前结算**：块帧（带 `streamSeq`）**不**结算 Promise —— 只有最终帧结算；
//      ★这条是"流式 vs 一问一答"的分水岭：块帧被误当最终帧 ⇒ 流在中途静默截断；
//   ③ **丢帧必报错**：seq 跳跃 ⇒ reject（不静默拼出半截数据——超级应用里最难查的一类）；
//   ④ **请求声明流式**：去程帧必须真的带 `stream` tag（否则老宿主仍整包回，调用方以为在流式）。
//
// 【为什么在 JS 层测（而不是只测宿主）】
//   流式的最终语义在**消费侧**：宿主逐块推来，JS 侧认不出/丢了/提前结算，都表现为
//   "看起来在跑、实际数据不对"。本测试把消费侧的三种失败形态各钉一条。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  invokeHostStream,
  installHostResolveBridge,
  pendingHostCallCount,
  lastStreamChunkCount,
  HOST_INVOKE_BYTES_KEY,
  HOST_RESOLVE_BYTES_KEY,
  HOST_INVOKE_KEY,
} from '../packages/api/src/capability-invoke'
import {
  decodeInvokeFrame,
  decodeResolveFrame,
  encodeResolveFrame,
  MetaTagInvoke,
  type ResolveFrame,
} from '../packages/api/src/invoke-wire'

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), 'utf8')

const g = globalThis as Record<string, unknown>

/** 宿主桩：实现二进制入口（返回 undefined = 已受理，等回推） */
function installBytesShell(handler: (frame: Uint8Array) => Uint8Array | undefined): void {
  g[HOST_INVOKE_BYTES_KEY] = (frame: Uint8Array): Uint8Array | undefined => handler(frame)
}

function push(frame: Uint8Array): void {
  ;(g[HOST_RESOLVE_BYTES_KEY] as (f: Uint8Array) => void)(frame)
}

/** 块帧（带 streamSeq ⇒ 不结算） */
function chunkFrame(reqId: string, seq: number, body: Uint8Array): Uint8Array {
  return encodeResolveFrame({ reqId, ok: true, pending: true, streamSeq: seq, body })
}

/** 最终帧（无 streamSeq 且非 pending ⇒ 结算） */
function finalFrame(reqId: string, extra: Partial<ResolveFrame> = {}): Uint8Array {
  return encodeResolveFrame({ reqId, ok: true, status: 200, ...extra })
}

const enc = (s: string): Uint8Array => new TextEncoder().encode(s)

beforeEach(() => {
  installHostResolveBridge()
})

afterEach(() => {
  delete g[HOST_INVOKE_BYTES_KEY]
  delete g[HOST_INVOKE_KEY]
  delete g['proteusHost']
})

describe('★#1118 流式消费 · 按块到达', () => {
  it('逐块回调 + 最终帧结算（不是最后才给整包）', async () => {
    let reqId = ''
    installBytesShell((frame) => {
      reqId = decodeInvokeFrame(frame).reqId
      return undefined // 已受理
    })
    const chunks: string[] = []
    const seqs: number[] = []
    const p = invokeHostStream('http.request', { url: 'https://x.cn/sse' }, (c, s) => {
      chunks.push(new TextDecoder().decode(c))
      seqs.push(s)
    })
    push(chunkFrame(reqId, 0, enc('data: 1\n')))
    push(chunkFrame(reqId, 1, enc('data: 2\n')))
    push(finalFrame(reqId, { body: new Uint8Array(0) }))
    await p
    expect(chunks).toEqual(['data: 1\n', 'data: 2\n'])
    expect(seqs).toEqual([0, 1])
    expect(lastStreamChunkCount()).toBe(2)
    expect(pendingHostCallCount()).toBe(0)
  })

  it('★块帧**不**结算（只发块、不发最终帧 ⇒ Promise 仍挂起）', async () => {
    let reqId = ''
    installBytesShell((f) => {
      reqId = decodeInvokeFrame(f).reqId
      return undefined
    })
    let settled = false
    const p = invokeHostStream('http.request', { url: 'https://x.cn/s' }, () => {}).then(
      () => { settled = true },
      () => { settled = true },
    )
    push(chunkFrame(reqId, 0, enc('a')))
    await Promise.resolve()
    expect(settled, '块帧被误当最终帧结算了 ⇒ 流会在中途静默截断').toBe(false)
    push(finalFrame(reqId))
    await p
    expect(settled).toBe(true)
  })
})

describe('★#1118 流式消费 · 丢帧与错误', () => {
  it('★seq 跳跃 ⇒ reject（不静默拼出半截数据）', async () => {
    let reqId = ''
    installBytesShell((f) => {
      reqId = decodeInvokeFrame(f).reqId
      return undefined
    })
    const p = invokeHostStream('http.request', { url: 'https://x.cn/s' }, () => {})
    push(chunkFrame(reqId, 0, enc('a')))
    push(chunkFrame(reqId, 2, enc('c'))) // ★跳过 1
    await expect(p).rejects.toThrow(/丢帧/)
    expect(pendingHostCallCount(), '丢帧后 pending 表未清理（泄漏）').toBe(0)
  })

  it('首块不是 seq=0 ⇒ reject（防"从中间开始"被当成正常）', async () => {
    let reqId = ''
    installBytesShell((f) => {
      reqId = decodeInvokeFrame(f).reqId
      return undefined
    })
    const p = invokeHostStream('http.request', { url: 'https://x.cn/s' }, () => {})
    push(chunkFrame(reqId, 3, enc('x')))
    await expect(p).rejects.toThrow(/丢帧/)
  })

  it('消费回调抛错 ⇒ reject 并清理（否则后续块到达却没人消费 = 泄漏）', async () => {
    let reqId = ''
    installBytesShell((f) => {
      reqId = decodeInvokeFrame(f).reqId
      return undefined
    })
    const p = invokeHostStream('http.request', { url: 'https://x.cn/s' }, () => {
      throw new Error('消费方炸了')
    })
    push(chunkFrame(reqId, 0, enc('a')))
    await expect(p).rejects.toThrow(/消费方炸了/)
    expect(pendingHostCallCount()).toBe(0)
  })

  it('最终帧是 error ⇒ reject（错误在末帧到达，不因块成功而吞掉）', async () => {
    let reqId = ''
    installBytesShell((f) => {
      reqId = decodeInvokeFrame(f).reqId
      return undefined
    })
    const p = invokeHostStream('http.request', { url: 'https://x.cn/s' }, () => {})
    push(chunkFrame(reqId, 0, enc('a')))
    push(encodeResolveFrame({ reqId, ok: false, reason: 'fetch.failed: 连接中断' }))
    await expect(p).rejects.toThrow(/连接中断/)
  })
})

describe('★#1118 去程必须声明流式（否则老宿主仍整包回）', () => {
  it('去程帧带 stream tag（值 1）', () => {
    let captured: Uint8Array | undefined
    installBytesShell((f) => {
      captured = f
      return undefined
    })
    void invokeHostStream('http.request', { url: 'https://x.cn/s' }, () => {})
    expect(captured).toBeDefined()
    const f = decodeInvokeFrame(captured as Uint8Array)
    expect(f.meta.stream, 'invokeHostStream 未在 meta 里声明 stream ⇒ 宿主不会分块回推').toBe(true)
    // 非流式路径必须**不**声明（否则整包上限失效）
    expect(MetaTagInvoke.Stream).toBe(8)
  })

  it('★普通 invokeHostAsync 不得带 stream tag（整包语义不变，32 MiB 上限仍生效）', async () => {
    let captured: Uint8Array | undefined
    installBytesShell((f) => {
      captured = f
      return encodeResolveFrame({ reqId: decodeInvokeFrame(f).reqId, ok: true, status: 200 })
    })
    const { invokeHostAsync } = await import('../packages/api/src/capability-invoke')
    await invokeHostAsync('http.request', { url: 'https://x.cn/s' })
    const f = decodeInvokeFrame(captured as Uint8Array)
    expect(f.meta.stream, '整包路径被误标流式 ⇒ 宿主改走分块，32 MiB 上限与整包语义都失效').toBeFalsy()
  })

  it('宿主无 invokeBytes ⇒ 明确 unsupported（不假装支持流式）', async () => {
    delete g[HOST_INVOKE_BYTES_KEY]
    await expect(invokeHostStream('http.request', { url: 'x' }, () => {})).rejects.toThrow(/unsupported/)
  })
})

describe('★#1118 宿主实现 · 三端同值同语义', () => {
  it('Android：有界队列阻塞读线程（真背压）+ 逐块 push', () => {
    const s = read('hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/HttpCapability.java')
    expect(s, '缺流式队列深度常量').toMatch(/STREAM_QUEUE_DEPTH\s*=\s*8/)
    expect(s, '缺 ArrayBlockingQueue（无界队列不是背压）').toMatch(/ArrayBlockingQueue/)
    // ★背压的本质：队列满时**阻塞**。put 是阻塞的；offer 不是（会静默丢块）。
    expect(s, '★读线程未用阻塞 put（用 offer 会静默丢块 ⇒ 不是背压）').toMatch(/q\.put\(chunk\)/)
    expect(s, '未统计背压等待次数（判据无法证明背压真的发生）').toMatch(/backpressureWaits/)
    expect(s, '块帧未带 streamSeq').toMatch(/rf\.streamSeq\s*=\s*seq/)
    expect(s, '块帧未标 pending（会被当最终帧结算）').toMatch(/rf\.pending\s*=\s*true/)
  })

  it('★★iOS：许可信号量必须是**引用类型**（struct 值拷贝会把 semaphore 复制多份 ⇒ 运行时崩）', () => {
    // 真实踩到（#1118 iOS 首跑）：把 DispatchSemaphore 直接放进 `State`（struct）——
    //   每次 `states[id]` 读出都会**复制一份引用**、写回时又存另一份 ⇒ 各线程拿到不同副本，
    //   `signal()` 加到别处 ⇒ 许可失控 ⇒ 崩在 seq=32/33 跨线程处（App terminated due to signal 5）。
    //   ★判据：必须有一个 class 持有 semaphore，且 State 只持有该 class 的引用。
    const s = read('hosts/ios/ProteusHost/runtime/http-capability.swift')
    // ★断言**定义行**（带缩进与花括号），不是裸类名——裸名连注释里的提及都能匹配（实测漏网）
    expect(s, '缺 StreamGate 引用类型定义').toMatch(/^    final class StreamGate \{$/m)
    expect(s, 'StreamGate 未真正持有 semaphore').toMatch(/sem = DispatchSemaphore\(value: depth\)/)
    expect(s, 'State 里直接放了 DispatchSemaphore（值拷贝 ⇒ 多份）').not.toMatch(
      /private struct State \{[\s\S]*?var inflight = DispatchSemaphore/,
    )
    expect(s, 'State 未通过 gate 持有许可').toMatch(/var gate: StreamGate/)
    expect(s, '背压点未用 gate.acquire()').toMatch(/st\.gate\.acquire\(\)/)
    expect(s, '归还未用同一 gate 引用（重新查 states 可能已被摘掉）').toMatch(/st\.gate\.release\(\)/)
  })

  it('★iOS：流式必须复用 BodyLimitDelegate（另建 delegate 收不到回调）', () => {
    // 真实踩到：新建 `StreamDelegate: NSObject, URLSessionDataDelegate` 但 session 的 delegate
    //   在创建时**已固定**为 BodyLimitDelegate ⇒ 新类**永远收不到回调** ⇒ 服务端发完 256 块、
    //   宿主记账全 0、Promise 永不结算、120s 超时。★这是"看着实现了、实际没接线"的典型形态。
    const s = read('hosts/ios/ProteusHost/runtime/http-capability.swift')
    expect(s, '不应再存在独立的 StreamDelegate 类').not.toMatch(/final class StreamDelegate/)
    expect(s, '流式应注册到 BodyLimitDelegate').toMatch(/BodyLimitDelegate\.shared\.registerStreaming/)
    expect(s, 'session 创建时应绑定 BodyLimitDelegate').toMatch(
      /URLSession\(configuration: cfg, delegate: BodyLimitDelegate\.shared/,
    )
  })

  it('iOS：限在途块 + 逐块回推（背压经 gate 生效）', () => {
    const s = read('hosts/ios/ProteusHost/runtime/http-capability.swift')
    expect(s, '缺流式队列深度常量').toMatch(/QUEUE_DEPTH\s*=\s*8/)
    expect(s, '缺 DispatchSemaphore（无背压）').toMatch(/DispatchSemaphore/)
    // ★注意：真正的「是否阻塞」判据在上面那条（gate.acquire / gate.release）——
    //   这里只查「许可机制存在」，不重复断言具体调用点（避免两处断言对同一事实各自漂移）。
    expect(s, '块帧未带 streamSeq').toMatch(/rf\.streamSeq\s*=\s*UInt32\(seq\)/)
  })

  it('★两端块大小与队列深度必须同值（否则"换端行为不同"）', () => {
    const a = read('hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/HttpCapability.java')
    const i = read('hosts/ios/ProteusHost/runtime/http-capability.swift')
    expect(a).toMatch(/STREAM_CHUNK\s*=\s*16\s*\*\s*1024/)
    expect(i).toMatch(/CHUNK\s*=\s*16\s*\*\s*1024/)
  })

  it('★流式请求**不受** 32 MiB 整包上限约束（上限是"整包驻留"的护栏）', () => {
    const a = read('hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/HttpCapability.java')
    // 流式路径不得调用 readAll（那会把整包攒进 ByteArrayOutputStream）
    // ★必须定位**定义处**（`indexOf('performStreaming')` 会命中 handle 里的调用点，切片就切错了）
    const start = a.indexOf('private static void performStreaming')
    expect(start, '找不到 performStreaming').toBeGreaterThan(0)
    const seg = a.slice(start, start + 4000)
    expect(seg, '★流式路径仍在攒整包（readAll）⇒ 与 S3 语义冲突').not.toMatch(/readAll\(/)
    expect(seg, '流式路径未边读边推').toMatch(/q\.put\(chunk\)/)
  })

  it('★服务器有可测背压的慢速流式端点', () => {
    const s = read('hosts/android/tools/transfer-echo-server.mjs')
    expect(s, '缺 /stream 端点').toMatch(/url\.pathname\s*===\s*'\/stream'/)
    expect(s, 'chunked 流缺延迟参数（不给消费侧压力就看不出背压）').toMatch(/delayMs/)
    expect(s, '★未省略 content-length（否则宿主可预分配，测不到边读边推）').toMatch(/'content-type': 'application\/octet-stream' \}\)/)
  })

  it('★探针必须带"慢消费"参数（否则队列从不满，背压测不出来）', () => {
    // ★#1118 收尾：探针已拆到 entry-superapp-probes.ts（原文件 1095 行越 size 上限）
    const s = read('hosts/shared/bridge/entry-superapp-probes.ts')
    expect(s, '缺 slowMs 参数').toMatch(/slowMs/)
    expect(s, '探针未逐字节校验（只数块数会漏掉内容错位）').toMatch(/mismatches/)
    // ★挂载点留在装配文件（探针实现已拆出）
    const wiring = read('hosts/shared/bridge/entry-superapp.ts')
    expect(wiring, '★探针函数必须挂 globalThis').toMatch(/__proteusHostAppStreamProbe/)
  })
})

describe('★#1118 线格式 · 块序号编码', () => {
  it('streamSeq 往返一致（含 0 与较大值）', () => {
    for (const seq of [0, 1, 65535, 4294967295]) {
      const b = encodeResolveFrame({ reqId: 'r', ok: true, pending: true, streamSeq: seq })
      expect(decodeResolveFrame(b).streamSeq).toBe(seq)
    }
  })

  it('★空块也要能表达（seq=0 + 空 body —— 靠 tag 区分，不靠 body 非空推断）', () => {
    const b = encodeResolveFrame({ reqId: 'r', ok: true, pending: true, streamSeq: 0 })
    const f = decodeResolveFrame(b)
    expect(f.streamSeq).toBe(0)
    expect(f.body?.length ?? 0).toBe(0)
  })
})
