// packages/render-backend/src/tab-bar-spec.ts —— ★★★B2（宿主关注点分离 · G1）：**App 壳 tab 栏视觉规格**
//
// 【它解决什么】三端宿主（Android/iOS/鸿蒙）此前**各自硬编码**同一套 tab 栏样式（颜色/字号/图标/角标规则）
//   ⇒ 改一处要改三处，且必然漂移。本模块把该规格收敛成**一份共享常量**，随运行期 `state` 下发给宿主，
//   宿主只"读规格 → 建原生视图"（不再各写一遍语义）。
//
// 【★★B · 能力归 runtime（2026-10-11 · 决策 #800）】本规格**只含视觉面**（颜色/尺寸/角标几何）。
//   每项的**内容**（名字/文案/字形/角标数）不在这里——那是项目声明（`router.tabBar.list` 的
//   text/glyph/badge），由 gen-routes 在**生成期合并成最终值**（auto-routes 的 `tabItems`），
//   宿主只渲染。历史教训：icons/labels 曾硬编码 `index/messages/mine` 三键 ⇒ dactyl 的
//   l2..l6 全部退化成 "•"，且"首页"压过项目真值（真机截图取证）。
//
// 【★基准 = Web（决策 #508）】规格值取自 Web 真源 `superapp/App.vue` 的 `.sa-tabbar` + `global.css` token：
//   surface #ffffff · 顶线 #dcdfe5 · 选中 brand #5b5bd6 · 未选中 text-3 #5f6673 · 角标 rec #d64545。
//   门禁 `check:host-tab-spec` 钉住"本常量 == 三端宿主读的值"（防漂移）。
//
// 【诚实边界】Web/MP **不消费本常量**（它们用各自 CSS 引擎渲染 `.sa-tabbar`）；本常量是**App 自绘端的
//   共享规格**。Web CSS 是基准，本常量须与它一致（门禁比对 `.sa-tabbar` 的字面值）。
export interface TabBarSpec {
  /** **内容区最小高**（逻辑像素）——内容块（图标 + 间距 + 文案）**至少**占这么高。
   *  ★不含底部安全区：各端渲染高度 = 内容区高 + safeBottom，安全区是内容区**下方**的纯底色
   *  （Web 基准 `.sa-tabbar`：`height: calc(52px + safe)` + `padding-bottom: safe` + 内容居中）。 */
  height: number
  /** **内容区有效高** = `max(height, 内容块自然高)`——**唯一计算点**（三端读同一值，不各算各的）。
   *  ★字号/图标可变（用户 2026-10-11「不可能固定文字和图标大小」）：实际用此值作内容区高，
   *    正常字号 = height（零视觉变化）；字号大时撑高 ⇒ 内容不裁切、上下间距仍相等。 */
  contentHeight: number
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
}

/** 内容区基准高（Web `.sa-tabbar` 的 52px 内容区）。 */
const CONTENT_MIN = 52
/** 图标字号（逻辑像素）。 */
const ICON_SIZE = 19
/** 文案字号（逻辑像素）。 */
const LABEL_SIZE = 10
/** 图标/文案行高系数（通用）：图标行高 ≈ 1.2×字号；文案行高 ≈ 1.2×字号。 */
const LINE_FACTOR = 1.2
/** 图标行与文案行之间的间距（逻辑像素）——与三端 chrome 的 stack spacing 一致。 */
const ICON_LABEL_GAP = 2

/** App 壳 tab 栏视觉规格（基准 = superapp/App.vue `.sa-tabbar` + global.css token）。 */
export const TAB_BAR_SPEC: TabBarSpec = {
  height: CONTENT_MIN,
  surface: '#ffffff',
  line: '#dcdfe5',
  brand: '#5b5bd6',
  text3: '#5f6673',
  badgeBg: '#d64545',
  iconSize: ICON_SIZE,
  labelSize: LABEL_SIZE,
  badge: { radius: 8, fontSize: 11, offsetX: 4, offsetY: 4, padX: 4 },
  // 内容区有效高：正常字号 = 52；字号/图标变大 ⇒ 撑高（保证不裁切 + 上下对称）。**唯一计算点**。
  contentHeight: Math.max(
    CONTENT_MIN,
    Math.round(ICON_SIZE * LINE_FACTOR + ICON_LABEL_GAP + LABEL_SIZE * LINE_FACTOR),
  ),
}
