<!-- showcase/subpackages/components/pages/p-view.vue —— p-view 通用容器演示
     覆盖：基础容器 / 按压反馈（hover-class / hover-start-time / hover-stay-time）/ 禁用 / 嵌套。
     ★双端同源码（div → view）；按压态 MP 用原生 hover-class、Web 用 active 反馈。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PView, PText } from '@proteus-vue/components'

const codes = ref({
  base: '<p-view>内容</p-view>',
  hover: '<p-view hover-class="my-hover" :hover-start-time="0" :hover-stay-time="200">按住我</p-view>',
  none: '<p-view hover-class="none">按住无反馈</p-view>',
  disabled: '<p-view disabled>禁用</p-view>',
})

const apiRows = ref([
  ['pid', '元素标识（框架扩展，用于调试/定位）', 'string'],
  ['disabled', '禁用态（整体淡化，不阻断布局）', 'boolean'],
  ['ariaLabel', '无障碍标签', 'string'],
  ['hoverClass', '按下样式类：缺省用框架默认 p-view--hover；none 关闭按压态；其它值 → 自定义类名（★官方 hover-class）', 'string'],
  ['hoverStopPropagation', '是否阻止祖先节点出现按压态（★官方 hover-stop-propagation）', 'boolean'],
  ['hoverStartTime', '按住多久出现按压态 ms（★官方 hover-start-time，默认 50）', 'number'],
  ['hoverStayTime', '松开后按压态保留时间 ms（★官方 hover-stay-time，默认 400）', 'number'],
])
const eventRows = ref([['—', 'p-view 为纯容器，无对外事件', '—']])
const slotRows = ref([['default', '容器内容', '—']])
</script>

<template>
  <page-shell title="p-view 通用容器" subtitle="布局基元 · 纵向 flex 容器 + 按压反馈">
    <demo-block index="01" title="基础容器" desc="display:flex 纵向；box-sizing 与双端对齐" :code="codes.base">
      <template #demo>
        <p-view class="box"><p-text>普通容器内容</p-text></p-view>
      </template>
    </demo-block>

    <demo-block index="02" title="按压反馈（hover-*）" :has-output="true"
      desc="官方 hover-class / hover-start-time / hover-stay-time：按住出现按压态" :code="codes.hover">
      <template #demo>
        <p-view class="box box--hover" hover-class="demo-hover" :hover-start-time="0" :hover-stay-time="200">
          <p-text>按住我看反馈（松手 200ms 后消失）</p-text>
        </p-view>
      </template>
      <template #output><p-text class="out">MP：hover-class="demo-hover" 由平台在按下时加类；Web：模拟层等效反馈</p-text></template>
    </demo-block>

    <demo-block index="03" title="关闭按压 / 禁用" desc="hover-class=none 无反馈；disabled 整体淡化" :code="codes.none">
      <template #demo>
        <p-view class="col">
          <p-view class="box" hover-class="none"><p-text>hover-class=none（无按压态）</p-text></p-view>
          <p-view class="box" disabled><p-text>disabled 容器</p-text></p-view>
        </p-view>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="Slots" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
  </page-shell>
</template>

<style scoped>
.col { display: flex; flex-direction: column; gap: var(--sp-3); }
.box { padding: var(--sp-3); border: 1px solid var(--p-border, #e5e5e5); border-radius: var(--sp-radius-sm); background: #fff; }
.box--hover { border-style: dashed; }
.out { display: block; font-size: 12.5px; color: #2f7a4d; }
</style>

<style global>
.demo-hover { opacity: 0.6; }
</style>
