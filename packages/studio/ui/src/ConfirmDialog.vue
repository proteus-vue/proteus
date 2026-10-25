<script setup lang="ts">
// ui/src/ConfirmDialog.vue —— 应用内确认框（决策 #1243）
// 只管画与键盘；内容由 `ask()` 给。Esc = 取消，Enter = 默认动作。
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { answer, confirmState } from './confirm'

const box = ref<HTMLElement | null>(null)

function onKey(e: KeyboardEvent) {
  if (!confirmState.open) return
  if (e.key === 'Escape') {
    e.preventDefault()
    answer('cancel')
  } else if (e.key === 'Enter') {
    const def = confirmState.actions.find((a) => a.kind === 'default') ?? confirmState.actions[0]
    if (def) {
      e.preventDefault()
      answer(def.id)
    }
  }
}

watch(
  () => confirmState.open,
  async (open) => {
    if (!open) return
    await nextTick()
    // 焦点给"取消"：危险动作不该是回车默认落点（防手滑）
    const cancel = box.value?.querySelector<HTMLButtonElement>('[data-act="cancel"]')
    cancel?.focus()
  },
)

onMounted(() => window.addEventListener('keydown', onKey, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true))
</script>

<template>
  <div v-if="confirmState.open" class="backdrop" @click.self="answer('cancel')">
    <div class="dlg" id="confirmDialog" ref="box" role="alertdialog" aria-modal="true">
      <div class="title">{{ confirmState.title }}</div>
      <p class="body">{{ confirmState.body }}</p>
      <div class="acts">
        <button
          v-for="a in confirmState.actions"
          :key="a.id"
          :data-act="a.id"
          class="btn"
          :class="a.kind"
          @click="answer(a.id)"
        >
          {{ a.label }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  background: rgba(6, 8, 12, 0.45);
  backdrop-filter: blur(1.5px);
}
.dlg {
  width: 380px;
  padding: var(--sp4);
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  background: var(--bg-elevated);
  box-shadow: 0 18px 48px -12px rgba(0, 0, 0, 0.6);
}
.title {
  font-size: 13px;
  font-weight: 600;
  color: var(--fg);
}
.body {
  margin: var(--sp2) 0 var(--sp4);
  font: var(--fs-xs) / 1.6 -apple-system, 'PingFang SC', sans-serif;
  color: var(--fg-muted);
}
.acts {
  display: flex;
  justify-content: flex-end;
  gap: var(--sp2);
}
.btn {
  height: 26px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bg-surface);
  color: var(--fg);
  font: 12px/24px -apple-system, 'PingFang SC', sans-serif;
  cursor: pointer;
}
.btn:hover {
  border-color: var(--border-strong);
  background: var(--bg-overlay);
}
/* 默认动作（保存并关闭）：**浅色实心**，不用品牌蓝。
   理由与右键菜单那条一致：深色界面里一整块饱和蓝会"跳"出来，是廉价感的主要来源。
   这里用"提亮的中性面"表示主次，靠**明度差**而不是色相。 */
.btn.default {
  border-color: rgba(255, 255, 255, 0.22);
  background: rgba(255, 255, 255, 0.12);
  color: var(--fg);
}
.btn.default:hover {
  background: rgba(255, 255, 255, 0.18);
}
.btn:focus-visible {
  outline: 1px solid var(--accent);
  outline-offset: 1px;
}
.btn.danger {
  color: var(--bad);
}
.btn.danger:hover {
  border-color: var(--bad);
}
</style>
