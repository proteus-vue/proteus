// hosts/harmony/host-app/entry/src/main/ets/shell/Superapp.ets
// ★★★批次 44（2026-10-05）：**superapp 真实应用 · 桌面启动页**（鸿蒙腿）。
//
// 【与 pages/Index 的关系】Index 是**验收装置**（跑全套探针/基准）；本页是**真实应用入口**——
//   桌面点开（EntryAbility 无 scene 参数）即到本页：superapp 路由栈装配 → 入口页上屏 → 底部
//   Tab 栏（可点切页）→ 常驻。与 Android SuperappActivity / iOS SuperappScene 同形。
//
// 【链路（与三端同源）】
//   ① rawfile bundle-superapp.js → napi `superappBoot`（**持久 VM**：注入 proteusHost.invoke +
//      eval bundle → `__proteusSuperappBootJson()` = createAppNavigation + createRouter → 进入入口 tab）
//   ② rawfile app-screen-content.json（项目路由 → 真 SFC → 编译器；与 Web/MP/iOS 同源）→ 当前页 nodes
//      → `appScreenCommands`（内容→内核树→RenderCmd）→ `attach + renderCommands` 真上屏（复用既有通道）
//   ③ 底部 Tab 栏（ArkUI 原生 chrome——MP 由原生 tabBar 提供，同语义）→ onClick → `superappNav` → 重绘
//
// 【诚实边界】页面内容 = 编译产物静态结构（结构/样式/文本）；全实时 slot/Vapor 运行时为下一阶段。
//   本页证明「真实应用壳 + 导航 + 真机渲染 + 切 tab」。
import { hilog } from '@kit.PerformanceAnalysisKit';
import { NodeContent } from '@kit.ArkUI';
import { display, window } from '@kit.ArkUI';
import { util } from '@kit.ArkTS';
import { fileIo } from '@kit.CoreFileKit';
import { attach, renderCommands, scrollRoot, appScreenCommands, appScreenContentHeight, hostRtShellInstall, hostRtShellEvent } from 'proteus_render';
import { superappDrive } from 'libproteus_bench.so';

const DOMAIN = 0x0002;
const TAG = 'ProteusSuperapp';
const TAB_H = 56;   // 底部 Tab 栏高度（vp）

@Entry
@Component
struct Superapp {
  private content: NodeContent = new NodeContent();
  private filesDir: string = '';
  /** bundle-superapp.js 源（切 tab 交互时复用——一次性 VM 每次都要 eval bundle） */
  private bundle: string = '';
  /** 每页 nodes 的 **JSON 串**（appScreenCommands 入参要字符串） */
  private nodesByPage: Map<string, string> = new Map<string, string>();
  /** 场景：'superapp'（常驻，桌面点开）/ 'superapp-drive'（脚本驱动切 tab + 落报告） */
  private scene: string = AppStorage.get<string>('proteusScene') ?? '';
  @State tabKeys: string[] = [];
  @State tabItems: string[] = [];
  @State current: string = '';
  @State booted: boolean = false;
  /** drive 记账（脚本判据读 switch_log） */
  private switchLog: string[] = [];
  /** IM 未读角标初值（与 App.vue 壳同源；后续接实时运行时改由状态驱动） */
  private imUnread: number = 3;
  /** 底部安全区高度（vp；手势条）——并入 Tab 栏高度（见 build），白底铺到屏底 */
  private safeBottom: number = 0;
  /** ★★★内置环境变量表（2026-10-08 · 决策 #593）：--pf-* → vp（逻辑像素），由 avoidArea 采集。 */
  private envVars: Record<string, number> = {};
  /** ★★★鸿蒙滚动对齐（2026-10-05 · 用户抓出「内容变长后看不到下面」）：滚动状态。
   *   与 Android `enableContentScrollRange` / iOS `contentScrollRangeEnabled` **同语义**：
   *   内容装不下才滚、最多滚到内容底（range = max(0, 内容高 − 视口高)）。
   *   ★真滚动 = `scrollRoot(offset)`（平移根 RenderNode——整幅内容位移，vp 单位）。 */
  private scrollOffset: number = 0;
  private maxScroll: number = 0;
  private touchLastY: number = -1;
  /** 视口高（vp；renderCurrent 处记录——与 contentH 同源）。 */
  private static vpH: number = 844;

