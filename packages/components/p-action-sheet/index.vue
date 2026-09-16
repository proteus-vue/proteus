<!-- src/components/p-action-sheet/index.vue —— 动作面板（★G-32 B4：shell.action-sheet S9）
     actions[{label,value?,color?}] + cancel + v-model 显隐 + select/cancel emit
     双端同源码：div → view；MP 安全（遮罩 + 面板；无平台 API）
     ★WXML 无函数调用（S38）：label/style 经 computed 预计算为数据行（rows），模板只做属性访问；
       循环内点击用 data-* + 事件对象（WXML bindtap 不能传参）。 -->
<template>
  <div class="p-action-sheet">
    <!-- ★2026-09-07 弹层命中契约（p-drawer P7 同款）：关闭事件挂全屏 layer（可靠命中层），遮罩纯视觉，
         面板 @click.stop 吞自身冒泡——skyline 下遮罩元素自身不参与命中（纯背景子节点被合成进父层） -->
    <div v-if="modelValue" class="p-as-layer" @click="onCancel">
      <div class="p-as-mask" />
      <div class="p-as-panel" @click.stop="noop">
        <div
          v-for="row in rows"
          :key="row.key"
          class="p-as-item"
          :style="row.style"
          :data-value="row.value"
          @click="onSelect"
        >
          {{ row.label }}
        </div>
        <div class="p-as-cancel" @click="onCancel">{{ cancelText }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface ActionItem {
  label?: string
  value?: string | number
  color?: string
}

const props = defineProps({
  /** 显隐（v-model） */
  modelValue: { type: Boolean, default: false },
  /** 动作项 [{label,value?,color?}] */
  actions: { type: Array as () => ActionItem[], default: () => [] },
  /** 取消文案 */
  cancelText: { type: String, default: '取消' },
})

const emit = defineEmits(['update:modelValue', 'select', 'cancel'])

/** ★预计算数据行（WXML 不能调函数——label/style 在 computed 里算好；
 *  ★`value` 用方括号取值：点号写法会被编译器 ref 剥离规则误伤为 this.data.value；
 *  MP 侧由 observers 随 actions 重算，见编译器 script/computed-observer） */
const rows = computed(() =>
  props.actions.map((act, i) => ({
    key: i,
    label: act.label != null ? act.label : String(act['value'] != null ? act['value'] : ''),
    value: String(act['value'] != null ? act['value'] : act.label != null ? act.label : ''),
    style: act.color ? 'color:' + act.color + ';' : '',
  })),
)

function onSelect(e: unknown): void {
  const ev = e as { currentTarget?: { dataset?: { value?: unknown } } }
  const v = ev?.currentTarget?.dataset?.value
  emit('select', v == null ? '' : v)
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
