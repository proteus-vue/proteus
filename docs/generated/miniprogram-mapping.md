# 小程序全量能力对照矩阵（自动生成——SSOT = packages/component-ir/src/audit.ts MP_MAPPING_MATRIX）

> ★由 `npm run gen:docs` 生成，勿手改。这是机器事实（catalog 与矩阵实时同步）；手工规划叙述见 `proteus-semantic-primitives-plus-plan/miniprogram-mapping.md`。
> 总计 71 项（组件 42 + API 29）；✅ 55 · 🔄 11 · ⬛ 5 · ❌ 0

## 组件对照表

| 小程序组件 | Proteus 原语 | 状态 |
|-----------|-------------|------|
| `<view>` | layout.box / layout.stack | ok |
| `<text>` | ui.text / ui.heading | ok |
| `<image>` | ui.image | ok |
| `<scroll-view>` | layout.scroll / layout.virtual-list | ok |
| `<swiper>` | layout.stack snap/loop（消灭为属性） | ok |
| `<swiper-item>` | layout.stack 子项 | ok |
| `<movable-area>` | gesture.scrollable 容器 | ok |
| `<movable-view>` | gesture.draggable | ok |
| `<cover-view>` | p-overlay (L2) | compat |
| `<cover-image>` | p-overlay + ui.image | compat |
| `<icon>` | ui.icon | ok |
| `<progress>` | p-progress (L2) | compat |
| `<rich-text>` | ui.rich-text | ok |
| `<button>` | ui.button | ok |
| `<form>` | ui.form | ok |
| `<input>` | ui.input | ok |
| `<textarea>` | ui.textarea | ok |
| `<checkbox>` | ui.checkbox | ok |
| `<radio>` | ui.radio | ok |
| `<picker>` | ui.picker / ui.select | ok |
| `<picker-view>` | ui.picker mode=wheel | ok |
| `<slider>` | ui.slider | ok |
| `<switch>` | ui.switch | ok |
| `<label>` | p-label (L2) | compat |
| `<navigator>` | engineering.router-link / router.* | ok |
| `<audio>` | ui.media kind=audio（消灭为属性） | ok |
| `<video>` | ui.media kind=video（消灭为属性） | ok |
| `<camera>` | p-camera (L2) + capability.camera | ok |
| `<live-player>` | ui.media kind=live（消灭为属性） | ok |
| `<live-pusher>` | ui.media kind=live mode=push | ok |
| `<canvas>` | ui.canvas | ok |
| `<map>` | p-map (L2) + capability.map | ok |
| `<web-view>` | p-webview (L2) | compat |
| `<editor>` | ui.rich-text editable | ok |
| `<ad>` | p-ad (L2) | compat |
| `<official-account>` | capability.mini-program（微信私有） | private |
| `<open-data>` | capability.mini-program（微信私有） | private |
| `<share-element>` | p-share-element (L2) | compat |
| `<aria-component>` | p-aria (L2) | compat |
| `<page-container>` | p-page-container (L2) | compat |
| `<voip-room>` | capability.mini-program（微信 VOIP） | private |
| `<guild-room>` | capability.mini-program（微信游戏） | private |

## API 对照表

| 小程序 API | Proteus 原语 | 状态 |
|-----------|-------------|------|
| `wx.request/upload/download/websocket（网络）` | capability.fetch/upload/download/websocket | ok |
| `wx.requestPayment` | capability.payment | ok |
| `wx.chooseImage/chooseMedia/previewImage（媒体）` | capability.camera + ui.image preview | ok |
| `wx.startRecord/RecorderManager（录音）` | capability.microphone | ok |
| `wx.createVideoContext/CameraContext` | capability.media + ui.media | ok |
| `wx.scanCode` | capability.qr-code / capability.scan-qr | ok |
| `wx.saveImageToPhotosAlbum` | capability.album (L2) | compat |
| `wx.getFileSystemManager/*（文件 30+）` | capability.file-system | ok |
| `wx.compressFile/unzip` | capability.archive | ok |
| `wx.set/get/remove/clearStorage(+Sync)` | capability.storage | ok |
| `wx.getLocation/chooseLocation/openLocation` | capability.location | ok |
| `wx.createMapContext` | capability.map | ok |
| `wx.getSystemInfo（设备/屏幕/网络/电量/亮度/方向/震动/传感器/剪贴板/电话）` | capability.device/screen/network/battery/brightness/orientation/vibrate/sensor/clipboard/phone-call | ok |
| `wx.openBluetoothAdapter（蓝牙 20+）` | capability.bluetooth | ok |
| `wx.getHCEState（NFC）` | capability.nfc | ok |
| `wx.checkIsSupportFingerPrint/FaceID` | capability.biometric / face-id | ok |
| `wx.showToast/showLoading/showModal/showActionSheet` | shell.toast + capability.toast/loading + shell.modal + shell.action-sheet | ok |
| `wx.setNavigationBarTitle/Color` | shell.nav | ok |
| `wx.setTabBarItem/Style/hide/show` | shell.tabbar | ok |
| `wx.pageScrollTo` | capability.page-scroll | ok |
| `wx.createAnimation` | engineering.animation | ok |
| `wx.createSelectorQuery/IntersectionObserver` | capability.element / intersection | ok |
| `wx.navigateTo/redirectTo/navigateBack/switchTab/reLaunch` | engineering.router-push/replace/back/switch-tab/relaunch | ok |
| `wx.getCurrentPages` | engineering.route | ok |
| `App()/Page() 生命周期/getApp()` | engineering.lifecycle + capability.app-lifecycle/page-lifecycle | ok |
| `wx.shareAppMessage/requestSubscribeMessage` | capability.share / notification | ok |
| `wx.login/checkSession/getUserInfo/authorize` | capability.login / auth / permission | ok |
| `wx.getUpdateManager` | capability.update (L2) | compat |
| `wx.requestWeChatPay/navigateToMiniProgram/模板消息/客服（微信私有）` | capability.mini-program | private |
