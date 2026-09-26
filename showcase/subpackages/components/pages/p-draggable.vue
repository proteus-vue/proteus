<!-- showcase/subpackages/components/pages/p-draggable.vue —— p-draggable 可拖拽 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-draggable.md ← gen-content.mjs ← packages/components/p-draggable/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PDraggable, PText, PView } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  base: "<p-draggable direction=\"all\" @change=\"onChange\">拖动我</p-draggable>",
  snap: "<p-draggable direction=\"all\" :snap-to-grid=\"24\" ghost @change=\"onChange\">网格吸附</p-draggable>",
  axis: "<p-draggable direction=\"horizontal\" @change=\"onChange\">仅横向</p-draggable>",
  inertia: "<p-draggable direction=\"all\" inertia :damping=\"20\" :friction=\"2\" out-of-bounds />",
})

const pos1 = ref('x: 0, y: 0')
const pos2 = ref('x: 0, y: 0')
const pos3 = ref('x: 0, y: 0')

function onChange1(e: unknown) { const d = e as { x?: number; y?: number }; pos1.value = 'x: ' + (d?.x ?? 0) + ', y: ' + (d?.y ?? 0) }
function onChange2(e: unknown) { const d = e as { x?: number; y?: number }; pos2.value = 'x: ' + (d?.x ?? 0) + ', y: ' + (d?.y ?? 0) }
function onChange3(e: unknown) { const d = e as { x?: number; y?: number }; pos3.value = 'x: ' + (d?.x ?? 0) + ', y: ' + (d?.y ?? 0) }

const apiRows = ref([
  [
    "direction",
    "移动方向：all / vertical / horizontal / none（★官方 direction）",
    "String"
  ],
  [
    "inertia",
    "是否带惯性（★官方 inertia）",
    "Boolean"
  ],
  [
    "outOfBounds",
    "超过可移动区域后是否仍可移动（回弹，★官方 out-of-bounds）",
    "Boolean"
  ],
  [
    "x",
    "x 轴偏移（★官方 x；改变触发动画）",
    "[Number, String]"
  ],
  [
    "y",
    "y 轴偏移（★官方 y）",
    "[Number, String]"
  ],
  [
    "damping",
    "阻尼系数（越大移动越快，★官方 damping，默认 20）",
    "Number"
  ],
  [
    "friction",
    "摩擦系数（必须 >0，★官方 friction，默认 2）",
    "Number"
  ],
  [
    "disabled",
    "是否禁用（★官方 disabled）",
    "Boolean"
  ],
  [
    "scaleEnabled",
    "是否支持双指缩放（★官方 scale；入参 scale 为官方保留属性名，框架侧用 scaleEnabled 避免与数值 scaleValue 混淆）",
    "Boolean"
  ],
  [
    "scaleMin",
    "缩放倍数最小值（★官方 scale-min，默认 0.1）",
    "Number"
  ],
  [
    "scaleMax",
    "缩放倍数最大值（★官方 scale-max，默认 10）",
    "Number"
  ],
  [
    "scaleValue",
    "缩放倍数（取值范围 0.1–10，★官方 scale-value）",
    "Number"
  ],
  [
    "animation",
    "是否使用动画（★官方 animation）",
    "Boolean"
  ],
  [
    "scaleArea",
    "缩放手势生效区域是否扩展到 movable-area（★官方 movable-area scale-area）",
    "Boolean"
  ],
  [
    "ghost",
    "拖拽拖影（半透明跟随；Web）",
    "Boolean"
  ],
  [
    "snapToGrid",
    "网格吸附步长 px（0=自由拖拽；Web）",
    "Number"
  ]
])
const eventRows = ref([
  [
    "change",
    "选中值变化",
    "d"
  ],
  [
    "scale",
    "—",
    "normalizeDetail(e)"
  ],
  [
    "drag",
    "拖拽中（gesture.draggable）",
    "{ x: (d as { x?: number }).x ?? 0, y: (d as { y?: number }).y ?? 0 }"
  ],
  [
    "drop",
    "拖拽释放",
    "{ x: dx.value, y: dy.value }"
  ]
])
const slotRows = ref([
  [
    "default",
    "默认插槽（组件主内容）",
    "—"
  ]
])
const compatRows = ref([
  [
    "Web SPA",
    "✅",
    "vue-dom · 双端同源码编译目标（编译期映射 + 事件归一）"
  ],
  [
    "微信小程序",
    "✅",
    "skyline（WebView 降级） · 原生控件映射 → <movable-view>（L1 原语） · <double-tap-gesture>（L1 原语）"
  ],
  [
    "Headless（SSR / 测试）",
    "✅",
    "headless · IR 渲染测试档（工具端）"
  ],
  [
    "iOS 原生",
    "🟡",
    "native-ios（UIKit） · 端原型映射——组件级接线未开始"
  ],
  [
    "Android 原生",
    "🟡",
    "native-android（Jetpack） · 端原型映射——组件级接线未开始"
  ],
  [
    "鸿蒙",
    "🟡",
    "native-harmony（ArkUI） · 端原型映射——组件级接线未开始"
  ],
  [
    "Flutter 混合",
    "🟡",
    "flutter · widget 级映射——组件级未验证"
  ],
  [
    "快应用",
    "⬜",
    "快应用引擎（待定） · 端未开始"
  ]
])
</script>

