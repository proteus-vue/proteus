// website/src/ends.ts —— 端注册表 SSOT（原则 W-7 多端文档规范）
// 单一事实来源：文档端矩阵表的列、状态标注、新端接入流程都从这里消费。
// 渲染引擎枚举对齐 packages/render-backend/src/spi.ts 的 BackendId；状态四档对齐全库纪律。
// 后续：端矩阵页可由本表生成（gen-ends-doc），避免手写第二份清单。

export type EndStatus = '✅ 已落地' | '🟡 部分落地' | '📋 规划已入库' | '⬜ 未开始'

export interface EndEntry {
  /** 端 ID（slug，用于端页路由 runtime-{id}.md） */
  id: string
  /** 端名 */
  name: string
  /** 渲染引擎（BackendId，对齐 render-backend spi.ts） */
  engine: string
  /** 逻辑层运行时 */
  runtime: string
  /** 持久化载体（Pinia 工厂适配） */
  persistence: string
  /** 状态工厂 */
  piniaFactory: string
  /** 文档状态（四档） */
  status: EndStatus
  /** 状态补充说明（标注工具档/原型映射等限定） */
  statusNote?: string
}

export const ENDS: EndEntry[] = [
  {
    id: 'web',
    name: 'Web SPA',
    engine: 'vue-dom',
    runtime: 'Vue 3（同线程）',
    persistence: 'localStorage',
    piniaFactory: 'createWebPinia()',
    status: '✅ 已落地',
  },
  {
    id: 'mp-weixin',
    name: '微信小程序',
    engine: 'skyline（WebView 降级）',
    runtime: '独立 JS 运行时（逻辑层）',
    persistence: 'wx storage（写盘防抖）',
    piniaFactory: 'createMpPinia()',
    status: '✅ 已落地',
  },
  {
    id: 'headless',
    name: 'Headless（SSR / 测试）',
    engine: 'headless',
    runtime: 'Node',
    persistence: 'memory',
    piniaFactory: 'createSsrPinia()',
    status: '✅ 已落地',
    statusNote: '工具档',
  },
  {
    id: 'app-ios',
    name: 'iOS 原生',
    engine: 'native-ios（UIKit）',
    runtime: 'JSI 载体（G-40）',
    persistence: 'NativeKVAdapter（待接入）',
    piniaFactory: 'createAppPinia()',
    status: '🟡 部分落地',
    statusNote: '原型映射',
  },
  {
    id: 'app-android',
    name: 'Android 原生',
    engine: 'native-android（Jetpack）',
    runtime: 'JSI 载体（G-40）',
    persistence: 'NativeKVAdapter（待接入）',
    piniaFactory: 'createAppPinia()',
    status: '🟡 部分落地',
    statusNote: '原型映射',
  },
  {
    id: 'app-harmony',
    name: '鸿蒙',
    engine: 'native-harmony（ArkUI）',
    runtime: 'JSI 载体（G-40）',
    persistence: '待定',
    piniaFactory: 'createAppPinia()',
    status: '🟡 部分落地',
    statusNote: '原型映射',
  },
  {
    id: 'flutter',
    name: 'Flutter 混合',
    engine: 'flutter',
    runtime: '同一 JS 逻辑层',
    persistence: '待定',
    piniaFactory: 'createAppPinia()',
    status: '🟡 部分落地',
    statusNote: 'widget 级映射',
  },
  {
    id: 'quick-app',
    name: '快应用',
    engine: '快应用引擎（待定）',
    runtime: '待定',
    persistence: '待定',
    piniaFactory: '待定',
    status: '⬜ 未开始',
  },
]
