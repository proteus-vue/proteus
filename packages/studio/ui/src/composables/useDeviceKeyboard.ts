// packages/studio/ui/src/composables/useDeviceKeyboard.ts
// ★★★#1341 / #1344：**键盘 → 设备**（把 Mac 键盘输入注入 iPhone）—— 从 `App.vue` 抽出。
//
// 【两条关键设计（都是真机踩出来的，别"优化"掉）】
//   1. **可打印字符合并后发送**（30ms 静默或遇到特殊键时 flush）：
//      逐字一次 IPC 在快速输入时会卡住界面。
//   2. **特殊键立刻发**：退格/回车/方向键必须先 flush 掉已攒的字再单独发，
//      否则顺序会乱（用户会看到"回车跑到前面去了"）。
//
// 【带 Cmd/Ctrl 的组合键一律不消费】那是给 IDE 自己的快捷键（保存、切换面板…）；
//   返回 `false` 让调用方继续往下走。
//
// 【失败处理】统一交给 `onError`（由调用方注入）：源不支持 ⇒ 只提示一次并关开关；
//   真故障 ⇒ 每次都提示。这个分类逻辑本身在 `App.vue` 的 `onTouchError` 里，
//   本模块只管"什么时候调它"，不复制那套判断（复制出来的第二份一定会漂移）。
import { onBeforeUnmount } from 'vue'
import { iosKey } from '../bridge'

/** 需要"立刻发"的按键（其余单字符走合并缓冲）。 */
const SPECIAL = [
  'Backspace', 'Enter', 'Tab', 'Escape', 'Delete',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
]

/** 合并缓冲的静默窗口（ms）：>30ms 无新字符即发送。 */
const FLUSH_MS = 30

export interface DeviceKeyboard {
  /** 把一次按键送给设备；返回 `true` 表示"已消费"（调用方不再往下走快捷键） */
  sendKeyToDevice: (e: KeyboardEvent) => boolean
}

export function useDeviceKeyboard(onError: (err: unknown) => void): DeviceKeyboard {
  let buf = ''
  let timer: number | undefined
  let busy = false

  function flush(): void {
    if (!buf || busy) return
    const text = buf
    buf = ''
    busy = true
    void (async () => {
      try {
        await iosKey(text)
      } catch (err) {
        onError(err)
      } finally {
        busy = false
        if (buf) flush() /* 期间又攒了字 ⇒ 接着发 */
      }
    })()
  }

  function sendKeyToDevice(e: KeyboardEvent): boolean {
    if (SPECIAL.includes(e.key)) {
      e.preventDefault()
      if (timer) {
        window.clearTimeout(timer)
        timer = undefined
      }
      flush() /* 先把已攒的可打印字符发出去，保证顺序 */
      void (async () => {
        try {
          await iosKey(e.key)
        } catch (err) {
          onError(err)
        }
      })()
      return true
    }
    if (e.key.length !== 1) return false
    // ★组合键放行（Cmd/Ctrl/Alt）：那是 IDE 自己的快捷键
    if (e.metaKey || e.ctrlKey || e.altKey) return false
    e.preventDefault()
    buf += e.key
    if (timer) window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      timer = undefined
      flush()
    }, FLUSH_MS)
    return true
  }

  // 卸载时清掉定时器（否则组件销毁后还会发一次）
  onBeforeUnmount(() => {
    if (timer) window.clearTimeout(timer)
    timer = undefined
    buf = ''
  })

  return { sendKeyToDevice }
}
