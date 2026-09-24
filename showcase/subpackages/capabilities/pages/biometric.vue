<!-- showcase/subpackages/capabilities/pages/biometric.vue —— 能力详情页（useBiometric，官方形态）
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
const codeDemo = ref("const ok = await useBiometric()          // 平台是否支持\nconst auth = await authenticateBiometric({ reason: \"验证身份\" })")

const out = ref('① 探测平台是否支持；② 发起认证（★需真实认证器——无认证器的环境会走失败路径，这是正确行为）')
async function onCheck(): Promise<void> {
  const r = await cap.useBiometric()
  out.value = r.ok ? `✅ 平台支持生物识别：${r.data}（WebAuthn ${r.data ? '可用' : '不可用'}）` : `⚠ 降级：${r.error.code}`
}
async function onAuth(): Promise<void> {
  // ★修正（类型检查暴露）：契约字段名是 prompt，非 reason
  const r = await cap.authenticateBiometric({ prompt: '验证身份以继续（WebAuthn 平台认证器）' })
  // ★诚实说明：WebAuthn 认证需**真实认证器**（指纹/面容/PIN）。无认证器的环境（如 CI/无头浏览器、
  //   未注册凭据的桌面浏览器）必然返回 biometric.failed —— 这是正确行为，不是缺陷。
  out.value = r.ok
    ? `✅ 认证通过：${r.data}`
    : `⚠ 降级：${r.error.code}（无认证器/用户取消时即为此结果——需在支持 WebAuthn 的真实设备上重试）`
}

const apiRows = ref([
  ["useBiometric()", "平台是否支持（WebAuthn 可用性入口）；返回 Promise<CapResult<boolean>>", "CapResult<boolean>"],
  ["authenticateBiometric(options)", "发起认证（WebAuthn 平台认证器 / wx.startSoterAuthentication）", "Promise<CapResult<boolean>>"],
  ["error.code", "机器码：biometric.unsupported（无 WebAuthn / 需 HTTPS）等", "string"],
])
const compatRows = ref([
  ["Web SPA", "WebAuthn（★需 HTTPS/安全上下文——真机认证器由系统弹出）", "✅"],
  ["微信小程序", "wx.checkIsSupportFingerPrint / startSoterAuthentication", "✅"],
  ["Headless（SSR/测试）", "mock 桥注入", "✅"],
  ["iOS / Android / 鸿蒙 / Flutter", "端原型映射·能力桥未接线（Err 显式降级）", "🟡"],
])
</script>

<template>
  <page-shell title="useBiometric 生物识别" subtitle="能力原语 · capability.biometric · 双端同源码">
    <demo-block index="01" title="真交互演示" :has-output="true" desc="同一份源码、同一个 Result&lt;T&gt; 契约——按 res.ok 分支，无回调、无 try/catch 义务" :code="codeDemo">
      <template #demo>
        <p-view id="demo-btns" class="btns">
          <p-button size="small" @click="onCheck">探测支持</p-button>
          <p-button size="small" @click="onAuth">发起认证</p-button>
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
