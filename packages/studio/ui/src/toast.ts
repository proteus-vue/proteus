// ui/src/toast.ts —— 轻量提示（toast）的状态（决策 #1236）
//
// 【为什么不能把"成功"塞进状态栏】状态栏是**常驻信息**（路径/行数/脏标记）。
//   "已复制路径"是**瞬时反馈**：它应该出现一下、说完就走，而不是占着状态栏等下一条消息盖掉它。
//   挤在状态栏里有两个具体后果：① 用户根本注意不到（字号小、位置偏）；
//   ② 下一条操作一来就被顶掉，等于没说过。这就是"复制相对路径成功的提示"那种反馈的来源。
//
// 【形态】右下角**可堆叠**的小卡片：类型色条 + 图标 + 一行文案 + 手动关闭。
//   默认 2.6s 自动消失；同类操作连点会**叠**起来而不是互相顶掉（两条都看得见）。
//   不加进度条、不加标题、不加按钮组——提示不是对话框。
import { reactive } from 'vue'

export type ToastKind = 'ok' | 'err' | 'info'

export interface ToastItem {
  id: number
  kind: ToastKind
  text: string
}

export const toasts = reactive<ToastItem[]>([])

let seq = 0
const timers = new Map<number, ReturnType<typeof setTimeout>>()

export function dismissToast(id: number): void {
  const i = toasts.findIndex((t) => t.id === id)
  if (i >= 0) toasts.splice(i, 1)
  const timer = timers.get(id)
  if (timer) clearTimeout(timer)
  timers.delete(id)
}

/* ★**同一句话不重复堆**（决策 #1354）：终端会话丢失时，前端每条写入都会收到
   "终端未打开" ⇒ 一屏能叠 4 个同样的错误卡（用户截图）。同一 (kind,text) 在 1.5s 内
   只保留**最新**一条并重置它的计时器，既不去掉反馈、也不刷屏。 */
const recent = new Map<string, { id: number; at: number }>()

export function pushToast(text: string, kind: ToastKind = 'ok', ms?: number): number {
  const key = `${kind}\u0000${text}`
  const hit = recent.get(key)
  if (hit && Date.now() - hit.at < 1500 && toasts.some((t) => t.id === hit.id)) {
    hit.at = Date.now()
    return hit.id
  }
  const id = ++seq
  recent.set(key, { id, at: Date.now() })
  toasts.push({ id, kind, text })
  // 最多 4 条：超出就把最老的丢掉（提示堆成墙比没有还糟）
  while (toasts.length > 4) dismissToast(toasts[0].id)
  // ★错误**不自动消失**：保存冲突/写盘失败需要人做决定（重读、覆盖），
  //   2.6s 一闪而过等于没告诉。普通提示才自动消退（默认 2.6s）。
  const life = ms ?? (kind === 'err' ? 0 : 2600)
  if (life > 0) timers.set(id, setTimeout(() => dismissToast(id), life))
  return id
}