  /** Tab 图标（⌂/✉/☺——与 Web/Android/iOS 同形） */
  private tabIconOf(name: string): string {
    return name === 'index' ? '⌂' : name === 'messages' ? '✉' : name === 'mine' ? '☺' : '•';
  }

  /** Tab 图标（鸿蒙系统符号资源；三端语义同：首页/消息/我的） */
  private tabSymbol(name: string): Resource {
    if (name === 'index') return $r('sys.symbol.house')
    if (name === 'messages') return $r('sys.symbol.message')
    return $r('sys.symbol.person')
  }

  /** Tab 短标签（首页/消息/我的） */
  private tabShortLabelOf(name: string): string {
    return name === 'index' ? '首页' : name === 'messages' ? '消息' : name === 'mine' ? '我的' : name;
  }

  aboutToAppear(): void {
    hilog.info(DOMAIN, TAG, 'SUPERAPP_PAGE_APPEAR scene=%{public}s', this.scene);
    try {
      const ctx = getContext(this);
      this.filesDir = ctx.filesDir;
      // ★底部安全区（手势条）→ 并入 Tab 栏高度：白底铺到屏底（Web `.sa-tabbar{padding-bottom:safe}`
      //   同义；此前 Tab 栏下方露出一条灰带——独立视觉验收抓出）。
      // ★先给**保守默认 16vp**（手势条标准高）——本机实测 `TYPE_SYSTEM` 避让区返回 0（见日志
      //   `SUPERAPP_SAFE_BOTTOM 0`），若照用会在 Tab 栏下露一条灰带（独立验收抓出）。
      //   取到真值再覆盖（不同机型/横竖屏）。与 Web `--sa-safe-bottom` 同义。
      this.safeBottom = 16;
      window.getLastWindow(ctx).then((win: window.Window) => {
        // ★★全端对齐批（2026-10-05 · css-conformance 独立复评抓出）：**隐藏系统状态栏**——
        //   与 Android `hide(statusBars())` / iOS 全屏同口径（Web 基准无系统栏）。
        //   此前状态栏图标（时钟等）叠印在页面标题上（复评 major：标题被遮挡），
        //   且状态栏区使内容画布从 y≈35px 才开始（顶部露一条宿主深色底）。
        //   `['navigation']` = 只隐藏状态栏、保留底部导航栏（与 Android 只隐 statusBars 一致）。
        // ★★★状态栏显示策略（2026-10-08 · 决策 #594）：app-config `safeArea.statusBar`（缺省 **show** ——
        //   与 Web 手机端 viewport-fit=cover + edge-to-edge 对齐：状态栏显示、内容铺到状态栏区）。
        //   `hide` = 沉浸式（只留导航栏）。读 rawfile/app-config.json（构建期由 app.config.ts 产出）。
        //   缺文件/字段 ⇒ **显示**（['status','navigation']）= 框架默认。
        let barHidden = false;
        try {
          const cfgB: Uint8Array = ctx.resourceManager.getRawFileContentSync('app-config.json');
          const cfgS: string = util.TextDecoder.create('utf-8').decodeToString(cfgB);
          const cfgO = JSON.parse(cfgS) as Record<string, Object>;
          const sa = cfgO['safeArea'] as Record<string, Object> | undefined;
          barHidden = !!sa && sa['statusBar'] === 'hide';
        } catch (e) { barHidden = false; }
        // ★★★edge-to-edge（2026-10-08 · 决策 #594）：内容铺满全屏（含状态栏/导航栏区）——
        //   状态栏**叠加**在内容之上（透明）⇒ 页面背景透上来，与 Web viewport-fit=cover 同观感；
        //   内容让位由页面 --pf-inset-top/bottom 负责。此前非 full-screen ⇒ 状态栏占位成黑带。
        win.setWindowLayoutFullScreen(true).catch((e: Error) => {
          hilog.warn(DOMAIN, TAG, 'SUPERAPP_FULLSCREEN_ERR %{public}s', String(e?.message ?? e));
        });
        // ★窗口背景 = 页面浅底（与 Android/Web 一致）：状态栏**透明**处透出窗口背景；若为系统默认
        //   （浅蓝渐变）⇒ 屏顶露一条非页面色的带（真机实测）。设浅底使其与页面无缝。
        try { win.setWindowBackgroundColor('#F4F5F7'); } catch (e) { /* 旧版本不支持 ⇒ 保持默认 */ }
        const barCfg: Array<'status' | 'navigation'> = barHidden ? ['navigation'] : ['status', 'navigation'];
        win.setWindowSystemBarEnable(barCfg).catch((e: Error) => {
          hilog.error(DOMAIN, TAG, 'SUPERAPP_STATUSBAR_ERR %{public}s', String(e?.message ?? e));
        });
        const avoid: window.AvoidArea = win.getWindowAvoidArea(window.AvoidAreaType.TYPE_SYSTEM);
        const h: number = px2vp(avoid.bottomRect.height);
        if (h > 0) this.safeBottom = h;
        // ★★★内置环境变量采集（决策 #593 · 文档坑 P1/P2）：TYPE_SYSTEM 沉浸式下底部可能为 0 ⇒
        //   底部总避让 = TYPE_SYSTEM.bottomRect + TYPE_NAVIGATION_INDICATOR.bottomRect（**加而非取其一**）；
        //   返回值为 **px 物理像素** ⇒ 必须 px2vp（否则高密度机上大 3 倍）。
        let indicB = 0;
        try {
          const ind: window.AvoidArea = win.getWindowAvoidArea(window.AvoidAreaType.TYPE_NAVIGATION_INDICATOR);
          indicB = px2vp(ind.bottomRect.height);
        } catch (e) { /* 旧版本无该 type ⇒ 0 */ }
        let cutT = 0, cutL = 0, cutR = 0;
        try {
          const co: window.AvoidArea = win.getWindowAvoidArea(window.AvoidAreaType.TYPE_CUTOUT);
          cutT = px2vp(co.topRect.height); cutL = px2vp(co.leftRect.width); cutR = px2vp(co.rightRect.width);
        } catch (e) { /* 未声明 metadata ⇒ 0 */ }
        const sysTop = px2vp(avoid.topRect.height);
        const sysB = px2vp(avoid.bottomRect.height);
        const navB = sysB;                       // 三键导航（TYPE_SYSTEM.bottom）
        const totalB = sysB + indicB;            // 底部总避让（含手势条）
        const gesture = indicB > 0 && sysB === 0;
        this.envVars = {
          '--pf-inset-top': Math.max(sysTop, cutT),
          '--pf-inset-bottom': totalB,
          '--pf-inset-left': cutL,
          '--pf-inset-right': cutR,
          '--pf-status-bar-height': sysTop,
          '--pf-nav-bar-height': gesture ? 0 : navB,
          '--pf-indicator-height': gesture ? indicB : 0,
          '--pf-nav-bar-total': totalB,
          '--pf-cutout-top': cutT,
          '--pf-cutout-left': cutL,
          '--pf-cutout-right': cutR,
          '--pf-keyboard-height': 0,
        };
        // I2-ALLOW: **日志读数**取整（安全区写进 hilog 供人核对——非几何换算；几何值 envVars 保留 vp 原值）
        hilog.info(DOMAIN, TAG, 'ENV_VARS top=%{public}d bottom=%{public}d', Math.round(this.envVars['--pf-inset-top']), Math.round(totalB));
        // ★env 采集是**异步**（getLastWindow promise）⇒ 首次 renderCurrent 时 envVars 尚空（真机实测
        //   C++ 收到空 env 表 ⇒ env token 替换为 fallback 0）。取到后**重渲染一次**（env 生效）。
        this.renderCurrent();
        // I2-ALLOW: **日志读数**取整（安全区高度写进 hilog 供人核对——不是几何换算；几何值
        //   this.safeBottom 保持 vp 原值，进 Tab 栏高度 .height(TAB_H + this.safeBottom)）。
        hilog.info(DOMAIN, TAG, 'SUPERAPP_SAFE_BOTTOM %{public}d', Math.round(this.safeBottom));
      }).catch((err: Error) => {
        hilog.error(DOMAIN, TAG, 'SUPERAPP_SAFE_BOTTOM_ERR %{public}s', String(err?.message ?? err));
      });
      // ① bundle-superapp.js
      const bb: Uint8Array = ctx.resourceManager.getRawFileContentSync('bundle-superapp.js');
      const bundle: string = util.TextDecoder.create('utf-8').decodeToString(bb);
      this.bundle = bundle;   // 存给交互（切 tab 时用）
      // ② app-screen-content.json（三端同源产物）
      const sb: Uint8Array = ctx.resourceManager.getRawFileContentSync('app-screen-content.json');
      const scStr: string = util.TextDecoder.create('utf-8').decodeToString(sb);
      const pages = JSON.parse(scStr) as Record<string, Record<string, Object>>;
      const names: string[] = Object.keys(pages);
      for (const nm of names) {
        this.nodesByPage.set(nm, JSON.stringify(pages[nm]['nodes']));
      }
      // ★★★逐屏截图装置（2026-10-05 · 拆页后每页需独立截图与 Web 基准可比）：
      //   `scene=superapp-screen-<name>` ⇒ 启动后**导航到该屏**（验收跑器逐页调用 + 截图）。
      //   与 Android `--es screen <name>` / iOS drive 遍历同法（三端同语义）。
      if (this.scene.startsWith('superapp-screen-')) {
        const want: string = this.scene.slice('superapp-screen-'.length);
        const out2: string = superappDrive(JSON.stringify({ 'bundle': bundle, 'filesDir': this.filesDir, 'tabs': [want] } as Record<string, Object>));
        hilog.info(DOMAIN, TAG, 'SUPERAPP_SCREEN_DRIVE %{public}s', out2.substring(0, 200));
        const o2 = JSON.parse(out2) as Record<string, Object>;
        const dr2 = o2['drive'] as Record<string, Object> | undefined;
        if (dr2) this.applyState(dr2['state'] as Object);
        this.renderCurrent();
        // ★★★不滚到底（2026-10-07 修）：逐屏截图必须**页顶锚定**——与 Web 基准（视口截图从页顶裁剪）
        //   同坐标系。此前滚到底 ⇒ 内容高于视口的页（如 background-position contentH=857>816）
        //   会把**页头/标题**切出屏外（真机抓出：鸿蒙页比 Web 少标题、整体上移）。
        //   保持 offset=0（renderCurrent 已 scrollRoot(0)）⇒ 页顶对齐。
        this.booted = true;
        this.writeReport();
      } else if (this.scene === 'superapp-drive') {
        // ★drive：**一次原生调用**完成 boot + 逐 tab 切页（one-kick + 宿主泵——鸿蒙 JSVM 专用形态）。
        //   跨原生调用反复启动新导航会与 V8 微任务排空重入 ⇒ 崩溃（本仓实测）；故合成单条 async 驱动。
        const out: string = superappDrive(JSON.stringify({ 'bundle': bundle, 'filesDir': this.filesDir } as Record<string, Object>));
        hilog.info(DOMAIN, TAG, 'SUPERAPP_DRIVE %{public}s', out.substring(0, 300));
        const o = JSON.parse(out) as Record<string, Object>;
        const dr = o['drive'] as Record<string, Object> | undefined;
        if (dr) {
          this.applyState(dr['state'] as Object);
          const lg = dr['log'];
          if (Array.isArray(lg)) { for (const row of lg as Record<string, Object>[]) { this.switchLog.push(JSON.stringify(row)); } }
        }
        this.renderCurrent();
        // ★★★滚动对齐（2026-10-05）：drive 模式**滚到底**——让验收截图看到全页
        //   （内容装不下时首屏只到中段；滚动读数随报告一起落盘供核对）。
        this.scrollToBottom();
        this.booted = true;
        this.writeReport();
      } else {
        // 常驻：**复用 superappDrive**（tabs=['index'] ⇒ boot 后跳过 index ⇒ 等价"仅启动"）。
        //   ★为什么不用 superappBoot：其原生泵是**无条件 400 轮** checkpoint，boot 落定后再泵
        //   会崩（SIGSEGV，实测）；superappDrive 有终态提前退出，是本机**唯一稳定**路径。
        const out: string = superappDrive(JSON.stringify({ 'bundle': bundle, 'filesDir': this.filesDir, 'tabs': ['index'] } as Record<string, Object>));
        hilog.info(DOMAIN, TAG, 'SUPERAPP_BOOT %{public}s', out.substring(0, 240));
        const o = JSON.parse(out) as Record<string, Object>;
        const dr = o['drive'] as Record<string, Object> | undefined;
        if (dr) this.applyState(dr['state'] as Object);
        this.renderCurrent();
        this.booted = true;
        hilog.info(DOMAIN, TAG, 'SUPERAPP_LAUNCHER_READY current=%{public}s', this.current);
      }
    } catch (e) {
      hilog.error(DOMAIN, TAG, 'SUPERAPP_BOOT_ERROR %{public}s', JSON.stringify(e) ?? '');
    }
  }

