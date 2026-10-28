// website/scripts/lib/capability-docs.mjs
// ★★★决策 #1084（2026-10-19）：能力页的**人话描述 + 端实现边界**（SSOT）。
//
// 【为什么需要（用户原话）】「能力描述太过专业化，能力原语 C77 · capability.beacon · 返回 BeaconAPI ·
//   Hook 已实现（API 就绪，双端桥见下表）。这一句话还是不知道这个能力是做什么的。
//   还有就是文档没有把我们端实现边界写清楚。」
//
// 【问题定性】此前能力页标题下只有一行**自动生成的机器标识**（原语编号 + 语义 id + 返回类型 +
//   "Hook 已实现"），而这一行回答的是"它叫什么、实现了没"，**不是"它能做什么"**。
//   对使用者（要选能力的业务方）来说，这行等于没说。同时"兼容进度"表只给状态标记
//   （✅/🟡/⚠️），不说**为什么不能用**、**能不能降级**——边界靠猜。
//
// 【本模块的做法】给每个能力补两条人可读信息：
//   ① `CAPABILITY_GUIDE`：**一句话干什么 + 典型用途**（中英各一份，业务视角、不出现内部术语）；
//   ② `CAPABILITY_END_NOTE`：**端实现边界**（仅在"某端不可用/有语义差异"时登记一句实话，
//      **必须说清原因与替代路径**，不是重复状态标记）。
//   生成器把它们排到标题正下方（`capabilityIntro()`），兼容进度表仍保留细节。
//
// 【★覆盖门禁】`assertGuideCoverage()`：84 个能力**缺一条人话描述就抛错**——
//   否则新增能力会静默沿用机器标识那行（正是本轮要消灭的形态）。

/**
 * 一条能力的人话说明。
 * @typedef {{ zh: { what: string, use: string }, en: { what: string, use: string } }} CapabilityGuide
 */

/** 简写构造：`S(中文干什么, 中文什么时候用, English what, English use)` */
const S = (whatZh, useZh, whatEn, useEn) => ({
  zh: { what: whatZh, use: useZh },
  en: { what: whatEn, use: useEn },
})

/**
 * ★能力人话说明（键 = `capability.<slug>`，与 `PRIMITIVE_CATALOG` 的 semantic 一一对应）。
 *
 * 写作约定（**别退回技术腔**）：
 *   · `what` = 一句话说"它让 App 能做哪件事"，**不出现** API 名/原语编号/返回类型；
 *   · `use` = 一个具体场景（"什么情况下该选它"），让读者能对号入座；
 *   · 面向**选能力的业务方**，不是面向读源码的人（技术细节留给下面的签名与方法表）。
 */
