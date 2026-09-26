<!-- showcase/subpackages/components/pages/p-progress.vue —— p-progress 进度条 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-progress.md ← gen-content.mjs ← packages/components/p-progress/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PButton, PProgress, PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  line: "<p-progress :percent=\"40\" />",
  status: "<p-progress :percent=\"100\" status=\"success\" /><p-progress :percent=\"60\" status=\"exception\" />",
  circle: "<p-progress :percent=\"70\" type=\"circle\" />",
  stroke: "<p-progress :percent=\"50\" :stroke-width=\"12\" :rounded=\"true\" />",
  color: "<p-progress :percent=\"60\" color=\"#7c5cff\" track-color=\"#eee\" />",
  active: "<p-progress :percent=\"40\" active />",
  duration: "<p-progress :percent=\"dyn\" :duration=\"1200\" />",
  info: "<p-progress :percent=\"80\" :show-info=\"false\" /><p-progress :percent=\"80\" :font-size=\"18\" />",
})

const dyn = ref(20)
function range() {
  dyn.value = (dyn.value + 30) % 130
}

const apiRows = ref([
  [
    "percent",
    "当前进度 0-100（超界自动夹取）",
    "Number"
  ],
  [
    "showInfo",
    "是否显示右侧百分比文案（官方 show-info）",
    "Boolean"
  ],
  [
    "status",
    "状态：active 进行中 / success 成功 / exception 异常（官方 active-mode 方向语义归入此处）",
    "String"
  ],
  [
    "strokeWidth",
    "线宽 px（环形=环粗，线性=条高）（官方 stroke-width）",
    "Number"
  ],
  [
    "type",
    "类型：line 线性 / circle 环形",
    "String"
  ],
  [
    "rounded",
    "是否圆角（官方 border-radius 语义归一：>0 即圆角）",
    "Boolean"
  ],
  [
    "color",
    "进度色（覆盖状态默认色）（官方 color）",
    "String"
  ],
  [
    "trackColor",
    "轨道底色",
    "String"
  ],
  [
    "active",
    "★官方 active：进度条从左往右的条纹动画",
    "Boolean"
  ],
  [
    "duration",
    "★官方 duration：过渡时长 ms（官方为「每 1%」，本框架按整体过渡处理，见文件头边界）",
    "Number"
  ],
  [
    "fontSize",
    "★官方 font-size：右侧百分比字体大小",
    "Number"
  ]
])
const eventRows = ref([])
const slotRows = ref([
  [
    "—",
    "无插槽",
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
    "skyline（WebView 降级） · 原生控件映射 → <progress>（L1 原语）"
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
  <page-shell title="p-progress 进度条" subtitle="进度展示 · 线性 / 环形双端一致">
    <demo-block index="01" title="线性（基础）" desc="percent 控制进度；默认显示右侧百分比" :has-output="false" :code="codes.line">
      <template #demo>
        <p-progress :percent="40" />
      </template>
    </demo-block>

    <demo-block index="02" title="状态（status）" desc="active 进行中（默认蓝）/ success 成功（绿）/ exception 异常（红）" :has-output="false" :code="codes.status">
      <template #demo>
        <view class="col">
  <p-progress :percent="60" status="active" />
  <p-progress :percent="100" status="success" />
  <p-progress :percent="60" status="exception" />
</view>
      </template>
    </demo-block>

    <demo-block index="03" title="环形（type=circle）" desc="conic-gradient 绘制环形进度（纯 CSS，两端可用）" :has-output="false" :code="codes.circle">
      <template #demo>
        <view class="row">
  <p-progress :percent="70" type="circle" />
  <p-progress :percent="100" type="circle" status="success" />
</view>
      </template>
    </demo-block>

    <demo-block index="04" title="粗细与圆角" desc="stroke-width 条高；rounded 圆角（★官方 border-radius）" :has-output="false" :code="codes.stroke">
      <template #demo>
        <view class="col">
  <p-progress :percent="50" :stroke-width="12" />
  <p-progress :percent="50" :stroke-width="12" :rounded="false" />
</view>
      </template>
    </demo-block>

    <demo-block index="05" title="自定义颜色" desc="color 进度色 · track-color 轨道底色（★官方 color）" :has-output="false" :code="codes.color">
      <template #demo>
        <p-progress :percent="60" color="#7c5cff" track-color="#eee" />
      </template>
    </demo-block>

    <demo-block index="06" title="条纹动画与过渡时长" desc="active 条纹滚动；duration 控制过渡时长（★官方 active / duration）" :has-output="true" :code="codes.active">
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

    <demo-block index="07" title="信息与字号（show-info / font-size）" desc="show-info=false 隐藏文案；font-size 调整百分比字号（★官方 show-info / font-size）" :has-output="false" :code="codes.info">
      <template #demo>
        <view class="col">
  <p-progress :percent="80" :show-info="false" />
  <p-progress :percent="80" :font-size="18" />
</view>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
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
