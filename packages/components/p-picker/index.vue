<!-- src/components/p-picker/index.vue —— 选择器（★G-32 B2：ui.picker U17）
     ★★定位（2026-09-13 用户评审定案）：p-* 内置组件 = 框架统一视觉语言；**两端同一套现代 weui 形态**
       （半屏弹层：× 关闭 + 居中标题 + 滚轮 + 底部主按钮）——
         · Web：中性标签 `<picker>` → defaultScopedPlugin 改写 `<proteus-picker>` → **WebPicker**（weui 半屏）
         · MP ：**原生 `<picker>` 是旧式「取消/确定」顶栏**（非现代设计，按「weui 是参考不是教条」不照搬）
                 → 自绘同一套半屏外壳，滚轮用原生 `<picker-view>`（原生吸附、无自带外壳）→ 两端视觉一致
       ★平台分支用**编译期宏** `__WEB__`（死分支消除）：Web 只留 `<picker>`；MP 只留自绘分支。
     ★属性透传原生 picker：mode（selector/multiSelector）/ range / range-key / value / disabled / header-text。
     ★事件契约（框架约定：**裸载荷**）：change `{ value }` / columnchange `{ column, value }` / cancel。
     ★底部按钮可配置：`show-buttons`（默认 true）/ `button-mode`（single 单按钮 / double 取消+确定）；
       关闭按钮（实测无弹出/关闭动画修正）：**keyframe 进出场**（enter 播放 / leave 播完再卸载）——
       对齐 p-popup 的 shown + phase 模式（transition 在本组件不可靠：Skyline 下首次渲染不触发）。
     ★诚实边界：`mode=time/date/region` 仅 MP 原生支持（自绘分支当前覆盖 selector/multiSelector）。 -->
<template>
  <!-- ★Web：中性标签 → WebPicker（weui 半屏弹层） -->
  <picker
    v-if="isWeb"
    class="p-picker"
    :mode="mode"
    :range="range"
    :range-key="rangeKey || undefined"
    :value="value"
    :disabled="disabled"
    :header-text="headerText || undefined"
    :title="headerText || undefined"
    @change="onChange"
    @cancel="onCancel"
    @columnchange="onColumnChange"
  >
    <!-- 触发内容由使用方提供（slot 即点击区域） -->
    <slot />
  </picker>

  <!-- ★MP：触发区（独立分支——宏死分支被 pruneStaticConditionals 移除后会留悬挂 v-else） -->
  <view v-if="!isWeb" class="p-picker">
    <view class="p-picker-trigger" :class="{ 'p-picker--disabled': disabled }" @click="open">
      <slot />
    </view>
  </view>

  <!-- ★MP 弹层：<teleport> → 编译器转 Skyline <root-portal>（子树脱离页面、类 fixed 顶层）。
       ★为什么必须 teleport：Skyline **不支持 position:fixed**，裸 fixed 会随页面流落成「浮动卡片 + 左右间隙」。
       ★★为什么 **不用 v-if 包裹 portal 内容**（二次打开卡死根因，对齐 p-drawer 注释「glass-easel 下 portal+wx:if 挂载异常」）：
         root-portal 内容**常驻**，靠 class 控制可见/动画；`v-if` 卸载重挂会让 portal 状态错乱 → 再次点击无反应且页面滚动被锁。
       ★动画：`phase`（enter/leave）驱动 keyframe，**退场播完只切 phase**（不卸载），进出场都保留。
       ★命中：root 全屏收遮罩区点击，面板 @click.stop（catchtap）吞自身冒泡（对齐 p-drawer / p-modal）。 -->
  <teleport v-if="!isWeb" to="body">
    <view class="p-picker-root" :class="{ 'p-picker-root--open': shown }" @click="onMaskTap">
      <view
        class="p-picker-mask"
        :class="[maskClass, { 'p-picker-mask--enter': phase === 'enter', 'p-picker-mask--leave': phase === 'leave' }]"
        :style="maskStyle"
      />
      <view
        class="p-picker-sheet"
        :class="{ 'p-picker-sheet--enter': phase === 'enter', 'p-picker-sheet--leave': phase === 'leave' }"
        @click.stop="noop"
      >
        <view class="p-picker-hd">
          <view class="p-picker-close" @click="onCloseTap">×</view>
          <text class="p-picker-title">{{ headerText }}</text>
        </view>
        <picker-view
          class="p-picker-bd"
          :class="indicatorClass"
          :indicator-style="indicatorStyle || undefined"
          :value="draft"
          @change="onPvChange"
        >
          <picker-view-column v-for="(col, ci) in columns" :key="ci">
            <view v-for="(label, li) in col" :key="li" class="p-picker-item">{{ label }}</view>
          </picker-view-column>
        </picker-view>
        <!-- ★底部按钮可配置：show-buttons（false 隐藏——此时**滚动即实时生效**，关闭即结束）
             button-mode：single 单按钮「确定」/ double「取消 + 确定」（各 120px，对齐 weui __ft 双按钮） -->
        <view v-if="showButtons" class="p-picker-ft">
          <view
            v-if="buttonMode === 'double'"
            class="p-picker-btn p-picker-btn--cancel p-picker-btn--sm"
            @click.stop="onCancel"
          >取消</view>
          <view
            class="p-picker-btn p-picker-btn--confirm"
            :class="{ 'p-picker-btn--sm': buttonMode === 'double' }"
            @click.stop="onConfirm"
          >确定</view>
        </view>
      </view>
    </view>
  </teleport>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'

