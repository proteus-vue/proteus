<script setup lang="ts">
/**
 * RenameBox.vue —— F2 重命名的输入框（决策 #1444）
 *
 * 定位在符号处，预填当前名字并**全选**（直接打字就是覆盖）。
 * Enter 确认、Esc 取消、点空白取消。z-index 高于预览卡/引用面板。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { renameAsk, settleRename } from './rename'

const val = ref('')
const input = ref<HTMLInputElement | null>(null)

const box = computed(() => {
  const d = renameAsk.value
  if (!d) return {}
  const W = 320
  const vw = window.innerWidth
  const vh = window.innerHeight
  const left = Math.max(8, Math.min(d.x, vw - W - 8))
  const top = d.y + 34 > vh ? Math.max(8, d.y - 44) : d.y
  return { left: `${left}px`, top: `${top}px`, width: `${W}px` }
})

watch(renameAsk, async (d) => {
  if (!d) return
  val.value = d.initial
  await nextTick()
  input.value?.focus()
  input.value?.select()
})

function ok(): void {
  const v = val.value.trim()
  if (!v) return
  settleRename(v)
}

function cancel(): void {
  settleRename(null)
}

/** 点空白取消（选择器是临时动作，不该挡着） */
function onDown(e: MouseEvent): void {
  if (!renameAsk.value) return
  if ((e.target as HTMLElement | null)?.closest('.renamebox')) return
  settleRename(null)
}

onMounted(() => window.addEventListener('mousedown', onDown, true))
onBeforeUnmount(() => window.removeEventListener('mousedown', onDown, true))
</script>

<template>
  <div v-if="renameAsk" class="renamebox" :style="box" @mousedown.stop>
    <span class="rbtag">F2</span>
    <input
      ref="input"
      v-model="val"
      class="rbin"
      spellcheck="false"
      autocomplete="off"
      @keydown.enter.prevent.stop="ok"
      @keydown.esc.prevent.stop="cancel"
    />
    <span class="rbhint">Enter 确认 · Esc 取消</span>
  </div>
</template>

<style scoped>
.renamebox {
  position: fixed;
  /* 高于引用面板(265)与就地提示(300)：这是正在输入的框，必须最上层 */
  z-index: 320;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border: 1px solid #4c8dff;
  border-radius: 5px;
  background: #24272e;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
}
.rbtag {
  flex: none;
  padding: 0 4px;
  border-radius: 3px;
  background: rgba(76, 141, 255, 0.18);
  color: #9dc0ff;
  font: 10px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.rbin {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: #e6e9ef;
  font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.rbhint {
  flex: none;
  color: #5d6673;
  font-size: 9.5px;
}
</style>
