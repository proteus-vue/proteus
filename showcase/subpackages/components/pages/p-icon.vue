<!-- showcase/subpackages/components/pages/p-icon.vue —— p-icon 图标演示
     覆盖：官方 type 取值 / 尺寸 / 颜色 / 旋转 / 框架 name 别名。
     ★矢量优先：内置 unicode 字形（自包含零资源）。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PIcon } from '@proteus-vue/components'

const codes = ref({
  types: '<p-icon type="success" /><p-icon type="info" /><p-icon type="warn" /><p-icon type="waiting" />',
  size: '<p-icon name="star" :size="24" color="#ffc300" />',
  spin: '<p-icon name="waiting" :spin="true" />',
})

const apiRows = ref([
  ['name', '图标名（内置字形表；框架名，优先于官方 type）', 'string'],
  ['type', '★官方 <icon> type（success/info/warn/waiting/cancel/download/clear…）——name 的官方别名', 'string'],
  ['size', '尺寸 px（★官方 size）', 'number'],
  ['color', '颜色（★官方 color）', 'string'],
  ['spin', '旋转动画（框架扩展）', 'boolean'],
])
const eventRows = ref([['—', 'p-icon 无对外事件', '—']])
const slotRows = ref([['—', 'p-icon 无插槽（字形由属性驱动）', '—']])
</script>

<template>
  <page-shell title="p-icon 图标" subtitle="内容基元 · 内置矢量字形，零资源">
    <demo-block index="01" title="官方 type 取值" desc="对齐官方 <icon> 的 type 语义（success/info/warn/waiting…）" :code="codes.types">
      <template #demo>
        <view class="row">
          <p-icon type="success" />
          <p-icon type="success_no_circle" />
          <p-icon type="info" />
          <p-icon type="warn" />
          <p-icon type="waiting" />
          <p-icon type="cancel" />
          <p-icon type="download" />
          <p-icon type="clear" />
        </view>
      </template>
    </demo-block>

    <demo-block index="02" title="尺寸与颜色" desc="size 控制字号与盒尺寸；color 同 CSS color" :code="codes.size">
      <template #demo>
        <view class="row">
          <p-icon name="star" :size="16" color="#ffc300" />
          <p-icon name="star" :size="24" color="#ffc300" />
          <p-icon name="heart" :size="24" color="#ef4d4d" />
          <p-icon name="search" :size="24" color="#1a7af8" />
        </view>
      </template>
    </demo-block>

    <demo-block index="03" title="旋转与常用名" desc="spin 旋转（加载态）；name 走框架字形表" :code="codes.spin">
      <template #demo>
        <view class="row">
          <p-icon name="back" :size="20" />
          <p-icon name="more" :size="20" />
          <p-icon name="home" :size="20" />
          <p-icon name="user" :size="20" />
          <p-icon name="waiting" :size="20" :spin="true" />
        </view>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="Slots" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
  </page-shell>
</template>

<style scoped>
.row { display: flex; flex-direction: row; align-items: center; gap: var(--sp-4); flex-wrap: wrap; }
</style>
