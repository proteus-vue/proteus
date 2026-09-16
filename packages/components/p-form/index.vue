<!-- src/components/p-form/index.vue —— 表单容器（★G-32 B2：ui.form U18）
     model + rules（字段→校验器）→ validate() 聚合校验 + submit 事件 + errors 状态
     ★B2 简形：同步校验聚合（Promise 校验后续批次）+ layout 横竖排
     双端同源码；MP 安全（无平台 API） -->
<template>
  <form class="p-form" :class="'p-form-' + layout" @submit.prevent="onSubmit">
    <slot :errors="errors" />
  </form>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps({
  /** 表单数据模型（校验对象） */
  model: { type: Object, default: () => ({}) },
  /** 校验规则 {field: (value) => string | null}（返回错误文案；null=通过） */
  rules: { type: Object, default: () => ({}) },
  /** 布局：horizontal 横排 / vertical 纵排 */
  layout: { type: String, default: 'vertical' },
})

const emit = defineEmits(['submit'])

const errors = ref<Record<string, string>>({})

/** 聚合校验：遍历 rules → errors；通过返回 true */
function validate(): boolean {
  const errs: Record<string, string> = {}
  const model = (props.model as Record<string, unknown>) ?? {}
  const rules = (props.rules as Record<string, (v: unknown) => string | null>) ?? {}
  for (const field of Object.keys(rules)) {
    const fn = rules[field]
    if (typeof fn !== 'function') continue
    const msg = fn(model[field])
    if (msg) errs[field] = String(msg)
  }
  errors.value = errs
  return Object.keys(errs).length === 0
}

function onSubmit(): void {
  const ok = validate()
  if (ok) emit('submit', { model: props.model, errors: {} })
  else emit('submit', { model: props.model, errors: { ...errors.value } })
}
</script>

<style scoped>
.p-form {
  display: block;
}
.p-form-horizontal {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
</style>