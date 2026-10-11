// hosts/harmony/host-app/proteus_render/TabChrome.ets
// ★★★B · 能力归 runtime（决策 #800）：**鸿蒙 tab 栏 chrome 唯一实现**（HAR 组件）
//
// 【它解决什么】此前鸿蒙**参考壳**写了一份 tab 栏（Superapp.ets），而 **CLI 模板壳整个没有 tab 栏**
//   （2026-10-11 取证：模板 MainPage.ets 与产物全树搜不到任何 tab 渲染）⇒ 签名一打通就是"换壳丢能力"。
//   本组件把该能力收敛进 runtime HAR：**任何鸿蒙壳 `import { ProteusTabChrome }` 即得**。
//
// 【输入契约 = 生成期最终值（不在宿主合并）】吃 JS 运行期 state JSON：
//   · `tabItems` —— 名字/文案/字形/角标**已由 gen-routes 在生成期合并完**（决策 #800）。
//   · `tabSpec`  —— 视觉规格（TAB_BAR_SPEC：颜色/尺寸/角标几何）。
//   · `current`  —— 高亮项。
//   本组件**不做合并/兜底**：没声明 glyph ⇒ 不画图标（不画 "•"——旧漂移形态已禁）。
//
// 【字形两形态】`glyph` = `sym:<name>` ⇒ SymbolGlyph 系统矢量符号（单色可着色——彩色 emoji 无法
//   压成线稿，实测）；其他 ⇒ 文本字形（+U+FE0E 强制文本呈现）。未知 sym ⇒ 不画（不静默画替代品）。
import { hilog } from '@kit.PerformanceAnalysisKit';

const DOMAIN = 0x0002;
const TAG = 'ProteusTabChrome';

/** tab 项终态（来源 = state.tabItems；生成期已合并，宿主零决策）。 */
export interface TabItemFinal {
  name: string;
  label: string;
  glyph?: string;
  badge?: number;
}

@Component
export struct ProteusTabChrome {
  /** JS 运行期 state（JSON 串）。★解析/着色全在本组件内（壳零逻辑）。 */
  @Prop @Watch('onStateChanged') stateJson: string = '';
  /** 点 tab → 壳走导航（壳只提供出口：本地导航 + 重渲）。 */
  onTab: (name: string) => void = (name: string) => {};
  /** 底部安全区（vp）——壳从窗口几何转发（窗口属壳，几何归属不变）；栏高 = 视觉高 + 安全区。 */
  @Prop safeBottom: number = 0;

  @State items: TabItemFinal[] = [];
  @State current: string = '';
  // 视觉规格（缺省 = render-backend TAB_BAR_SPEC；spec 随 state 下发时被覆盖）
  @State tbBrand: string = '#5B5BD6';
  @State tbText3: string = '#5F6673';
  @State tbLine: string = '#DCDFE5';
  @State tbSurface: string = '#FFFFFF';
  @State tbBadge: string = '#D64545';
  @State tbIconSize: number = 19;
  @State tbLabelSize: number = 10;
  @State tbBadgeFont: number = 11;
  @State tbBadgeRadius: number = 8;
  @State tbHeight: number = 56;

  onStateChanged(): void {
    this.applyJson(this.stateJson);
  }

  aboutToAppear(): void {
    if (this.stateJson.length > 0) this.applyJson(this.stateJson);
  }

  /** 解析 state：items（终值）+ current + 视觉规格。兼容老产物（无 tabItems ⇒ tabs+tabLabels 现场折）。 */
  private applyJson(s: string): void {
    try {
      const o = JSON.parse(s) as Record<string, Object>;
      // ① tab 项终态
      const arr = o['tabItems'];
      const next: TabItemFinal[] = [];
      if (Array.isArray(arr)) {
        for (const e of arr as Array<Object>) {
          const r = e as Record<string, Object>;
          const name = typeof r['name'] === 'string' ? r['name'] as string : '';
          if (name.length === 0) continue;
          const item: TabItemFinal = { name: name, label: typeof r['label'] === 'string' ? r['label'] as string : name };
          if (typeof r['glyph'] === 'string' && (r['glyph'] as string).length > 0) item.glyph = r['glyph'] as string;
          if (typeof r['badge'] === 'number' && (r['badge'] as number) > 0) item.badge = r['badge'] as number;
          next.push(item);
        }
      } else {
        const tabs = o['tabs'];
        const labels = o['tabLabels'] as Record<string, Object> | undefined;
        if (Array.isArray(tabs)) {
          for (const t of tabs as Array<string>) {
            const lb = labels !== undefined ? labels[t] : undefined;
            const label = typeof lb === 'string' && lb.length > 0 ? lb : t;
            next.push({ name: t, label: label });
          }
        }
      }
      this.items = next;
      const cur = o['current'];
      if (typeof cur === 'string') this.current = cur as string;
      // ② 视觉规格
      const sp = o['tabSpec'] as Record<string, Object> | undefined;
      if (sp !== undefined) {
        if (typeof sp['brand'] === 'string') this.tbBrand = sp['brand'] as string;
        if (typeof sp['text3'] === 'string') this.tbText3 = sp['text3'] as string;
        if (typeof sp['line'] === 'string') this.tbLine = sp['line'] as string;
        if (typeof sp['surface'] === 'string') this.tbSurface = sp['surface'] as string;
        if (typeof sp['badgeBg'] === 'string') this.tbBadge = sp['badgeBg'] as string;
        // 内容区高：优先 contentHeight（= max(height, 内容块高)；字号大时撑高）——问题1/字号可变
        if (typeof sp['contentHeight'] === 'number') this.tbHeight = sp['contentHeight'] as number;
        else if (typeof sp['height'] === 'number') this.tbHeight = sp['height'] as number;
        if (typeof sp['iconSize'] === 'number') this.tbIconSize = sp['iconSize'] as number;
        if (typeof sp['labelSize'] === 'number') this.tbLabelSize = sp['labelSize'] as number;
        const bd = sp['badge'] as Record<string, Object> | undefined;
        if (bd !== undefined) {
          if (typeof bd['fontSize'] === 'number') this.tbBadgeFont = bd['fontSize'] as number;
          if (typeof bd['radius'] === 'number') this.tbBadgeRadius = bd['radius'] as number;
        }
      }
    } catch (e) {
      hilog.warn(DOMAIN, TAG, 'state 解析失败：%{public}s', JSON.stringify(e) ?? '?');
    }
  }

