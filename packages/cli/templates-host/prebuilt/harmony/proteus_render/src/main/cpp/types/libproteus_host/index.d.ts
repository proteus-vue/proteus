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
/** ★dev 元素高亮（决策 #729）：内核节点 rect（**cmd 同口径=物理 px**）→ `{ok,x,y,w,h}`；供叠一条半透明高亮框 */
export const appScreenNodeRect: (id: number) => string;
/** 屏转场动画推进一帧（缺省 16.7ms）；入参可选 `{"dtMs":n}` → 返回 JSON（与 proteus_host.cpp 的 AppScreenAnimTick 一致） */
export const appScreenAnimTick: (json?: string) => string;
/** ★★★Dactyl 专项（场跟手）：对保留的内核树调 `follow_field_bin`（12B/条）→
 *  `{"ok":true,"nodes":[{id,scale,rotate}]}`；入参 `{containerId,x,y,falloff,minScale,maxScale,rotate}`。
 *  ★调用频率纪律：**每帧最多一次**（MOVE 只记焦点——与 Android fieldDirty 同）。 */
export const appScreenFollowField: (json: string) => string;
/** 建立持久壳 VM（注入 proteusHost + 平台全局 → eval bundle → 探测生命周期钩子） */
export const hostRtShellInstall: (json: string) => string;
/** ★★★#1187：由 ArkTS 壳注入沙箱根目录（`savePath` 落盘需要；不注入 ⇒ 落盘如实报错） */
export const setHttpSandboxRoot: (dir: string) => string;
/** ★T-app-fetch 真机判据：空 VM + 真实 `invokeBytes` + 真网络（入参 {url}）→ JSON 回执 */
export const hostHttpProbe: (json: string) => string;
/** ★★★#1156 鸿蒙传输层事实取证：同一 VM 连发 N 轮同 host:port（入参 {url, rounds}）→ JSON 读数。
 *  ★**复用结论不在这里判**——协议/连接数只有服务端知道，由 runner 读 `/__stats` 判（同判据三端可比）。 */
export const hostTransportProbe: (json: string) => string;
/** ★★设备与系统域（决策 #1067）：ArkTS 注入设备快照 → C++ 侧回答 device.* 读类能力 */
export const setDeviceSnapshot: (json: string) => string;
/** ★★设备与系统域（决策 #1067）：取走 C++ 入队的设备动作（渲染后执行） */
export const drainDeviceActions: () => string;
/** 真事件转发：__proteusHostShellLifecycle('pause'|'resume') + 泵 job + 读回 + 落盘 */
export const hostRtShellEvent: (evt: string) => string;
/** ★应用运行期·启动（一次性 VM）：eval bundle → boot（路由栈 + 进入入口 tab）；入参 {bundle,filesDir} */
export const hostAppBoot: (json: string) => string;
/** ★应用运行期·驱动链（一次性 VM）：boot + 逐 tab 切页；入参 {bundle,filesDir,tabs?} */
export const hostAppDrive: (json: string) => string;
/** ★应用运行期·渲染（一次性 VM）：实例化某屏（+可选 tap 命中链）→ 返回 {current,state,snapshot,tree}；
 *  入参 {bundle,filesDir,page,viewport:{width,height},chain?:[],state?:{},remount?:bool} */
export const hostAppRender: (json: string) => string;
/** ★dev REPL（决策 #729）：一次性 VM 求值 JS 表达式；入参 {bundle,filesDir,expr} → {ok,value/error} */
export const hostAppEval: (json: string) => string;
/** ★★★v-pump 批量节拍（本批）：一次性 VM 内 boot + 渲染 + N 帧泵推进 + 重挂；
 *  入参 {bundle,page,viewport:{width,height},state?,dtMs?,frames?,chain?:[],gestureOnly?:bool}
 *  → {ok,fired,frames,eval_ms,pumpHz,current,state,snapshot,tree} */
export const hostAppPumpTick: (json: string) => string;
/** ★记录当前屏泵频率（判据/报告读数）；入参 = 频率列表 JSON（`[]` ⇒ 无泵） */
export const hostAppPumpHzSet: (hzJson: string) => string;
/** ★★★动画挂树（本批）：ArkTS 在**每次 appScreenCommands 建树后**调——把动画规格挂到新树 +
 *  重放到当前相位（一次性 VM ⇒ 树每次重建）；返回 `{ok,active,started,updates}`（updates 喂 applyNodeVisuals） */