  /** 从 superappState JSON（对象或串）刷新 tab 注册表 + current */
  private applyState(state: Object | undefined): void {
    let st: Record<string, Object> | null = null;
    if (state === null || state === undefined) return;
    if (typeof state === 'string') {
      try { st = JSON.parse(state) as Record<string, Object>; } catch (pe) { return; }
    } else {
      st = state as Record<string, Object>;
    }
    if (st === null) return;
    const tabs = st['tabs'];
    if (Array.isArray(tabs)) {
      const keys: string[] = [];
      const labels: string[] = [];
      const labelMap = st['tabLabels'] as Record<string, string> | undefined;
      for (const t of tabs as string[]) {
        keys.push(t);
        labels.push(labelMap && labelMap[t] ? labelMap[t] : t);
      }
      this.tabKeys = keys;
      this.tabItems = labels;
    }
    const cur = st['current'];
    if (typeof cur === 'string') this.current = cur;
  }

  /** ★★★鸿蒙滚动对齐：触摸滚动（与 Android `scrollDragBy` / iOS `driveScrollDrag` 同语义）。
   *   手指上滑（windowY 减小）⇒ offset 增大 ⇒ 内容上移。 */
  private onScrollTouch(e: TouchEvent): void {
    const t: TouchObject = e.touches[0];
    if (t === undefined) { return; }
    if (e.type === TouchType.Down) { this.touchLastY = t.windowY; return; }
    if (e.type === TouchType.Move) {
      if (this.touchLastY < 0) { this.touchLastY = t.windowY; return; }
      const dy: number = t.windowY - this.touchLastY;
      this.touchLastY = t.windowY;
      let next: number = this.scrollOffset - dy;
      if (next < 0) { next = 0; }
      if (next > this.maxScroll) { next = this.maxScroll; }
      if (next !== this.scrollOffset) {
        this.scrollOffset = next;
        scrollRoot(this.scrollOffset);
      }
      return;
    }
    if (e.type === TouchType.Up || e.type === TouchType.Cancel) { this.touchLastY = -1; }
  }

