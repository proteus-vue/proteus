<!-- showcase/subpackages/capabilities/pages/page-lifecycle.vue —— 能力详情页（usePageLifecycle，官方形态）
     ★由 scripts/gen-capability-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     范式同 camera.vue：能力说明 + 真交互演示 + API 表 + 双端兼容进度。
     ★真交互：按钮真调用能力 Hook，输出区回显 Result<T>（成功/失败 + 错误码）。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PText, PView, PButton } from '@proteus-vue/components'
import { createCapabilityHooks } from '@proteus-vue/api'

// ★每页独立实例（demo 页惯例——不共享全局单例，页面间互不影响）
const cap = createCapabilityHooks()

// ★代码片段放 data（含 < > "。直写 :code 字面量会破坏 WXML 解析）
const codeDemo = ref("const pl = usePageLifecycle()\npl.onLoad(() => {}); pl.onShow(() => {})\n/* pl.phase: IDLE | LOAD | SHOW | HIDE */")

const out = ref('订阅已就绪——切换标签页可看到 onShow/onHide 回调记录')
let unsubP: (() => void) | null = null
const pPhases = ref<string[]>([])
function onPSubscribe(): void {
  const pl = cap.usePageLifecycle()
  pPhases.value = [pl.phase]
  const offShow = pl.onShow(() => { pPhases.value.push('SHOW') })
  const offHide = pl.onHide(() => { pPhases.value.push('HIDE') })
  unsubP = () => { offShow(); offHide() }
  out.value = `✅ 已订阅（当前 phase=${pl.phase}）`
}
function onPUnsubscribe(): void {
  if (!unsubP) { out.value = '（尚未订阅）'; return }
  unsubP(); unsubP = null
  out.value = '✅ 已取消订阅'
}

const apiRows = ref([
  ["usePageLifecycle()", "页面生命周期句柄（★同步返回）", "PageLifecycle"],
  ["phase", "当前阶段：'IDLE' | 'LOAD' | 'SHOW' | 'HIDE'", "string"],
  ["onLoad(cb) / onShow(cb) / onHide(cb)", "订阅页面加载 / 显示 / 隐藏（返回取消函数）", "() => void"],
])
const compatRows = ref([
  ["Web SPA", "document visibilitychange（同 app-lifecycle 通道；★可切标签页触发）", "✅"],
  ["微信小程序", "wx.onPageShow / onPageHide / Page.onLoad", "✅"],
  ["Headless（SSR/测试）", "mock 桥注入", "✅"],
  ["iOS / Android / 鸿蒙 / Flutter", "端原型映射·能力桥未接线（Err 显式降级）", "🟡"],
])
</script>

<template>
  <page-shell title="usePageLifecycle 页面生命周期" subtitle="能力原语 · capability.page-lifecycle · 双端同源码">
    <demo-block index="01" title="真交互演示" :has-output="true" desc="同一份源码、同一个 Result&lt;T&gt; 契约——按 res.ok 分支，无回调、无 try/catch 义务" :code="codeDemo">
      <template #demo>
        <p-view id="demo-btns" class="btns">
          <p-button size="small" @click="onPSubscribe">订阅页面生命周期</p-button>
          <p-button size="small" @click="onPUnsubscribe">取消订阅</p-button>
        </p-view>
      </template>
      <template #output>
        <p-text class="out">{{ out }}</p-text>
        <p-text class="out out-extra">已记录的阶段：{{ pPhases.join(" → ") || "（暂无）" }}</p-text>      </template>
    </demo-block>

    <api-table title="API" :columns="['签名 / 字段', '说明', '类型']" :rows="apiRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<style scoped>
.btns {
  display: flex;
  gap: var(--sp-2);
  flex-wrap: wrap;
}
.out {
  display: block;
  background: #f2fbf5;
  border: 1px solid #d6f0e0;
  border-radius: var(--sp-radius-sm);
  padding: var(--sp-2) var(--sp-3);
  font-size: 12.5px;
  color: #2f7a4d;
  font-weight: 600;
  word-break: break-all;
}
.out-extra {
  margin-top: var(--sp-2);
  background: #f7f8fa;
  border-color: #e5e6eb;
  color: #4b5563;
  font-weight: 500;
}
</style>