const props = defineProps({
  /** 选择器类型：selector（单列）/ multiSelector（多列）——与原生 picker 一致 */
  mode: { type: String, default: 'selector' },
  /** 选项列表：selector 一维数组；multiSelector 二维数组（各列一个数组） */
  range: { type: Array, default: () => [] },
  /** range 元素为对象时的显示字段名（原生 range-key） */
  rangeKey: { type: String, default: '' },
  /** 选中项索引：selector 为 number；multiSelector 为 number[] */
  value: { type: [Number, Array], default: 0 },
  /** 是否禁用（★官方对齐） */
  disabled: { type: Boolean, default: false },
  /** 选择器标题（★官方 header-text；两端均映射为弹层标题） */
  headerText: { type: String, default: '' },
  /** ★是否显示底部按钮（默认 true）。false 时**滚动即实时 emit change**，关闭即结束（无需确认键） */
  showButtons: { type: Boolean, default: true },
  /** ★底部按钮形态：single 单按钮「确定」（默认）/ double「取消 + 确定」 */
  buttonMode: { type: String, default: 'single' },
  // ── ★官方 <picker-view> 属性（2026-09-14 对齐，批次 2） ──
  /** 滚轮选中指示线样式（原生 picker-view indicator-style；缺省 48px 细线） */
  indicatorStyle: { type: String, default: 'height: 48px;' },
  /** 滚轮指示线附加类名（原生 picker-view indicator-class） */
  indicatorClass: { type: String, default: '' },
  /** 遮罩层附加类名（原生 picker-view mask-class） */
  maskClass: { type: String, default: '' },
  /** 遮罩层内联样式（原生 picker-view mask-style） */
  maskStyle: { type: String, default: '' },
  /** 滚动即实时触发 change（原生 picker-view immediate-change；亦等价于 showButtons=false 的实时生效语义） */
  immediateChange: { type: Boolean, default: false },
})

const emit = defineEmits(['change', 'cancel', 'columnchange'])

/** ★平台布尔：编译期宏在 **script** 中替换（Web=true / MP=false）。
 *  为何不在模板里直接写 `v-if="__WEB__"`——vue-tsc 的模板类型检查不认全局宏
 *  （报 `Property '__WEB__' does not exist on ...Instance`）；经 script 常量中转即可。 */
const isWeb = __WEB__

/* ============ Web 路径（<picker> → WebPicker）：原生形状 → 裸载荷 ============ */

/** 原生形状 → 裸载荷（框架约定；页面侧用 `e?.detail ?? e` 跨端通吃） */
function pick(e: unknown): { value?: unknown; column?: number } {
  const p = e as { detail?: { value?: unknown; column?: number }; value?: unknown; column?: number }
  return (p?.detail ?? p) as { value?: unknown; column?: number }
}

