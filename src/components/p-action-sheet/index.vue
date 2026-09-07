<!-- src/components/p-action-sheet/index.vue —— 动作面板（★G-32 B4：shell.action-sheet S9）
     actions[{label,value?,color?}] + cancel + v-model 显隐 + select/cancel emit
     双端同源码：div → view；MP 安全（遮罩 + 面板；无平台 API） -->
<template>
  <div class="p-action-sheet">
    <!-- ★2026-09-07 弹层命中契约（p-drawer P7 同款）：关闭事件挂全屏 layer（可靠命中层），遮罩纯视觉，
         面板 @click.stop 吞自身冒泡——skyline 下遮罩元素自身不参与命中（纯背景子节点被合成进父层） -->
    <div v-if="modelValue" class="p-as-layer" @click="onCancel">
      <div class="p-as-mask" />
      <div class="p-as-panel" @click.stop="noop">
        <div
          v-for="act in actions"
          :key="actLabel(act)"
          class="p-as-item"
          :style="actStyle(act)"
          @click="onSelect(act)"
        >
          {{ actLabel(act) }}
        </div>
        <div class="p-as-cancel" @click="onCancel">{{ cancelText }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CSSProperties } from 'vue'

const props = defineProps({
  /** 显隐（v-model） */
  modelValue: { type: Boolean, default: false },
  /** 动作项 [{label,value?,color?}] */
  actions: { type: Array as () => unknown[], default: () => [] },
  /** 取消文案 */
  cancelText: { type: String, default: '取消' },
})

const emit = defineEmits(['update:modelValue', 'select', 'cancel'])

// ★MP 安全：字段访问走方法（数组泛型 unknown）
function actLabel(act: unknown): string {
  const a = act as { label?: string; value?: string | number }
  return a.label ?? String(a.value ?? '')
}
function actValue(act: unknown): string {
  const a = act as { value?: string | number; label?: string }
  return String(a.value ?? a.label ?? '')
}
function actStyle(act: unknown): CSSProperties {
  const a = act as { color?: string }
  return a.color ? ({ color: a.color } as CSSProperties) : {}
}

function onSelect(act: unknown): void {
  emit('select', actValue(act))
  emit('update:modelValue', false)
}
function onCancel(): void {
  emit('cancel')
  emit('update:modelValue', false)
}

/** 面板内点击仅需阻止冒泡（MP catchtap 无值形式不可编译 → 显式方法承载 .stop） */
function noop(): void {}
</script>

<style scoped>
.p-action-sheet {
  position: relative;
}
.p-as-layer {
  /* 全屏 layer = 视口坐标 + 可靠命中层（对齐 p-drawer 根容器模式） */
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 999;
}
.p-as-mask {
  /* 显式四边定位（skyline 不认 inset 简写）+ 纯视觉 */
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 1;
}
.p-as-panel {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 2;
  background: #fff;
  border-radius: 12px 12px 0 0;
  padding: 8px 0 calc(8px + env(safe-area-inset-bottom));
}
.p-as-item {
  padding: 14px 16px;
  text-align: center;
  font-size: 15px;
  color: #323233;
  border-bottom: 1px solid #f2f3f5;
}
.p-as-cancel {
  padding: 14px 16px;
  text-align: center;
  font-size: 15px;
  color: #646566;
  margin-top: 8px;
  border-top: 6px solid #f7f8fa;
}
</style>