export const CAPABILITY_GUIDE = {
  // ── 媒体 ──
  'capability.camera': S('调用摄像头拍照或录像，并把画面实时显示在页面上。', '扫码、证件拍摄、直播前置画面。',
    'Take photos or record video with the camera, and show a live preview on the page.', 'QR scanning, ID capture, live-stream preview.'),
  'capability.microphone': S('录音并把音频保存成文件，或实时拿到音量。', '语音消息、录音笔记、音量可视化。',
    'Record audio to a file, or read live volume levels.', 'Voice messages, audio notes, volume visualisation.'),
  'capability.map': S('在页面里嵌入地图，控制标记点、视野与路线。', '门店位置、配送轨迹、地图选点。',
    'Embed a map and control markers, viewport and routes.', 'Store locator, delivery tracking, picking a point.'),
  'capability.album': S('从相册选图/选视频，或把图片保存到相册。', '头像上传、晒图、保存生成的图片。',
    'Pick images/videos from the album, or save images to it.', 'Avatar upload, sharing photos, saving generated images.'),
  'capability.video': S('播放视频，并控制播放进度、音量与全屏。', '课程视频、商品详情视频。',
    'Play video with control over progress, volume and fullscreen.', 'Course videos, product videos.'),
  'capability.audio': S('播放音频，并控制播放、暂停、进度与音量。', '背景音乐、语音播报。',
    'Play audio with play/pause/seek/volume control.', 'Background music, spoken announcements.'),
  'capability.live-pusher': S('把摄像头画面推流到直播服务。', '商家直播、活动直播。',
    'Push camera video to a live-streaming service.', 'Merchant or event live streaming.'),
  'capability.live': S('嵌入直播间（观看与互动）。', '电商带货、活动观看。',
    'Embed a live room for watching and interaction.', 'Livestream commerce, event viewing.'),
  'capability.data-channel': S('在直播/实时场景里传小数据（连麦状态、信令）。', '直播间连麦、实时投票。',
    'Exchange small real-time messages inside a live session.', 'Co-hosting, live polls.'),
  'capability.image-edit': S('裁剪、旋转、编辑图片。', '头像裁剪、海报二次编辑。',
    'Crop, rotate and edit images.', 'Avatar cropping, editing a generated poster.'),
  'capability.media-processing': S('封装媒体文件、解码视频、处理音视频轨道。', '视频压缩转封装、抽帧。',
    'Mux media files, decode video and process audio/video tracks.', 'Re-muxing, frame extraction.'),
  'capability.poster': S('把内容（文字、二维码、图片）合成一张海报图片。', '分享海报、活动邀请卡。',
    'Compose text, QR codes and images into one poster image.', 'Share posters, invite cards.'),

  'capability.ar': S('在相机画面上叠加虚拟物体（ARKit / ARCore / VKSession 一类的空间跟踪）。',
    '虚拟试穿、家具摆放预览、AR 导航箭头。',
    'Overlay virtual objects on the camera feed using spatial tracking.',
    'Virtual try-on, furniture preview, AR navigation arrows.'),
  // ── 设备与系统 ──
  'capability.location': S('拿到用户的经纬度（GPS 或基站定位）。', '附近门店、打卡、配送地址。',
    'Get the user latitude/longitude from GPS or network positioning.', 'Nearby stores, check-in, delivery address.'),
  'capability.sensor': S('读加速度计、陀螺仪、罗盘（一次读取或持续采样）。', '摇一摇、步数、指南针、姿态识别。',
    'Read accelerometer, gyroscope and compass — once or as a stream.', 'Shake, step counting, compass, orientation.'),
  'capability.vibrate': S('让手机震动一下（短震或长震）。', '点击反馈、错误提示、提醒。',
    'Vibrate the phone briefly or for a longer duration.', 'Tap feedback, error alerts, reminders.'),
  'capability.battery': S('读电量百分比与是否在充电。', '省电模式、低电量提示。',
    'Read battery percentage and charging state.', 'Power-saving mode, low-battery prompts.'),
  'capability.network': S('读当前网络类型（WiFi/蜂窝/离线）并订阅变化。', '弱网提示、仅 WiFi 上传。',
    'Read the current network type and subscribe to changes.', 'Weak-network hints, Wi-Fi-only uploads.'),
  'capability.clipboard': S('读剪贴板文字，或把文字写进剪贴板。', '复制邀请码、粘贴地址。',
    'Read text from the clipboard, or write text into it.', 'Copying invite codes, pasting addresses.'),
  'capability.screen': S('读屏幕宽高与像素密度。', '自适应布局、按机型调整。',
    'Read screen size and pixel density.', 'Adaptive layout, per-device tuning.'),
  'capability.device': S('读机型、系统版本等设备标识信息。', '问题排查、按机型做兼容。',
    'Read device model and OS version info.', 'Troubleshooting, per-device compatibility.'),
  'capability.orientation': S('读屏幕方向（横屏/竖屏）并订阅旋转。', '视频全屏、横屏游戏、旋转布局。',
    'Read screen orientation and subscribe to rotation.', 'Fullscreen video, landscape games, adaptive layout.'),
  'capability.brightness': S('读当前屏幕亮度，或调亮调暗。', '夜间模式、扫码时临时提亮。',
    'Read or set the screen brightness.', 'Night mode, brightening for QR scanning.'),
  'capability.keyboard': S('拿到软键盘弹起的高度与显示状态。', '输入框不被键盘遮挡、聊天输入栏上推。',
    'Get the software keyboard height and visibility.', 'Keeping inputs visible, pushing chat bars up.'),
  'capability.keep-screen-on': S('让屏幕保持常亮不自动锁屏。', '看视频、看菜谱、导航。',
    'Keep the screen awake (prevent auto-lock).', 'Watching video, following a recipe, navigation.'),
  'capability.element-query': S('按选择器查页面元素的实际位置与尺寸。', '做锚点定位、测量布局、引导浮层对齐元素。',
    'Query an element on-screen position and size by selector.', 'Anchoring overlays, measuring layout.'),
  'capability.intersection': S('监听元素是否进入/离开可视区域。', '曝光统计、上拉加载更多、懒加载。',
    'Observe whether an element enters or leaves the visible area.', 'Impression tracking, infinite scroll, lazy loading.'),
  'capability.media-query': S('按屏幕尺寸等条件监听"当前是哪种布局断点"。', '响应式布局、平板/手机不同排版。',
    'Watch responsive breakpoints such as screen width.', 'Responsive layout for phone vs tablet.'),
  'capability.screen-capture': S('查询设备是否正在被录屏/投屏，以及用户是否刚刚截屏；部分端可查画中画。', '隐私提示、截屏分享引导、防录屏水印。',
    'Detect whether the device is being recorded/mirrored, and whether the user just took a screenshot.', 'Privacy hints, share-after-screenshot, watermarking.'),
  'capability.cache-manager': S('为网络请求配置缓存规则（最大存活时间、弱网策略），并清理缓存。', '离线可用、弱网加速、按域名清缓存。',
    'Configure HTTP caching rules (max-age, weak-network policy) and clear cache.', 'Offline support, weak-network speed-up, per-origin cache clearing.'),
  'capability.beacon': S('扫描身边的 iBeacon 蓝牙信标，拿到信标标识与信号强度（据此估算距离）。',
    '室内定位、到店提醒、博物馆展项讲解、场馆签到打卡——GPS 在室内不准时用它。',
    'Scan nearby iBeacon BLE beacons and read their identifiers and signal strength to estimate proximity.',
    'Indoor positioning, proximity prompts, museum audio guides, venue check-in — when GPS is not accurate indoors.'),
  'capability.local-service': S('在局域网里发现/广播服务（mDNS）。', '同一 WiFi 下发现打印机、投屏设备、局域网协作。',
    'Discover or advertise services on the local network (mDNS).', 'Finding printers or cast devices on the same Wi-Fi.'),
  'capability.device-capability': S('探测设备支持哪些高级能力（如 HEVC 硬解）。', '按设备能力选择视频编码或降级方案。',
    'Probe optional device capabilities such as HEVC decoding.', 'Choosing a video codec or fallback per device.'),

  // ── 网络与通信 ──
  'capability.fetch': S('发一个 HTTP 请求并拿到返回数据。', '调后端接口、拉列表、提交表单。',
    'Send an HTTP request and get the response data.', 'Calling APIs, loading lists, submitting forms.'),
  'capability.websocket': S('和服务器建立长连接，双向实时收发消息。', '聊天、实时协作、行情推送。',
    'Open a persistent bidirectional connection to a server.', 'Chat, real-time collaboration, market data.'),
  'capability.socket-task': S('管理一条 WebSocket 连接的完整生命周期。', '需要断线重连、多路复用时的长连接。',
    'Manage the full lifecycle of one WebSocket connection.', 'Long-lived connections with reconnection.'),
  'capability.socket': S('直接用 UDP/TCP 收发原始字节。', '物联网设备通信、自定义协议。',
    'Send and receive raw bytes over UDP or TCP.', 'IoT device protocols, custom protocols.'),
  'capability.upload': S('上传文件到服务器，并拿到进度。', '上传头像、证件、视频。',
    'Upload a file to a server with progress.', 'Uploading avatars, documents, videos.'),
  'capability.download': S('从服务器下载文件，并拿到进度。', '下载附件、离线包、导出文件。',
    'Download a file from a server with progress.', 'Attachments, offline bundles, exports.'),
  'capability.bluetooth': S('连接低功耗蓝牙设备并读写特征值。', '手环、体脂秤、蓝牙打印机。',
    'Connect to BLE peripherals and read/write characteristics.', 'Wearables, smart scales, BLE printers.'),
  'capability.nfc': S('读/写 NFC 标签，或模拟卡（HCE）。', '门禁卡、公交卡、NFC 标签防伪。',
    'Read/write NFC tags or emulate a card (HCE).', 'Access cards, transit cards, tag authentication.'),
  'capability.wifi': S('读当前 WiFi 信息，或连接指定 WiFi。', '配网、门店 WiFi 引导。',
    'Read current Wi-Fi info or connect to a specific network.', 'Device provisioning, in-store Wi-Fi onboarding.'),

  // ── 用户与账号 ──
  'capability.permission': S('查询并申请系统权限（相机、定位、通知等）。', '首次使用前的授权引导。',
    'Check and request system permissions (camera, location, notifications).', 'First-use permission prompts.'),
  'capability.auth': S('走登录授权流程并拿到登录态。', '手机号/第三方登录。',
    'Run an authorization flow and obtain a session.', 'Phone or third-party sign-in.'),
  'capability.login': S('调用平台登录拿到临时凭证，换取自己的登录态。', '微信登录、静默登录。',
    'Get a platform login code to exchange for your own session.', 'WeChat login, silent login.'),
  'capability.biometric': S('调指纹/人脸做本机身份校验。', '支付确认、敏感操作二次验证。',
    'Verify identity locally with fingerprint or face.', 'Payment confirmation, re-auth for sensitive actions.'),
  'capability.face-id': S('人脸识别（活体检测）验证身份。', '实名认证、门禁刷脸。',
    'Face recognition with liveness detection.', 'Identity verification, face-access control.'),
  'capability.privacy': S('查询并引导用户同意隐私协议。', '首次启动的隐私弹窗。',
    'Check and obtain privacy-policy consent.', 'First-launch privacy consent dialog.'),

  // ── 支付与商业化 ──
  'capability.payment': S('发起支付并拿到支付结果。', '下单付款、充值。',
    'Start a payment and receive the result.', 'Checkout, top-ups.'),
  'capability.in-app-purchase': S('走应用商店内购（订阅/消耗型商品）。', '会员订阅、去广告。',
    'Use in-app purchase for subscriptions or consumables.', 'Memberships, removing ads.'),
  'capability.ad': S('展示激励视频、插屏、横幅广告并拿收益回调。', '看广告解锁、流量变现。',
    'Show rewarded video, interstitial or banner ads.', 'Unlock-by-ad, ad monetisation.'),

  // ── 内容与分享 ──
  'capability.share': S('把内容分享到微信好友/朋友圈等渠道。', '邀请好友、分享商品。',
    'Share content to chat apps and social feeds.', 'Invites, sharing products.'),
  'capability.qr-code': S('扫码识别二维码/条形码，或生成二维码。', '扫码登录、扫码付款、生成分享码。',
    'Scan QR/barcodes, or generate QR codes.', 'Scan-to-login, scan-to-pay, share codes.'),
  'capability.translation': S('触发系统翻译（用户主动翻译页面文字）。', '多语言页面、跨境内容。',
    'Trigger system translation of on-page content.', 'Multilingual pages, cross-border content.'),
  'capability.document-preview': S('在应用内预览 PDF/Office 等文档。', '查看合同、发票、电子票据。',
    'Preview PDF/Office documents inside the app.', 'Contracts, invoices, e-receipts.'),
  'capability.mini-program': S('跳转到另一个小程序/应用。', '跳合作方小程序、打开地图导航。',
    'Jump to another mini program or app.', 'Partner mini programs, opening maps.'),

  // ── 数据与存储 ──
  'capability.storage': S('在本地持久保存键值数据。', '登录态、草稿、用户偏好。',
    'Persist key-value data locally.', 'Sessions, drafts, user preferences.'),
  'capability.file-system': S('读写本地文件与目录。', '导出文件、缓存大文件。',
    'Read and write local files and directories.', 'Exporting files, caching large assets.'),
  'capability.archive': S('压缩、解压文件或目录。', '打包日志、解压离线包。',
    'Compress or extract files and directories.', 'Bundling logs, unpacking offline bundles.'),
  'capability.cookie': S('读写 HTTP Cookie。', '维持 Web 视图登录态。',
    'Read and write HTTP cookies.', 'Keeping web-view sessions.'),
  'capability.preload': S('提前预加载资源或页面，减少后续等待。', '首屏加速、预载下一页。',
    'Preload assets or pages ahead of time.', 'Faster first paint, preloading the next page.'),
  'capability.performance': S('采集页面性能指标。', '监控启动耗时、卡顿。',
    'Collect page performance metrics.', 'Monitoring startup time and jank.'),
  'capability.analytics': S('上报业务埋点事件。', '转化漏斗、功能使用统计。',
    'Report analytics events.', 'Conversion funnels, feature usage stats.'),
  'capability.log': S('统一输出日志（可上报）。', '线上问题排查。',
    'Emit unified logs, optionally uploaded.', 'Production troubleshooting.'),
  'capability.webassembly': S('加载并执行 WebAssembly 模块。', '跑高性能计算、复用 C/Rust 库。',
    'Load and execute WebAssembly modules.', 'Heavy computation, reusing C/Rust libraries.'),

  // ── 应用与生命周期 ──
  'capability.app-lifecycle': S('监听 App 进入前台/后台/启动。', '前后台暂停任务、回到前台刷新。',
    'Observe app launch, foreground and background transitions.', 'Pausing work in background, refreshing on resume.'),
  'capability.page-lifecycle': S('监听页面加载/显示/隐藏/卸载。', '进入页面拉数据、离开时清理。',
    'Observe page load/show/hide/unload.', 'Fetching on enter, cleaning up on leave.'),
  'capability.background': S('申请后台继续运行一段时间。', '上传大文件、定位上报。',
    'Request extra background execution time.', 'Large uploads, location reporting.'),
  'capability.idle': S('把不紧急的工作排到浏览器/设备空闲时执行。', '预计算、缓存预热。',
    'Defer non-urgent work until the device is idle.', 'Precomputation, cache warming.'),
  'capability.window': S('调整窗口尺寸/层级（分屏、悬浮窗场景）。', '平板分屏、悬浮播放。',
    'Adjust window size or layering (split-screen, floating windows).', 'Tablet split view, floating video.'),
  'capability.navigation-guard': S('在用户离开页面前拦截并询问（如未保存的编辑）。', '表单防误退、离开确认。',
    'Intercept navigation away from a page to confirm.', 'Unsaved-form protection, leave confirmation.'),
  'capability.update': S('检查并应用应用/小程序的版本更新。', '强制更新、灰度发布。',
    'Check for and apply app/mini-program updates.', 'Forced updates, staged rollouts.'),
  'capability.shortcut': S('把入口添加到桌面。', '高频功能快捷方式。',
    'Add a home-screen shortcut.', 'Quick access to frequent features.'),
  'capability.extension': S('加载宿主提供的扩展/插件能力。', '宿主注入的业务扩展点。',
    'Load host-provided extensions/plugins.', 'Host-injected extension points.'),
  'capability.embedded': S('读"当前被谁嵌入"的宿主上下文。', '同一份页面嵌进不同 App 时区分来源。',
    'Read the embedding host context.', 'Adapting one page embedded in different host apps.'),
  'capability.worker': S('把耗时计算放到后台线程，避免卡住界面。', '大文件解析、复杂计算、加解密。',
    'Run heavy work on a background thread to keep the UI smooth.', 'Large parsing, heavy computation, crypto.'),
  'capability.canvas': S('在画布上绘制图形、文字并导出图片。', '图表、签名板、海报生成。',
    'Draw shapes and text on a canvas and export images.', 'Charts, signature pads, poster generation.'),

  // ── 联系方式与设备外设 ──
  'capability.contact': S('从通讯录选择一个联系人。', '填写收货人、邀请好友。',
    'Pick a contact from the address book.', 'Filling in a recipient, inviting friends.'),
  'capability.address': S('调用平台的收货地址选择器。', '下单填写收货地址。',
    'Use the platform shipping-address picker.', 'Checkout shipping address.'),
  'capability.calendar': S('往系统日历添加日程。', '课程表、活动提醒。',
    'Add events to the system calendar.', 'Class schedules, event reminders.'),
  'capability.phone-call': S('直接调起系统拨号界面并填入号码。', '联系客服、一键呼救、商家电话。',
    'Place a phone call.', 'Calling support, emergency dial.'),
  'capability.sms': S('发送短信（平台受限，多数端只能跳到短信界面）。', '验证码、通知短信。',
    'Compose or send SMS (platform-limited on most ends).', 'Verification codes, notifications.'),
  'capability.notification': S('申请订阅消息/推送通知。', '订单状态提醒、营销触达。',
    'Request subscription messages or push notifications.', 'Order updates, marketing reach.'),
  'capability.we-run': S('读微信运动的步数数据。', '运动排行、步数兑换。',
    'Read WeRun step data.', 'Step leaderboards, step-to-reward.'),

}

