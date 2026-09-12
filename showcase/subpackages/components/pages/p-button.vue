<!-- showcase/pages/component-button.vue —— p-button 组件演示（官方形态样板）
     结构：组件说明 + 多用法演示块（真交互）+ API 表。
     全部演示均为实机渲染，输出区回显真实事件/状态。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PButton, PText, PView } from '@proteus-vue/components'

// ★代码片段放 data（不经 WXML 属性字面量——含 < > "。直接写 :code="'<p-button>" 会破坏 WXML 解析）
const codes = ref({
  basic: '<p-button @click="onBasicClick">点击我</p-button>',
  disabled: '<p-button :disabled="true">禁用按钮</p-button>',
  loading: '<p-button :loading="loading" @click="submit">提交</p-button>',
  throttle: '<p-button :throttle="800" @click="onClick">连点试试</p-button>',
  attrs: '<p-button size="mini">mini</p-button><p-button type="primary">primary</p-button><p-button type="warn">warn</p-button><p-button :plain="true">镂空</p-button>',
})

// 演示状态
const count = ref(0)
const loading = ref(false)
const lastEvent = ref('（暂无）')
const throttleCount = ref(0)

// 演示 1：基础点击
function onBasicClick() {
  count.value++
  lastEvent.value = `click @ ${Date.now() % 100000}`
}
// 演示 2：加载态（点击后 1.2s 恢复）
function onLoadingClick() {
  loading.value = true
  lastEvent.value = 'loading 开始'
  setTimeout(() => {
    loading.value = false
    lastEvent.value = 'loading 结束'
  }, 1200)
}
// 演示 4：节流（throttle=800ms 内重复点击被忽略）
function onThrottledClick() {
  throttleCount.value++
}

const apiRows = ref([
  ['size', '按钮大小：default / mini（★官方对齐）', 'string'],
  ['type', '样式类型：default / primary / warn（★官方对齐）', 'string'],
  ['plain', '镂空（背景透明）（★官方对齐）', 'boolean'],
  ['form-type', 'form 内行为：submit / reset（★官方对齐）', 'string'],
  ['open-type', '微信开放能力：contact/share/getPhoneNumber/…（★官方对齐）', 'string'],
  ['hover-class', '按下样式类（none = 无点击态）（★官方对齐）', 'string'],
  ['hover-start-time', '按住多久出现点击态 ms（★官方对齐）', 'number'],
  ['hover-stay-time', '松开后点击态保留 ms（★官方对齐）', 'number'],
  ['disabled', '禁用态（禁交互 + 弱化视觉，MP 原生 disabled 透传）', 'boolean'],
  ['loading', '加载中状态（透传 MP 原生 loading，自动禁点击）', 'boolean'],
  ['throttle', '点击节流间隔 ms，防重复触发（runtime 内置）', 'number'],
  ['ariaLabel', '无障碍标签（读屏器朗读文本）', 'string'],
  ['pid', '组件实例标识（调试/观测/测试定位）', 'string'],
])
const eventRows = ref([['click', '点击事件（throttle 未拦截时触发）', '(e, {bubbles, composed})']])
const slotRows = ref([['default', '按钮文本内容', '—']])
</script>

<template>
  <page-shell title="p-button 按钮" subtitle="触发操作的按钮 · 双端同源码">
    <demo-block index="01" title="基础用法" :has-output="true" desc="默认按钮，点击触发 click 事件" :code="codes.basic">
      <template #demo>
        <p-button @click="onBasicClick">点击我</p-button>
      </template>
      <template #output>
        <p-text class="out">结果：点击次数 {{ count }}</p-text>
      </template>
    </demo-block>

    <demo-block index="02" title="禁用态" desc="disabled 禁用交互；MP 端透传原生 disabled" :code="codes.disabled">
      <template #demo>
        <view class="row">
          <p-button>可用按钮</p-button>
          <p-button :disabled="true">禁用按钮</p-button>
        </view>
      </template>
    </demo-block>

    <demo-block index="03" title="加载态" :has-output="true" desc="loading 期间自动禁用点击（透传 MP 原生 loading）" :code="codes.loading">
      <template #demo>
        <p-button :loading="loading" @click="onLoadingClick">提交</p-button>
      </template>
      <template #output>
        <p-text class="out">结果：状态 {{ loading ? '加载中…' : '就绪' }}</p-text>
      </template>
    </demo-block>

    <demo-block index="04" title="点击节流" :has-output="true" desc="throttle=800ms：间隔内的重复点击被忽略（防连点重复提交）" :code="codes.throttle">
      <template #demo>
        <p-button :throttle="800" @click="onThrottledClick">连点试试</p-button>
      </template>
      <template #output>
        <p-text class="out">结果：生效 {{ throttleCount }} 次 · 快速连点计数明显少于点击次数即节流生效</p-text>
      </template>
    </demo-block>

    <demo-block index="05" title="事件回显" :has-output="true" desc="click 事件的实时回显（弹起气泡 + 组合事件语义）">
      <template #demo>
        <p-button @click="onBasicClick">触发事件</p-button>
      </template>
      <template #output>
        <p-text class="out">结果：最后事件 {{ lastEvent }}</p-text>
      </template>
    </demo-block>

    <demo-block index="06" title="官方属性对齐" desc="size / type / plain —— 对齐小程序原生 button 视觉变体" :code="codes.attrs">
      <template #demo>
        <view class="row">
          <p-button size="mini">mini</p-button>
          <p-button type="primary">primary</p-button>
          <p-button type="warn">warn</p-button>
          <p-button :plain="true">镂空</p-button>
        </view>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="Slots" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
  </page-shell>
</template>

<style scoped>
.row { display: flex; flex-direction: row; gap: var(--sp-3); flex-wrap: wrap; }
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