  /** 把**当前页**内容真画到屏上（复用既有 appScreenCommands + renderCommands 通道） */
  private renderCurrent(): void {
    const page: string = this.current && this.nodesByPage.has(this.current) ? this.current
      : (this.nodesByPage.has('index') ? 'index' : '');
    if (!page) return;
    const nodes: string | undefined = this.nodesByPage.get(page);
    if (!nodes) return;
    const disp = display.getDefaultDisplaySync();
    // ★★第五轮修复（2026-10-05）：**vp 值用精确除法**（此前 `px2vp()` 把结果截断成整数 vp：
    //   1320px / 3.5 = 377.14vp 被截成 377 ⇒ 内核视口 377vp ⇒ 页根 cmd 宽 377×3.5 = 1319.5px
    //   ⇒ 最右 1px 列露宿主深色底（第四轮复评实测 x=1319 全高 #0f1018）。
    //   `vp2px(1)` 即 density（精确 3.5）⇒ `disp.width / density` 得精确 vp（377.14）⇒ 页根宽
    //   = 1320px 恰好铺满（先证后改：渲染日志实测页根 cmd w=1319.5，右缘差 0.5px）。
    const vpDensity: number = vp2px(1);
    const vpW: number = disp.width / vpDensity;
    const vpH: number = disp.height / vpDensity;
    // ★★★视口 = **全屏**（不缩 Tab 栏）——与 Web 一致：Web 的 Tab 栏是 overlay（浮在页面之上、
    //   fixed 不占流），页面让位靠**自身下内边距**（编译器已给页面根 padding-bottom:120dp）。
    //   此前缩到"屏高−56" ⇒ 视口少 56dp ⇒ 依赖 bottom 定位的元素（客服球）偏高/偏大（独立验收抓出）。
    Superapp.vpH = vpH;   // ★滚动对齐：视口高（供范围计算）
    const contentH: number = vpH;
    try {
      attach(this.content, vpDensity, vpW, contentH);
      const cmds: string = appScreenCommands(JSON.stringify({
        'nodes': nodes, 'density': vp2px(1), 'vpW': vpW, 'vpH': contentH,
        'page': page, 'filesDir': this.filesDir,
        'env': this.envVars,   // ★内置环境变量（决策 #593）——宿主采集的 vp 值，C++ 侧解析 env token
      } as Record<string, Object>));
      const n: number = renderCommands(cmds);
      hilog.info(DOMAIN, TAG, 'SUPERAPP_RENDER page=%{public}s nodes_rendered=%{public}d', page, n);
      // ★★★鸿蒙滚动对齐：重算滚动范围 + 重放偏移（renderCommands 重建指令后根位置归零）。
      const chVp: number = appScreenContentHeight();
      this.maxScroll = Math.max(0, chVp - Superapp.vpH);
      // ★★★页面滚动锁定（2026-10-08）：页根声明 `overflow-y: hidden` ⇒ **整页不滚**（maxScroll=0）。
      //   App 的「页面滚动」= 整树滚动 ⇒ 页根 overflow 即页面滚动开关。
      try {
        const pageNodes = JSON.parse(nodes) as Record<string, Object>[];
        const r0 = pageNodes.length > 0 ? pageNodes[0] : undefined;
        if (r0 && (r0 as Record<string, Object>)['overflowY'] === 'hidden') this.maxScroll = 0;
      } catch (e) { /* nodes 解析失败 ⇒ 不锁（保持可滚） */ }
      if (this.scrollOffset > this.maxScroll) { this.scrollOffset = this.maxScroll; }
      if (this.scrollOffset < 0) { this.scrollOffset = 0; }
      scrollRoot(this.scrollOffset);
      hilog.info(DOMAIN, TAG, 'SUPERAPP_SCROLL contentH=%{public}s viewport=%{public}s max=%{public}s offset=%{public}s',
        chVp.toFixed(1), Superapp.vpH.toFixed(1), this.maxScroll.toFixed(1), this.scrollOffset.toFixed(1));
    } catch (e) {
      hilog.error(DOMAIN, TAG, 'SUPERAPP_RENDER_ERROR %{public}s', JSON.stringify(e) ?? '');
    }
  }

