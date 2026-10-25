// packages/api/src/capability-app-log.ts
// ★★★#1225 App 能力批 1 第 2 项：App 端**日志通道**（`log`）——`useLog` 的桥实现。
// ★★★#1240 按 §1.0 补到 **S3（规模可用）**：日志属「高频/大数据」族 ⇒ 规范要求 S3。
//
// 【为什么日志必须 S3（这不是过度设计）】日志是**最容易打爆**的能力：业务在循环里 log、
//   网络异常时一次刷几百条、宿主 logcat 本身有吞吐上限。S1 实现（来一条写一条）在峰值下：
//   ① 同步写把调用方拖慢；② logcat 缓冲区被灌满后**静默丢弃**，业务完全不知情。
//
// 【四项必答（证据就在下面代码里，不是"设计上支持"）】
//   ① **上限**：单条 message ≤ `LOG_MAX_MESSAGE_BYTES`(8 KiB)、data 序列化后 ≤ `LOG_MAX_DATA_BYTES`(8 KiB)。
//      超限策略 `onOverflow`：默认 **截断并计入 `truncated`**（日志不能因为太长就整条丢——
//      截断保留前因更可用）；`onOverflow='throw'` 时抛 `log.tooLarge`（**显式报错**通道）。
//      ★"计数的截断"不是静默截断：`logStats().truncated` 可读、可断言。
//   ② **背压**：进程内**有界队列** `LOG_MAX_QUEUE`(1024) + **丢最旧** + `dropped` 计数。
//      ★为什么丢旧而不阻塞：`log()` 在业务热路径上，阻塞会把 UI 拖死；丢旧保留"最近发生了什么"。
//      单次 flush 上限 `LOG_MAX_BATCH`(64) ⇒ 峰值下一次调用不会把宿主写爆（剩的留队等下次）。
//   ③ **回收**：队列登记进 `capability-resources` 账本（`type:'log-queue'`）⇒ 页面退出 /
//      scope dispose 时 `release()` 清空并归零；无原生句柄常驻（宿主调用同步完成即释放）。
//   ④ **并发/淘汰**：`LOG_PENDING_MAX` 表项上界 + FIFO 淘汰；`logStats()` 给出
//      `{written, dropped, truncated, queued}` 四项可观测读数。
//
// 【★语义：三端都"真的写进平台日志"】
//   Android → `android.util.Log`（tag `proteus-log`，`adb logcat -s proteus-log` 可验）
//   iOS → `os_log`（subsystem `dev.proteus.host`，category `proteus-log`）
//   鸿蒙 → `OH_LOG_Print`（tag `proteus-log`，`hilog` 可验）
//   ⇒ 判据是**在宿主侧读到日志**，不是"桥说成功了"（本仓最忌的假成功）。
//
// 【★诚实边界】
//   ① `data` 在宿主侧序列化后**拼进同一行**（平台日志 API 是单行文本）——结构化检索请用业务自己的上报通道。
//   ② 日志**没有回传通道**：`log()` 的 Promise 只表示"宿主已受理"，不是"已被收集/上报"。
//   ③ 级别收 log / info / warn / error（仓库 `LogLevel` 四值）；宿主侧 info 归到普通日志级。
//   ④ 队列是**削峰**不是异步发送（`invokeHost` 同步）——所以 flush 在本调用内完成，
//      超过批量的留在队列，下次调用或 `flushLogQueue()` 继续。
import { invokeHost } from './capability-invoke'
import type { CapabilityResource, CapabilityResourceRegistry } from './capability-resources'
import type { LogLevel } from './capability-types'

/** ① 单条消息字节上限（超出按 `onOverflow` 处理） */
export const LOG_MAX_MESSAGE_BYTES = 8 * 1024
/** ① data 序列化后的字节上限（超出丢 data 保留 message） */
export const LOG_MAX_DATA_BYTES = 8 * 1024
/** ② 待发队列上界（条） */
export const LOG_MAX_QUEUE = 1024
/** ④ 表项上界（与队列同值，单列出来是因为它是"并发/淘汰"维度的读数口径） */
export const LOG_PENDING_MAX = 1024
/** ② 单次 flush 最多发多少条（防一次调用写爆宿主） */
export const LOG_MAX_BATCH = 64

