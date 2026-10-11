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
