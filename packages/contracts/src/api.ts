// packages/contracts/src/api.ts
// ★types-plan §07 / 架构规约 L0：网络域跨层共享 DTO（ApiResponse）
// 定位：跨层通用响应契约（DevTools trace / 跨层传递 / 审计）；运行时请求响应（含 config 的
//       RequestResponse）仍归 @proteus-vue/types/api-types——ApiResponse 是其跨层基座（无 config）

/** 跨层 API 响应 DTO（最小公约数：data + status + headers） */
export interface ApiResponse<T = unknown> {
  data: T
  /** HTTP 状态码 */
  status: number
  headers?: Record<string, string>
}
