// src/components/index.ts —— 框架内置组件聚合导出
// Web 端：import { VirtualList, PView, PListView } from '@proteus-vue/components'（拆包步骤 6 精确别名 → src/components）
// MP 端：无需 import，标签 <virtual-list>/<p-view> 由 gen-routes 自动解析框架组件（/proteus/...）
// 新增内置组件：在此聚合导出 + 插件/路由自动支持（src/components/ 扫描与 /proteus/ 前缀已就绪）
// 组件层契约/能力（组件库落地评估 v2 B1）：contracts / runtime 供 Web 端 import
import VirtualList from './virtual-list/index.vue'
import PView from './p-view/index.vue'
import PText from './p-text/index.vue'
import PImage from './p-image/index.vue'
import PButton from './p-button/index.vue'
import PScrollView from './p-scroll-view/index.vue'
import PListView from './p-list-view/index.vue'
import PInput from './p-input/index.vue'
import PTextarea from './p-textarea/index.vue'
import PMask from './p-mask/index.vue'
import PPopup from './p-popup/index.vue'
import PToast from './p-toast/index.vue'
import PLoading from './p-loading/index.vue'
import PNavBar from './p-nav-bar/index.vue'
import PSkeleton from './p-skeleton/index.vue'
import PErrorBoundary from './p-error-boundary/index.vue'
// ★G-22 柔性布局（fluid-layout-plan B2/B3）：自适应网格 / 弹性栈 / 内在尺寸
import PGrid from './p-grid/index.vue'
import PStack from './p-stack/index.vue'
import PFit from './p-fit/index.vue'
// ★Fluid System（fluid-system-plan S1）：自适应分栏 / 容器断点分区
import PSplit from './p-split/index.vue'
import PZone from './p-zone/index.vue'
// ★Fluid System（fluid-system-plan S2）：安全区避让 / 纵横比容器
import PSafe from './p-safe/index.vue'
import PAspect from './p-aspect/index.vue'
// ★Fluid System（fluid-system-plan S3）：自适应导航栏 / 工具栏溢出折叠
import PSidebar from './p-sidebar/index.vue'
import PToolbar from './p-toolbar/index.vue'
// ★Fluid System（fluid-system-plan S4）：动态字号/密度
import PScale from './p-scale/index.vue'
// ★p-adaptive（adaptive-container-plan B2）：容器形态自适应
import PAdaptive from './p-adaptive/index.vue'
// ★p-adaptive（adaptive-container-plan B4）：弹窗（形态能力并入）
import PModal from './p-modal/index.vue'
// ★G-32 B2：布局原语补齐（layout.inline/spacer/divider/scroll/virtual-list/masonry）
import PInline from './p-inline/index.vue'
import PSpacer from './p-spacer/index.vue'
import PDivider from './p-divider/index.vue'
import PScroll from './p-scroll/index.vue'
import PVirtualList from './p-virtual-list/index.vue'
import PMasonry from './p-masonry/index.vue'
// ★G-32 B2：UI 原语补齐（ui.heading/icon/switch/slider）
import PHeading from './p-heading/index.vue'
import PIcon from './p-icon/index.vue'
import PSwitch from './p-switch/index.vue'
import PSlider from './p-slider/index.vue'
// ★G-32 B2：Shell 原语（shell.nav/tabbar/drawer）
import PNav from './p-nav/index.vue'
import PTabbar from './p-tabbar/index.vue'
import PDrawer from './p-drawer/index.vue'
// ★G-32 B2 续：UI 视图原语（rich-text/avatar/media/canvas/svg）
import PRichText from './p-rich-text/index.vue'
import PAvatar from './p-avatar/index.vue'
import PMedia from './p-media/index.vue'
import PCanvas from './p-canvas/index.vue'
import PSvg from './p-svg/index.vue'
// ★G-32 B2 续：UI 表单原语（select/checkbox/radio/picker/form）
import PSelect from './p-select/index.vue'
import PCheckbox from './p-checkbox/index.vue'
import PRadio from './p-radio/index.vue'
import PPicker from './p-picker/index.vue'
import PForm from './p-form/index.vue'
// ★G-32 B4：Shell 补齐（page/segment/popover/action-sheet）
import PPage from './p-page/index.vue'
import PSegment from './p-segment/index.vue'
import PPopover from './p-popover/index.vue'
import PActionSheet from './p-action-sheet/index.vue'
// ★G-32 B4 ④ Gesture：可拖拽 / 可滚动（gesture.draggable / gesture.scrollable）
import PDraggable from './p-draggable/index.vue'
import PScrollable from './p-scrollable/index.vue'
// ★G-32 B5 续二：动画组件形态（engineering.transition / engineering.animate）
import PTransition from './p-transition/index.vue'
import PAnimate from './p-animate/index.vue'
// ★G-32 B5 尾巴：E18 声明式导航组件形态（engineering.router-link）
import PRouterLink from './p-router-link/index.vue'

export {
  VirtualList,
  PView,
  PText,
  PImage,
  PButton,
  PScrollView,
  PListView,
  PInput,
  PTextarea,
  PMask,
  PPopup,
  PToast,
  PLoading,
  PNavBar,
  PSkeleton,
  PErrorBoundary,
  // ★G-22 柔性布局
  PGrid,
  PStack,
  PFit,
  // ★Fluid System
  PSplit,
  PZone,
  // ★Fluid System S2
  PSafe,
  PAspect,
  // ★Fluid System S3
  PSidebar,
  PToolbar,
  // ★Fluid System S4
  PScale,
  // ★p-adaptive
  PAdaptive,
  // ★p-adaptive B4
  PModal,
  // ★G-32 B2：布局原语补齐（layout.inline/spacer/divider/scroll/virtual-list/masonry）
  PInline,
  PSpacer,
  PDivider,
  PScroll,
  PVirtualList,
  PMasonry,
  // ★G-32 B2：UI 原语补齐（ui.heading/icon/switch/slider）
  PHeading,
  PIcon,
  PSwitch,
  PSlider,
  // ★G-32 B2：Shell 原语（shell.nav/tabbar/drawer）
  PNav,
  PTabbar,
  PDrawer,
  // ★G-32 B2 续：UI 视图原语（rich-text/avatar/media/canvas/svg）
  PRichText,
  PAvatar,
  PMedia,
  PCanvas,
  PSvg,
  // ★G-32 B2 续：UI 表单原语（select/checkbox/radio/picker/form）
  PSelect,
  PCheckbox,
  PRadio,
  PPicker,
  PForm,
  // ★G-32 B4：Shell 补齐（page/segment/popover/action-sheet）
  PPage,
  PSegment,
  PPopover,
  PActionSheet,
  // ★G-32 B4 ④ Gesture：可拖拽 / 可滚动（gesture.draggable / gesture.scrollable）
  PDraggable,
  PScrollable,
  // ★G-32 B5 续二：动画组件形态（engineering.transition / engineering.animate）
  PTransition,
  PAnimate,
  // ★G-32 B5 尾巴：E18 声明式导航组件形态（engineering.router-link）
  PRouterLink,
}

// ★G-22 柔性布局运行时（Web 端）：v-p-fluid 指令 + 表达式解析/clamp 生成纯函数
export { installFluidLayout, createFluidDirective, createFluidStyle, parseFluidExpr, applyFluidStyle } from './runtime/fluid'
export type { FluidGroup } from './runtime/fluid'
export { COMPONENT_TAG_PREFIX, EVENT_NAMES, SLOT_NAMES } from './contracts'
export type { BaseProps } from './contracts'
