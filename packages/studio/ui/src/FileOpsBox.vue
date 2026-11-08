<script setup lang="ts">
/**
 * FileOpsBox.vue —— 文件树「新建 / 重命名」的名字输入浮层（决策 #1460）
 *
 * 与 `RenameBox.vue` 同形态（Promise 桥 + 点空白/Esc 取消），但**刻意不共用**：
 *   F2 那个带「影响 N 个文件」的二次确认态，语义属于符号重命名；这里写盘类的二次确认
 *   一律走 `ask()` 全局对话框（文案能写清路径），不塞进输入框。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { nameAsk, settleName } from './fileOps'

const val = ref('')
const input = ref<HTMLInputElement | null>(null)

const box = computed(() => {
  const d = nameAsk.value
  if (!d) return {}
  const W = 320
  const vw = window.innerWidth
  const vh = window.innerHeight
  const left = Math.max(8, Math.min(d.x, vw - W - 8))
  const top = d.y + 34 > vh ? Math.max(8, d.y - 44) : d.y
  return { left: `${left}px`, top: `${top}px`, width: `${W}px` }
})

watch(nameAsk, async (d) => {
  if (!d) return
  val.value = d.initial
  await nextTick()
  input.value?.focus()
  /* 重命名预填全选（直接打字覆盖）；新建时 initial 为空，select 无副作用 */
  input.value?.select()
})

function ok(): void {
  const v = val.value.trim()
  settleName(v || null)
}

function cancel(): void {
  settleName(null)
}

function onDown(e: MouseEvent): void {
  if (!nameAsk.value) return
  if ((e.target as HTMLElement | null)?.closest('.fnbox')) return
  settleName(null)
}

onMounted(() => window.addEventListener('mousedown', onDown, true))
onBeforeUnmount(() => window.removeEventListener('mousedown', onDown, true))
</script>

<template>
  <div v-if="nameAsk" class="fnbox" :style="box" @mousedown.stop>
    <span class="fntitle">{{ nameAsk.title }}</span>
    <input
      ref="input"
      v-model="val"
      class="fnin"
      spellcheck="false"
      autocomplete="off"
      @keydown.enter.prevent.stop="ok"
      @keydown.esc.prevent.stop="cancel"
    />
    <span class="fnhint">Enter 确认 · Esc 取消</span>
  </div>
</template>

<style scoped>
.fnbox {
  position: fixed;
  z-index: 320;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  border: 1px solid #4c8dff;
  border-radius: 5px;
  background: #24272e;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
}
.fntitle {
  color: #9dc0ff;
  font: 10px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fnin {
  width: 100%;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: #e6e9ef;
  font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.fnhint {
  align-self: flex-end;
  color: #5d6673;
  font-size: 9.5px;
}
</style>
