<script setup lang="ts">
// ContextMenu.vue —— 全局右键菜单的渲染层（决策 #1234 / #1239）
//
// 只管三件事：**画**（按 menuState 渲染）、**报告**（点项 → pickItem）、**关闭/定位**。
// 菜单内容由调用方（标签栏/文件树/编辑器）在 `openMenu()` 时给，这里不认识任何具体动作。
//
// ★两条这次修出来的硬要求：
//   ① **先量后放**：贴边翻转必须用**真实尺寸**，不能用"估算高度 × 项数"——
//      估高了会把菜单丢到离鼠标很远的地方（用户截图就是这么来的）。
//      做法：先按锚点渲染但设 `visibility:hidden`，nextTick 量完 → `placeMenu()` → 再显示。
//   ② **高亮必须中性**：hover/键盘选中用一层 8% 白，不用品牌蓝——
//      VS Code / JetBrains 的菜单都是灰底，蓝底在深色界面里"跳"出来，粗糙。
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { activeItem, closeMenu, menuState, moveActive, pickItem, placeMenu } from './contextmenu'

const box = ref<HTMLElement | null>(null)
const placed = ref(false)

function onDocDown(e: MouseEvent) {
  if (!menuState.open) return
  const el = box.value
  if (el && e.target instanceof Node && el.contains(e.target)) return
  closeMenu()
}

function onKey(e: KeyboardEvent) {
  if (!menuState.open) return
  switch (e.key) {
    case 'Escape':
      e.preventDefault()
      closeMenu()
      break
    case 'ArrowDown':
      e.preventDefault()
      moveActive(1)
      break
    case 'ArrowUp':
      e.preventDefault()
      moveActive(-1)
      break
    case 'Home':
      e.preventDefault()
      menuState.active = -1
      moveActive(1)
      break
    case 'End':
      e.preventDefault()
      menuState.active = -1
      moveActive(-1)
      break
    case 'Enter': {
      const it = activeItem()
      if (it) {
        e.preventDefault()
        pickItem(it.id)
      }
      break
    }
    default:
      break
  }
}

watch(
  () => menuState.open,
  async (open) => {
    placed.value = false
    if (!open) return
    await nextTick()
    const el = box.value
    if (!el) return
    const r = el.getBoundingClientRect()
    placeMenu(r.width, r.height, window.innerWidth, window.innerHeight)
    placed.value = true
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
    :style="{
      left: `${menuState.x}px`,
      top: `${menuState.y}px`,
      visibility: placed ? 'visible' : 'hidden',
    }"
    @contextmenu.prevent
  >
    <template v-for="(it, i) in menuState.items" :key="`${it.id}-${i}`">
      <div v-if="it.sep" class="sep" role="separator" />
      <button
        v-else
        class="item"
        role="menuitem"
        :class="{ active: menuState.active === i, danger: it.danger }"
        :data-menu-item="it.id"
        :disabled="it.disabled"
        :aria-disabled="it.disabled ? 'true' : undefined"
        @mouseenter="menuState.active = i"
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
  padding: 4px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--bg-overlay);
  box-shadow: 0 10px 28px -8px rgba(0, 0, 0, 0.55);
}
.item {
  display: flex;
  align-items: center;
  gap: var(--sp3);
  width: 100%;
  height: 24px;
  padding: 0 8px;
  border: 0;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--fg);
  font: 12px/24px -apple-system, 'PingFang SC', sans-serif;
  text-align: left;
  cursor: default;
}
/* ★中性高亮（8% 白），不用品牌蓝 —— 蓝底在深色界面里太跳，是"粗糙"的主要来源 */
.item.active:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
}
.item:disabled {
  color: var(--fg-subtle);
  opacity: 0.55;
  cursor: default;
}
.item.danger:not(:disabled) {
  color: var(--bad);
}
.item.danger.active:not(:disabled) {
  background: rgba(240, 82, 82, 0.14);
}
.label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.accel {
  color: var(--fg-subtle);
  font-size: 11px;
  letter-spacing: 0.2px;
}
.item.active:not(:disabled) .accel {
  color: var(--fg-muted);
}
.sep {
  height: 1px;
  margin: 4px 4px;
  background: var(--border-subtle);
}
</style>
