// website/src/end-notes.ts —— 逐机制端说明注册表（#415 端指令的说明侧 SSOT）
// 状态列取 ends.ts（端注册表）；本表只管「该机制在各端的具体形态/缺口」——
// 键 = frontmatter.ends 的机制名；值 = end id → 说明（空串 = 无机制级差异，只显示端状态）
// 诚实纪律：说明与实现同步——端接线后必须更新对应行（状态不在此表，漂移面收敛一半）

export const END_MECHANISM_NOTES: Record<string, Record<string, string>> = {
  /** 数据更新：响应式写入 → 视图推送通道 */
  'data-updates': {
    web: 'Vue Proxy 原生——无桥零成本',
    'mp-weixin': 'setDataBridge：16ms 批量窗口 + 深层 diff 叶路径补丁',
    headless: '内存态直更（无视图推送）',
    'app-ios': 'Bridge setData 通道（JSI）待接线',
    'app-android': 'Bridge setData 通道（JSI）待接线',
    'app-harmony': 'Bridge setData 通道（JSI）待接线',
    flutter: '同一 JS 逻辑层——状态通道待接线',
    'quick-app': '',
  },
  /** 启动流程 */
  startup: {
    web: '标准 Vite（dev HMR / build 静态产物）',
    'mp-weixin': 'gen-routes → app.js 骨架 → lazyCodeLoading 按需注入',
    headless: 'Node 直启（mock 桥注入）',
    'app-ios': 'JSI 载体（G-40）——JS 逻辑层随宿主启动',
    'app-android': 'JSI 载体（G-40）',
    'app-harmony': 'JSI 载体（G-40）',
    flutter: '同一 JS 逻辑层（Flutter 引擎侧宿主）',
    'quick-app': '',
  },
  /** 调试与可观测 */
  debugging: {
    web: 'Vue devtools + HMR + TraceBus + 本地浮动面板',
    'mp-weixin': '开发者工具断点 + debug:mp 决策链 + __PROTEUS_STORES__() 快照 + 远程 WS 面板',
    headless: 'Node 直连 TraceBus',
    'app-ios': 'G-57 Inspector L0 叠加宿主调试器（VM Service）待接线',
    'app-android': 'G-57 Inspector L0 叠加宿主调试器（Flipper）待接线',
    'app-harmony': 'G-57 Inspector L0 叠加宿主调试器待接线',
    flutter: '宿主 Flutter DevTools——语义叠加待接',
    'quick-app': '',
  },
  /** 网络：useFetch 桥 + 策略层 */
  network: {
    web: 'fetch（webBridge.request 已实现）',
    'mp-weixin': 'wx.request（wxBridge.request）',
    headless: 'mock 桥注入',
    'app-ios': '原生网络栈桥待接线（策略层随 client 注入即生效）',
    'app-android': '原生网络栈桥待接线',
    'app-harmony': '原生网络栈桥待接线',
    flutter: '桥待接',
    'quick-app': '',
  },
  /** 存储：useStorage + 持久化 */
  storage: {
    web: 'localStorage（webBridge.getStorage 已实现）',
    'mp-weixin': 'wx sync 存储',
    headless: '内存存储（mock / createMockContext 内置）',
    'app-ios': 'NativeKVAdapter（MMKV）待接入',
    'app-android': 'NativeKVAdapter（MMKV）待接入',
    'app-harmony': '存储载体待定',
    flutter: '桥待接',
    'quick-app': '',
  },
}
