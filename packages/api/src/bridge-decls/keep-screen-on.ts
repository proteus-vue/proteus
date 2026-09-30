// packages/api/src/bridge-decls/keep-screen-on.ts —— 首个声明式能力（NC1 端到端实证）
//
// 【为什么选它做首个样例】
//   · 它是权威标尺修复后浮现的 **21 个真实缺口之一**（此前因快照漏抽 `wx.setKeepScreenOn`
//     而结构性不可见——见 `mp-spec-coverage.ts` 的 SPEC_PLANNED）；
//   · **双端都有真实对等**：MP = `wx.setKeepScreenOn`（callback 式）、
//     Web = **Screen Wake Lock API**（`navigator.wakeLock.request('screen')`，TS DOM lib 自带类型）；
//   · 形态有代表性：MP 侧是典型 callback→Promise 包装，Web 侧是**有状态**（需持有 sentinel 才能释放）
//     —— 正好检验生成器能处理非平凡形态，而不是只挑最简单的那种。
//
// 【诚实边界】Web 端 Wake Lock 需**页面可见**才能获取（隐藏时系统自动释放，恢复可见需重取）；
//   且需安全上下文（HTTPS/localhost）。这些是平台语义，生成物里保留说明，不粉饰为"两端一致"。
import { defineCapability } from '../bridge-decl'

export const keepScreenOn = defineCapability({
  id: 'C83',
  semantic: 'capability.keep-screen-on',
  hook: 'useKeepScreenOn',
  method: 'setKeepScreenOn',
  params: [{ name: 'on', type: 'boolean' }],
  errPrefix: 'screen.keep-on',
  mp: {
    kind: 'callback',
    api: 'setKeepScreenOn',
    // wx 入参名 → 桥参数名
    map: { keepScreenOn: 'on' },
  },
  web: {
    kind: 'stateful',
    guard: 'nav?.wakeLock',
    guardMessage: 'Screen Wake Lock 不可用（需安全上下文 + 浏览器支持）',
    onExpr: 'await nav.wakeLock.request(\'screen\')',
    offExpr: 'await (sentinel as { release(): Promise<void> }).release()',
  },
  doc: '屏幕常亮开关（MP wx.setKeepScreenOn / Web Screen Wake Lock）。Web 端需页面可见 + 安全上下文；隐藏时系统自动释放。',
})
