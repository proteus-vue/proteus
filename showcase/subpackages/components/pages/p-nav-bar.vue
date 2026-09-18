<!-- showcase/subpackages/components/pages/p-nav-bar.vue —— p-nav-bar 导航栏演示
     覆盖：标题 / 返回 / 固定 / 插槽 / 官方 navigation-bar 属性（loading / front-color /
           background-color / 换色动画）。
     ★对齐官方 <navigation-bar>（导航条）：shell.nav。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PNavBar, PText, PButton } from '@proteus-vue/components'

const lastEvent = ref('（点击返回观察 back 事件）')
function onBack() {
  lastEvent.value = 'back 事件触发（页面决定导航，组件不直接调路由）'
}

const codes = ref({
  base: '<p-nav-bar title="页面标题" />',
  back: '<p-nav-bar title="详情页" back @back="onBack" />',
  slots: '<p-nav-bar title="插槽"><template #right><p-icon name="more" /></template></p-nav-bar>',
  loading: '<p-nav-bar title="加载中" loading />',
  color: '<p-nav-bar title="深色导航" background-color="#1a1a1e" front-color="#ffffff" />',
})

const apiRows = ref([
  ['pid', '组件实例标识（调试/观测/测试定位）', 'string'],
  ['disabled', '禁用态（框架扩展）', 'boolean'],
  ['ariaLabel', '无障碍标签', 'string'],
  ['title', '标题文本（插槽内容优先）', 'string'],
  ['back', '是否显示返回（仅 emit，不直接导航）', 'boolean'],
  ['fixed', '固定于顶部（框架扩展）', 'boolean'],
  ['loading', '标题区显示 loading 指示（★官方 loading）', 'boolean'],
  ['frontColor', '前景色（按钮/标题），仅 #ffffff / #000000（★官方 front-color）', 'string'],
  ['backgroundColor', '背景色（十六进制）（★官方 background-color）', 'string'],
  ['colorAnimationDuration', '换色动画时长 ms（★官方 color-animation-duration）', 'number'],
  ['colorAnimationTimingFunc', '换色动画方式：linear/easeIn/easeOut/easeInOut（★官方）', 'string'],
])
const eventRows = ref([['back', '点击返回（back=true 时）', '—']])
const slotRows = ref([
  ['default', '标题内容（优先于 title）', '—'],
  ['left', '左侧区域', '—'],
  ['right', '右侧区域', '—'],
])
</script>

<template>
  <page-shell title="p-nav-bar 导航栏" subtitle="页面外壳 · 对齐官方 navigation-bar">
    <demo-block index="01" title="基础与返回" :has-output="true" desc="title 标题；back 显示返回（仅 emit）" :code="codes.back">
      <template #demo>
        <view class="col">
          <p-nav-bar title="基础标题" />
          <p-nav-bar title="详情页" back @back="onBack" />
        </view>
      </template>
      <template #output><p-text class="out">{{ lastEvent }}</p-text></template>
    </demo-block>

    <demo-block index="02" title="右侧插槽" desc="left/right 插槽承载操作区" :code="codes.slots">
      <template #demo>
        <p-nav-bar title="带操作">
          <template #right><p-text class="act">更多</p-text></template>
        </p-nav-bar>
      </template>
    </demo-block>

    <demo-block index="03" title="loading 指示" desc="loading 在标题区显示加载指示（★官方 loading）" :code="codes.loading">
      <template #demo>
        <p-nav-bar title="加载中" loading />
      </template>
    </demo-block>

    <demo-block index="04" title="配色（front-color / background-color）" desc="深色导航条；换色动画（★官方 front-color / background-color）" :code="codes.color">
      <template #demo>
        <p-nav-bar title="深色导航" background-color="#1a1a1e" front-color="#ffffff" back />
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="Slots" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
  </page-shell>
</template>

<style scoped>
.col { display: flex; flex-direction: column; gap: var(--sp-3); }
.act { color: #1a7af8; }
.out { display: block; font-size: 12.5px; color: #2f7a4d; }
</style>