  /** 文本字形（非 sym:）——空串 ⇒ 不画。 */
  private glyphTextOf(item: TabItemFinal): string {
    const g = item.glyph;
    if (g === undefined || g.startsWith('sym:')) return '';
    return g;
  }

  /** 系统符号（sym:<name>）；未知/非 sym ⇒ undefined（不画，不静默画替代品）。 */
  private symbolOf(item: TabItemFinal): Resource | undefined {
    const g = item.glyph;
    if (g === undefined || !g.startsWith('sym:')) return undefined;
    const n = g.substring(4);
    if (n === 'house' || n === 'home') return $r('sys.symbol.house');
    if (n === 'message' || n === 'envelope') return $r('sys.symbol.message');
    if (n === 'person' || n === 'mine') return $r('sys.symbol.person');
    return undefined;
  }

  /** SymbolGlyph 字号：规格 iconSize 是**文本字形**口径（iOS/Android 同值 19）；系统符号墨高 ≈ 1.7×
   *   字号（独立验收抓出）⇒ 换算保持 Web 图标墨高 ≈11.5dp（19 → 13，与已验证视觉一致）。 */
  private symbolSize(): number {
    return (this.tbIconSize * 13) / 19;
  }

  build() {
    // ★无 tab 的应用不渲染 tab 栏（与 MP「未声明 tabBar 就无 tabBar」同源）
    if (this.items.length > 0) {
      Column() {
        Divider().strokeWidth(1).color(this.tbLine)
        Row() {
          ForEach(this.items, (item: TabItemFinal) => {
            Column() {
              Stack() {
                if (this.glyphTextOf(item).length > 0) {
                  // 文本字形 + U+FE0E（强制文本呈现，防彩色 emoji）
                  Text(this.glyphTextOf(item) + '\uFE0E')
                    .fontSize(this.tbIconSize)
                    .fontColor(this.current === item.name ? this.tbBrand : this.tbText3)
                } else if (this.symbolOf(item) !== undefined) {
                  // 系统矢量符号（单色可着色）
                  SymbolGlyph(this.symbolOf(item))
                    .fontSize(this.symbolSize())
                    .fontColor([this.current === item.name ? this.tbBrand : this.tbText3])
                }
                // 角标（声明了 badge>0 才画）
                if (item.badge !== undefined && item.badge > 0) {
                  Text(item.badge > 99 ? '99+' : String(item.badge))
                    .fontSize(this.tbBadgeFont).fontWeight(FontWeight.Bold).fontColor('#FFFFFF')
                    .textAlign(TextAlign.Center)
                    .constraintSize({ minWidth: 16 }).height(16).padding({ left: 4, right: 4 })
                    .borderRadius(this.tbBadgeRadius).backgroundColor(this.tbBadge)
                    .position({ x: 24, y: -2 })
                }
              }
              Text(item.label).fontSize(this.tbLabelSize)
                .fontColor(this.current === item.name ? this.tbBrand : this.tbText3)
            }
            .layoutWeight(1)
            .height('100%')
            .justifyContent(FlexAlign.Center)
            .onClick(() => { this.onTab(item.name); })
          }, (item: TabItemFinal) => item.name)
        }
        .width('100%')
        // ★★修复（2026-10-11 · 问题1）：内容块**只在内容区（tbHeight）内居中**——此前 height('100%')
        //   使其在 内容区+安全区 全高居中 ⇒ 内容偏下（实测上 gap 29vp / 下 23vp）。
        //   安全区改为内容区**下方**的纯底色（对齐 Web `.sa-tabbar`）。
        .height(this.tbHeight)
      }
      .width('100%')
      // 总高 = 内容区 + 底部安全区（安全区为下方白底；内容在内容区内居中）
      .height(this.tbHeight + this.safeBottom)
      .backgroundColor(this.tbSurface)
    }
  }
}
