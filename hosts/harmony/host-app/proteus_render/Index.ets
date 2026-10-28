// proteus_render/Index.ets —— HAR 的 ArkTS 入口（重导出原生模块的类型与符号）
//
// 【关注点分层】见 hosts/README-LAYERS.md：本文件属 runtime（项目无关）。
//   消费方（宿主工程）通过 ohpm 依赖本 HAR，即可 `import { attach, renderCommands, ... } from 'proteus_render'`；
//   原生 `.so`（libproteus_render.so）由 HAR 的 native 部分编译并随消费方 HAP 打包。
export {
  attach,
  renderCommands,
  // ★★★"跳变驱动动画"（本批）：内核逐帧视觉 → RenderNode
  applyNodeVisuals,
  // ★★★Dactyl 专项：按下态直写 RenderNode（{} ⇒ 还原）
  applyPressVisual,
  stats,
  platformAnimBegin,
  platformAnimStep,
  platformAnimEnd,
  platformAnimSave,
  clearRoot,
  scrollRoot,
  // ★★★决策 #842：内容渲染模式切换（"render-node" 缺省 / "self-draw" 进程内自绘 ⇒ 玻璃同帧）
  setContentMode,
  gestureInstall,
  gestureSample,
  // ★★★决策 #840/#841：节点快照能力探针（玻璃背景捕获来源取证）
  snapshotProbe,
  // ★★★决策 #841：离屏 Vulkan 玻璃 pass 探针（GPU 单源取证）
  vkGlassProbe,
  // ★★★决策 #841：玻璃 GPU pass 集成（内容快照 → 离屏 Vulkan → 落覆盖节点背景图）
  glassPass,
  // ★★★决策 #847：自绘玻璃性能基线读数（帧数/均值/最大/p50/p95 ms）
  glassStats,
  // ★★★决策 #847：设置顶部避让区（状态栏高，物理 px）——内容裁到其下（防滚进状态栏区）
  setTopInset,
  // ★★★决策 #905：玻璃触控形变（命中交互玻璃 → 记触点；逐帧 press lerp）
  glassTouch,
  glassStep,
} from 'libproteus_render.so'
export type { ProteusRenderStats } from 'libproteus_render.so'

// 宿主桥（appScreen 桥 + 壳生命周期桥 + 应用运行期驱动）——同属 HAR runtime
export {
  appScreenCommands,
  appScreenContentHeight,
  appScreenHitAt,
  appScreenNodeRect,
  appScreenAnimTick,
  // ★★★Dactyl 专项：场跟手一步（内核 follow_field_bin → 12B/条 → JSON）
  appScreenFollowField,
  hostRtShellInstall,
  hostRtShellEvent,
  // ★★★#1187：沙箱根注入（savePath 落盘）
  setHttpSandboxRoot,
  // ★T-app-fetch：真机 HTTP 通路判据（空 VM + 真实 invokeBytes + 真网络）
  hostHttpProbe,
  // ★★★#1156：传输层事实取证（同一 VM 连发 N 轮同 host:port ⇒ 服务端判连接复用）
  hostTransportProbe,
  // ★★设备与系统域（决策 #1067）：设备快照注入 + 动作队列 drain
  setDeviceSnapshot,
  drainDeviceActions,
  hostAppBoot,
  hostAppDrive,
  hostAppRender,
  hostAppEval,
  // ★★★"跳变驱动动画" + "v-pump"（本批）：一次性 VM 会话四入口 + 读数
  hostAppPumpTick,
  hostAppPumpHzSet,
  hostAppAnimAttach,
  hostAppAnimTick,
  hostAppAnimStats,
  // ★★★切页残留动画修复（2026-10-11）：壳每轮渲染前清动画会话（旧页 spec 错打新页节点）
  hostAppAnimReset,
  // ★★★#1342-A：#540 决策门（持久 VM 探针，真机判据专用）
  hostVmSessionProbe,
  // ★★★#1342 B-0：整包 Vue bundle 版（真实微任务压力）
  hostVmSessionBundleProbe,
} from 'libproteus_host.so'

// ★★★应用运行期驱动（v-pump 周期驱动 + 跳变驱动动画）——**runtime 归属的唯一实现**（决策 #796）：
//   任何鸿蒙壳 `import { AppRuntimeDriver } from 'proteus_render'` 一次装配即得全部能力（壳内零驱动代码）。
//   ★构造参数 = **回调分解**（实测：ArkTS 拒收"跨 HAR 接口 + 对象字面量"⇒ 不用 host 对象形态）。
export { AppRuntimeDriver } from './AppRuntimeDriver'

// ★★★B · 能力归 runtime（决策 #800）：**tab 栏 chrome**（唯一实现）——任何鸿蒙壳
//   `ProteusTabChrome({ stateJson, onTab })` 一次装配即得（壳零 tab 逻辑；含解析/着色/角标/字形）。
export { ProteusTabChrome } from './TabChrome'
export type { TabItemFinal } from './TabChrome'