  /**
   * 切 tab（常驻交互：用户点底部 Tab）→ 重绘。
   * ★实现 = **一次性 VM 的 `superappDrive`**（tabs=[name]）：每次交互独立装配 → boot → 切到目标 tab
   *   并读回新状态（跨调用的持久 VM 在鸿蒙会崩，见 native 注释）。语义与 Web `wx.switchTab` 同形。
   */
  private switchTab(name: string): void {
    try {
      const out: string = superappDrive(JSON.stringify({
        'bundle': this.bundle, 'filesDir': this.filesDir, 'tabs': [name],
      } as Record<string, Object>));
      const o = JSON.parse(out) as Record<string, Object>;
      const dr = o['drive'] as Record<string, Object> | undefined;
      if (dr) this.applyState(dr['state'] as Object);
      this.renderCurrent();
      hilog.info(DOMAIN, TAG, 'SUPERAPP_SWITCH tap=%{public}s current=%{public}s', name, this.current);
    } catch (e) {
      hilog.error(DOMAIN, TAG, 'SUPERAPP_SWITCH_ERROR %{public}s', JSON.stringify(e) ?? '');
    }
  }

  /** ★★★滚动对齐：驱动滚到底（验收跑器用——让截图看到全页；返回实际偏移）。 */
  private scrollToBottom(): number {
    this.scrollOffset = this.maxScroll;
    scrollRoot(this.scrollOffset);
    return this.scrollOffset;
  }

