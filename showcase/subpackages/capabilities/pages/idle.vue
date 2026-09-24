<!-- showcase/subpackages/capabilities/pages/idle.vue —— 能力详情页（useIdle，官方形态）
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
const codeDemo = ref("const h = useIdle()\nif (h.ok) {\n  await h.data.request((deadline) => {\n    /* deadline.timeRemaining() / didTimeout */\n  }, 500)\n}")

const out = ref('点击按钮提交一个空闲任务（宿主空闲时执行，超时 500ms 兜底）')
function onIdle(): void {
  const h = cap.useIdle()
  if (!h.ok) {
    out.value = `⚠ 降级：${h.error.code}`
    return
  }
  out.value = '⏳ 已提交空闲任务，等待宿主空闲…'
  void h.data.request((d) => {
    out.value = `✅ 空闲回调执行：剩余 ${d.timeRemaining().toFixed(1)}ms · 超时触发：${d.didTimeout}`
  }, 500)
}

const apiRows = ref([
  ["useIdle()", "空闲调度句柄（★同步返回 CapResult）", "CapResult<IdleAPI>"],
  ["request(cb, timeout?)", "空闲时执行；timeout 到时即执行（ms）", "Promise<CapResult<number>>"],
  ["cancel(id)", "取消待执行的空闲回调", "Promise<CapResult<void>>"],
  ["deadline.timeRemaining()", "本次空闲剩余时间（ms）", "number"],
  ["deadline.didTimeout", "是否因超时触发（非真空闲）", "boolean"],
])
const compatRows = ref([
  ["Web SPA", "requestIdleCallback（Safari 缺省 → setTimeout 兜底：timeRemaining 恒 0）", "✅"],
  ["微信小程序", "wx.requestIdleCallback", "✅"],
  ["Headless（SSR/测试）", "mock 桥注入", "✅"],
  ["iOS / Android / 鸿蒙 / Flutter", "端原型映射·能力桥未接线（Err 显式降级）", "🟡"],
])
</script>

<template>
  <page-shell title="useIdle 空闲调度" subtitle="能力原语 · capability.idle · 双端同源码">
    <demo-block index="01" title="真交互演示" :has-output="true" desc="同一份源码、同一个 Result&lt;T&gt; 契约——按 res.ok 分支，无回调、无 try/catch 义务" :code="codeDemo">
      <template #demo>
        <p-view id="demo-btns" class="btns">
          <p-button size="small" @click="onIdle">提交空闲任务</p-button>
        </p-view>
      </template>
      <template #output>
        <p-text class="out">{{ out }}</p-text>
      </template>
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
