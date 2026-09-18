<!-- src/components/p-share-element/index.vue —— E29 共享元素转场（★官方 <share-element> 对齐）
     页面间共享元素：两页中 shuttle-key 相同的元素在「跳转/返回」时由宿主做跨页飞行动画（shuttle = 飞跃物）。
     ★语义（G-32）：engineering.share-element —— 与 p-transition（同页显隐过渡）不同：
       p-transition 是**页内** CSS 过渡（框架自绘）；本组件是**页面间**元素转场（能力由宿主提供）。
     ★命名决策（02-ir-prop-binding「保留字冲突 → 加前缀或改写」）——本组件有**两处**改名：
       ① 官方 `key` 在 Vue 中**不是 props**（vnode diff 保留属性——写 <p-share-element :key="x">
          只会被 Vue 消费做 diff，组件**收不到**）→ `shuttleKey`（保留官方「飞跃物」语义 + 明确 key 用途）。
       ② 官方 `transform`（boolean「是否动画」）与 `<view>` 的 CSS transform **字符串**属性类型冲突
          （vue-tsc TS2322）→ `animate`（语义更直白：是否播动画）。
       两处均在审计 SEMANTIC_ALIAS_BY_TAG 登记（官方名 → 框架名）。
     ★跨端（诚实边界）：
       - MP（Skyline）：宿主原生支持 → 属性透传原生 <share-element>，**框架不做动画计算**。
       - Web：**无宿主共享元素转场** → 降级为普通容器（内容可见、不做飞行），不静默：
         需要页内过渡动画请用 p-transition。
       - 原生端：由各 Backend 映射系统共享元素转场（iOS/Android 共享元素、ArkUI geometryTransition）。
     ★注：官方 `worklet:onframe` 是 worklet 回调（事件语义）——按 schema type 过滤，不计入属性覆盖。 -->
<template>
  <view
    class="p-share-element"
    :shuttle-key="shuttleKey"
    :animate="animate"
    :duration="duration"
    :easing-function="easingFunction"
    :transition-on-gesture="transitionOnGesture"
    :shuttle-on-push="shuttleOnPush"
    :shuttle-on-pop="shuttleOnPop"
    :rect-tween-type="rectTweenType"
    :aria-label="ariaLabel"
  >
    <slot />
  </view>
</template>

<script setup lang="ts">
defineProps({
  pid: { type: String, default: '' },
  ariaLabel: { type: String, default: '' },
  // ── ★官方 <share-element> 属性（批次 8 / E29，8 项；worklet:onframe 属事件不计）──
  /** 映射标记：页面内唯一；两页同名即「同一个飞跃物」（★官方 key——Vue 保留属性故改名） */
  shuttleKey: { type: String, default: '' },
  /** 是否进行动画（false → 仅位置对齐、无过渡）。★官方名 `transform` 与 <view> 的 CSS transform
   *  字符串属性**类型冲突**（vue-tsc TS2322：boolean 不可赋 string）→ 按 02 命名策略改名为 `animate` */
  animate: { type: Boolean, default: true },
  /** 动画时长（毫秒） */
  duration: { type: Number, default: 300 },
  /** CSS 缓动函数（如 ease / cubic-bezier(...)） */
  easingFunction: { type: String, default: 'ease' },
  /** 手势返回时是否进行动画 */
  transitionOnGesture: { type: Boolean, default: true },
  /** 指定 push 阶段的飞跃物（旧页 → 新页方向控制） */
  shuttleOnPush: { type: String, default: '' },
  /** 指定 pop 阶段的飞跃物（新页 → 旧页方向控制） */
  shuttleOnPop: { type: String, default: '' },
  /** 动画插值曲线（rect 几何插值类型） */
  rectTweenType: { type: String, default: '' },
})
</script>

<style scoped>
/* 布局语义中立：共享元素常是图片/卡片本体，容器不引入 flex/尺寸默认值（布局归使用方） */
.p-share-element {
  display: block;
}
</style>
