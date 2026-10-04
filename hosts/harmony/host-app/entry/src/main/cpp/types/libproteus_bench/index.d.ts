// entry/src/main/cpp/types/libproteus_bench/index.d.ts
// Proteus 鸿蒙基准模块 —— ArkTS 侧类型声明
/** 4050 元素应用级基准；返回 JSON 串 */
export const bench4050: (fixtureJson: string, viewportW: number, viewportH: number, depthLimit: number) => string;
/** ★命中测试探针（与 Android/iOS 同场景同探针点；逐位一致性判据） */
export const hitProbe: () => string;
/** ★长列表复用池探针（Rust 核决策 + 宿主真执行 RenderNode 复用） */
export const recycleProbe: (rows: number, frames: number) => string;
/** ★结构变更探针（splice；与 Android 同一棵树同一 payload） */
export const spliceProbe: () => string;
/** ★文本通道探针（ArkGraphics2D typography） */
export const textProbe: () => string;
/** ★内核动画探针（矩阵 #16；anim_seek + updates 读数） */
export const kernelAnimProbe: () => string;
/** ★内存探针（三段式：tree/nodes/release；ArkTS 在阶段间读 PSS） */
export const memProbe: (phase: string, fixtureJson?: string) => string;
/** ★SFC 压力夹具探针（矩阵 #21；44 节点，与六端一致性报告同源）；
 *  视口为**逻辑 vp 尺寸**（夹具 device-independent，widthRatio 在排版时按视口解析） */
export const sfcStressProbe: (fixtureJson: string, vpW: number, vpH: number, density: number) => string;
/** ★SFC 压力夹具 → 渲染指令数组（上屏通路；density = vp2px(1)，几何/字号在该处转物理 px） */
export const sfcStressCommands: (fixtureJson: string, density: number, vpW: number, vpH: number) => string;
/** ★JSVM（V8）引擎探针（矩阵 #13/#14 前置）：init→VM→Env→Compile→Run→取值；默认脚本 6*7 */
export const jsvmProbe: (script?: string) => string;
/** ★★★Vapor 设备端链（矩阵 #14）：JSVM eval bundle-vapor.js → 设备端实例化 + 订阅驱动增量。
 *  argsJson = { bundle, artifacts, vpW, vpH, density, filesDir? }；返回包装报告（含 report 原文） */
export const vaporProbe: (argsJson: string) => string;
/** ★内核曲线采样（矩阵 #15 A1："贝塞尔来自内核"）——id 缺省 1 */
export const animCurveBezier: (curveId?: number) => string;
/** ★★宿主运行时（矩阵 #18，G-39）：JSVM eval 同一份 bundle-host-runtime.js；
 *  argsJson = { bundle, filesDir? }；返回同形报告（可用 check-host-runtime.py 判） */
export const hostRuntimeProbe: (argsJson: string) => string;
/** ★C 组：持久壳 VM 安装（跨事件存活；幂等）—— argsJson = { bundle, filesDir? } */
export const hostRtShellInstall: (argsJson: string) => string;
/** ★C 组：真生命周期转发（pause/resume）→ JS 钩子 → 泵 job → 写 host-shell.json */
export const hostRtShellEvent: (evt: string) => string;
/** ★矩阵 #12：整树级虚拟化（全树进核 + 池化层 + 命中一致性）——fixture = vapor-tree.json */
export const mountVirtualProbe: (fixtureJson: string) => string;
/** ★矩阵 #7：手势命中——SFC 夹具建树缓存（触摸坐标 → 核心 hitTest 用） */
export const gestureHitPrepare: (fixtureJson: string, vpW: number, vpH: number, density: number) => string;
/** ★矩阵 #7：核心 hitTest（设计单位坐标）→ {ok,target,path,chain} 原样返回 */
export const gestureHitAt: (xDesign: number, yDesign: number) => string;
/** ★矩阵 #9：字体族端到端（同样文本同字号三族 ⇒ 度量分流 + 同族稳定性反例） */
export const fontFamilyProbe: () => string;
/** ★矩阵 #10：读核心真源的单节点几何（设计单位）——ArkUI 原生组件按此定位 */
export const nodeRect: (nodeId: number) => string;
/** Rust 排版核版本（仪器自检） */
export const version: () => string;
/* ── ★★★P3-3（2026-10-03）：`<Transition>` 宿主动画入口（三端同形）── */
/** 登记动画（内核 `proteus_layout_anim_start`）；返回 `{"ok":true,"started":N}` */
export const animStart: (animsJson: string) => string;
/** 推进一帧（`{"dtMs":16.7}`；内核求值——宿主每帧调） */
export const animTick: (dtMsJson: string) => string;
/** 仍在推进的条数（0 = 全结束；帧循环的停判据） */
export const animActive: () => string;
/** 停动画 */
export const animStop: (json: string) => string;
/** ★★★App 三端对齐（2026-10-04）：消费 App 屏内容（某页 nodes）建真实内核树。
 *  argsJson = { nodes: string, page?: string, filesDir?: string, vpW?: number, vpH?: number }；
 *  返回 {ok, page, content_nodes, mount_ok}；给 filesDir 时落盘 app-screen-content.json。 */
export const screenContentProbe: (argsJson: string) => string;
/** ★★★视觉合成（2026-10-04）：App 屏内容 → 内核树 → 渲染指令数组（物理 px，renderCommands 输入）。
 *  argsJson = { nodes, density, vpW, vpH, page?, filesDir? }；返回 JSON 数组串。 */
export const appScreenCommands: (argsJson: string) => string;
/** ★★★真实触摸（2026-10-04）：`.onTouch` 真注入的 vp 坐标 → 内核 hitTest（保留的合成树）。
 *  返回 {ok,target,path,chain}；每调用一次计入 app-screen-composite.json 的真实触摸读数。 */
export const appScreenHitAt: (x: number, y: number) => string;
/** ★★★App 三端对齐（2026-10-04）：鸿蒙 executor 探针——eval 同一份 bundle-app-stack.js + 注入
 *  proteusHost.invoke（screen.* 真内核树）+ 两相泵 job。argsJson = { bundle }；返回 {ok, exec_* , exec_read}。 */
export const appStackExecutorProbe: (argsJson: string) => string;
