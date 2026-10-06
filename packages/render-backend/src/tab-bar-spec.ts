// packages/render-backend/src/tab-bar-spec.ts —— ★★★B2（宿主关注点分离 · G1）：**App 壳 tab 栏视觉规格**
//
// 【它解决什么】三端宿主（Android/iOS/鸿蒙）此前**各自硬编码**同一套 tab 栏样式（颜色/字号/图标/角标规则）
//   ⇒ 改一处要改三处，且必然漂移。本模块把该规格收敛成**一份共享常量**，随运行期 `state` 下发给宿主，
//   宿主只"读规格 → 建原生视图"（不再各写一遍语义）。
//
// 【★基准 = Web（决策 #508）】规格值取自 Web 真源 `superapp/App.vue` 的 `.sa-tabbar` + `global.css` token：
//   surface #ffffff · 顶线 #dcdfe5 · 选中 brand #5b5bd6 · 未选中 text-3 #5f6673 · 角标 rec #d64545。
//   门禁 `check:host-tab-spec` 钉住"本常量 == 三端宿主读的值"（防漂移）。
//
// 【诚实边界】Web/MP **不消费本常量**（它们用各自 CSS 引擎渲染 `.sa-tabbar`）；本常量是**App 自绘端的
//   共享规格**。Web CSS 是基准，本常量须与它一致（门禁比对 `.sa-tabbar` 的字面值）。
export interface TabBarSpec {
  /** 栏高（逻辑像素；不含底部安全区——宿主自行叠加 safeBottom） */
  height: number
  /** 底色（CSS 颜色字面量） */
  surface: string
  /** 顶边线色 */
  line: string
  /** 选中项色（品牌色） */
  brand: string
  /** 未选中项色 */
  text3: string
  /** 角标底色（提示红） */
  badgeBg: string
  /** 图标字号（逻辑像素） */
  iconSize: number
  /** 标签字号（逻辑像素） */
  labelSize: number
  /** IM 角标规格 */
  badge: { radius: number; fontSize: number; offsetX: number; offsetY: number; padX: number }
  /**
   * 图标字形（符号/emoji；宿主按名字查）。★Web 用 SVG/字体图标——此处给 App 端的**字形回退**。
   *   （U+FE0E 变体选择符让 emoji 走文本呈现——见各宿主实现。）
   */
  icons: Record<string, string>
  /** 标签文案（符号键 → 文案；缺省用 tabLabels 或键名） */
  labels: Record<string, string>
}

/** App 壳 tab 栏视觉规格（基准 = superapp/App.vue `.sa-tabbar` + global.css token）。 */
export const TAB_BAR_SPEC: TabBarSpec = {
  height: 56,
  surface: '#ffffff',
  line: '#dcdfe5',
  brand: '#5b5bd6',
  text3: '#5f6673',
  badgeBg: '#d64545',
  iconSize: 19,
  labelSize: 10,
  badge: { radius: 8, fontSize: 11, offsetX: 4, offsetY: 4, padX: 4 },
  icons: { index: '⌂', messages: '✉', mine: '☺' },
  labels: { index: '首页', messages: '消息', mine: '我的' },
}
