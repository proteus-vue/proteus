// scripts/lib/app-composite-verdict.mjs —— ★★★App 三端对齐 · 视觉合成/真实触摸判据（单一实现）
//
// 【为什么抽成模块】门禁 `check-app-screen-content.mjs` 与单测 `tests/app-screen-content-gate.test.ts`
//   **共用同一份判据**（本仓"同一事实一处"纪律）——否则门禁改了、测试还锁旧逻辑，静默失效。
//
// 【判据分两层】
//   · 视觉合成（真上屏）：屏内容确实画出来了（三端各自的"上屏"读数）。
//   · 真实触摸（本轮 2026-10-04 新增）：交互由**真实触摸事件**驱动，而非**装置内直调**命中。
//     此前合成页的"可命中"是 `dispatchHit`/`tapAt`/`proteus_layout_hit_test` 直调
//     （绕过平台事件通道）——只证明内核能命中，不证明真实触摸能驱动交互。三端各自证据：
//       Android：进程内注入真 MotionEvent 序列 → dispatchTouchEvent → GestureDetector（真实触摸事件数）
//       iOS：宿主喂 down→held→up → classifyAndEmit 分流器（真触摸 tap 次数）
//       鸿蒙：uitest uiInput 系统输入栈真注入 → ArkTS .onTouch → appScreenHitAt（真实触摸命中数）

/** 各端"真上屏"判据（合成页确实画到屏上） */
export const COMPOSITE_OK = {
  Android: (d) =>
    d.ok === true && Number(d.painted_samples ?? 0) > 0 && Number(d.content_nodes ?? 0) > 0 && Number(d.hit_points_hit ?? 0) > 0,
  iOS: (d) =>
    d.ok === true && Number(d.content_nodes ?? 0) > 0 && Number(d.layer_count ?? 0) > 0 && d.snapshot === true && Number(d.hit_points_hit ?? 0) > 0,
  鸿蒙: (d) =>
    d.ok === true && Number(d.content_nodes ?? 0) > 0 && Number(d.render_nodes ?? d.cmds ?? 0) > 0 && Number(d.hit_points_hit ?? 0) > 0,
}

/** 各端"真实触摸"判据（非装置内直调——真实事件驱动） */
export const REAL_TOUCH_OK = {
  Android: (d) => d.real_touch === true && Number(d.touch_events ?? 0) > 0 && Number(d.taps_recognized ?? 0) > 0,
  iOS: (d) => d.real_touch === true && Number(d.taps_recognized ?? 0) > 0,
  鸿蒙: (d) => d.real_touch === true && Number(d.real_touch_hits ?? 0) > 0,
}

/** 该端缺失/为 0 的真实触摸字段名（报错信息用） */
export function realTouchMissingField(platform) {
  return platform === '鸿蒙' ? 'real_touch_hits' : platform === 'Android' ? 'touch_events/taps_recognized' : 'taps_recognized'
}
