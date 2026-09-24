<!-- showcase/subpackages/capabilities/pages/keyboard.vue —— 能力详情页（useKeyboard，官方形态）
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
const codeDemo = ref("const kb = useKeyboard()\nkb.onChange((info) => { /* info.height / info.visible */ })")

const out = ref('订阅已就绪——点下方输入框唤起软键盘（移动端/开发者工具设备模拟）可观察高度')
let unsubK: (() => void) | null = null
const kbInfo = ref('（未订阅）')
function onSubscribeKb(): void {
  const kb = cap.useKeyboard()
  unsubK = kb.onChange((info) => {
    kbInfo.value = `高度 ${info.height}px · 可见：${info.visible}`
  })
  kbInfo.value = `当前快照：高度 ${kb.info.height}px · 可见：${kb.info.visible}`
  out.value = '✅ 已订阅键盘变化（info 会实时更新）'
}
function onUnsubscribeKb(): void {
  if (!unsubK) { out.value = '（尚未订阅）'; return }
  unsubK(); unsubK = null
  out.value = '✅ 已取消订阅'
}

const apiRows = ref([
  ["useKeyboard()", "键盘生命周期句柄（★同步返回）", "KeyboardLifecycle"],
  ["info", "当前键盘状态快照 { height, visible }", "KeyboardInfo"],
  ["onChange(cb)", "订阅键盘高度变化（返回取消函数）", "() => void"],
])
const compatRows = ref([
  ["Web SPA", "visualViewport（软键盘挤压视口时高度变化；桌面端键盘不挤压 → 恒 0 可见）", "✅"],
  ["微信小程序", "wx.onKeyboardHeightChange", "✅"],
  ["Headless（SSR/测试）", "mock 桥注入", "✅"],
  ["iOS / Android / 鸿蒙 / Flutter", "端原型映射·能力桥未接线（Err 显式降级）", "🟡"],
])
</script>

<template>
  <page-shell title="useKeyboard 键盘高度" subtitle="能力原语 · capability.keyboard · 双端同源码">
    <demo-block index="01" title="真交互演示" :has-output="true" desc="同一份源码、同一个 Result&lt;T&gt; 契约——按 res.ok 分支，无回调、无 try/catch 义务" :code="codeDemo">
      <template #demo>
        <p-view id="demo-btns" class="btns">
          <p-button size="small" @click="onSubscribeKb">订阅键盘变化</p-button>
          <p-button size="small" @click="onUnsubscribeKb">取消订阅</p-button>
        </p-view>
      </template>
      <template #output>
        <p-text class="out">{{ out }}</p-text>
        <p-text class="out out-extra">键盘快照：{{ kbInfo }}</p-text>      </template>
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
