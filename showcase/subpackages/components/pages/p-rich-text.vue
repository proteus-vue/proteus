<!-- showcase/subpackages/components/pages/p-rich-text.vue —— p-rich-text 富文本演示
     覆盖：HTML 字符串渲染 / 节点数组 / space 连续空格 / user-select 可选 / mode 布局兼容。
     ★双端：MP 原生 <rich-text>（nodes）；Web <view v-html>（浏览器解析）。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PRichText, PText } from '@proteus-vue/components'

// ★字面量必须直接内联进 ref()（编译器静态求值：标识符初值 → data 为 undefined，见 S33/S57）
const html = ref('<p style="margin:0 0 8px">这是<strong>富文本</strong>：支持 <em>斜体</em>、<span style="color:#7c5cff">着色</span>。</p><ul style="margin:0;padding-left:20px"><li>列表项 A</li><li>列表项 B</li></ul>')
// ★类型（2026-09-24 类型检查暴露）：nodes 的 type/children[].type 需为**字面量**联合
//   （p-rich-text 契约是 'text' | 'node'），as const 收窄，否则被推断为 string 而类型不符
const nodes = ref<Array<Record<string, unknown>>>([
  { type: 'node', name: 'h3', attrs: { style: 'margin:0 0 6px;font-size:15px' }, children: [{ type: 'text', text: '节点数组形态' }] },
  { type: 'node', name: 'p', attrs: { style: 'margin:0;color:#666' }, children: [{ type: 'text', text: 'structured nodes（官方 nodes 数组）' }] },
])
const spaces = ref('连续空格（默认压缩）:  1  2  3\n启用 space=nbsp:  1  2  3')

const codes = ref({
  html: '<p-rich-text nodes="<p>HTML 字符串</p>" />',
  nodes: '<p-rich-text :nodes="nodes" />',
  space: '<p-rich-text :nodes="text" space="nbsp" user-select />',
})

const apiRows = ref([
  ['nodes', '节点列表 / HTML 字符串（★官方 nodes）', 'string | array'],
  ['source', 'HTML 源（框架可读别名，等价 nodes 字符串形态）', 'string'],
  ['space', '连续空格显示：ensp / emsp / nbsp（★官方 space）', 'string'],
  ['userSelect', '文本是否可选（★官方 user-select；使节点显示为 block）', 'boolean'],
  ['mode', '布局兼容模式：default / compat（★官方 mode）', 'string'],
])
const eventRows = ref([['—', 'p-rich-text 无对外事件', '—']])
const slotRows = ref([['—', 'p-rich-text 无插槽', '—']])
</script>

<template>
  <page-shell title="p-rich-text 富文本" subtitle="内容基元 · HTML / 节点数组渲染">
    <demo-block index="01" title="HTML 字符串" desc="nodes 传入 HTML 字符串（MP 原生 rich-text / Web v-html）" :code="codes.html">
      <template #demo>
        <view class="box"><p-rich-text :nodes="html" /></view>
      </template>
    </demo-block>

    <demo-block index="02" title="节点数组" desc="structured nodes（type/name/attrs/children）——跨端同数据结构" :code="codes.nodes">
      <template #demo>
        <view class="box"><p-rich-text :nodes="nodes" /></view>
      </template>
    </demo-block>

    <demo-block index="03" title="空格与可选" :has-output="true"
      desc="space 控制连续空格呈现；user-select 使文本可选中" :code="codes.space">
      <template #demo>
        <view class="box">
          <p-rich-text :nodes="spaces" space="nbsp" user-select />
        </view>
      </template>
      <template #output><p-text class="out">space=nbsp 下连续空格保留；user-select 后可拖选文本</p-text></template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="Slots" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
  </page-shell>
</template>

<style scoped>
.box { padding: var(--sp-3); border: 1px solid var(--p-border, #e5e5e5); border-radius: var(--sp-radius-sm); background: #fff; }
.out { display: block; font-size: 12.5px; color: #2f7a4d; }
</style>
