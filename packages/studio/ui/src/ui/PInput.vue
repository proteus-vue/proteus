<script setup lang="ts">
/**
 * ui/src/ui/PInput.vue —— Studio 基础输入框（决策 #1350）
 *
 * 用途：终端查找、面板过滤、重命名等。统一高度/圆角/焦点环，并**默认不参与标题栏拖拽**
 * （输入框在 Tauri 的 drag-region 里必须能正常聚焦，`data-tauri-drag-region` 会被 isClickableElement 排除，
 *  但用原生 input 时仍要避免祖先的 pointer 手势抢焦点 —— 这里统一 stopPropagation）。
 */
const model = defineModel<string>({ default: '' })
withDefaults(defineProps<{ placeholder?: string; size?: 'sm' | 'md' }>(), {
  placeholder: '',
  size: 'sm',
})
</script>

<template>
  <input
    v-model="model"
    class="pinput"
    :class="`s-${size}`"
    :placeholder="placeholder"
    spellcheck="false"
    autocomplete="off"
    autocorrect="off"
    autocapitalize="off"
    @pointerdown.stop
  />
</template>

<style scoped>
.pinput {
  width: 100%; border: 1px solid var(--border-subtle); background: var(--bg-overlay);
  color: var(--fg); border-radius: 5px; font: inherit;
}
.s-sm { height: 20px; padding: 0 6px; font-size: 11px; }
.s-md { height: 26px; padding: 0 8px; font-size: 12px; }
.pinput::placeholder { color: var(--fg-faint, var(--fg-dim)); }
.pinput:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 2px rgb(96 165 250 / 22%); }
</style>
