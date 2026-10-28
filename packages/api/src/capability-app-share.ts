// packages/api/src/capability-app-share.ts
// ★★★#1336 App 能力 C22：`share` —— 系统分享面板（App 桥实现）。
//
// 【为什么需要】`useShare` 要的 `bridge.share(options)` 在 App 端一直没有宿主方法
//   ⇒ `capability.ts` 里 `wrap(bridge.share(options))` 直接抛 `TypeError: bridge.share is not a function`
//   （**不是** `share.unsupported`，业务连"本端不支持"都读不到）。三端平台本来都能弹系统分享面板
//   ⇒ 属"有平台能力、没接线"。
//
// 【★语义边界：这是"把内容交给系统分享面板"，不是"分享到某个具体 App"】
//   调用返回只代表**面板已拉起**；用户选哪个目标、是否真的发出去，由系统 UI 决定。
//   ★与 `wx.shareAppMessage`（分享到微信会话）**语义不同**——本方法对齐的是 **Web Share API**
//     （`navigator.share({title,text,url})`）。不要在能力页上写成"分享到微信"。
//
// 【★★输入校验（安全基线，与 #1285 号码白名单同族）】
//   ① **至少有一项内容**：三项全空 = 无意义调用（也防"空 Intent 拉起一个空面板"）。
//   ② **长度上限**：Android 的 Intent extra 走 Binder，超限抛 `TransactionTooLargeException`
//     （表现为"分享失败"，且异常发生在系统侧、难以归因）⇒ 文本 8 KiB / 标题 256 字符。
//   ③ **URL scheme 白名单 = http/https**：分享面板会把 URL 交给**别的 App**。
//      `file:` / `javascript:` / `content:` / 自定义 scheme 一旦流出，等于把本机私有路径或
//      可执行语义递给了任意接收方（Intent/URL 重定向同族风险，#1257 的跨域凭据是同一条线）。
//      ⇒ **非法一律报错，不做"清洗后放行"**（静默清洗 = 把一个业务没写过的链接发出去）。
//   ④ 三端宿主**各自再校验一遍**（不信任 JS 层）：业务可直接调 `__proteusHostInvoke` 绕过这里。
//
// 【诚实边界】
//   · **模拟器/无分享目标**：Android 无任何可分享 App 时 `createChooser` 仍会拉起（系统 fallback），
//     iOS 模拟器有系统面板；鸿蒙走动作队列 ⇒ 回执是 `{accepted:true}`（已入队），
//     由 ArkTS 渲染后 drain 执行——与震动/拨号同一语义（见 `proteus_device.h` 头注释）。
//   · 判据验"面板真的拉起了"，**不验**"用户选了某个目标并发送成功"（那属系统 UI 内的行为）。
//   · ★★**真机证据（如实分端）**：iOS 10/10（`hosts/ios/run-share-probe.sh`，含宿主层直调两条）；
//     鸿蒙 11/11（`hosts/harmony/run-share-probe.sh`，含设备日志 `PROTEUS_SHARE_OK` = 面板真拉起）；
//     **Android 的探针脚本已就绪但本机无设备 ⇒ 未跑**（`hosts/android/run-share-probe.sh`），
//     届时需补跑并回填本行，别把"代码编译过"读成"真机验过"。
//   · ★★★**本文件不得使用 `new URL()`**：App 精简引擎（QuickJS/JSC 精简版）没有 URL 构造器。
//     实测（#1336 首跑）：Node 下 `capability-app-share` 单测 8/8 全绿，而 iOS 真机
//     `useShare({url:'https://proteus.dev/'})` 返回 `share.invalid: url 不是合法绝对地址`
//     ——「单测全绿 ≠ 真机可用」，同族既有记录：无 TextDecoder #1071 / 无 TextEncoder #1095 /
//     `capability-fetch-redirect.ts` 的 resolveLocation 注释。⇒ URL 校验一律走纯正则。
import { invokeHost } from './capability-invoke'

/** 文本上限：8 KiB（≈ 一段长文；也远低于 Binder 事务上限） */
export const SHARE_MAX_TEXT_LEN = 8192
/** 标题上限：256 字符 */
export const SHARE_MAX_TITLE_LEN = 256
/** URL 长度上限：2 KiB（浏览器实践上限；超长 URL 本身也不可信） */
export const SHARE_MAX_URL_LEN = 2048
/** URL 允许的 scheme（★白名单，不是黑名单——见文件头 ③） */
export const SHARE_ALLOWED_SCHEMES = ['http:', 'https:'] as const

/** 归一化后的分享载荷（三端宿主收到的形状） */
export interface NormalizedSharePayload {
  title?: string
  text?: string
  url?: string
}

/**
 * 校验并归一化分享选项；非法抛 `Error`（调用方负责包成 rejection）。
 * ★导出以便判据直接验证规则本身，而不是只测"最终有没有报错"。
 */