function onChange(e: unknown): void {
  if (props.disabled) return
  emit('change', { value: pick(e).value })
}

/** ★原生 bindcolumnchange：多列联动（列 i 滚动 → 开发者据 columnchange 改 range 数据驱动联动） */
function onColumnChange(e: unknown): void {
  if (props.disabled) return
  const d = pick(e)
  emit('columnchange', { column: d.column, value: d.value })
}

/* ============ MP 路径（自绘半屏 + 原生 picker-view） ============ */
/* ★注：以下 computed 体内避免 TS 断言（as）与 `.value` 点号取属性——前者破坏 computed 静态提取，
   后者被 ref 剥离规则误伤（S40）；属性取值统一用方括号。 */

/** 弹层挂载（enter/leave 全程为 true；leave 动画播完才 false 卸载） */
const shown = ref(false)
/** 动画阶段：enter（进场）/ leave（退场） */
const phase = ref('idle')
const closeTimer = ref(0)

/** picker-view 的 value = 各列索引数组 */
const draft = ref([0])

/** 各列显示文本（二维：每列一个字符串数组）——模板禁止函数调用（S38），故在此算好 */
const columns = computed(() => {
  const r = props.range
  const first = r && r.length ? r[0] : null
  const is2d = Array.isArray(first)
  const cols = is2d ? r : [r]
  return cols.map((col) => {
    const list = Array.isArray(col) ? col : []
    return list.map((it) => {
      if (it !== null && typeof it === 'object' && props.rangeKey) {
        const v = it[props.rangeKey]
        return String(v != null ? v : '')
      }
      return String(it != null ? it : '')
    })
  })
})

/** 当前选中值（裸载荷） */
function emitChange(): void {
  const d = draft.value
  emit('change', { value: props.mode === 'multiSelector' ? d.slice() : d[0] })
}

/** 打开：以当前 value 初始化 draft（selector → [idx]；multiSelector → idx[]），播放进场动画 */
function open(): void {
  if (props.disabled) return
  const v = props.value
  draft.value = Array.isArray(v) ? v.map((x) => Number(x)) : [Number(v) || 0]
  phase.value = 'enter'
  shown.value = true
}

/** 关闭：播放退场动画，动画时长后切 idle（常驻不卸载——对齐 p-drawer；避免二次打开卡死） */
function closeSheet(): void {
  if (!shown.value || phase.value === 'leave') return
  phase.value = 'leave'
  // ★leave 播完：**只切 class/phase（不卸载 root-portal 内容——卸载重挂会二次打开卡死）**
  clearTimeout(closeTimer.value)
  closeTimer.value = setTimeout(() => {
    shown.value = false
    phase.value = 'idle'
  }, 300) as unknown as number
}

/** picker-view 滚动吸附完成：找第一个变化的列 → columnchange（对齐官方多列联动语义） */
function onPvChange(e: unknown): void {
  const ev = e as { detail?: { value?: number[] } }
  const raw = ev && ev.detail ? ev.detail.value : null
  if (!raw || !raw.length) return
  const next: number[] = raw.map((x) => Number(x))
  const prev = draft.value
  for (let i = 0; i < next.length; i++) {
    if (prev[i] !== next[i]) {
      emit('columnchange', { column: i, value: next[i] })
      break
    }
  }
  draft.value = next
  // ★无底部按钮 / immediate-change：滚动即实时生效（关闭即结束，无需确认键）
  if (!props.showButtons || props.immediateChange) emitChange()
}

/** 确定：裸载荷（selector → number；multiSelector → number[]） */
function onConfirm(): void {
  emitChange()
  closeSheet()
}

function onCancel(e?: unknown): void {
  emit('cancel', e)
  closeSheet()
}

/** 关闭键（×）：无按钮时已实时生效 → 仅关闭（不发 cancel）；有按钮 → 取消 */
function onCloseTap(): void {
  if (!props.showButtons) {
    closeSheet()
    return
  }
  onCancel()
}

/** ★遮罩区点击关闭（root 全屏收点击；面板 catchtap 吞自身冒泡——Skyline 命中契约同 p-drawer） */
function onMaskTap(): void {
  if (!shown.value) return
  onCloseTap()
}

