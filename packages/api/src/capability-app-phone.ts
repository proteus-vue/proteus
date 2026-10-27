// packages/api/src/capability-app-phone.ts
// ★★★#1285 App 能力 C21：`makePhoneCall` —— 拨号盘唤起（App 桥实现）。
//
// 【为什么需要】`usePhoneCall` 要的 `bridge.makePhoneCall(number)` 在 App 端一直没有宿主方法
//   ⇒ 恒抛 `phone-call.unsupported`。三端平台本来都能"唤起拨号盘"⇒ 属"有平台能力、没接线"。
//
// 【★★语义边界（必须写在代码旁边，别被读成"能打电话"）】
//   本方法**只拉起拨号盘并预填号码**，不发起通话、**不需要任何运行时权限**。
//   返回 `{dispatched:true}` = **已交给系统**，不是"已拨出"——是否真的拨由用户在拨号盘决定。
//   ★"直接拨出"是**另一个能力**（Android 需 `CALL_PHONE` 权限 + 审核；iOS 公开 API 做不到），
//     **不得**用同一个方法名偷换语义。
//
// 【★★号码校验（安全基线，同族 #1257 的凭据跨域）】
//   未校验的字符串拼进 `tel:` URI 就是注入面：`/`、`?`、`#`、`@` 都能改变 URI 结构，
//   构造出与业务意图不同的目标。⇒ 这里做**白名单**：`0-9 + - ( ) 空格 # * ,`，且至少 1 位数字。
//   ★非法**直接报错**，不"清洗后放行"——静默清洗 = 打到错的号，比报错更糟。
//   ★三端宿主**各自再校验一遍**（不信任 JS 层）：Android/iOS/鸿蒙的白名单与本文件同一集。
//     两层不是冗余：JS 层可能被业务绕过（直接调 `__proteusHostInvoke`），宿主层是最后一道。
//
// 【诚实边界】
//   · 模拟器没有拨号盘 ⇒ iOS 报 `unsupported`、Android 报失败（不是假成功）；
//   · 鸿蒙走"动作队列"（同步 napi 里不能 await `startAbility`）⇒ 回执是 `{accepted:true}`（已入队），
//     由 ArkTS 渲染后 drain 执行——与震动/亮度同一语义（见 `proteus_device.h` 头注释）。
import { invokeHost } from './capability-invoke'

/** 号码白名单（与三端宿主**同一集**，改一处要改四处）。 */
const PHONE_ALLOWED = /^[0-9+\-() #*,]+$/
/** 长度闸：E.164 最长 15 位数字；含分隔符给到 32 足够（防把整个 payload 塞进来） */
export const PHONE_MAX_LEN = 32

/**
 * 校验号码；非法抛 `Error`（调用方负责包成 CapError）。
 * ★导出以便判据直接验证规则本身，而不是只测"最终有没有报错"。
 */
export function assertPhoneNumber(number: unknown): string {
  if (typeof number !== 'string') throw new Error('phone-call.invalid: 号码必须是字符串')
  const s = number.trim()
  if (s.length === 0) throw new Error('phone-call.invalid: 号码为空')
  if (s.length > PHONE_MAX_LEN) {
    throw new Error(`phone-call.invalid: 号码过长（${s.length} > ${PHONE_MAX_LEN}）`)
  }
  if (!PHONE_ALLOWED.test(s)) {
    // ★错误信息里**不回显原始号码**（可能敏感，且会进日志）
    throw new Error('phone-call.invalid: 号码含非法字符（只允许 0-9 + - ( ) 空格 # * ,）')
  }
  if (!/[0-9]/.test(s)) throw new Error('phone-call.invalid: 号码里没有数字')
  return s
}

/** 桥成员对象（★抽取器契约：顶层唯一 `return { 显式属性 }`） */
export interface AppPhoneBridge {
  makePhoneCall?: (phoneNumber: string) => Promise<void>
}

/** 宿主是否提供拨号能力（缺 `phone.call` ⇒ 不提供该方法 ⇒ usePhoneCall 如实 unsupported） */
export function appPhoneCallAvailable(): boolean {
  const r = invokeHost('phone.call', { probe: true })
  // 与 capability-app-log/storage 同款写法（短路联合窄化）
  return r.ok || !(!r.ok && r.missing)
}

export function createAppPhone(): AppPhoneBridge {
  return {
    makePhoneCall: (phoneNumber: string) => {
      // ★★★必须返回 **rejected Promise**，不能同步 throw：
      //   本方法签名是 `Promise<void>`（与 Web/MP 契约一致），调用方按 `await` 写 ⇒
      //   同步抛错会绕过 `try/catch` 之外的 `.catch()`/Result 包装，变成"未捕获异常"。
      //   本仓既有约定：异步桥的错误一律走 rejection（见 capability-app-log 的 tooLarge 同理）。
      let number: string
      try {
        number = assertPhoneNumber(phoneNumber)
      } catch (e) {
        return Promise.reject(e instanceof Error ? e : new Error(String(e)))
      }
      const r = invokeHost('phone.call', { number })
      if (!r.ok) {
        return Promise.reject(new Error(`phone-call.failed: 宿主拒绝拨号（${r.reason ?? '未知原因'}）`))
      }
      // ★宿主回执两种形态都接受：直接派发（Android/iOS 的 `{dispatched:true}`）
      //   或已入队（鸿蒙的 `{accepted:true}`）——**不得**把"已入队"报成"已拨出"。
      //   本方法签名是 `Promise<void>`（与 Web/MP 契约一致），所以这里只做"受理"语义。
      return Promise.resolve()
    },
  }
}
