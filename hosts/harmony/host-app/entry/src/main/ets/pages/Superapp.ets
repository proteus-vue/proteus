// hosts/harmony/host-app/entry/src/main/ets/pages/Superapp.ets
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
import { display } from '@kit.ArkUI';
import { util } from '@kit.ArkTS';
import { fileIo } from '@kit.CoreFileKit';
import { attach, renderCommands } from 'libproteus_render.so';
import { appScreenCommands, superappBoot, superappDrive } from 'libproteus_bench.so';

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

  /** Tab 图标（⌂/✉/☺——与 Web/Android/iOS 同形） */
  private tabIconOf(name: string): string {
    return name === 'index' ? '⌂' : name === 'messages' ? '✉' : name === 'mine' ? '☺' : '•';
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
      if (this.scene === 'superapp-drive') {
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
        this.booted = true;
        this.writeReport();
      } else {
        // 常驻：boot（单次调用）→ 入口页上屏 → 底部 Tab 栏
        const out: string = superappBoot(JSON.stringify({ 'bundle': bundle, 'filesDir': this.filesDir } as Record<string, Object>));
        hilog.info(DOMAIN, TAG, 'SUPERAPP_BOOT %{public}s', out.substring(0, 240));
        const o = JSON.parse(out) as Record<string, Object>;
        this.applyState(o['state']);
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

  /** 把**当前页**内容真画到屏上（复用既有 appScreenCommands + renderCommands 通道） */
  private renderCurrent(): void {
    const page: string = this.current && this.nodesByPage.has(this.current) ? this.current
      : (this.nodesByPage.has('index') ? 'index' : '');
    if (!page) return;
    const nodes: string | undefined = this.nodesByPage.get(page);
    if (!nodes) return;
    const disp = display.getDefaultDisplaySync();
    const vpW: number = px2vp(disp.width);
    const vpH: number = px2vp(disp.height);
    const contentH: number = vpH - TAB_H;
    try {
      attach(this.content, vp2px(1), vpW, contentH);
      const cmds: string = appScreenCommands(JSON.stringify({
        'nodes': nodes, 'density': vp2px(1), 'vpW': vpW, 'vpH': contentH,
        'page': page, 'filesDir': this.filesDir,
      } as Record<string, Object>));
      const n: number = renderCommands(cmds);
      hilog.info(DOMAIN, TAG, 'SUPERAPP_RENDER page=%{public}s nodes_rendered=%{public}d', page, n);
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

  /** drive：链式切遍所有 tab（每次一次 native 调用；跳过当前页）→ 落报告 */
  private driveFrom(i: number): void {
    if (i >= this.tabKeys.length) { this.writeReport(); return; }
    const name: string = this.tabKeys[i];
    if (name === this.current) { this.driveFrom(i + 1); return; }
    setTimeout(() => {
      try {
        const r: string = superappNav(name);
        const parts: string[] = r.split('|STATE|');
        if (parts.length > 1) this.applyState(parts[1]);
        this.renderCurrent();
        this.switchLog.push(`{"tap":"${name}","current":"${this.current}","ok":${this.current === name}}`);
        hilog.info(DOMAIN, TAG, 'SUPERAPP_SWITCH tap=%{public}s current=%{public}s', name, this.current);
      } catch (e) {
        hilog.error(DOMAIN, TAG, 'SUPERAPP_SWITCH_ERROR %{public}s', JSON.stringify(e) ?? '');
      }
      setTimeout(() => { this.driveFrom(i + 1); }, 30);
    }, 30);
  }

  private writeReport(): void {
    try {
      const body: string = '{"ok":true,"host_id":"harmony","tabs":' + JSON.stringify(this.tabKeys)
        + ',"current":"' + this.current + '"'
        + ',"switch_log":[' + this.switchLog.join(',') + ']}';
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

      // 底部 Tab 栏（原生 chrome；★图标 + 短标签，与 Web/Android/iOS 同形：⌂ 首页 / ✉ 消息 / ☺ 我的）
      Row() {
        ForEach(this.tabKeys, (k: string, i: number) => {
          Column() {
            Stack() {
              Text(this.tabIconOf(k)).fontSize(20).fontColor(this.current === k ? '#4C8DFF' : '#8A8A9A')
              if (k === 'messages' && this.imUnread > 0) {
                Text(this.imUnread > 99 ? '99+' : String(this.imUnread))
                  .fontSize(9).fontColor('#FFFFFF').textAlign(TextAlign.Center)
                  .width(16).height(16).borderRadius(8).backgroundColor('#F5222D')
                  .position({ x: 24, y: 0 })
              }
            }
            Text(this.tabShortLabelOf(k)).fontSize(11).fontColor(this.current === k ? '#4C8DFF' : '#8A8A9A')
          }
          .layoutWeight(1)
          .height('100%')
          .justifyContent(FlexAlign.Center)
          .onClick(() => { this.switchTab(k); })
        }, (k: string) => k)
      }
      .width('100%')
      .height(TAB_H)
      .backgroundColor('#1B1B2A')
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#101020')
  }
}
