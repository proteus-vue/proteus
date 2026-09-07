<!-- src/components/p-select/index.vue —— 选择器 / 弹层型（★G-32 B2：ui.select U12）
     options[{value,label}] + multiple + searchable + cascader（B2 基础：单选/多选面板；searchable/cascader 后续批次）
     ★B2 Web-first：自绘下拉面板（div）；MP 端映射 picker/弹层后续批次
     双端同源码；无平台 API（文档级监听禁——用遮罩点击关闭，对齐 p-drawer 模式） -->
<template>
  <div class="p-select">
    <div class="p-select-trigger" @click="onToggle">
      <div class="p-select-value">{{ displayText || placeholder }}</div>
      <span class="p-select-arrow">▾</span>
    </div>
    <template v-if="open">
      <div class="p-select-mask" @click="close" />
      <div class="p-select-panel">
        <div
          v-for="opt in options"
          :key="valueOf(opt)"
          class="p-select-option"
          :class="{ 'p-select-option-on': isSelected(opt) }"
          @click="pick(opt)"
        >
          <span>{{ labelOf(opt) }}</span>
          <span v-if="isSelected(opt)" class="p-select-check">✓</span>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

const props = defineProps({
  /** 选项 [{value,label}?] */
  options: { type: Array as () => unknown[], default: () => [] },
  /** 单选值 或 多选值数组 */
  modelValue: { type: [String, Number, Array], default: '' },
  /** 多选模式 */
  multiple: { type: Boolean, default: false },
  /** 占位文本 */
  placeholder: { type: String, default: '请选择' },
  /** 搜索（B2 占位声明——后续批次实现） */
  searchable: { type: Boolean, default: false },
  /** 级联（B2 占位声明——后续批次实现） */
  cascader: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue'])

const open = ref(false)

// 面板开关抽方法（MP 编译器事件处理器仅支持方法引用）
function onToggle(): void {
  open.value = !open.value
}
function close(): void {
  open.value = false
}

// ★MP 安全：字段访问走方法（数组泛型 unknown）
function valueOf(opt: unknown): string {
  const o = opt as { value?: string | number }
  return String(o.value ?? '')
}
function labelOf(opt: unknown): string {
  const o = opt as { label?: string }
  return o.label ?? valueOf(opt)
}

const selectedValues = computed(() => {
  if (props.multiple) return (props.modelValue as Array<string | number> | null) ?? []
  return props.modelValue === '' ? [] : [props.modelValue]
})

const displayText = computed(() => {
  const sel = selectedValues.value
  if (!sel.length) return ''
  return sel
    .map((v) => {
      const found = props.options.find((o) => valueOf(o) === String(v))
      return found ? labelOf(found) : String(v)
    })
    .join(' / ')
})

function isSelected(opt: unknown): boolean {
  return selectedValues.value.indexOf(valueOf(opt)) >= 0
}

function pick(opt: unknown): void {
  const v = valueOf(opt)
  if (props.multiple) {
    const cur = selectedValues.value.slice()
    const idx = cur.indexOf(v)
    if (idx >= 0) cur.splice(idx, 1)
    else cur.push(v)
    emit('update:modelValue', cur)
  } else {
    emit('update:modelValue', v)
    open.value = false
  }
}
</script>

<style scoped>
.p-select {
  position: relative;
  display: inline-block;
}
.p-select-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-width: 160px;
  padding: 8px 12px;
  background: #fff;
  border: 1px solid #ebedf0;
  border-radius: 6px;
  font-size: 14px;
}
.p-select-value {
  color: #323233;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.p-select-arrow {
  color: #969799;
  margin-left: 8px;
}
.p-select-mask {
  position: fixed;
  inset: 0;
  z-index: 998;
}
.p-select-panel {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  min-width: 100%;
  max-height: 240px;
  overflow-y: auto;
  background: #fff;
  border: 1px solid #ebedf0;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  z-index: 999;
}
.p-select-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  font-size: 14px;
  color: #323233;
}
.p-select-option-on {
  color: #07c160;
}
.p-select-check {
  color: #07c160;
}
</style>