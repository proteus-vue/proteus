<!-- showcase/subpackages/components/pages/p-canvas.vue —— p-canvas 画布演示
     覆盖：engine（2d/webgl）/ canvas-id / disable-scroll / resolution 高清倍率 / 尺寸。
     ★双端：MP 原生 <canvas>（type/canvas-id/disable-scroll）；Web <canvas>（同属性面映射）。
     ★诚实边界：帧绘制（getCanvasContext / p-svg-canvas）属能力批次，本页只演示属性面与元素形态。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PCanvas, PText } from '@proteus-vue/components'

const info = ref('canvas-id 已生成；改用 canvas-id 属性可自定义句柄标识')

const codes = ref({
  base: '<p-canvas :width="240" :height="140" />',
  id: '<p-canvas canvas-id="main-canvas" :width="240" :height="140" />',
  scroll: '<p-canvas :disable-scroll="true" />',
  dpr: '<p-canvas :resolution="2" :width="120" :height="80" />',
})

const apiRows = ref([
  ['engine', '渲染引擎 2d / webgl / skia（★语义等价官方 <canvas type>；skia 在 MP 回落 2d）', 'string'],
  ['canvasId', '画布唯一标识（★官方 canvas-id；缺省按实例生成）', 'string'],
  ['disableScroll', '画布手势期间禁止页面滚动/下拉刷新（★官方 disable-scroll）', 'boolean'],
  ['width', 'CSS 宽 px', 'number'],
  ['height', 'CSS 高 px', 'number'],
  ['resolution', '分辨率倍率（内部分辨率 = CSS × 倍率，>1 高清）', 'number'],
])
const eventRows = ref([['—', 'p-canvas 自身无事件（触摸/错误事件由后续能力批次映射）', '—']])
const slotRows = ref([['default', '绘制层叠加内容', '—']])
</script>

<template>
  <page-shell title="p-canvas 画布" subtitle="内容基元 · 2d / webgl 上下文 + 高清倍率">
    <demo-block index="01" title="基础画布" desc="engine 缺省 2d；canvas-id 由组件自动生成保证唯一" :code="codes.base">
      <template #demo>
        <p-canvas :width="240" :height="140" />
      </template>
    </demo-block>

    <demo-block index="02" title="自定义 canvas-id" :has-output="true"
      desc="canvas-id 是绘制上下文的句柄标识（指定后无需再传 type）" :code="codes.id">
      <template #demo>
        <p-canvas canvas-id="main-canvas" :width="240" :height="140" />
      </template>
      <template #output><p-text class="out">{{ info }}</p-text></template>
    </demo-block>

    <demo-block index="03" title="禁止画布内滚动" desc="disable-scroll：画布中的手势不触发页面滚动/下拉刷新" :code="codes.scroll">
      <template #demo>
        <p-canvas :disable-scroll="true" :width="240" :height="140" />
      </template>
    </demo-block>

    <demo-block index="04" title="高清倍率" desc="resolution=2 → 内部分辨率翻倍（CSS 尺寸不变，渲染更清晰）" :code="codes.dpr">
      <template #demo>
        <p-canvas :resolution="2" :width="120" :height="80" />
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="Slots" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
  </page-shell>
</template>

<style scoped>
.out { display: block; font-size: 12.5px; color: #2f7a4d; }
</style>
