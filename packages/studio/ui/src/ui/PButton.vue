<script setup lang="ts">
/**
 * ui/src/ui/PButton.vue —— Studio 基础按钮（决策 #1350）
 *
 * 为什么不用原生 `<button>` + class：Studio 里按钮出现在工具栏、面板头、弹层三处，
 * 各处字号/高度/间距此前各写一套（20px/22px/24px 混用）。这里收敛成**两种尺寸 + 三种语气**，
 * 后续新面板直接用它，避免"每个面板一套按钮样式"继续扩散。
 *
 * 语气：`ghost`（默认，透明底，hover 才亮）· `subtle`（有底色）· `danger`（红，用于破坏性操作）
 */
withDefaults(
  defineProps<{
    size?: 'sm' | 'md'
    variant?: 'ghost' | 'subtle' | 'danger'
    active?: boolean
    disabled?: boolean
    title?: string
  }>(),
  { size: 'sm', variant: 'ghost', active: false, disabled: false, title: '' },
)
</script>

<template>
  <button
    type="button"
    class="pbtn"
    :class="[`s-${size}`, `v-${variant}`, { on: active }]"
    :disabled="disabled"
    :title="title"
  >
    <slot />
  </button>
</template>

<style scoped>
.pbtn {
  display: inline-flex; align-items: center; gap: 5px; justify-content: center;
  border: 1px solid transparent; background: transparent; color: var(--fg-dim);
  border-radius: 5px; cursor: pointer; font: inherit; white-space: nowrap;
}
.s-sm { height: 20px; padding: 0 7px; font-size: 11px; }
.s-md { height: 26px; padding: 0 10px; font-size: 12px; }
.pbtn:hover:not(:disabled) { background: var(--bg-overlay); color: var(--fg); }
.pbtn:active:not(:disabled) { background: var(--bg-elevated); }
.pbtn:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.pbtn.on { background: var(--bg-elevated); color: var(--fg); border-color: var(--border-subtle); }
.pbtn:disabled { opacity: .4; cursor: not-allowed; }
.v-subtle { background: var(--bg-overlay); border-color: var(--border-subtle); color: var(--fg); }
.v-danger { color: #f87171; }
.v-danger:hover:not(:disabled) { background: rgb(248 113 113 / 15%); color: #fca5a5; }
</style>
