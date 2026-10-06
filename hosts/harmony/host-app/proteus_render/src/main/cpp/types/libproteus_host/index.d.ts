// hosts/harmony/host-app/proteus_render/src/main/cpp/types/libproteus_host/index.d.ts
// Proteus 鸿蒙宿主桥原生模块 —— ArkTS 侧类型声明（与 proteus_host.cpp 的 Init 一一对应）
// ★属 HAR runtime（项目无关）：App 屏内容→内核树→RenderCmd 桥 + 壳生命周期桥。
//
// ★ArkTS 严格模式（arkts-no-any-unknown）：所有类型必须显式。
/** 内容 → 内核树 → RenderCmd 数组串（入参 {nodes,density,vpW,vpH,page?,filesDir?}） */
export const appScreenCommands: (json: string) => string;
/** 内容高（vp，供滚动范围钳制） */
export const appScreenContentHeight: () => number;
/** 真触摸命中（vp 坐标）→ 内核 hitTest JSON */
export const appScreenHitAt: (x: number, y: number) => string;
/** 屏转场动画推进一帧（16.7ms）；返回 JSON */
export const appScreenAnimTick: () => string;
/** 建立持久壳 VM（注入 proteusHost + 平台全局 → eval bundle → 探测生命周期钩子） */
export const hostRtShellInstall: (json: string) => string;
/** 真事件转发：__proteusHostShellLifecycle('pause'|'resume') + 泵 job + 读回 + 落盘 */
export const hostRtShellEvent: (evt: string) => string;
