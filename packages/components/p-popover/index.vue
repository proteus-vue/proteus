<!-- src/components/p-popover/index.vue —— 气泡浮层（★G-32 B4：shell.popover S7）
     trigger click/hover/focus + placement 位置（top/bottom/left/right）
     ★B2/B4 薄壳：v-model 显隐受控 + 自绘定位（智能定位批次接入）
     双端同源码：div → view；MP 安全（遮罩点关闭，避 document 监听） -->
<template>
  <div class="p-popover">
    <!-- ★2026-09-08 修复定位：改用静态 id（#proteus-popover-trigger）供 adapter.measureRect 查询。
         此前 data-role 属性选择器 [data-role=…] 在 Skyline 引擎不认（PROJECT_MEMORY L82-84 实证「Skyline 不认属性选择器」）
         + class 被 scoped hash（.p-popover-trigger-data-v-x 精确类名 select 查不到无 hash 的 .p-popover-trigger）
         → measureRect 返回 null → panelStyle 空 → 面板 absolute 含块跨 root-portal 失效 → 左上角。
         id 选择器 Skyline 认 + .in(scope) 限定组件内唯一（每实例 wrapper 独立 DOM，静态 id 安全，非模块 let 动态生成） -->
    <!-- ★trigger 事件双通道（2026-09-11）：@click→bindtap 收「普通元素」原生 tap；
         bind:click（原样透传）收「插槽内自定义组件」冒泡的 click（小程序原生 tap 不跨组件边界——
         p-button 等组件 emit({bubbles,composed}) 后由此接收）。两通道互斥不重复触发。 -->
    <div class="p-popover-trigger" :class="triggerQueryCls" id="proteus-popover-trigger" @click="onTrigger" bind:click="onTrigger">
      <slot name="trigger" />
    </div>
    <!-- ★★2026-09-08 改为标准 <teleport>（对齐框架「写标准 Vue 跨端」原则——不再裸写平台标签 root-portal）：
         编译器把 <teleport> 转成 Skyline <root-portal>（官方同层节点，弹层逃逸页面层叠——类 fixed 顶层）。
         组件源码写标准 Vue <teleport to="body">，Web/MP 双端由编译器统一处理——这正让 vue 能力对齐 teleport 有真实消费者。
         ★layering 逃逸部分 = overlay+panel（不含 trigger/触发器）；to="body" 在 MP 无 target 语义（root-portal 恒脱离页面）。
         ★不用 wx:if 包 teleport 内容（glass-easel 下 portal+wx:if 挂载异常不渲染）→ 常驻 + visibility 类切换。
         ★定位：portal 脱离后 containing block 丢失——板面用 :style 定位（fixed+坐标），不依赖 .p-popover 相对锚定。 -->
    <teleport to="body">
      <view class="p-popover-overlay" :class="{ 'p-popover-overlay--on': modelValue }">
        <view class="p-popover-layer" @click="close" />
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
    </teleport>
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
// ★2026-09-08 查询类（二轮修复）：id 选择器真机仍查不到（glass-easel .in(scope) 对组件内静态 id 支持未证）。
//   改用 :class 绑定的运行时类——编译器只对静态字面量类加 scope 后缀，:class 绑定值（classInterp）不过 suffix
//   → DOM 类名无 hash → selectorQuery '.proteus-popover-trigger-query' 类选择器（Skyline 认类选择器）精确匹配。
const triggerQueryCls = 'proteus-popover-trigger-query'
const TRIGGER_SELECTOR = '.proteus-popover-trigger-query'
const panelStyle = ref('')

async function openMeasure(this: unknown): Promise<void> {
  // measureRect 可选（旧 adapter/mock 无此方法）→ 回退空增量
  if (!adapter.measureRect || typeof adapter.measureRect !== 'function') {
    panelStyle.value = ''
    return
  }
  try {
    // ★scope 直接传组件实例 this（MP 方法内 this=组件实例；adapter 经 .in(this) 下探组件内 trigger——
    //   页面级 query 查不到玻璃组件内部，glass-easel 隔离）。★不再用模板 ref popoverRoot（MP 模板 ref 永不绑定
    //   → this.data.popoverRoot 恒 undefined → .in(undefined) 退化为页面级查询 → 测量失败）；也不译 Vue 运行时
    //   getCurrentInstance（MP 编译 not defined，用户决策 1b 反黑盒）——组件实例走 MP 原生 this（框架语义 API）
    // ★2026-09-08 选择器内联（编译器缺口绕过）：顶层 const TRIGGER_SELECTOR 被内联进 data，方法体裸引用
    //   不被改写 → ReferenceError 被 catch 吞 → 左上角真因（登记 compiler 缺口另修）；字面量直接可用
    const rect = await adapter.measureRect('.proteus-popover-trigger-query', this)
    if (!rect) {
      // 测量失败（元素未找到）→ 回退绝对锚定
      panelStyle.value = ''
      return
    }
    const pos = computePopoverPosition({ trigger: rect, placement: props.placement as PopoverPlacement })
    // fixed + 视口像素坐标：inline 覆盖 .p-popover-panel 的 absolute 与 placement 类的 top/left（inline 优先级最高）
    // ★字符串拼接（MP 安全——模板字符串 ${} 在产物转译易报错，项目一贯拼接；如 computeAnchorStyle）
    panelStyle.value = 'position:fixed;left:' + pos.left + 'px;top:' + pos.top + 'px;right:auto;bottom:auto'
    // ★2026-09-08 定位打点（e2e console 断言锚定成功非左上角）：measureRect 成功 → 打印坐标（左=pos.left 上=pos.top）
    console.log(`[proteus-popover] measureRect ok left=${pos.left} top=${pos.top}`)
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