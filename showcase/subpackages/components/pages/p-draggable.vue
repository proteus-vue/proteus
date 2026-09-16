<!-- showcase/subpackages/components/pages/p-draggable.vue —— p-draggable 可拖拽演示
     覆盖：direction 方向约束 / inertia 惯性 / out-of-bounds 越界 / damping 阻尼 / disabled /
           scale 族 / ghost 拖影 / snap-to-grid 网格吸附（change 事件回显坐标）。
     ★双端：MP 原生 movable-area + movable-view（官方能力本体）；Web Pointer 手势（useGesture）。
     本页用「指针拖动 / 触摸拖动」真实交互，输出区回显实时坐标（非静态图）。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PDraggable, PText, PView } from '@proteus-vue/components'

const pos1 = ref('x: 0, y: 0')
const pos2 = ref('x: 0, y: 0')
const pos3 = ref('x: 0, y: 0')

function onChange1(e: unknown) { const d = e as { x?: number; y?: number }; pos1.value = 'x: ' + (d?.x ?? 0) + ', y: ' + (d?.y ?? 0) }
function onChange2(e: unknown) { const d = e as { x?: number; y?: number }; pos2.value = 'x: ' + (d?.x ?? 0) + ', y: ' + (d?.y ?? 0) }
function onChange3(e: unknown) { const d = e as { x?: number; y?: number }; pos3.value = 'x: ' + (d?.x ?? 0) + ', y: ' + (d?.y ?? 0) }

const codes = ref({
  base: '<p-draggable direction="all" @change="onChange">拖动我</p-draggable>',
  snap: '<p-draggable direction="all" :snap-to-grid="24" ghost @change="onChange">网格吸附</p-draggable>',
  axis: '<p-draggable direction="horizontal" @change="onChange">仅横向</p-draggable>',
  inertia: '<p-draggable direction="all" inertia :damping="20" :friction="2" out-of-bounds />',
})

const apiRows = ref([
  ['direction', '移动方向 all / vertical / horizontal / none（★官方 direction）', 'string'],
  ['inertia', '是否带惯性（★官方 inertia）', 'boolean'],
  ['outOfBounds', '超出可移动区域后是否仍可移动（回弹，★官方 out-of-bounds）', 'boolean'],
  ['x', 'x 轴偏移（★官方 x；改变触发动画）', 'number | string'],
  ['y', 'y 轴偏移（★官方 y）', 'number | string'],
  ['damping', '阻尼系数（越大移动越快，★官方 damping，默认 20）', 'number'],
  ['friction', '摩擦系数（须 >0，★官方 friction，默认 2）', 'number'],
  ['disabled', '是否禁用（★官方 disabled）', 'boolean'],
  ['scaleEnabled', '是否支持双指缩放（★语义等价官方 scale；数值族用 scaleMin/Max/Value）', 'boolean'],
  ['scaleMin', '缩放倍数最小值（★官方 scale-min，默认 0.1）', 'number'],
  ['scaleMax', '缩放倍数最大值（★官方 scale-max，默认 10）', 'number'],
  ['scaleValue', '缩放倍数 0.1–10（★官方 scale-value）', 'number'],
  ['animation', '是否使用动画（★官方 animation）', 'boolean'],
  ['scaleArea', '缩放手势生效区域扩展到 movable-area（★官方 movable-area scale-area）', 'boolean'],
  ['ghost', '拖拽拖影（框架扩展，Web）', 'boolean'],
  ['snapToGrid', '网格吸附步长 px，0=自由（框架扩展，Web）', 'number'],
])
const eventRows = ref([
  ['change', '拖动中触发（★官方 bind:change，detail={x,y,source}）', '{ x, y, source }'],
  ['scale', '缩放中触发（★官方 bind:scale，detail={x,y,scale}）', '{ x, y, scale }'],
  ['drag', '拖动中（框架扩展，载荷 {x,y}）', '{ x, y }'],
  ['drop', '拖动结束（框架扩展，载荷 {x,y}）', '{ x, y }'],
])
const slotRows = ref([['default', '被拖动的元素内容', '—']])
</script>

<template>
  <page-shell title="p-draggable 可拖拽" subtitle="手势原语 · 容器内拖动（MP movable-view / Web Pointer）">
    <demo-block index="01" title="自由拖动" :has-output="true"
      desc="direction=all 容器内自由移动；change 回显实时坐标" :code="codes.base">
      <template #demo>
        <p-view class="stage">
          <p-draggable direction="all" @change="onChange1">
            <p-view class="chip"><p-text>拖动我</p-text></p-view>
          </p-draggable>
        </p-view>
      </template>
      <template #output><p-text class="out">{{ pos1 }}</p-text></template>
    </demo-block>

    <demo-block index="02" title="网格吸附 + 拖影" :has-output="true"
      desc="snap-to-grid=24 吸附到 24px 网格；ghost 拖动时半透明" :code="codes.snap">
      <template #demo>
        <p-view class="stage">
          <p-draggable direction="all" :snap-to-grid="24" ghost @change="onChange2">
            <p-view class="chip chip--alt"><p-text>吸附 24px</p-text></p-view>
          </p-draggable>
        </p-view>
      </template>
      <template #output><p-text class="out">{{ pos2 }}</p-text></template>
    </demo-block>

    <demo-block index="03" title="轴向约束 / 禁用" :has-output="true"
      desc="direction=horizontal 仅横向；disabled 完全禁止拖动" :code="codes.axis">
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
      <template #output><p-text class="out">{{ pos3 }}</p-text></template>
    </demo-block>

    <demo-block index="04" title="惯性 / 阻尼 / 越界" desc="inertia + damping + friction + out-of-bounds（官方物理族）" :code="codes.inertia">
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
    <api-table title="Slots" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
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
