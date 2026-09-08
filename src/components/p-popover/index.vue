<!-- src/components/p-popover/index.vue —— 气泡浮层（★G-32 B4：shell.popover S7）
     trigger click/hover/focus + placement 位置（top/bottom/left/right）
     ★B2/B4 薄壳：v-model 显隐受控 + 自绘定位（智能定位批次接入）
     双端同源码：div → view；MP 安全（遮罩点关闭，避 document 监听） -->
<template>
  <div class="p-popover">
    <!-- ★方案 A spike：data-role 静态属性（非 scoped hash）供 adapter.measureRect 页面级 selectorQuery 测量——
         不加 id（MP 编译器丢弃模块级 let/实例 uid 计数的 const/ref → ReferenceError），data-role 常驻可查 -->
    <div class="p-popover-trigger" data-role="proteus-popover-trigger" @click="onTrigger">
      <slot name="trigger" />
    </div>
    <!-- ★2026-09-07 Skyline 悬浮层：常驻 overlay + visibility 切换（对齐 p-drawer 常驻模式；wx:if 子树在
         glass-easel 不可靠）。portal 版曾实证可渲染但「脱离导致锚定失效（面板左上角）」→ 去 portal，
         面板 absolute 锚定留在原组件树（containing block = .p-popover 根，定位不破坏） -->
    <view class="p-popover-overlay" :class="{ 'p-popover-overlay--on': modelValue }">
      <view class="p-popover-layer" @click="close" />
      <!-- ★方案 A spike：面板定位由 panelStyle 承载 fixed+像素坐标（浮层叠顶层）；measureRect 失败 → 回退
           静态 .p-popover-{placement} 绝对锚定（恰在下/上/左/右 + gap）。静态分支类名**保持不变**（动态
           拼接类被编译器插半截 scope 后缀，勿改） -->
      <view v-if="placement === 'bottom'" class="p-popover-panel p-popover-bottom" :style="panelStyle">
        <slot />
      </view>
      <view v-else-if="placement === 'top'" class="p-popover-panel p-popover-top" :style="panelStyle">
        <slot />
      </view>
      <view v-else-if="placement === 'left'" class="p-popover-panel p-popover-left" :style="panelStyle">
        <slot />
      </view>
      <view v-else class="p-popover-panel p-popover-right" :style="panelStyle">
        <slot />
      </view>
    </view>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { adapter } from '@proteus-vue/shared'
import { computePopoverPosition } from '../runtime/popover-position'
import type { PopoverPlacement } from '../runtime/popover-position'

const props = defineProps({
  /** 显隐（v-model） */
  modelValue: { type: Boolean, default: false },
  /** 触发方式：click / hover / focus（hover/focus 批次接入——B4 薄壳 click） */
  trigger: { type: String, default: 'click' },
  /** 位置：top / bottom / left / right */
  placement: { type: String, default: 'bottom' as PopoverPlacement },
})

const emit = defineEmits(['update:modelValue'])

// ★方案 A spike（Skyline 层叠）：打开时经 adapter.measureRect（L2 抽象——no-platform-api 安全）测 trigger
//   rect → computePopoverPosition 算视口坐标 → 面板 position:fixed + left/top（浮到层叠顶层，不被后续内容盖住）。
//   降级契约：measureRect 缺失/失败/不支持 → panelStyle='' → 回退静态 .p-popover-{placement} 绝对锚定（终案行为）。
//   ★uid：measureRect 是页面级 selector 查询——多实例用唯一 id 区分（否则默认选到第一个 .p-popover-trigger）。
//   ★triggerId（唯一 id）：getCurrentInstance().uid 的顶层 const/ref 在 MP 编译均被丢弃（ref 初始值含函数调用不保留）
//     → 改用**模块级 let popoverSeq（不衍生成 const）** + 方法内 `triggerId.value = '...' + popoverSeq`（运行时值，编译器保留
//     模块 let + data ref 赋值）；确保在 openMeasure 之前赋值（初始化/切换路径均先 ensure）。
//   ★selector（触发测量）：静态 data-role="proteus-popover-trigger"——不用模块级 let计数（MP 编译器丢弃模块 let →
//     ReferenceError 真机崩）/getCurrentInstance().uid（顶层 const/ref 丢弃）/动态 :id（响应式异步 flush 时序坑）。
//     data-role 非 scoped hash（常驻 trigger 恒可查），页面级 selectorQuery 单 popover 场景命中；多实例为已知限制。
//   ★str 直接赋值（非 computed 对象）：MP 只收字符串 style（#500）且经 setData 重化——避开「computed 依赖 async 内
//     ref 赋值未被 chain patch 重化」的编译缺口（p-modal 的 form 走 applyForm 才重化）。
const TRIGGER_SELECTOR = '[data-role="proteus-popover-trigger"]'
const panelStyle = ref('')

async function openMeasure(): Promise<void> {
  // measureRect 可选（旧 adapter/mock 无此方法）→ 回退空增量
  if (!adapter.measureRect || typeof adapter.measureRect !== 'function') {
    panelStyle.value = ''
    return
  }
  try {
    const rect = await adapter.measureRect(TRIGGER_SELECTOR)
    if (!rect) {
      panelStyle.value = ''
      return
    }
    const pos = computePopoverPosition({ trigger: rect, placement: props.placement as PopoverPlacement })
    // fixed + 视口像素坐标：inline 覆盖 .p-popover-panel 的 absolute 与 placement 类的 top/left（inline 优先级最高）
    // ★字符串拼接（MP 安全——模板字符串 ${} 在产物转译易报错，项目一贯拼接；如 computeAnchorStyle）
    panelStyle.value = 'position:fixed;left:' + pos.left + 'px;top:' + pos.top + 'px;right:auto;bottom:auto'
  } catch {
    // 测量异常 → 回退绝对锚定（不抛，调用方降级）
    panelStyle.value = ''
  }
}

function onTrigger(): void {
  if (props.trigger === 'hover') return // hover 批次接入；click 直接切换
  emit('update:modelValue', !props.modelValue)
}
function close(): void {
  emit('update:modelValue', false)
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) openMeasure()
    else panelStyle.value = ''
  },
)

onMounted(() => {
  // 初始即打开：trigger 已在 DOM（setup 时尚未挂载 —— 测量须在 onMounted 后）
  if (props.modelValue) openMeasure()
})
</script>

<style scoped>
.p-popover {
  position: relative;
  display: inline-block;
}
.p-popover-overlay {
  /* 常驻 overlay：关闭态隐藏（不拦截不绘制），打开态可见——skyline 终案（wx:if 子树不可靠，弃 portal） */
  visibility: hidden;
  transition: visibility 0s linear 0.25s;
}
.p-popover-overlay--on {
  visibility: visible;
  transition: visibility 0s linear 0s;
}
.p-popover-layer {
  /* 全屏可靠命中层：显式四边定位（skyline 不认 inset）；popover 非模态 → 透明底 + 微透明兜底绘制 */
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(255, 255, 255, 0.01);
  z-index: 998;
}
.p-popover-panel {
  position: absolute;
  z-index: 999;
  min-width: 120px;
  padding: 8px 12px;
  background: #fff;
  border: 1px solid #ebedf0;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  font-size: 14px;
}
.p-popover-top {
  bottom: calc(100% + 6px);
  left: 0;
}
.p-popover-bottom {
  top: calc(100% + 6px);
  left: 0;
}
.p-popover-left {
  right: calc(100% + 6px);
  top: 0;
}
.p-popover-right {
  left: calc(100% + 6px);
  top: 0;
}
</style>