/**
 * ★端实现边界（**只在"某端不可用/有语义差异"时登记**；必须说清**原因**与**替代路径**）。
 *
 * 写作约定：一句话，格式 `不可用原因 → 替代/降级`。不要重复兼容表的状态标记（那是结论，这是理由）。
 * 未登记的能力 ⇒ 认为各端边界与兼容表一致（无需额外解释）。
 */
export const CAPABILITY_END_NOTE = {
  'capability.beacon': {
    zh: '**微信端可用，其余端如实不可用**。用法上有个容易漏的步骤：**必须先调 `startBeaconDiscovery(uuids)` 才会收到 `onUpdate`**——不搜索就订阅，微信端不会有任何回调（错误码 11004 通常意味着缺少定位/蓝牙授权）。Web 端浏览器没有 iBeacon 扫描 API（Web Bluetooth 需用户手势且不自带信标帧解析）；App 三端宿主均未实现 BLE 扫描。',
    en: '**Usable on WeChat; honestly unavailable elsewhere.** One step is easy to miss: you **must call `startBeaconDiscovery(uuids)` before `onUpdate` fires** — subscribing without starting discovery yields no callbacks on WeChat (error 11004 usually means location/Bluetooth permission is missing). Browsers expose no iBeacon scanning API (Web Bluetooth needs a user gesture and does not parse beacon frames); no App host implements BLE scanning yet.',
  },
  'capability.websocket': {
    zh: '**四端可用**（Web / 微信 / App-iOS / App-Android，两端均已真机验证）；**鸿蒙未接线**（宿主没有 ws 通道）。用法上有个易错点：`useWebSocket()` 成功只代表**连接已受理**，`open` 事件才是"连上了"的证据——App 端尤其如此（`ws.open` 受理即返，不阻塞 JS 线程等握手）。发送失败走 `error` 事件（`send` 不抛，与浏览器一致）。实现上两端形态不同：iOS 用系统 `URLSessionWebSocketTask`，Android 因构建不允许引依赖而**手写 RFC 6455**（握手/Mask/分片/close 帧）。**安全链（#1344 P4）**：WebSocket 与 HTTP 走**同一套**出网治理 —— `createCapabilityHooks({ allowedDomains })` **一处配置、两条通道**（共用 `isHostAllowed`；不传=不限制；`*.example.com` 只匹配**一级**子域）。被拒时**宿主一次都不会被调用**（错误码 `websocket.forbidden`），且白名单检查**排在并发额度之前**（否则恶意域名能刷满 64 个额度挤掉合法业务）。传输层主机名校验在 Android 上是**真缺陷**并已修：`createSocket()` + `connect()` 只校验证书链、**不比对主机名** ⇒ 任意域名的合法证书都能冒充；现显式设 `setEndpointIdentificationAlgorithm("HTTPS")` 并调 `startHandshake()`。iOS 保持 `delegate: nil`（系统默认处理才含主机名比对）。**诚实边界**：`wss://` 的 SPKI pinning **三端都未实现**。',

    en: '**Available on four targets** (Web / WeChat / App-iOS / App-Android, both App ends device-verified); **not wired on HarmonyOS** (no ws channel in the host). One easy mistake: a successful `useWebSocket()` only means the **connection was accepted** — the `open` event is the proof it is connected (especially on App, where `ws.open` returns immediately instead of blocking the JS thread on the handshake). Send failures surface through the `error` event (`send` does not throw, matching the browser). The two App implementations differ because the platforms do: iOS uses the system `URLSessionWebSocketTask`; Android hand-writes RFC 6455 because the build has no dependency manager. **Security chain (#1344 P4)**: WebSocket now goes through the **same egress governance as HTTP** — `createCapabilityHooks({ allowedDomains })` configures **one rule for both channels** (shared `isHostAllowed`: unset = unrestricted; `*.example.com` matches **one** level only). A blocked connection never reaches the host (error code `websocket.forbidden`), and the allowlist check runs **before** the concurrency quota so a hostile domain cannot exhaust the 64 slots. Transport-level hostname verification was a real defect on Android (`createSocket()` + `connect()` validates the chain but **not the hostname**) — now sets `setEndpointIdentificationAlgorithm("HTTPS")` and calls `startHandshake()` explicitly. iOS keeps `delegate: nil` (the system default is what performs hostname checking). **Honest limit**: SPKI pinning for `wss://` is **not implemented on any target**.',

  },
  'capability.intersection': {
    zh: 'Web / 微信 / App-iOS / App-Android **可用**（相交计算在 JS，宿主只推几何 tick）；**鸿蒙不可用**——一次性 VM 下观察者无法跨渲染存活。诚实边界：只监听滚动等"几何可能变了"的时机，**纯布局变化与动画位移不触发**。',
    en: '**Works on Web / WeChat / App-iOS / App-Android** (intersection math runs in JS; the host only pushes geometry ticks). **Not on HarmonyOS** — observers cannot survive across renders in its one-shot VM. Honest limit: it reacts to "geometry may have changed" moments such as scrolling; **pure layout changes and animated movement do not fire**.',
  },
  'capability.element-query': {
    zh: 'App 端**只支持 `#id` / `.class` / `tag` / 复合 / 后代 / `>` / 选择器列表 / `[attr]`**；兄弟（`+` `~`）、伪类、伪元素、属性运算符（`^=` 等）返回 `unsupported`（**原因**：自绘树没有兄弟序与 CSS 引擎语义；不做近似匹配）。动态 `:id`/`:class`/`:data-*` 在编译期产诊断，这类节点**查不到**。',
    en: 'On App ends only `#id` / `.class` / `tag` / compound / descendant / `>` / selector lists / `[attr]` are supported; sibling combinators, pseudo-classes/elements and attribute operators return `unsupported`. Dynamic `:id`/`:class`/`:data-*` are diagnosed at build time and cannot be queried.',
  },
  'capability.screen-capture': {
    zh: '各端能查的字段**不同**（逐方法独立分档，查不了返回 `unsupported`、**不伪造 false**）：Android 无公开录屏查询（仅 API 34+ 本人窗口截屏回调 + 本应用画中画）；iOS 有 `UIScreen.isCaptured` 与截屏通知、**无全局画中画查询**；鸿蒙三项都支持但读数来自**渲染时刻快照**（延迟 = 一次渲染间隔），且**无用户截屏事件**。',
    en: 'Capabilities differ per end (each method is graded independently; unavailable methods return `unsupported` and never a faked `false`): Android has no public recording query (only API 34+ screenshot callback for its own window and its own PiP state); iOS has `UIScreen.isCaptured` plus screenshot notifications but no global PiP query; HarmonyOS supports all three but values come from a per-render snapshot and it has no user-screenshot event.',
  },
  'capability.cache-manager': {
    zh: 'App 端**无对等物**（HTTP 缓存策略由各端网络栈自行决定），三端均返回 `unsupported`。需要离线能力请用 `useStorage` / `useFileSystem` + 本地 ETag 策略自行实现。',
    en: 'No App-end equivalent (HTTP caching is owned by each platform network stack); all three App ends return `unsupported`. For offline needs, use `useStorage` / `useFileSystem` with your own ETag strategy.',
  },
  'capability.ar': {
    zh: '需要平台 AR/XR 会话能力（微信 VKSession）：App 三端**未接线**。若只需"相机 + 平面覆盖"可用 `useCamera` 自行合成。',
    en: 'Requires a platform AR/XR session (WeChat VKSession); App ends are not wired. If you only need camera plus a plane overlay, compose it with `useCamera`.',
  },
  'capability.translation': {
    zh: 'Web 端**只有空订阅**（无标准翻译触发 API——`Translation` 实验特性未普及）：订阅后**永远收不到回调**，平台标记为可用但实际不工作。App 三端未接线。需要翻译请自行调翻译服务。',
    en: 'On Web this is an **empty subscription** (no standard translation-trigger API): it never fires, so the platform looks wired but does nothing. App ends are not wired. Call a translation service yourself.',
  },
  'capability.poster': {
    zh: 'Web 端**只有空订阅**（海报生成需画布合成，各端未接）；App 端依赖 `useCanvas`（当前 planned）。实际可用的是微信小程序。',
    en: 'Web exposes an **empty subscription** only — poster composition **requires** a canvas pipeline that is **missing** on Web; App ends depend on `useCanvas` (planned). Only the WeChat mini program is actually usable today.',
  },
  'capability.local-service': {
    zh: '**微信 + App 两端可用；Web 不可用**（浏览器没有 mDNS 服务发现 API）。用法上有个容易漏的步骤：**必须先调 `startDiscovery(serviceType)` 才会收到 `onFound`**——订阅本身不会启动搜索。★这个契约缺陷本轮才补：此前只有四个订阅、没有启停开关，等于给业务一个"照文档写完什么都不会发生"的接口（与 `useBeacon` 同一族缺陷）。两端形态差异：Android 用 `NsdManager`（`onServiceFound` 之后需**二次 resolve** 才拿得到 ip/port）；iOS 用 `NWBrowser` + `NetService` 解析。',
    en: '**Usable on WeChat and both App targets; not on Web** (browsers expose no mDNS discovery API). One step is easy to miss: you **must call `startDiscovery(serviceType)` before `onFound` fires** — subscribing alone does not start discovery. ★That contract gap was fixed in this batch: it previously had four subscriptions and no start/stop switch, i.e. an interface where following the docs produces no events at all (the same family as `useBeacon`). The two App implementations differ: Android uses `NsdManager` (a second **resolve** is required after `onServiceFound` to get ip/port); iOS uses `NWBrowser` plus `NetService` resolution.',
  },
  'capability.nfc': {
    zh: 'HCE 卡模拟**仅**部分安卓机型与小程序支持（**限制**：iOS 只开放标签读取 Core NFC，**不能模拟卡**）。',
    en: 'HCE card emulation is limited to some Android devices and mini programs; iOS only allows tag reading (Core NFC), not emulation.',
  },
  'capability.bluetooth': {
    zh: 'iOS 需要 `NSBluetoothAlwaysUsageDescription` 与真机；Web 走 Web Bluetooth 受浏览器与用户手势限制（页面内无法后台扫描）。',
    en: 'iOS requires the Bluetooth usage description and a real device; Web Bluetooth is browser-gated and requires a user gesture (no background scanning in a page).',
  },
  'capability.biometric': {
    zh: '仅"本机校验"（指纹/面容）——**不是**服务端可验证的凭据；需要服务端确认时请与自有鉴权组合。',
    en: 'Local verification only (fingerprint/face) — not a server-verifiable credential; combine with your own auth when the server must confirm.',
  },
  'capability.face-id': {
    zh: '活体检测依赖平台能力（iOS Face ID / Android 厂商生物识别）；Web 无对等。',
    en: 'Liveness detection depends on platform capability (iOS Face ID / Android vendor biometrics); no Web equivalent.',
  },
  'capability.sms': {
    zh: '绝大多数端**只能跳转到短信界面**并预填内容，无法静默发送（操作系统限制）。',
    en: 'Most ends can only open the SMS composer with prefilled content; silent sending is blocked by the OS.',
  },
  'capability.notification': {
    zh: '小程序为"订阅消息"（需用户每次授权、次数受限）；App 需先申请系统通知权限；Web 走 Notification API 且需用户手势。',
    en: 'Mini programs use subscription messages (per-use consent, limited count); App ends need notification permission first; Web uses the Notification API behind a user gesture.',
  },
  'capability.extension': {
    zh: 'iOS **禁止**动态加载第三方代码（App Store 政策）；Android/鸿蒙可用宿主侧注册表实现。',
    en: 'iOS forbids dynamic loading of third-party code (App Store policy); Android/HarmonyOS can implement it via a host-side registry.',
  },
  'capability.mini-program': {
    zh: 'iOS **无小程序概念**（只能 URL Scheme / Universal Link 跳转）；Android 视宿主而定。',
    en: 'iOS has no mini-program concept (URL Scheme / Universal Link only); Android depends on the host app.',
  },
  'capability.window': {
    zh: 'App 端为**全屏单窗口**应用：只能读尺寸，**不能**程序化改窗口大小（分屏由系统控制）。',
    en: 'App ends are full-screen single-window apps: size can be read but not changed programmatically (split view is system-controlled).',
  },
  'capability.background': {
    zh: '后台执行时长由系统决定并随时可被回收；iOS 需声明 `UIBackgroundModes`，Android 需前台服务。不要把它当保证。',
    en: 'Background time is **only** system-granted and revocable — **requires** `UIBackgroundModes` on iOS and a foreground service on Android. Treat it as best-effort.',
  },
  'capability.keep-screen-on': {
    zh: 'Web 需 Screen Wake Lock API 且要求页面可见；App 端走系统常亮标记。',
    en: 'Web **requires** the Screen Wake Lock API and a visible page (**限制**: no background wake lock); App ends use the platform keep-awake flag.',
  },
  'capability.we-run': {
    zh: '仅微信小程序提供（需用户在微信运动授权）；其他端**无对等数据源**——App 端要步数请接系统健康数据（iOS HealthKit / Android Health Connect）。',
    en: 'Provided only by the WeChat mini program; no equivalent data source elsewhere.',
  },
  'capability.privacy': {
    zh: '隐私授权是平台合规流程（小程序/App 商店要求）；Web 无对等，返回 `unsupported`。',
    en: 'Privacy consent is a platform compliance flow (mini program / app store); Web has no equivalent and returns `unsupported`.',
  },
  'capability.data-channel': {
    zh: '仅直播/实时容器内有意义（微信直播组件）；其他端无载体。',
    en: 'Only meaningful inside a live/realtime container (WeChat live component); no carrier elsewhere.',
  },
  'capability.live': {
    zh: '仅小程序提供直播组件；App 端需自行接入第三方直播 SDK。',
    en: 'Only mini programs provide a live component; App ends must integrate a third-party live SDK.',
  },
}

