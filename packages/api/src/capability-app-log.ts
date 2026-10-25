// packages/api/src/capability-app-log.ts
// ★★★#1225 App 能力批 1 第 2 项：App 端**日志通道**（`log`）——`useLog` 的桥实现。
//
// 【为什么需要（#1212 的口径二修）】`useLog` 要的 `bridge.log(level, message, data)` 在 App 端
//   一直没有宿主方法 ⇒ `useLog` 恒抛 `log.unsupported`。此前把它判成"零原生（A 类）"是错的：
//   A 类的判据只能是「**桥接口所需方法已存在**」，而三端宿主根本没有 `log.*`。
//   ⇒ 本轮三端各写一个宿主方法（Android `LogCapability` / iOS `LogCapability` / 鸿蒙 `proteus_log.h`）。
//
// 【★语义：三端都"真的写进平台日志"】
//   Android → `android.util.Log`（tag `proteus-log`，`adb logcat -s proteus-log` 可验）
//   iOS → `os_log`（subsystem `dev.proteus.host`，category `proteus-log`）
//   鸿蒙 → `OH_LOG_Print`（tag `proteus-log`，`hilog` 可验）
//   ⇒ 判据可以**在宿主侧读到日志**，不是"桥说成功了"（本仓最忌的假成功）。
//
// 【★诚实边界】
//   ① `data` 在宿主侧序列化后**拼进同一行**（平台日志 API 是单行文本）——
//      结构化检索请用业务自己的上报通道，不要依赖日志格式。
//   ② 日志**没有回传通道**：`log()` 的 Promise 只表示"宿主已受理"，不是"已被收集/上报"。
//   ③ 级别收 log / info / warn / error（仓库 `LogLevel` 四值）；宿主侧 info 归到普通日志级。
import { invokeHost } from './capability-invoke'
import type { LogLevel } from './capability-types'

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

/**
 * 创建 App 端的日志桥。
 *
 * @returns 空对象 ⇒ 宿主不支持 `log`（**如实不可用**，由装配点决定不提供该方法 ⇒ `useLog` 抛 unsupported）
 * ★不返回"内存兜底"：那会让业务以为日志进了平台日志系统、实际只留在 JS 内存里（重启即丢）。
 */
export function createAppLog(): AppLogBridge {
  /**
   * 写一条日志。
   * ★**同步派发**（本仓 `invokeHost` 同步，三端宿主也都是同步完成）⇒ 直接返回 Promise.resolve，
   *   `useLog` 的异步签名不变，但不需要等壳回推。
   */
  const log = (level: LogLevel, message: string, data?: unknown): Promise<void> => {
    const r = invokeHost('log', { level, message: String(message), ...(data === undefined ? {} : { data }) })
    if (!r.ok) {
      // ★不吞：桥层如实拒绝，让 useLog 的调用方看到（与 capability.ts 的 `*.unsupported` 同族）
      const kind = r.missing ? 'unsupported' : 'failed'
      return Promise.reject(new Error(`log.${kind}: ${r.reason ?? '宿主拒绝'}`))
    }
    return Promise.resolve()
  }

  // ★单一返回点（抽取器契约：函数的第一个顶层 `return {` 才是成员表）——
  //   宿主不支持时返回空对象 ⇒ 装配层不提供 log ⇒ useLog 如实 unsupported。
  // ★显式属性写法（抽取器只认 `name:` 形式，不认简写 `{ log }`）—— 改实现不改解析器（#1209 同款）
  return { log: log }
}
