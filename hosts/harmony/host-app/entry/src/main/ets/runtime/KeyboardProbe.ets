// hosts/harmony/host-app/entry/src/main/ets/runtime/KeyboardProbe.ets
// ★★★ C14 键盘推送**真机探针**（鸿蒙）—— 2026-10-19 · 决策 #1077
//
// 【为什么单列一个文件】`Superapp.ets` 已 959 行（`check:file-size` 新文件硬上限 1000）；
//   探针逻辑塞进去会超限。本文件只放**逻辑**，UI（TextInput）仍留在 Superapp 的 `build()` 里
//   —— ArkUI 组件必须是 @Component 的后代，无法在普通模块里声明。
//
// 【它验证什么】「真实系统键盘 → `window.on('keyboardHeightChange')` → `--pf-keyboard-height`
//   + JS `__proteusHostKeyboard`」全链。鸿蒙 superapp 是**自绘**（RenderNode），没有输入控件，
//   所以探针场景单独渲染一个 TextInput 让系统真正弹键盘（用程序化注入的伪事件证明不了系统真会发）。
//
// 【★诚实边界：一次性 VM（决策 #540）】鸿蒙 superapp 每次渲染新建 VM、同步跑完即销毁。
//   键盘事件到达时**没有存活的 JS 环境** ⇒ JS 侧的 `__proteusHostKeyboard` 只能在**下一次渲染的
//   VM 内**被调用（读数由 `DeviceSnapshot` 带进快照，C++ 在 VM 内注入一次）。
//   ⇒ 本探针能证明的：**系统真的发 keyboardHeightChange** + **env 变量真的更新**；
//     不能证明：JS 侧当帧收到（那是渲染时注入的语义，单测 + C++ 注入路径覆盖）。
//
// 【有界】弹/收各最多 3s（100ms × 30 轮条件轮询，非盲等）；超时如实写 error 并落报告。

export interface KeyboardProbeDeps {
  /** 报告目录（filesDir） */
  filesDir: string
  /** 当前键盘高度（vp）——由调用方维护（`installKeyboardWatch` 的回调里更新） */
  heightVp: () => number
  /** env 变量表（读 `--pf-keyboard-height`） */
  envVars: () => Record<string, number>
  /** 键盘监听是否已装 */
  watched: () => boolean
  /** 触发焦点（TextInput 的 id） */
  requestFocus: (id: string) => void
  /** 收起键盘（由调用方用 IMEKit 的 inputMethod.getController().stopInputSession() 实现） */
  hideKeyboard: () => void
  /** 写文件（注入以便单测/复用；`(name, content) => void`） */
  write: (name: string, content: string) => void
  /** 日志 */
  log: (msg: string) => void
}

/**
 * 跑一次键盘探针（异步有界；完成时写 `keyboard-probe.json`）。
 * ★调用方负责在 `build()` 里提供 `<TextInput id="proteus-kb-probe">`。
 */
export function runKeyboardProbe(deps: KeyboardProbeDeps): void {
  const kp: Record<string, Object> = {
    'watch_installed': deps.watched(),
  }
  // ① 请求焦点 ⇒ 系统弹真实键盘
  deps.requestFocus('proteus-kb-probe')
  let rounds: number = 0
  const timer: number = setInterval(() => {
    rounds++
    const h: number = deps.heightVp()
    kp['shown_height_vp'] = h
    kp['env_keyboard'] = deps.envVars()['--pf-keyboard-height'] ?? -1
    if (h > 0 || rounds >= 30) {
      clearInterval(timer)
      kp['shown_ok'] = h > 0
      if (h <= 0) kp['shown_error'] = 'keyboard 3s 内未出现（无输入法/硬件键盘？）'
      // ② 收起：调输入法服务停止输入会话（不是"移焦到不存在 id"——鸿蒙不一定收）
      deps.hideKeyboard()
      // ③ 等收起（再给一轮，避免"刚弹就读到 0"的假绿）
      let r2: number = 0
      const t2: number = setInterval(() => {
        r2++
        const h2: number = deps.heightVp()
        if (h2 === 0 || r2 >= 20) {
          clearInterval(t2)
          kp['hidden_height_vp'] = h2
          kp['hidden_ok'] = h2 === 0
          const json: string = JSON.stringify(kp)
          deps.write('keyboard-probe.json', json)
          deps.log('PROTEUS_KEYBOARD_PROBE_DONE ' + json)
        }
      }, 100)
    }
  }, 100)
}