export function assertShareOptions(options: unknown): NormalizedSharePayload {
  if (options === null || typeof options !== 'object') {
    throw new Error('share.invalid: 参数必须是 { title?, text?, url? } 对象')
  }
  const o = options as { title?: unknown; text?: unknown; url?: unknown }
  const out: NormalizedSharePayload = {}

  if (o.title !== undefined && o.title !== null) {
    if (typeof o.title !== 'string') throw new Error('share.invalid: title 必须是字符串')
    const t = o.title.trim()
    if (t.length > SHARE_MAX_TITLE_LEN) {
      throw new Error(`share.invalid: title 过长（${t.length} > ${SHARE_MAX_TITLE_LEN}）`)
    }
    if (t.length > 0) out.title = t
  }

  if (o.text !== undefined && o.text !== null) {
    if (typeof o.text !== 'string') throw new Error('share.invalid: text 必须是字符串')
    // ★不 trim 文本（首尾空白可能是业务有意为之，比如代码片段）；只判长度
    if (o.text.length > SHARE_MAX_TEXT_LEN) {
      throw new Error(`share.invalid: text 过长（${o.text.length} > ${SHARE_MAX_TEXT_LEN}）`)
    }
    if (o.text.length > 0) out.text = o.text
  }

  if (o.url !== undefined && o.url !== null) {
    if (typeof o.url !== 'string') throw new Error('share.invalid: url 必须是字符串')
    const u = o.url.trim()
    if (u.length > 0) {
      if (u.length > SHARE_MAX_URL_LEN) {
        throw new Error(`share.invalid: url 过长（${u.length} > ${SHARE_MAX_URL_LEN}）`)
      }
      /* ★★★不用 `new URL(u)`（真机实测踩过，见「诚实边界」里那条）：
         App 精简引擎（QuickJS/JSC 精简版）**没有 URL 构造器** ⇒ Node 下单测全绿、
         真机上 `new URL('https://proteus.dev/')` 直接抛 ⇒ 被判"不是合法绝对地址"。
         这与 `capability-fetch-redirect.ts` 的 `resolveLocation` 是**同一条平台事实**
         （同族：无 TextDecoder #1071 / 无 TextEncoder #1095）。
         ⇒ 改为纯正则：① 必须有 scheme；② scheme 必须在白名单；
           ③ http(s) 必须带 authority（`https://` 后面至少一个非分隔字符）。 */
      const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(u)
      if (!schemeMatch) {
        throw new Error('share.invalid: url 不是合法绝对地址（缺少 scheme）')
      }
      const scheme = schemeMatch[1]!.toLowerCase()
      if (!(SHARE_ALLOWED_SCHEMES as readonly string[]).includes(`${scheme}:`)) {
        throw new Error(`share.invalid: url 只允许 http/https（收到 ${scheme}:）`)
      }
      if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/?#\s]/.test(u)) {
        // ★不回显原始 URL（可能带 token/查询串，且会进日志）
        throw new Error('share.invalid: url 不是合法绝对地址（缺少主机名）')
      }
      out.url = u
    }
  }

  if (!out.title && !out.text && !out.url) {
    throw new Error('share.invalid: 分享内容为空（title/text/url 至少给一项）')
  }
  return out
}

/** 桥成员对象（★抽取器契约：顶层唯一 `return { 显式属性 }`） */
export interface AppShareBridge {
  share?: (options: { title?: string; text?: string; url?: string }) => Promise<void>
}

/** 宿主是否提供分享能力（缺 `share` ⇒ 不提供该方法 ⇒ useShare 如实 unsupported） */
export function appShareAvailable(): boolean {
  const r = invokeHost('share', { probe: true })
  // 与 capability-app-phone/log 同款写法（短路联合窄化）：missing ⇒ 宿主没有该方法
  return r.ok || !(!r.ok && r.missing)
}

export function createAppShare(): AppShareBridge {
  return {
    share: (options: { title?: string; text?: string; url?: string }) => {
      // ★★★必须返回 rejected Promise，不能同步 throw（签名是 Promise<void>，与 Web/MP 契约一致）：
      //   同步抛错会绕过调用方的 `.catch()`，变成"未捕获异常"（#1285 同款坑）。
      let payload: NormalizedSharePayload
      try {
        payload = assertShareOptions(options)
      } catch (e) {
        return Promise.reject(e instanceof Error ? e : new Error(String(e)))
      }
      const r = invokeHost('share', payload)
      if (!r.ok) {
        // ★missing（宿主未实现）也应落到这里：装配层已用 appShareAvailable() 挡过一层，
        //   但业务可能绕过装配直接构造桥 ⇒ 保留分档信息在 reason 里。
        const kind = r.missing ? 'share.unsupported' : 'share.failed'
        return Promise.reject(new Error(`${kind}: 宿主拒绝分享（${r.reason ?? '未知原因'}）`))
      }
      // ★宿主回执两种形态都接受：直接拉起（Android/iOS 的 `{dispatched|presented:true}`）
      //   或已入队（鸿蒙的 `{accepted:true}`）——**不得**把"已入队"报成"已分享成功"。
      //   本方法签名是 `Promise<void>`（与 Web/MP 契约一致），所以这里只做"受理"语义。
      return Promise.resolve()
    },
  }
}
