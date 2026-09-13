<!-- showcase/subpackages/components/pages/p-progress.vue —— p-progress 组件演示（官方形态）
     覆盖：线性 / 环形 / 状态（active·success·exception）/ 粗细 / 圆角 / 自定义色 / 条纹动画 /
           过渡时长 / 百分比字号 / 隐藏信息。
     ★双端同源码（view）；纯样式计算（MP 安全）。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PProgress, PText, PButton } from '@proteus-vue/components'

const codes = ref({
  line: '<p-progress :percent="40" />',
  status: '<p-progress :percent="100" status="success" /><p-progress :percent="60" status="exception" />',
  circle: '<p-progress :percent="70" type="circle" />',
  stroke: '<p-progress :percent="50" :stroke-width="12" :rounded="true" />',
  color: '<p-progress :percent="60" color="#7c5cff" track-color="#eee" />',
  active: '<p-progress :percent="40" active />',
  duration: '<p-progress :percent="dyn" :duration="1200" />',
  info: '<p-progress :percent="80" :show-info="false" /><p-progress :percent="80" :font-size="18" />',
})

const dyn = ref(20)
function range() {
  dyn.value = (dyn.value + 30) % 130
}

const apiRows = ref([
  ['percent', '百分比 0~100（超界自动夹取；★官方对齐）', 'number'],
  ['showInfo', '是否显示右侧百分比文案（★官方 show-info）', 'boolean'],
  ['status', '状态：active 进行中 / success 成功 / exception 异常（★官方 active-mode 动画方向语义归入此处）', 'string'],
  ['strokeWidth', '线宽 px：线性=条高、环形=环粗（★官方 stroke-width）', 'number'],
  ['type', '类型：line 线性 / circle 环形（框架扩展）', 'string'],
  ['rounded', '是否圆角（★官方 border-radius 语义归一）', 'boolean'],
  ['color', '进度色，覆盖状态默认色（★官方 color）', 'string'],
  ['trackColor', '轨道底色（框架扩展）', 'string'],
  ['active', '进度条条纹从左往右动画（★官方 active）', 'boolean'],
  ['duration', '过渡时长 ms（★官方 duration；官方为「每 1%」计时，本框架按整体过渡处理）', 'number'],
  ['fontSize', '右侧百分比字体大小 px（★官方 font-size）', 'number'],
])
const eventRows = ref([['—', 'p-progress 无对外事件（纯展示；★官方 activeend 未纳入——框架动画由 CSS 完成，无完成回调）', '—']])
const slotRows = ref([['—', 'p-progress 无插槽（内容由属性驱动）', '—']])
</script>

<template>
  <page-shell title="p-progress 进度条" subtitle="进度展示 · 线性 / 环形双端一致">
    <demo-block index="01" title="线性（基础）" desc="percent 控制进度；默认显示右侧百分比" :code="codes.line">
      <template #demo>
        <p-progress :percent="40" />
      </template>
    </demo-block>

    <demo-block index="02" title="状态（status）" desc="active 进行中（默认蓝）/ success 成功（绿）/ exception 异常（红）" :code="codes.status">
      <template #demo>
        <view class="col">
          <p-progress :percent="60" status="active" />
          <p-progress :percent="100" status="success" />
          <p-progress :percent="60" status="exception" />
        </view>
      </template>
    </demo-block>

    <demo-block index="03" title="环形（type=circle）" desc="conic-gradient 绘制环形进度（纯 CSS，两端可用）" :code="codes.circle">
      <template #demo>
        <view class="row">
          <p-progress :percent="70" type="circle" />
          <p-progress :percent="100" type="circle" status="success" />
        </view>
      </template>
    </demo-block>

    <demo-block index="04" title="粗细与圆角" desc="stroke-width 条高；rounded 圆角（★官方 border-radius）" :code="codes.stroke">
      <template #demo>
        <view class="col">
          <p-progress :percent="50" :stroke-width="12" />
          <p-progress :percent="50" :stroke-width="12" :rounded="false" />
        </view>
      </template>
    </demo-block>

    <demo-block index="05" title="自定义颜色" desc="color 进度色 · track-color 轨道底色（★官方 color）" :code="codes.color">
      <template #demo>
        <p-progress :percent="60" color="#7c5cff" track-color="#eee" />
      </template>
    </demo-block>

    <demo-block index="06" title="条纹动画与过渡时长" :has-output="true" desc="active 条纹滚动；duration 控制过渡时长（★官方 active / duration）" :code="codes.active">
      <template #demo>
        <view class="col">
          <p-progress :percent="dyn" active :duration="600" />
          <p-button size="mini" @click="range">推进 30</p-button>
        </view>
      </template>
      <template #output>
        <p-text class="out">当前 percent：{{ dyn }}（点击推进，观察过渡 + 条纹）</p-text>
      </template>
    </demo-block>

    <demo-block index="07" title="信息与字号（show-info / font-size）" desc="show-info=false 隐藏文案；font-size 调整百分比字号（★官方 show-info / font-size）" :code="codes.info">
      <template #demo>
        <view class="col">
          <p-progress :percent="80" :show-info="false" />
          <p-progress :percent="80" :font-size="18" />
        </view>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="Slots" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
  </page-shell>
</template>

<style scoped>
.col { display: flex; flex-direction: column; gap: var(--sp-4); }
.row { display: flex; flex-direction: row; align-items: center; gap: var(--sp-4); }
.out {
  display: block;
  background: #f2fbf5;
  border: 1px solid #d6f0e0;
  border-radius: var(--sp-radius-sm);
  padding: var(--sp-2) var(--sp-3);
  font-size: 12.5px;
  color: #2f7a4d;
  font-weight: 600;
}
</style>
