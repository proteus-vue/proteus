// packages/hmr/src/types.ts —— @proteus-vue/hmr 类型（devtools-plus G-34 M1：HMR 协议）
// ★零依赖：全部接口为结构类型（注入式）——传输层/宿主环境可替换，业务产物不依赖本包

/** HMR 可观测事件（原则 #3 编译透明：HMR 过程可见——DevTools 面板数据源） */
export type HmrEvent =
  | { type: 'connected' }
  | { type: 'disconnected'; reason?: string }
  | { type: 'reconnecting'; attempt: number; delayMs: number }
  | { type: 'payload'; payload: HmrPayload }
  | { type: 'apply'; file: string; result: 'ok' | 'skipped' | 'reload' }
  | { type: 'rule'; rule: 'HMR001' | 'HMR002' | 'HMR003'; file: string; message: string }
  | { type: 'error'; file?: string; message: string }

/** HMR payload：一次增量更新的传输单元 */
export interface HmrPayload {
  /** 单调递增 id（客户端按序应用；乱序/重复丢弃） */
  id: number
  /** 变更文件（相对工程根路径） */
  file: string
  /** 变更类型 */
  type: 'vue' | 'js' | 'css' | 'asset' | 'native-binding'
  /** 新模块代码（vue/js 必带；css/asset 可选——资源替换由宿主处理） */
  code?: string
  /** 编译时间戳 */
  timestamp: number
  /** 动作：update（热替换）/ reload（整体刷新） */
  action: 'update' | 'reload'
}

/** 传输通道（结构类型：WebSocket / SSE / 自研均可注入） */
export interface HmrTransport {
  send(payload: HmrPayload): void
  onMessage(cb: (payload: HmrPayload) => void): void
  onStatus(cb: (online: boolean) => void): void
  close(): void
}

/** 安全 reload 接口（HMR002：原生 binding 变更等不可热替换场景） */
export interface SafeReload {
  /** 保存当前状态（路由栈 + 页面状态；M3 原生侧联动 Router G-32 栈序列化） */
  saveState(): Record<string, unknown>
  /** 恢复状态（传入已保存状态；缺省读存储） */
  restoreState(state?: Record<string, unknown>): Record<string, unknown> | undefined
  /** 安全 reload：保存 → reload（恢复由新会话完成） */
  reload(): void
}