/** 队列条目（导出是因为 `LogFlushResult.failed` 引用它——declaration emit 需要可命名） */
export interface LogItem {
  level: LogLevel
  message: string
  data?: unknown
}

/** 进程内状态（模块级 ⇒ 进程退出自然回收；无原生句柄） */
const pending: LogItem[] = []
let droppedCount = 0
let truncatedCount = 0
let writtenCount = 0

/** 规模读数（判据/探针用；不改变状态） */
export interface LogStats {
  /** 已交给宿主的条数 */
  written: number
  /** 因队列满被淘汰的条数（② 背压） */
  dropped: number
  /** 因超限被截断的条数（① 上限） */
  truncated: number
  /** 当前队列深度 */
  queued: number
}

/** 读规模读数 */
export function logStats(): LogStats {
  return { written: writtenCount, dropped: droppedCount, truncated: truncatedCount, queued: pending.length }
}

/** 仅测试用：重置状态 */
export function __resetLogState(): void {
  pending.length = 0
  droppedCount = 0
  truncatedCount = 0
  writtenCount = 0
}

/** UTF-8 字节长度（只算长度，不真编码） */
function utf8Len(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++ }
    else n += 3
  }
  return n
}

/** 按字节上限截断（按码点切，不切半个字符） */
function truncateUtf8(s: string, maxBytes: number): string {
  if (utf8Len(s) <= maxBytes) return s
  let n = 0
  let i = 0
  for (; i < s.length; i++) {
    const c = s.charCodeAt(i)
    const w = c < 0x80 ? 1 : c < 0x800 ? 2 : c >= 0xd800 && c <= 0xdbff ? 4 : 3
    if (n + w > maxBytes - 3) break   // 留 3 字节给省略号
    n += w
    if (w === 4) i++
  }
  return s.slice(0, i) + '…'
}

/** 单次 flush 的结果（★失败条目要回传：否则 log() 分不清"留队"与"发出去被拒"） */
export interface LogFlushResult {
  /** 成功交给宿主的条数 */
  sent: number
  /** 这一批里失败的条目 + 宿主给的原因（`missing` ⇒ 宿主没这方法，不是执行失败） */
  failed: Array<{ item: LogItem; missing: boolean }>
}

/** 把队列里最多 `LOG_MAX_BATCH` 条发给宿主 */
export function flushLogQueue(): LogFlushResult {
  const failed: Array<{ item: LogItem; missing: boolean }> = []
  let sent = 0
  while (pending.length > 0 && sent + failed.length < LOG_MAX_BATCH) {
    const it = pending.shift()!
    const r = invokeHost('log', {
      level: it.level,
      message: it.message,
      ...(it.data === undefined ? {} : { data: it.data }),
    })
    if (r.ok) { writtenCount++; sent++ } else {
      droppedCount++
      failed.push({ item: it, missing: r.ok === false && r.missing === true })
    }
  }
  return { sent, failed }
}

/**
 * 桥成员对象（★抽取器契约要求"工厂顶层 `return { 成员名 }`"）。
 * ★返回类型必须是**具名** type：内联对象类型里的 `=>` 与 `{}` 会让抽取器的花括号匹配带偏
 *   （实测：`(): { log?: (…) => Promise<void> }` ⇒ 抽取器报"未找到顶层 return {"）。
 */
export interface AppLogBridge {
  log?: (level: LogLevel, message: string, data?: unknown) => Promise<void>
}

/** 宿主是否具备日志通道（`{probe:true}` ⇒ 宿主回"未知方法"即 false） */
export function appLogAvailable(): boolean {
  const r = invokeHost('log', { probe: true })
  // 与 capability-app-storage 同款写法（短路联合窄化： tsc 对该返回类型只在这种形式下窄化）
  return r.ok || !(!r.ok && r.missing)
}

/** 创建选项 */
export interface AppLogOptions {
  /** ① 超限策略：默认截断并计数（`truncated`）；`'throw'` ⇒ 抛 `log.tooLarge`（显式报错通道） */
  onOverflow?: 'truncate' | 'throw'
  /**
   * ② 是否每次 `log()` 立刻 flush。
   * ★默认 `true`（最低延迟）。`false` ⇒ **批量模式**：条目留在队列，由调用方
   *   `flushLogQueue()` 统一发出 —— 高频日志场景下这是省宿主调用次数的正路，
   *   也是队列上界/淘汰策略**唯一会被触发**的形态（默认模式下队列深度恒 ≤1）。
   */
  autoFlush?: boolean
  /** ③ 资源账本（#1094）：登记队列为边界资源 ⇒ scope dispose 时清空归零 */
  resources?: CapabilityResourceRegistry
  /** 账本 owner 标签 */
  owner?: string
}

