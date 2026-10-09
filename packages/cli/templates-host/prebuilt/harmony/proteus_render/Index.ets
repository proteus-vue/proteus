// proteus_render/Index.ets —— HAR 的 ArkTS 入口（重导出原生模块的类型与符号）
//
// 【关注点分层】见 hosts/README-LAYERS.md：本文件属 runtime（项目无关）。
//   消费方（宿主工程）通过 ohpm 依赖本 HAR，即可 `import { attach, renderCommands, ... } from 'proteus_render'`；
//   原生 `.so`（libproteus_render.so）由 HAR 的 native 部分编译并随消费方 HAP 打包。
export {
  attach,
  renderCommands,
  stats,
  platformAnimBegin,
  platformAnimStep,
  platformAnimEnd,
  platformAnimSave,
  clearRoot,
  scrollRoot,
  gestureInstall,
  gestureSample,
} from 'libproteus_render.so'
export type { ProteusRenderStats } from 'libproteus_render.so'

// 宿主桥（appScreen 桥 + 壳生命周期桥 + 应用运行期驱动）——同属 HAR runtime
export {
  appScreenCommands,
  appScreenContentHeight,
  appScreenHitAt,
  appScreenNodeRect,
  appScreenAnimTick,
  hostRtShellInstall,
  hostRtShellEvent,
  hostAppBoot,
  hostAppDrive,
  hostAppRender,
  hostAppEval,
} from 'libproteus_host.so'