<template>
  <page-shell title="p-draggable 可拖拽" subtitle="手势原语 · 容器内拖动（MP movable-view / Web Pointer）">
    <demo-block index="01" title="自由拖动" desc="direction=all 容器内自由移动；change 回显实时坐标" :has-output="true" :code="codes.base">
      <template #demo>
        <p-view class="stage">
  <p-draggable direction="all" @change="onChange1">
    <p-view class="chip"><p-text>拖动我</p-text></p-view>
  </p-draggable>
</p-view>
      </template>
      <template #output>
        <p-text class="out">{{ pos1 }}</p-text>
      </template>
    </demo-block>

    <demo-block index="02" title="网格吸附 + 拖影" desc="snap-to-grid=24 吸附到 24px 网格；ghost 拖动时半透明" :has-output="true" :code="codes.snap">
      <template #demo>
        <p-view class="stage">
  <p-draggable direction="all" :snap-to-grid="24" ghost @change="onChange2">
    <p-view class="chip chip--alt"><p-text>吸附 24px</p-text></p-view>
  </p-draggable>
</p-view>
      </template>
      <template #output>
        <p-text class="out">{{ pos2 }}</p-text>
      </template>
    </demo-block>

    <demo-block index="03" title="轴向约束 / 禁用" desc="direction=horizontal 仅横向；disabled 完全禁止拖动" :has-output="true" :code="codes.axis">
      <template #demo>
        <p-view class="stage stage--short">
  <p-draggable direction="horizontal" @change="onChange3">
    <p-view class="chip"><p-text>仅横向</p-text></p-view>
  </p-draggable>
  <p-draggable direction="all" disabled>
    <p-view class="chip chip--off"><p-text>已禁用</p-text></p-view>
  </p-draggable>
</p-view>
      </template>
      <template #output>
        <p-text class="out">{{ pos3 }}</p-text>
      </template>
    </demo-block>

    <demo-block index="04" title="惯性 / 阻尼 / 越界" desc="inertia + damping + friction + out-of-bounds（官方物理族）" :has-output="false" :code="codes.inertia">
      <template #demo>
        <p-view class="stage">
  <p-draggable direction="all" inertia :damping="20" :friction="2" out-of-bounds>
    <p-view class="chip chip--alt"><p-text>惯性拖动</p-text></p-view>
  </p-draggable>
</p-view>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<style scoped>
.stage { position: relative; height: 160px; border: 1px dashed var(--p-border, #d8d8dc); border-radius: var(--sp-radius-sm); background: #fafafc; padding: var(--sp-3); overflow: hidden; }
.stage--short { display: flex; flex-direction: column; gap: var(--sp-3); height: auto; }
.chip { display: inline-block; padding: var(--sp-2) var(--sp-3); background: #7c5cff; color: #fff; border-radius: 999px; font-size: 13px; }
.chip--alt { background: #22b573; }
.chip--off { background: #c8c9cc; }
.out { display: block; font-size: 12.5px; color: #2f7a4d; }
</style>