/**
 * 创建 App 端的日志桥。
 *
 * @returns 空对象 ⇒ 宿主不支持 `log`（**如实不可用**，由装配点决定不提供该方法 ⇒ `useLog` 抛 unsupported）
 * ★不返回"内存兜底"：那会让业务以为日志进了平台日志系统、实际只留在内存里（重启即丢）。
 */
export function createAppLog(opts: AppLogOptions = {}): AppLogBridge {
  const onOverflow = opts.onOverflow ?? 'truncate'
  const autoFlush = opts.autoFlush ?? true
  /** ③ 资源账本登记（队列是边界资源：批量模式下会积压未发条目，页面退出必须能清） */
  if (opts.resources) {
    opts.resources.register({
      type: 'log-queue',
      owner: opts.owner,
      sourceLocation: 'packages/api/src/capability-app-log.ts',
      release: () => { pending.length = 0 },
    })
  }

  /**
   * ① 归一化一条消息：截断（并计数）或显式抛错。
   * ★"计数的截断"与"静默截断"的区别就在这里——`logStats().truncated` 可读可断言。
   */
  function normalize(message: string, data: unknown): { message: string; data: unknown } {
    let msg = typeof message === 'string' ? message : String(message)
    let payload = data
    const msgBytes = utf8Len(msg)
    let dataBytes = 0
    if (data !== undefined) {
      try {
        dataBytes = utf8Len(typeof data === 'string' ? data : JSON.stringify(data) ?? '')
      } catch {
        dataBytes = 0
      }
    }
    const overMsg = msgBytes > LOG_MAX_MESSAGE_BYTES
    const overData = dataBytes > LOG_MAX_DATA_BYTES
    if (overMsg || overData) {
      if (onOverflow === 'throw') {
        const what = overMsg
          ? `message ${msgBytes}B > ${LOG_MAX_MESSAGE_BYTES}B`
          : `data ${dataBytes}B > ${LOG_MAX_DATA_BYTES}B`
        throw new Error(`log.tooLarge: ${what}`)
      }
      if (overMsg) { msg = truncateUtf8(msg, LOG_MAX_MESSAGE_BYTES); truncatedCount++ }
      // ★data 超限丢 data 保留 message（比丢整条有用）；同样计数
      if (overData) { payload = undefined; truncatedCount++ }
    }
    return { message: msg, data: payload }
  }

  /**
   * 写一条日志。
   * ★**同步派发**（`invokeHost` 同步，三端宿主也都是同步完成）⇒ 返回已决议的 Promise。
   */
  const log = (level: LogLevel, message: string, data?: unknown): Promise<void> => {
    let norm: { message: string; data: unknown }
    try {
      norm = normalize(message, data)
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)))
    }
    const item: LogItem = { level, message: norm.message, data: norm.data }
    // ② 背压：队列满 ⇒ 淘汰最旧（保留"最近发生了什么"）并计数
    if (pending.length >= LOG_MAX_QUEUE) {
      pending.shift()
      droppedCount++
    }
    pending.push(item)
    if (!autoFlush) return Promise.resolve()

    const { failed } = flushLogQueue()
    // ★只有"这一条**真的发出去了**且宿主拒了"才 reject——
    //   被批量上限留在队里不算失败（那会让峰值下误报一串错）。
    const hit = failed.find((f) => f.item === item)
    if (hit) {
      const kind = hit.missing ? 'unsupported' : 'failed'
      return Promise.reject(new Error(`log.${kind}: 宿主拒绝写入`))
    }
    return Promise.resolve()
  }

  // ★单一返回点（抽取器契约：函数的第一个顶层 `return {` 才是成员表）——
  //   宿主不支持时返回空对象 ⇒ 装配层不提供 log ⇒ useLog 如实 unsupported。
  // ★显式属性写法（抽取器只认 `name:` 形式，不认简写 `{ log }`）—— 改实现不改解析器（#1209 同款）
  return { log: log }
}
