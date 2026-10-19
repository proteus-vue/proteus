// packages/render-backend/src/host-invoke-contract.ts —— ★★★B2（宿主关注点分离 · G4）：宿主 `proteusHost.invoke` **方法契约**
//
// 【它解决什么】`proteusHost.invoke(method, argsJson)` 的方法名（`screen.*` + 能力族）此前**手抄**在
//   各端宿主里（Android `HostCapabilities`/`ScreenHost` · iOS `host-capabilities`/`screen-host` · 鸿蒙）
//   —— 增删一个方法要改多处、且必然漂移（本仓实测：iOS 漏 `webassembly.*`、鸿蒙缺整个能力族）。
//   本模块是方法名的**唯一契约**；门禁 `check:host-invoke-contract` 校验各端声明 ⊆ 契约 + 报告覆盖率。
//
// 【★诚实边界（各端合法差异）】契约是**超集**；某端可**不实现**某方法（由引擎/平台提供），记为
//   `HOST_METHOD_OPTIONAL[end]`（合法省略，非漂移）。未知方法（不在契约里）⇒ 门禁**红**（防拼写漂移/私增）。
//
// 【与 `@proteus-vue/api` 的关系】能力名与 `APP_NATIVE_METHODS`（packages/api/src/capability-app.ts，JS 侧消费）
//   的取值对齐（`host.context`/`update.check`/…）；本模块是**宿主侧**契约视图（含 `screen.*` + webassembly + native.calls）。

/** `screen.*` 执行器方法（三端**必须一致**——M5 执行器协议）。 */
export const HOST_SCREEN_METHODS = [
  'screen.mount',
  'screen.visible',
  'screen.destroy',
  'screen.anim',
  'screen.rect',
  'screen.shared',
  'screen.stats',
] as const

/** 能力族方法（`proteusHost.invoke` 非 `screen.*` 分支）。 */
export const HOST_CAPABILITY_METHODS = [
  // 宿主上下文 / 热更新 / 窗口
  'host.context',
  'update.check',
  'update.apply',
  'window.setSize',
  // Worker（G-39 后台线程）
  'worker.create',
  'worker.post',
  'worker.terminate',
  // 空闲回调 / 预加载 / 扩展
  'idle.request',
  'idle.cancel',
  'preload.assets',
  'extension.load',
  // 跳其他小程序（App 端对齐 Web：通常无对等）
  'mini-program.navigate',
  // WebAssembly（宿主运行时；★引擎内置 WASM 的端可不实现——见 HOST_METHOD_OPTIONAL）
  'webassembly.instantiate',
  'webassembly.validate',
  'webassembly.call',
  'webassembly.release',
  // 宿主自报调用记账（判据"能力经壳执行"）
  'native.calls',
  // ★★C26 网络请求（App 腿 · S2/#903）：`http.request` 经二进制帧（`PINV`/`PRSP`）派发，
  //   宿主实现 = HttpCapability（Android 已接 / iOS 已接 / 鸿蒙未做——门禁按覆盖率如实报缺）。
  'http.request',
  // ★★C27 WebSocket（#1093）：连接/发送/关闭三个方法都**受理即返**，事件经壳推送达。
  'ws.open',
  'ws.send',
  'ws.close',
  // ★★dev 通道 · 项目 console 回收（决策 #730）：页面 `console.*` 经垫片 → `invoke('dev.console', {level,text})`
  //   ⇒ 宿主回收，渲染收尾带走（面板 Console·项目通道）。★当前仅鸿蒙 runtime 声明（一次性 VM 无法用
  //   `post` 反向通道；Android/iOS 走 `proteusHost.post`）——他端不实现 ⇒ 覆盖率如实报缺（非漂移）。
  'dev.console',
  // ★★2026-10-19（决策 #1067）：能力对齐专项「设备与系统」域 12 项。
  //   方法名契约与 `packages/api/src/capability-app-device.ts::APP_DEVICE_METHODS` 对齐（改一处必须改两处）。
  'device.vibrate',
  'device.network',
  'clipboard.read',
  'clipboard.write',
  'device.screen',
  'device.info',
  'device.battery',
  'device.orientation',
  'device.brightness.get',
  'device.brightness.set',
  'device.keepScreenOn',
  'device.hevc',
  // ★★2026-10-19（决策 #1080）：C5 传感器（App 端订阅式 API；read = 订阅→首采样→取消）
  'device.sensor.read',
  'device.sensor.start',
  'device.sensor.stop',
  // ★★★2026-10-19（决策 #1081）：**元素查询**（`useElement` 选择器通路）。
  //   `{nodeId}` → `{ok,x,y,width,height,scrollY}`——**内容坐标 + 逻辑 px**（宿主报告自己的滚动偏移，
  //   JS 侧统一减掉得到 Web `getBoundingClientRect()` 的视口坐标语义 ⇒ 三端一套归一实现）。
  //   ★selector → nodeId 的映射**不在宿主**（宿主只认数字 id）：由 `render-backend/src/element-registry.ts`
  //     在知道元素身份的那一层建索引（Vapor 实例化 / Vue patchProp 两条链都写它）。
  //   ★三端实现：Android `VaporRenderHost.elementRect` · iOS `SelfDrawBridge.elementRect` ·
  //     鸿蒙 `host_app_runtime_impl.h`（读 `g_elTree` = 上一帧内核树，一次性 VM 的必然形态）。
  'element.rect',
  // ★★★决策 #1083：录屏/截屏状态（C71 `useScreenCapture`）——一次取全部状态。
  //   ★回执里**缺字段 = 该端查不了**（桥给 unsupported，绝不伪造 false）：
  //     Android 无公开录屏查询 · iOS 无全局 PiP 查询 · 鸿蒙无用户截屏事件。
  'device.capture',
] as const

/** **合法省略**（某端不实现但非漂移——由引擎/平台提供）。键 = 端名（`android`/`ios`/`harmony`）。 */
export const HOST_METHOD_OPTIONAL: Record<string, readonly string[]> = {
  // iOS JSC 内建 WebAssembly（`typeof WebAssembly === 'object'`）⇒ 壳不实现 `webassembly.*`。
  ios: ['webassembly.instantiate', 'webassembly.validate', 'webassembly.call', 'webassembly.release'],
  // 鸿蒙：能力族尚未接线（memUsage/gc 之外）——★**缺失已登记**（非合法省略；门禁以"覆盖率"报告，不静默）。
}

/** 契约全量（能力 + 屏幕）。 */
export const HOST_INVOKE_METHODS: readonly string[] = [...HOST_CAPABILITY_METHODS, ...HOST_SCREEN_METHODS]
