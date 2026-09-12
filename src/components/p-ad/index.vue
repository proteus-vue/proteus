<!-- src/components/p-ad/index.vue —— 广告位（★权威标尺批 J：shell.ad · 对齐小程序 <ad>）
     语义：广告容器。MP 端原生 <ad>（unit-id 拉联盟广告）；Web 端无广告联盟标准（宿主接入自建广告桥）→ 占位容器 + 可插槽替换。
     ★v-if 双分支：<ad>（MP 原生）/ <view>占位（Web）——两端标签均编译安全（死分支不渲染）。 -->
<template>
  <div class="p-ad" :class="{ 'p-ad--placeholder': isPlaceholder }">
    <!-- MP 原生广告组件 -->
    <ad
      v-if="isMp"
      class="p-ad__el"
      :unit-id="unitId"
      :ad-intervals="adIntervals"
      :ad-type="adType"
      @load="onLoad"
      @error="onError"
      @close="onClose"
    />
    <!-- Web 占位（宿主/业务注入自建广告内容） -->
    <div v-else class="p-ad__ph" :style="placeholderStyle">
      <slot>
        <span class="p-ad__label">{{ placeholderText }}</span>
      </slot>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CSSProperties } from 'vue'
import { isMpRuntime } from '../runtime/container-measure'

const props = defineProps({
  /** 广告单元 id（对齐 unit-id；MP 平台后台创建） */
  unitId: { type: String, default: '' },
  /** 广告自动刷新的间隔秒数（最小 30，对齐 ad-intervals） */
  adIntervals: { type: Number, default: 0 },
  /** 广告类型（对齐 ad-type：banner / video / grid 等） */
  adType: { type: String, default: '' },
  /** 占位高度 px（Web 占位容器） */
  height: { type: Number, default: 100 },
  /** Web 占位文案 */
  placeholderText: { type: String, default: '广告位' },
})

const emit = defineEmits(['load', 'error', 'close'])

const isMp = isMpRuntime()
/** Web 占位恒为占位态（无广告联盟标准 API）——诚实标记，非伪装 */
const isPlaceholder = computed(() => !isMp)

const placeholderStyle = computed<CSSProperties>(() => ({
  height: props.height + 'px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}))

function onLoad(e: unknown): void {
  emit('load', e)
}
function onError(e: unknown): void {
  emit('error', e)
}
function onClose(e: unknown): void {
  emit('close', e)
}
</script>

<style scoped>
.p-ad {
  width: 100%;
}
.p-ad--placeholder {
  border: 1px dashed var(--p-border-color, rgba(0, 0, 0, 0.15));
  border-radius: 6px;
  background: var(--p-fill-color, rgba(0, 0, 0, 0.02));
  color: var(--p-text-color-3, #86909c);
  font-size: 12px;
}
</style>
