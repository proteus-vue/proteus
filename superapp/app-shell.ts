// superapp/app-shell.ts —— ★★★批次 45：App 壳的**构建期已知初值**（App 端静态实例化用）
//
// 【为什么需要】App 端产物是**静态**节点树（无 Vue 运行时）——App.vue 的 `v-if`/`v-for`/插值/`:class`
//   必须在构建期按**已知初值**求值折叠（见编译器 `staticInstantiate`）。本文件把 App.vue 模板引用到的
//   应用级状态（主题/网络条/客服球/音乐条/IM 角标/tab 列表）**快照**成普通值供构建期求值。
//
// 【单一事实源】值取自 `global-state.ts`（与 Web/MP 同源）+ `router/auto-routes.ts`（统一导航产物）；
//   `tabLabel` 与 App.vue 内同名函数**同义**（App.vue 未导出它 ⇒ 此处按同一规则复刻）。
import {
  theme,
  isDark,
  netBarVisible,
  netBarText,
  netBarLevel,
  fabVisible,
  musicVisible,
  musicPlaying,
  musicTitle,
  musicArtist,
  imUnread,
} from './global-state'
import { tabRoutes } from './router/auto-routes'

/** App 壳构建期初值（App.vue 模板引用的全部名字） */
export const statics: Record<string, unknown> = {
  theme: theme.value,
  isDark: isDark.value,
  netBarVisible: netBarVisible.value,
  netBarText: netBarText.value,
  netBarLevel: netBarLevel.value,
  fabVisible: fabVisible.value,
  musicVisible: musicVisible.value,
  musicPlaying: musicPlaying.value,
  musicTitle: musicTitle.value,
  musicArtist: musicArtist.value,
  imUnread: imUnread.value,
  tabRoutes,
  activeTab: 'index',
  tabLabel: (name: string): string =>
    name === 'index' ? '首页' : name === 'messages' ? '消息' : name === 'mine' ? '我的' : name,
}
