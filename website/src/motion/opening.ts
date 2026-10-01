// website/src/motion/opening.ts —— ★★**开幕策略**（"何时播/何时不播"的唯一事实源）
//
// 【为什么独立成模块（一次真实的构建失败）】首版把 `openingEligible()` 放在
//   `OpeningCeremony.vue` 的 `<script setup>` 里并 `export`——**`<script setup>` 不允许导出**，
//   构建当场失败（vite 报该行语法错）。⇒ 策略与组件分离：组件只管演，**是否该演**由这里定。
//
// 【判据（都不靠记忆）】
//   · `prefers-reduced-motion` ⇒ 不播；
//   · 每次**页面加载**只播一次（模块级标志：刷新可重看；SPA 内路由往返不重播）。
import { motionAllowed } from './engine-motion'

let playedOnce = false

/** 本页本次加载是否该播开幕（父组件在 setup 期问一次即可） */
export function openingEligible(): boolean {
  return !playedOnce && motionAllowed()
}

/** 标记已播（组件 onMounted 时调用——幂等） */
export function markOpeningPlayed(): void {
  playedOnce = true
}
