<script setup lang="ts">
/**
 * ui/src/ui/PSelect.vue —— Studio 自己的下拉选择（决策 #1350）
 *
 * 【为什么要自己造】原生 `<select>` 在 macOS 上由系统绘制：
 *   · 外观完全不受我们控制（圆角/字号/配色都跟 Studio 的深色主题对不上）；
 *   · 弹层样式、键盘行为、以及"和标题栏 drag-region 的交互"都插不进去；
 *   · 更麻烦的是它**在 Tauri webview 里会盖住原生层**（原生 GL 画布在下层，select 弹层在另一层窗口里）。
 *   ⇒ Studio 需要一套自己的基础控件，这个文件是第一个（后续 Button/Input/Popover 都按这套约定来）。
 *
 * 约定（与后续组件保持一致）：
 *   · 只吃 `modelValue` / `update:modelValue`，不藏内部状态（受控组件）；
 *   · 尺寸只用 `size: 'sm' | 'md'`，颜色只用 styles.css 的 CSS 变量；
 *   · 键盘：↑↓ 移动、Enter 选中、Esc 关闭、Tab 关闭并把焦点交出去；
 *   · 点外面关闭（pointerdown 捕获，不用 blur —— blur 在点击弹层里的项时会先触发）。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

type Opt = { value: string; label: string; hint?: string }

const props = withDefaults(
  defineProps<{
    modelValue: string
    options: Opt[]
    size?: 'sm' | 'md'
    title?: string
    width?: number
  }>(),
  { size: 'sm', title: '', width: 0 },
)
const emit = defineEmits<{ 'update:modelValue': [string] }>()

const open = ref(false)
const active = ref(0)
const root = ref<HTMLElement>()
const btn = ref<HTMLElement>()

const cur = computed(() => props.options.find((o) => o.value === props.modelValue))
const style = computed(() => (props.width ? { width: props.width + 'px' } : undefined))

function toggle() {
  open.value ? close() : show()
}

function show() {
  open.value = true
  active.value = Math.max(0, props.options.findIndex((o) => o.value === props.modelValue))
  window.addEventListener('pointerdown', onOutside, true)
}

function close(focusBack = false) {
  if (!open.value) return
  open.value = false
  window.removeEventListener('pointerdown', onOutside, true)
  if (focusBack) void nextTick(() => btn.value?.focus())
}

function onOutside(e: PointerEvent) {
  if (!root.value?.contains(e.target as Node)) close()
}

function pick(o: Opt) {
  emit('update:modelValue', o.value)
  close(true)
}

function onKey(e: KeyboardEvent) {
  if (!open.value) {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault()
      show()
    }
    return
  }
  if (e.key === 'Escape') {
    e.preventDefault()
    close(true)
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    active.value = (active.value + 1) % props.options.length
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    active.value = (active.value - 1 + props.options.length) % props.options.length
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    pick(props.options[active.value])
  } else if (e.key === 'Tab') {
    close()
  }
}

/* 打开时滚到当前项（长列表才有意义，但成本很低） */
watch(open, async (v) => {
  if (!v) return
  await nextTick()
  root.value?.querySelector<HTMLElement>('.psel-list .on')?.scrollIntoView({ block: 'nearest' })
})

onBeforeUnmount(() => window.removeEventListener('pointerdown', onOutside, true))
</script>

<template>
  <div class="psel" :class="[`s-${size}`, { open }]" ref="root" :style="style" :title="title">
    <button
      ref="btn"
      type="button"
      class="psel-btn"
      :aria-expanded="open"
      aria-haspopup="listbox"
      @click="toggle"
      @keydown="onKey"
    >
      <span class="psel-label">{{ cur?.label ?? modelValue }}</span>
      <svg class="psel-caret" width="9" height="9" viewBox="0 0 10 10" aria-hidden="true">
        <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
      </svg>
    </button>
    <ul v-if="open" class="psel-list" role="listbox" @keydown="onKey">
      <li
        v-for="(o, i) in options"
        :key="o.value"
        role="option"
        :aria-selected="o.value === modelValue"
        :class="{ on: i === active, cur: o.value === modelValue }"
        @pointerenter="active = i"
        @click="pick(o)"
      >
        <span>{{ o.label }}</span>
        <small v-if="o.hint">{{ o.hint }}</small>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.psel { position: relative; display: inline-block; }
.psel-btn {
  display: inline-flex; align-items: center; gap: 4px; width: 100%;
  border: 1px solid var(--border-subtle); background: var(--bg-overlay); color: var(--fg);
  border-radius: 5px; cursor: pointer; font: inherit;
}
.s-sm .psel-btn { height: 20px; padding: 0 6px; font-size: 11px; }
.s-md .psel-btn { height: 26px; padding: 0 8px; font-size: 12px; }
.psel-btn:hover { background: var(--bg-elevated); }
.psel-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.psel-label { flex: 1; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.psel-caret { opacity: .7; flex: none; }
.psel.open .psel-caret { transform: rotate(180deg); }

/* 弹层：自己画，避免原生 select 的层叠窗口盖住原生画布 */
.psel-list {
  position: absolute; z-index: 40; left: 0; top: calc(100% + 3px); min-width: 100%;
  margin: 0; padding: 3px; list-style: none;
  background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 7px;
  box-shadow: 0 8px 24px rgb(0 0 0 / 35%); max-height: 240px; overflow: auto;
}
.psel-list li {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 4px 7px; border-radius: 5px; font-size: 11px; color: var(--fg-dim); cursor: pointer;
  white-space: nowrap;
}
.psel-list li small { color: var(--fg-faint, var(--fg-dim)); font-size: 10px; }
.psel-list li.on { background: var(--bg-overlay); color: var(--fg); }
.psel-list li.cur::after { content: '✓'; margin-left: 4px; color: var(--accent); }
</style>
