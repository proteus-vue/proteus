<!-- src/components/p-picker/index.vue —— 原生日期/时间/城市选择（★G-32 B2：ui.picker U17）
     mode date/time/region + start/end 边界
     ★B2 Web-first：date/time 用原生 input（type=date/time）；region 待内置精简行政区划数据（partial 标注）
     双端同源码（input → 编译映射）；无平台 API -->
<template>
  <div class="p-picker">
    <input
      v-if="mode === 'date' || mode === 'time'"
      :type="mode === 'date' ? 'date' : 'time'"
      class="p-picker-input"
      :value="modelValue"
      :min="min"
      :max="max"
      @input="onInput"
    />
    <div
      v-else-if="mode === 'region'"
      class="p-picker-region"
      @click="onRegionTap"
    >
      {{ modelValue || '请选择地区（B2 占位——内置行政区划数据后续批次）' }}
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps({
  /** 模式：date / time / region */
  mode: { type: String, default: 'date' },
  /** 值（date=YYYY-MM-DD；time=HH:mm；region=经纬度/文本） */
  modelValue: { type: String, default: '' },
  /** 最小值边界（date/time 原生 min） */
  min: { type: String, default: '' },
  /** 最大值边界 */
  max: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue'])

function onInput(e: Event): void {
  const v = (e.target as HTMLInputElement).value
  emit('update:modelValue', v ?? '')
}

/** ★B2 占位：region 数据源后续批次（内置精简行政区划 / 接入能力）——点按仅提示 */
function onRegionTap(): void {
  /* 后续批次：region 选择面板 */
}
</script>

<style scoped>
.p-picker-input {
  padding: 8px 12px;
  border: 1px solid #ebedf0;
  border-radius: 6px;
  font-size: 14px;
}
.p-picker-region {
  padding: 8px 12px;
  border: 1px solid #ebedf0;
  border-radius: 6px;
  font-size: 14px;
  color: #646566;
}
</style>