  private writeReport(): void {
    try {
      const body: string = '{"ok":true,"host_id":"harmony","tabs":' + JSON.stringify(this.tabKeys)
        + ',"current":"' + this.current + '"'
        + ',"switch_log":[' + this.switchLog.join(',') + ']}'
        // ★★★滚动对齐（2026-10-05）：滚动读数（范围/当前偏移）——与 Android/iOS 的 scroll 读数同语义
        .replace(/\}$/, ',"scroll":{"max":' + this.maxScroll.toFixed(1) + ',"offset":' + this.scrollOffset.toFixed(1) + '}}');
      const path: string = this.filesDir + '/superapp.json';
      const fd = fileIo.openSync(path, fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.CREATE | fileIo.OpenMode.TRUNC);
      fileIo.writeSync(fd.fd, body);
      fileIo.closeSync(fd.fd);
      hilog.info(DOMAIN, TAG, 'SUPERAPP_REPORT_READY %{public}s', body);
    } catch (e) {
      hilog.error(DOMAIN, TAG, 'SUPERAPP_REPORT_ERROR %{public}s', JSON.stringify(e) ?? '');
    }
  }

  build() {
    Column() {
      // 内容区（自绘 RenderNode 挂在 ContentSlot）
      Stack() {
        ContentSlot(this.content)
      }
      .width('100%')
      .layoutWeight(1)
      .clip(true)   // ★★★滚动对齐：越界内容裁剪（与 Android 视图裁剪同语义）
      .onTouch((e: TouchEvent) => { this.onScrollTouch(e); })

      // ★★全端对齐批（2026-10-05 · css-conformance 视觉验收抓出）：**无 tab 的应用不渲染 tab 栏**——
      //   此前无条件留白底柱（tabs=[] 时 ForEach 空转但容器仍在）⇒ 底部白带与 Web 基准不符。
      if (this.tabKeys.length > 0) {
      // 底部 Tab 栏（原生 chrome）——★样式取自 **Web 真值**（App.vue `.sa-tabbar` + global.css token）：
      //   白底 #ffffff · 顶边框 #dcdfe5 · 选中 brand #5b5bd6 · 未选中 text-3 #5f6673 · 角标 rec #d64545。
      //   图标加 U+FE0E（变体选择符）强制**文本呈现**——否则 ☺/✉ 会被渲染成彩色 emoji（与 Web 线稿不符）。
      Column() {
        Divider().strokeWidth(1).color('#DCDFE5')
        Row() {
          ForEach(this.tabKeys, (k: string, i: number) => {
            Column() {
              Stack() {
                // ★★图标用鸿蒙 **SymbolGlyph 系统矢量符号**（单色、可着色、尺寸可控）：
                //   · 彩色 emoji（U+2709/U+263A 默认 emoji 呈现；FE0E/字体族都压不住——实测）
                //   · Shape+Path 实测被渲染成**实心**且不随 viewPort 缩放
                //   ⇒ 两者都不满足「与 Web 线稿一致」。系统符号是本机唯一的**原生单色矢量**通道。
                // ★尺寸对齐 Web（图标墨高 ≈11.5dp；系统符号字号 20 时墨高约 20dp=1.7×，独立验收抓出）⇒ 13
                SymbolGlyph(this.tabSymbol(k))
                  .fontSize(13)
                  .fontColor([this.current === k ? '#5B5BD6' : '#5F6673'])
                if (k === 'messages' && this.imUnread > 0) {
                  Text(this.imUnread > 99 ? '99+' : String(this.imUnread))
                    .fontSize(11).fontWeight(FontWeight.Bold).fontColor('#FFFFFF').textAlign(TextAlign.Center)
                    .constraintSize({ minWidth: 16 }).height(16).padding({ left: 4, right: 4 })
                    .borderRadius(8).backgroundColor('#D64545')
                    .position({ x: 24, y: -2 })
                }
              }
              Text(this.tabShortLabelOf(k)).fontSize(10)
                .fontColor(this.current === k ? '#5B5BD6' : '#5F6673')
            }
            .layoutWeight(1)
            .height('100%')
            .justifyContent(FlexAlign.Center)
            .onClick(() => { this.switchTab(k); })
          }, (k: string) => k)
        }
        .width('100%')
        .layoutWeight(1)
      }
      .width('100%')
      // ★高度 = 视觉高 + 底部安全区（内容仍居中于 TAB_H 内；白底延伸到屏底）
      .height(TAB_H + this.safeBottom)
      .backgroundColor('#FFFFFF')
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#101020')
    // ★★★内容铺满**全屏**（含状态栏与手势区）——与 Web viewport（390×844 全屏）同口径。
    //   此前默认避让系统安全区 ⇒ 内容区止于 y≈2795/2856（差 61px ≈ 17dp）：
    //   ① 客服球（bottom 定位）整体偏高 17dp；② 页头被状态栏压住。独立视觉验收抓出。
    //   ★页面自身已由编译器给下内边距（120dp）⇒ Tab 栏不遮内容（与 Web overlay Tab 同理）。
    .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
  }
}
