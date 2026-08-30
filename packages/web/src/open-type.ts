// packages/web/src/open-type.ts
// ★小程序开放能力 open-type → Web 降级事件（14-mp-first-semantics，反黑盒）
// 小程序 button open-type（share/contact/getUserInfo…）是原生开放能力，Web 端无微信对等——
// 点击时触发对应自定义事件（openshare 等），由开发者自定义 Web 行为（如 navigator.share）；
// 事件命名规则：open + 驼峰（与小程序 bindopenXXX 事件对齐，如 bindopenshare）
export const OPEN_TYPE_EVENTS: Record<string, string> = {
  share: 'openshare',
  contact: 'opencontact',
  getUserInfo: 'opengetuseroinfo',
  getPhoneNumber: 'opengetphonenumber',
  launchApp: 'openlaunchapp',
  openSetting: 'openopensetting',
  feedback: 'openfeedback',
  chooseAvatar: 'openchooseavatar',
  agreePrivacyAuthorization: 'openagreeprivacyauthorization',
  getRealtimePhoneNumber: 'opengetrealtimephonenumber',
}

/** 开放能力状态标注：full=有 Web 对等 / event=仅触发事件（无对等） */
export const OPEN_TYPE_STATUS: Record<string, 'full' | 'event'> = Object.fromEntries(
  Object.keys(OPEN_TYPE_EVENTS).map((k) => [k, 'event']),
)