/** 面板内点击仅阻止冒泡（MP catchtap 无值形式不可编译 → 显式方法承载 .stop） */
function noop(): void {}



onUnmounted(() => {
  clearTimeout(closeTimer.value)
})
</script>

<style scoped>
.p-picker {
  display: block;
}
.p-picker-trigger {
  display: block;
}
.p-picker--disabled {
  opacity: 0.5;
}
/* root-portal 内全屏层（命中层）：★fixed 仅在 root-portal 下生效（Skyline 页面流内不支持 fixed） */
.p-picker-root {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 9990;
  visibility: hidden; /* 常驻隐藏：不拦截页面点击/滚动（对齐 p-drawer） */
}
.p-picker-root--open {
  visibility: visible;
}
.p-picker-mask {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
}
.p-picker-mask--enter {
  animation: p-picker-fade-in 0.3s ease-out;
}
.p-picker-mask--leave {
  animation: p-picker-fade-out 0.3s ease-in;
}
/* 面板：贴底全宽（left/right 0，与 Web 半屏一致）；keyframe 滑入滑出 = 弹出/关闭动画 */
.p-picker-sheet {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  background: #ffffff;
  border-radius: 12px 12px 0 0;
  overflow: hidden;
}
.p-picker-sheet--enter {
  animation: p-picker-slide-up 0.3s ease-out;
}
.p-picker-sheet--leave {
  animation: p-picker-slide-down 0.3s ease-in;
}
@keyframes p-picker-slide-up {
  from {
    transform: translateY(100%);
  }
  to {
    transform: translateY(0);
  }
}
@keyframes p-picker-slide-down {
  from {
    transform: translateY(0);
  }
  to {
    transform: translateY(100%);
  }
}
@keyframes p-picker-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
@keyframes p-picker-fade-out {
  from {
    opacity: 1;
  }
  to {
    opacity: 0;
  }
}
.p-picker-hd {
  position: relative;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  height: 56px;
  padding: 0 16px;
  box-sizing: border-box;
}
.p-picker-close {
  position: absolute;
  left: 16px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 24px;
  line-height: 1;
  color: rgba(0, 0, 0, 0.9);
  padding: 4px;
}
.p-picker-title {
  font-size: 15px;
  font-weight: 500;
  color: rgba(0, 0, 0, 0.9);
  text-align: center;
}
/* ★滚轮区 240px（weui 官方 bd）；选中指示线由 picker-view 原生 indicator-style 绘制（48px 细线） */
.p-picker-bd {
  display: block;
  width: 100%;
  height: 240px;
  /* ★指示线两端内缩（对齐官方 picker-view：细线不撑满宽度）——覆盖原生 indicator 左右边距 */
  padding-left: 16px;
  padding-right: 16px;
  box-sizing: border-box;
  background: #ffffff;
}
.p-picker-item {
  height: 48px;
  line-height: 48px;
  text-align: center;
  font-size: 17px;
  color: rgba(0, 0, 0, 0.9);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* ★底部按钮区（对齐 weui half-screen-dialog__ft：padding 0 24px 32px） */
.p-picker-ft {
  display: flex;
  flex-direction: row;
  gap: 16px;
  justify-content: center;
  padding: 0 24px 32px;
  background: #ffffff;
}
/* 按钮（weui-btn：高 48 / 圆角 8 / 17px）；单按钮 184px 居中——
   ★尺寸用**单类**（--sm）而非后代选择器：Skyline 不支持后代/复合选择器（会被编译期剔除） */
.p-picker-btn {
  width: 184px;
  height: 48px;
  line-height: 48px;
  text-align: center;
  border-radius: 8px;
  font-size: 17px;
  font-weight: 500;
  box-sizing: border-box;
}
.p-picker-btn--sm {
  width: 120px; /* weui __ft 双按钮 120px */
}
.p-picker-btn--confirm {
  background: #07c160;
  color: #ffffff;
}
.p-picker-btn--cancel {
  background: rgba(0, 0, 0, 0.05);
  color: rgba(0, 0, 0, 0.9);
}
</style>
