<!-- showcase/subpackages/components/pages/p-text.vue —— p-text 文本演示
     覆盖：基础 / 可选(user-select) / 省略号(overflow=ellipsis) / 多行钳制(max-lines) /
           连续空格(space) / 手势选择(select-on-gesture)。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PText } from '@proteus-vue/components'

const codes = ref({
  base: '<p-text>普通文本</p-text>',
  select: '<p-text user-select>这段文本可以选中复制</p-text>',
  ellipsis: '<p-text overflow="ellipsis" style="width:200px">很长的文本会被裁剪为省略号…</p-text>',
  clamp: '<p-text :max-lines="2" style="width:240px">多行文本最多显示两行，超出部分被裁剪…</p-text>',
  space: '<p-text space="emsp">用 emsp 显示连续空格</p-text>',
  gesture: '<p-text select-on-gesture>允许通过手势选择文本</p-text>',
})

const long = ref('这是一段足够长的示例文本，用于演示 overflow=ellipsis 与 max-lines 两种溢出处理方式的差异，请观察行尾表现。')

const apiRows = ref([
  ['pid', '元素标识（框架扩展，用于调试/定位）', 'string'],
  ['disabled', '禁用态（框架扩展）', 'boolean'],
  ['ariaLabel', '无障碍标签', 'string'],
  ['selectable', '文本是否可选（官方已废弃 → 兼容保留；新代码用 user-select）', 'boolean'],
  ['userSelect', '文本是否可选（★官方 user-select；Web 用 CSS user-select）', 'boolean'],
  ['overflow', '文本溢出处理：ellipsis 省略号 / clip 裁剪（★官方 overflow）', 'string'],
  ['maxLines', '限制文本最大行数（★官方 max-lines；Web 用 -webkit-line-clamp）', 'number'],
  ['selectOnGesture', '是否允许通过手势选择文本（★官方 select-on-gesture）', 'boolean'],
  ['space', '显示连续空格：ensp / emsp / nbsp（★官方 space）', 'string'],
  ['decode', '是否解码实体字符（★官方 decode）', 'boolean'],
  ['ariaLabel', '无障碍标签', 'string'],
])
const eventRows = ref([['—', 'p-text 无对外事件', '—']])
const slotRows = ref([['default', '文本内容', '—']])
</script>

<template>
  <page-shell title="p-text 文本" subtitle="内容基元 · 可选 / 溢出 / 空格处理">
    <demo-block index="01" title="可选文本（user-select）" desc="user-select 使文本可被选中复制（官方 user-select）" :code="codes.select">
      <template #demo>
        <p-text class="para" user-select>这段文本可以被选中并复制（user-select）。</p-text>
      </template>
    </demo-block>

    <demo-block index="02" title="溢出处理" desc="overflow=ellipsis 单行省略号；max-lines 多行钳制" :code="codes.ellipsis">
      <template #demo>
        <view class="col">
          <p-text class="clip1" overflow="ellipsis">{{ long }}</p-text>
          <p-text class="clip2" :max-lines="2">{{ long }}</p-text>
        </view>
      </template>
    </demo-block>

    <demo-block index="03" title="连续空格与手势选择" desc="space=emsp/ensp/nbsp 显示连续空格；select-on-gesture 手势选择" :code="codes.space">
      <template #demo>
        <view class="col">
          <p-text space="emsp">A   B（emsp 连续空格）</p-text>
          <p-text select-on-gesture>允许通过手势选择文本（select-on-gesture）</p-text>
        </view>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="Slots" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
  </page-shell>
</template>

<style scoped>
.col { display: flex; flex-direction: column; gap: var(--sp-3); }
.para { display: block; line-height: 1.6; }
.clip1 { display: block; width: 200px; }
.clip2 { display: block; width: 240px; line-height: 1.6; }
</style>