export const hostAppAnimAttach: () => string;
/** ★★★动画帧推进（本批）：帧循环每 vsync 调；入参 `{"dtMs":n}` → `{ok,active,changed,updates}` */
export const hostAppAnimTick: (json: string) => string;
/** ★动画/泵会话读数（判据/报告）：`{starts,attaches,ticks,changed,active,elapsed_ms,have_spec,pump:{…}}` */
export const hostAppAnimStats: () => string;
/**
 * ★★★#1342-A：**#540 决策门**——持久 VM 探针（真机判据专用，**不参与生产路径**）。
 *
 * 验的是「跨 napi 调用复用同一个 JSVM 是否仍崩」这**一个**变量：
 *   创建 VM 一次 → 循环 N 轮（每轮只开/关一个内层 HandleScope + 显式 checkpoint）→ 最后才销毁。
 *
 * @param argsJson `{ rounds?: number, mode?: 'plain' | 'nav' | 'ref' }`
 * @returns 读数 JSON：`{ ok, rounds, roundsOk, firstFailureRound, firstFailureWhy,
 *          heapBeforeKB, heapAfterKB, heapPeakKB, heapGrowthPct, samples }`
 */
export const hostVmSessionProbe: (argsJson: string) => string;
/**
 * ★★★#1342 B-0：**整包 Vue bundle 版持久 VM 探针**。
 *
 * 与 `hostVmSessionProbe` 的区别：它把真实的 `bundle-superapp.js`（1.5MB）eval 进持久 VM，
 * 每轮调 `__proteusHostAppBootJson()`（createAppNavigation + createRouter 启动链），
 * 让**真实 Vue 运行时**产出微任务压力 —— 这是合成负载（plain/nav/ref）测不到的那一层。
 *
 * @param bundleJs 整包源码原文（**不走 JSON 转义**：1.5MB 转义既慢又易踩引号/换行坑）
 * @param rounds 轮数（默认 1000）
 * @returns 读数 JSON（比合成版多一个 `bootHook` 字段 = 整包入口的 typeof）
 */
export const hostVmSessionBundleProbe: (bundleJs: string, rounds?: number) => string;
/**
 * ★★★#1344 B-1：**会话式 VM**（一个 VM 跨 napi 调用存活）。
 *
 * 打开会话：建 VM → 注入 `proteusHost` → eval 整包 → boot，**不销毁**。
 * 之后每拍 `hostVmSessionTick()` 只推进微任务 + 搬运待回推帧 ⇒ **异步回推有了接收方**。
 *
 * ★单线程纪律：open/tick/close 必须由 ArkTS 主线程**串行**调用；
 *   网络线程只能 `hostVmSessionPushResolve()`（入队，不碰 JS）。
 *
 * @param bundleJs 整包源码原文（不走 JSON 转义）
 * @param doBoot `true`（默认）⇒ eval 后 boot；`false` ⇒ 只 eval（诊断形态）
 * @returns 读数 JSON（`open/ticks/pushed/pendingDepth/heapKB/boot`）
 */
export const hostVmSessionOpen: (bundleJs: string, doBoot?: boolean, jsStubHost?: boolean, autoMicrotask?: boolean) => string;
/** 会话节拍（推回推帧 + checkpoint）。@param maxPush 单拍最多推几帧（默认 64） */
export const hostVmSessionTick: (maxPush?: number) => string;/** 诊断用：把一个 PRSP 帧（**十六进制字符串**）塞进待回推队列，验"队列→tick→JS"通路 */
export const hostVmSessionPushResolve: (frameHex: string) => string;
/**
 * ★★★#1344 B-2：**在会话内 eval 一段 JS**（业务接线的统一入口）。
 * 例：`hostVmSessionEval('useFetch("/x").then(r => globalThis.r = r)')`
 * @returns `{ok:true, value:"..."}` / `{ok:false, error:"..."}`
 */
export const hostVmSessionEval: (js: string) => string;
/**
 * ★★★#1344 B-2c：**宿主侧取消记账**（`calls`/`hits`/`misses`）。
 *
 * 【为什么单独一个入口】在会话里用 `hostVmSessionEval("proteusHost.invoke('http.cancelStats')")`
 * **会崩**（会话内再触发宿主回调 = 重入）。⇒ 由宿主直接读 `stats()`。
 * 【为什么判据必须读它】JS 侧"abort 后 3ms 结算"只证明**本地 Promise reject 了**；
 * 把宿主的 `HMS_Rcp_CancelRequest` 摘掉，JS 侧读数一模一样（破坏性验证 M7 抓到）。
 * 只有 `calls > 0` 才证明**宿主真的调了 RCP 取消**。
 */
export const hostVmSessionCancelStats: () => string;
export const hostVmSessionClose: () => string;
export const hostVmSessionStats: () => string;
/** ★★★切页残留动画修复（2026-10-11）：清动画会话（旧页 spec 的 nodeId 属旧页编号空间——
 *   不清会把旧页动画错打到新页同 id 节点）。壳每轮渲染/点按导航前调；返回 `{"ok":true}`。 */
export const hostAppAnimReset: () => string;
