<!-- showcase/subpackages/capabilities/pages/app-lifecycle.vue —— 能力详情页（useAppLifecycle，官方形态）
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
const codeDemo = ref("const lc = useAppLifecycle()\nlc.onShow(() => {}); lc.onHide(() => {})\n/* lc.phase: PENDING | LAUNCH | SHOW | HIDE */")

// ★订阅型能力：订阅本身不产生即时输出（要切标签页才会回调）——看下方「已记录的阶段」
const out = ref('订阅已就绪——切换浏览器标签页/最小化窗口可观察 phase 变化')
let unsub: (() => void) | null = null
const phases = ref<string[]>([])
function onSubscribe(): void {
  const lc = cap.useAppLifecycle()
  phases.value = [lc.phase]
  const offShow = lc.onShow(() => { phases.value.push('SHOW') })
  const offHide = lc.onHide(() => { phases.value.push('HIDE') })
  unsub = () => { offShow(); offHide() }
  out.value = `✅ 已订阅（当前 phase=${lc.phase}）——切换标签页观察`
}
function onUnsubscribe(): void {
  if (!unsub) { out.value = '（尚未订阅）'; return }
  unsub(); unsub = null
  out.value = '✅ 已取消订阅（释放监听）'
}

const apiRows = ref([
  ["useAppLifecycle()", "应用生命周期句柄（★同步返回，非 CapResult）", "AppLifecycle"],
  ["phase", "当前阶段：'PENDING' | 'LAUNCH' | 'SHOW' | 'HIDE'", "string"],
  ["onLaunch(cb) / onShow(cb) / onHide(cb)", "订阅启动 / 进前台 / 退后台（返回取消函数）", "() => void"],
])
const compatRows = ref([
  ["Web SPA", "Page Visibility API（visibilitychange；★真可触发——切标签页）", "✅"],
  ["微信小程序", "wx.onAppShow / onAppHide / onLaunch", "✅"],
  ["Headless（SSR/测试）", "mock 桥注入", "✅"],
  ["iOS / Android / 鸿蒙 / Flutter", "端原型映射·能力桥未接线（Err 显式降级）", "🟡"],
])
</script>

<template>
  <page-shell title="useAppLifecycle 应用生命周期" subtitle="能力原语 · capability.app-lifecycle · 双端同源码">
    <demo-block index="01" title="真交互演示" :has-output="true" desc="同一份源码、同一个 Result&lt;T&gt; 契约——按 res.ok 分支，无回调、无 try/catch 义务" :code="codeDemo">
      <template #demo>
        <p-view id="demo-btns" class="btns">
          <p-button size="small" @click="onSubscribe">订阅生命周期</p-button>
          <p-button size="small" @click="onUnsubscribe">取消订阅</p-button>
        </p-view>
      </template>
      <template #output>
        <p-text class="out">{{ out }}</p-text>
        <p-text class="out out-extra">已记录的阶段：{{ phases.join(" → ") || "（暂无）" }}</p-text>      </template>
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
