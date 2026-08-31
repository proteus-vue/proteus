// packages/types/src/mp/official-typings.ts
// ★types-plus-plan B8（§8）：小程序官方类型桥（miniprogram-api-typings）
// 职责：官方 d.ts 覆盖 wx.* / App/Page/Component 构造器参数 → Proteus 不自造，仅收敛别名；
//       业务/API 实现不直接 import 官方包，统一经本模块引用（§8.2）。
// ★激活方式：本文件自带 /// <reference types> —— 消费方（API/能力实现）import 本模块即获得
//   WechatMiniprogram 全局命名空间与 wx 精确类型（opt-in，不污染不 import 的编译单元）。
// ★注意：官方包为纯 ambient 声明（无模块导出），5.x 无 `import { RequestOption }` 形态；
//   类型一律走全局命名空间 WechatMiniprogram.*。

/// <reference types="miniprogram-api-typings" />

/** wx 全局对象类型（官方 Wx 接口，含 wx.router 等 Skyline API） */
export type Wx = WechatMiniprogram.Wx

/** wx.request 选项（B9 PlatformAPI 请求层的基础类型） */
export type WxRequestOption = WechatMiniprogram.RequestOption

/** wx.request 成功回调结果 */
export type WxRequestSuccessCallbackResult = WechatMiniprogram.RequestSuccessCallbackResult

/** wx.setStorage / wx.setStorageSync 选项（B9 存储层） */
export type WxSetStorageOption = WechatMiniprogram.SetStorageOption

/** wx.showToast 选项（UI 层） */
export type WxShowToastOption = WechatMiniprogram.ShowToastOption

/** wx.navigateTo 选项（路由层） */
export type WxNavigateToOption = WechatMiniprogram.NavigateToOption

/** wx.switchTab 选项（路由层） */
export type WxSwitchTabOption = WechatMiniprogram.SwitchTabOption

/** 官方命名空间整体（供需要完整官方类型的实现方引用；不自造等价类型） */
export type WxNamespace = typeof WechatMiniprogram
