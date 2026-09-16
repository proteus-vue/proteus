<!-- showcase/subpackages/components/pages/p-page-container.vue —— p-page-container 页面容器演示
     覆盖：基础弹出 / 遮罩点击关闭开关 / 位置(bottom/top/center) / 动画时长 / 层级 / 下滑关闭 / 自定义样式。
     ★用 **v-model:show** 双向绑定（遮罩点击关闭经 update:show 回写——手写 @update:show 亦可，编译器已归一事件名）。
     ★Skyline：内容经 root-portal 脱离页面；下滑关闭为触摸手势。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PPageContainer, PText, PButton, PView } from '@proteus-vue/components'

const show = ref(false)
const showTop = ref(false)
const showCenter = ref(false)
const showNoOverlay = ref(false)
const showSlide = ref(false)
const lastEvent = ref('（未触发 close）')
function onClose() {
  lastEvent.value = 'close 事件触发'
}

const codes = ref({
  base: '<p-page-container v-model:show="show" @close="onClose"><p-view>内容</p-view></p-page-container>',
  top: '<p-page-container v-model:show="showTop" position="top">…</p-page-container>',
  center: '<p-page-container v-model:show="showCenter" position="center">…</p-page-container>',
  overlay: '<p-page-container v-model:show="showNoOverlay" :overlay="false">…</p-page-container>',
  slide: '<p-page-container v-model:show="showSlide" close-on-slide-down>…</p-page-container>',
})

const apiRows = ref([
  ['show', '是否显示（v-model:show；★官方 show）', 'boolean'],
  ['position', '位置：bottom（默认）/ top / center（★官方 position）', 'string'],
  ['overlay', '是否显示遮罩（★官方 overlay）', 'boolean'],
  ['closeOnClickOverlay', '点击遮罩关闭（框架扩展）', 'boolean'],
  ['round', '圆角（★官方 round）', 'boolean'],
  ['duration', '进出场动画时长 ms（★官方 duration）', 'number'],
  ['zIndex', '层级（★官方 z-index）', 'number'],
  ['closeOnSlideDown', '下滑一段距离后关闭（★官方 close-on-slide-down，触摸/鼠标手势）', 'boolean'],
  ['overlayStyle', '自定义遮罩层样式（★官方 overlay-style）', 'string'],
  ['customStyle', '自定义弹出层样式（★官方 custom-style）', 'string'],
])
const eventRows = ref([
  ['update:show', '显示状态变化（v-model:show 回写；遮罩点击/下滑关闭均触发）', 'boolean'],
  ['close', '关闭（遮罩点击 / 下滑 / 主动关闭）', '—'],
])
const slotRows = ref([['default', '弹出层内容', '—']])
</script>

<template>
  <page-shell title="p-page-container 页面容器" subtitle="页面外壳 · 底部/顶部/居中弹出层">
    <demo-block index="01" title="基础弹出（底部）" :has-output="true" desc="v-model:show 控制；点击遮罩关闭（update:show 回写）" :code="codes.base">
      <template #demo>
        <p-button @click="show = true">打开底部容器</p-button>
      </template>
      <template #output><p-text class="out">{{ lastEvent }}</p-text></template>
    </demo-block>

    <demo-block index="02" title="位置（position）" desc="top 从顶部弹出 / center 居中弹出（★官方 position）" :code="codes.top">
      <template #demo>
        <view class="row">
          <p-button size="mini" @click="showTop = true">顶部（top）</p-button>
          <p-button size="mini" @click="showCenter = true">居中（center）</p-button>
        </view>
      </template>
    </demo-block>

    <demo-block index="03" title="无遮罩 / 下滑关闭" desc="overlay=false 无遮罩；close-on-slide-down 下滑关闭（触摸手势）" :code="codes.overlay">
      <template #demo>
        <view class="row">
          <p-button size="mini" @click="showNoOverlay = true">无遮罩</p-button>
          <p-button size="mini" @click="showSlide = true">下滑关闭</p-button>
        </view>
      </template>
    </demo-block>

    <p-page-container v-model:show="show" @close="onClose">
      <p-view class="panel"><p-text>底部弹出层内容（bottom）——点遮罩关闭</p-text></p-view>
    </p-page-container>
    <p-page-container v-model:show="showTop" position="top" @close="onClose">
      <p-view class="panel"><p-text>顶部弹出层内容（top，从上滑入）</p-text></p-view>
    </p-page-container>
    <p-page-container v-model:show="showCenter" position="center" @close="onClose">
      <p-view class="panel"><p-text>居中弹出层内容（center）</p-text></p-view>
    </p-page-container>
    <p-page-container v-model:show="showNoOverlay" :overlay="false" @close="onClose">
      <p-view class="panel"><p-text>无遮罩弹出层（overlay=false）</p-text></p-view>
    </p-page-container>
    <p-page-container v-model:show="showSlide" close-on-slide-down @close="onClose">
      <p-view class="panel"><p-text>下滑关闭（下滑 40px 关闭）</p-text></p-view>
    </p-page-container>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="Slots" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
  </page-shell>
</template>

<style scoped>
.row { display: flex; flex-direction: row; gap: var(--sp-3); }
.panel { padding: var(--sp-4); }
.out { display: block; font-size: 12.5px; color: #2f7a4d; }
</style>
