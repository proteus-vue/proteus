<script setup lang="ts">
// ui/src/ToastStack.vue —— 右下角提示栈（决策 #1236）
// 只负责画与过渡；内容全部来自 toast.ts（谁都能 push，不需要父子传参）。
import { dismissToast, toasts } from './toast'
import StudioIcon from './icons/StudioIcon.vue'

const iconOf = (k: string) => (k === 'ok' ? 'check' : k === 'err' ? 'close' : 'code')
</script>

<template>
  <TransitionGroup name="toast" tag="div" class="toasts" id="toasts" aria-live="polite">
    <div v-for="t in toasts" :key="t.id" class="toast" :class="t.kind" :data-kind="t.kind" role="status">
      <span class="bar" />
      <StudioIcon :name="iconOf(t.kind)" :size="13" class="ico" />
      <span class="txt">{{ t.text }}</span>
      <button class="x" aria-label="关闭提示" @click="dismissToast(t.id)">×</button>
    </div>
  </TransitionGroup>
</template>

<style scoped>
.toasts {
  position: fixed;
  right: var(--sp4);
  bottom: var(--sp4);
  z-index: 70;
  display: flex;
  flex-direction: column;
  gap: var(--sp2);
  max-width: 360px;
}
.toast {
  display: flex;
  align-items: center;
  gap: var(--sp2);
  padding: 7px 8px 7px 0;
  border: 1px solid var(--border-strong);
  border-radius: var(--r-md);
  background: var(--bg-overlay);
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.4);
}
.bar {
  width: 3px;
  align-self: stretch;
  border-radius: 0 2px 2px 0;
  background: var(--accent);
}
.toast.ok .bar { background: var(--ok); }
.toast.ok .ico { color: var(--ok); }
.toast.err .bar { background: var(--bad); }
.toast.err .ico { color: var(--bad); }
.toast.info .ico { color: var(--accent); }
.txt {
  flex: 1;
  font: var(--fs-xs) / 1.5 -apple-system, 'PingFang SC', sans-serif;
  color: var(--fg);
}
.x {
  flex: none;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--fg-subtle);
  font-size: 13px;
  line-height: 18px;
  cursor: pointer;
}
.x:hover { background: var(--bg-inset); color: var(--fg); }
.toast-enter-active,
.toast-leave-active {
  transition: opacity var(--dur) var(--ease), transform var(--dur) var(--ease);
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(6px);
}
.toast-leave-active {
  position: absolute;
  right: var(--sp4);
}
</style>