/**
 * 生成能力页开头的"人话说明"块。
 * @param {{ semantic: string, id: string, props?: string[] }} c 原语定义
 * @param {{ en?: boolean }} opts
 * @returns {string[]} markdown 行
 */
export function capabilityIntro(c, opts = {}) {
  const en = opts.en === true
  const g = CAPABILITY_GUIDE[c.semantic]
  if (!g) {
    throw new Error(
      `[capability-docs] 能力 ${c.semantic} 缺人话说明（CAPABILITY_GUIDE）——`
      + '新增能力必须补，否则官网只会显示机器标识（本模块存在的理由）',
    )
  }
  const t = en ? g.en : g.zh
  const L = en
    ? { what: '**What it does**: ', when: '**When to use it**: ', bound: '**End support & boundaries**: ' }
    : { what: '**它能做什么**：', when: '**什么时候用**：', bound: '**端实现边界**：' }
  const lines = []
  lines.push(L.what + t.what)
  lines.push('')
  lines.push(L.when + t.use)
  lines.push('')
  const note = CAPABILITY_END_NOTE[c.semantic]
  if (note) {
    lines.push(L.bound + (en ? note.en : note.zh))
    lines.push('')
  }
  // 技术标识行**后移**：它能回答"叫什么/实现了没"，但回答不了"做什么"（用户反馈的原话）
  lines.push(
    `> 技术标识：能力原语 ${c.id} · \`${c.semantic}\` · 返回 \`${(c.props ?? [])[0] ?? 'Result<T>'}\` · `
    + (en ? '**Hook implemented** (per-end support in the table below)' : '**Hook 已实现**（各端支持情况见下方兼容进度表）'),
  )
  lines.push('')
  return lines
}

/** 覆盖门禁：84 个能力都必须有人话说明（缺一个就抛）。 */
export function assertGuideCoverage(capabilities) {
  const missing = capabilities.map((c) => c.semantic).filter((s) => !(s in CAPABILITY_GUIDE))
  if (missing.length) {
    throw new Error(`[capability-docs] ${missing.length} 个能力缺人话说明：${missing.join(', ')}`)
  }
}
