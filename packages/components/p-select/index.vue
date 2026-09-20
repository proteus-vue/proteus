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
    <!-- ★2026-09-20（外部实战报告第二十四节）：`<template v-if>` 在 WXML 是**定义块**（is=/data=）、
         不是 Vue 片段容器 → 微信报 "child nodes are not allowed"（外部工程由此黑屏）。
         本分支含两个兄弟节点（mask + panel），故用无样式 <view> 包裹并把 v-if 落到它上面。 -->
    <view v-if="open" class="p-select-layer">
      <div class="p-select-mask" @click="close" />
      <div class="p-select-panel">
        <div
          v-for="row in rows"
          :key="row.key"
          class="p-select-option"
          :class="{ 'p-select-option-on': row.selected }"
          :data-value="row.value"
          @click="pick"
        >
          <span>{{ row.label }}</span>
          <span v-if="row.selected" class="p-select-check">✓</span>
        </div>
      </div>
    </view>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

const props = defineProps({
  /** 选项 [{value,label}?] */
  options: { type: Array as () => Array<{ value?: string | number; label?: string }>, default: () => [] },
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
function valueOf(opt: { value?: string | number; label?: string }): string {
  return String(opt['value'] != null ? opt['value'] : '')
}
function labelOf(opt: { value?: string | number; label?: string }): string {
  return opt.label != null ? opt.label : valueOf(opt)
}

const selectedValues = computed(() => {
  if (props.multiple) return (props.modelValue as Array<string | number> | null) ?? []
  return props.modelValue === '' ? [] : [props.modelValue]
})

/** ★预计算数据行（WXML 禁止函数调用 S38）——label/selected 均在此算好 */
const rows = computed(() =>
  props.options.map((opt, i) => {
    const value = valueOf(opt)
    return { key: value + '#' + i, value, label: labelOf(opt), selected: selectedValues.value.indexOf(value) >= 0 }
  }),
)

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

function pick(e: unknown): void {
  const ev = e as { currentTarget?: { dataset?: { value?: unknown } } }
  const v = ev?.currentTarget?.dataset?.value
  const s = v == null ? '' : String(v)
  if (props.multiple) {
    const cur = selectedValues.value.slice()
    const idx = cur.indexOf(s)
    if (idx >= 0) cur.splice(idx, 1)
    else cur.push(s)
    emit('update:modelValue', cur)
  } else {
    emit('update:modelValue', s)
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