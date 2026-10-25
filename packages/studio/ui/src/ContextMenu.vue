<script setup lang="ts">
// panels/../ContextMenu.vue —— 全局右键菜单的渲染层（决策 #1234）
//
// 只管三件事：**画**（按 menuState 渲染）、**报告**（点项 → pickItem）、**关闭**（点外面 / Esc / 滚动 / 失焦）。
// 菜单内容由调用方（标签栏/文件树/编辑器）在 `openMenu()` 时给，这里不认识任何具体动作。
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { closeMenu, menuState, pickItem } from './contextmenu'

const box = ref<HTMLElement | null>(null)

function onDocDown(e: MouseEvent) {
  if (!menuState.open) return
  const el = box.value
  if (el && e.target instanceof Node && el.contains(e.target)) return
  closeMenu()
}
function onKey(e: KeyboardEvent) {
  if (menuState.open && e.key === 'Escape') {
    e.preventDefault()
    closeMenu()
  }
}

watch(
  () => menuState.open,
  async (open) => {
    if (!open) return
    // 打开后按真实高度再校一次位置（估算值只负责"大致不越界"）
    await nextTick()
    const el = box.value
    if (!el) return
    const r = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    if (r.right > vw - 6) menuState.x = Math.max(6, vw - r.width - 6)
    if (r.bottom > vh - 6) menuState.y = Math.max(6, vh - r.height - 6)
  },
)

onMounted(() => {
  // capture 阶段：不让下面的组件把"点外面"吃掉
  window.addEventListener('mousedown', onDocDown, true)
  window.addEventListener('keydown', onKey)
  window.addEventListener('resize', closeMenu)
  window.addEventListener('blur', closeMenu)
})
onBeforeUnmount(() => {
  window.removeEventListener('mousedown', onDocDown, true)
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('resize', closeMenu)
  window.removeEventListener('blur', closeMenu)
})
</script>

<template>
  <div
    v-if="menuState.open"
    ref="box"
    class="ctx"
    id="ctxMenu"
    role="menu"
    :style="{ left: `${menuState.x}px`, top: `${menuState.y}px` }"
    @contextmenu.prevent
  >
    <template v-for="(it, i) in menuState.items" :key="`${it.id}-${i}`">
      <div v-if="it.sep" class="sep" />
      <button
        v-else
        class="item"
        role="menuitem"
        :class="{ danger: it.danger }"
        :data-menu-item="it.id"
        :disabled="it.disabled"
        @click="pickItem(it.id)"
      >
        <span class="label">{{ it.label }}</span>
        <span v-if="it.accel" class="accel">{{ it.accel }}</span>
      </button>
    </template>
  </div>
</template>

<style scoped>
.ctx {
  position: fixed;
  z-index: 60;
  min-width: 208px;
  padding: var(--sp1);
  border: 1px solid var(--border-strong);
  border-radius: var(--r-md);
  background: var(--bg-overlay);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(8px);
}
.item {
  display: flex;
  align-items: center;
  gap: var(--sp3);
  width: 100%;
  height: 26px;
  padding: 0 var(--sp2);
  border: 0;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--fg);
  font: var(--fs-xs) / 26px -apple-system, 'PingFang SC', sans-serif;
  text-align: left;
  cursor: pointer;
}
.item:hover:not(:disabled) {
  background: var(--accent);
  color: #fff;
}
.item:hover:not(:disabled) .accel {
  color: rgba(255, 255, 255, 0.8);
}
.item:disabled {
  color: var(--fg-subtle);
  cursor: default;
}
.item.danger:not(:disabled) {
  color: var(--bad);
}
.item.danger:hover:not(:disabled) {
  background: var(--bad);
  color: #fff;
}
.label {
  flex: 1;
}
.accel {
  color: var(--fg-subtle);
  font-size: 11px;
  letter-spacing: 0.3px;
}
.sep {
  height: 1px;
  margin: var(--sp1) var(--sp1);
  background: var(--border-subtle);
}
</style>
