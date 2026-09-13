// packages/built-in-components/src/open-type.ts
// 小程序 button open-type（share/contact/getUserInfo…）是原生开放能力，Web 端无微信对等——
// 点击时触发同名语义事件，由开发者自定义 Web 行为（如分享用 navigator.share）。
//
// ★★2026-09-13 契约修正（重要）：此前映射为 `opencontact`/`openshare`，前提「对齐 bindopenXXX」是**错的**——
//   微信官方 button 的事件名是 `bind:contact` / `bind:getphonenumber` / …（事件名 = 去掉 `bind:` 的驼峰，
//   与 open-type 取值对应），并无 `bindopencontact`/`bindopenshare`
//   （权威清单：docs/generated/miniprogram-component-attrs.json）。
//   旧命名导致「Web 发 opencontact、p-button 监听 @contact」两不相通 → **open-type 事件在 Web 端静默失效**。
//
//   现契约：**MP 有原生事件 → Web 发同名事件**（跨端一个 `@contact` 即可，见下「MP 原生事件」组）；
//   MP 无事件（share/feedback —— 原生能力直接生效，如 share 拉起分享面板）→ 发**同名 Web-only 降级事件**
//   （诚实标注：仅 Web 触发，MP 走原生能力不触发）。
export const OPEN_TYPE_EVENTS: Record<string, string> = {
  // —— 组 1：MP 有对应原生事件（`bind:<name>`）→ Web 发同名事件，跨端契约一致 ——
  getUserInfo: 'getuserinfo',
  contact: 'contact',
  liveActivity: 'createliveactivity',
  getPhoneNumber: 'getphonenumber',
  getRealtimePhoneNumber: 'getrealtimephonenumber',
  error: 'error',
  openSetting: 'opensetting',
  launchApp: 'launchapp',
  chooseAvatar: 'chooseavatar',
  agreePrivacyAuthorization: 'agreeprivacyauthorization',
  // —— 组 2：MP 无事件（原生能力直接生效）→ 同名 Web-only 降级事件 ——
  share: 'share',
  feedback: 'feedback',
}

/** ★MP 有原生事件的 open-type 集合（判定「Web-only 降级」用；见文件头分组说明） */
export const MP_NATIVE_EVENT_OPEN_TYPES = new Set([
  'getUserInfo', 'contact', 'liveActivity', 'getPhoneNumber', 'getRealtimePhoneNumber',
  'error', 'openSetting', 'launchApp', 'chooseAvatar', 'agreePrivacyAuthorization',
])

/** 开放能力标注：mpEvent=MP 有原生事件（跨端同名） / webOnly=MP 无事件（仅 Web 降级触发） */
export function openTypeStatus(openType: string): 'mpEvent' | 'webOnly' {
  return MP_NATIVE_EVENT_OPEN_TYPES.has(openType) ? 'mpEvent' : 'webOnly'
}

/** 兼容旧名（既有消费方）：full=有 Web 对等 / event=仅触发事件（无对等）。
 *  @deprecated 用 {@link openTypeStatus}（区分 mpEvent / webOnly 更准确） */
export const OPEN_TYPE_STATUS: Record<string, 'full' | 'event'> = Object.fromEntries(
  Object.keys(OPEN_TYPE_EVENTS).map((k) => [k, 'event']),
)
