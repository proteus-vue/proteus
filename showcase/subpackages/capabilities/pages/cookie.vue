<!-- showcase/subpackages/capabilities/pages/cookie.vue —— 能力详情页（useCookie，官方形态）
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
const codeDemo = ref("const res = await useCookie()\nif (res.ok) {\n  res.data.set(\"k\", \"v\", 300)   // maxAge 秒\n  res.data.get(\"k\")             // \"v\"\n}")

const out = ref('点击按钮写入一枚 cookie 再读回（Web 走 document.cookie）')
async function onCookie(): Promise<void> {
  const res = await cap.useCookie()
  if (!res.ok) {
    out.value = `⚠ 降级：${res.error.code}`
    return
  }
  const jar = res.data
  jar.set('proteus_demo', 'ok-' + Date.now(), 300)
  const back = jar.get('proteus_demo')
  out.value = `✅ 读回 proteus_demo = ${back ?? '（无）'} · 罐内共 ${Object.keys(jar.list()).length} 项`
}

const apiRows = ref([
  ["useCookie()", "Cookie 罐句柄；返回 Promise<CapResult<CookieJar>>", "CapResult<CookieJar>"],
  ["get(name) / set(name, value, maxAge?)", "读 / 写（maxAge 秒；缺省会话级）", "string | undefined / void"],
  ["remove(name) / list()", "删除 / 列出全部", "void / Record<string, string>"],
  ["error.code", "机器码：cookie.unsupported（桥未提供 getCookieJar）等", "string"],
])
const compatRows = ref([
  ["Web SPA", "document.cookie（值 encodeURIComponent；写入自动带 path=/）", "✅"],
  ["微信小程序", "小程序无 document.cookie → wx storage 兜底（键 __proteus_cookies）", "✅"],
  ["Headless（SSR/测试）", "mock 桥注入", "✅"],
  ["iOS / Android / 鸿蒙 / Flutter", "端原型映射·能力桥未接线（Err 显式降级）", "🟡"],
])
</script>

<template>
  <page-shell title="useCookie Cookie 罐" subtitle="能力原语 · capability.cookie · 双端同源码">
    <demo-block index="01" title="真交互演示" :has-output="true" desc="同一份源码、同一个 Result&lt;T&gt; 契约——按 res.ok 分支，无回调、无 try/catch 义务" :code="codeDemo">
      <template #demo>
        <p-view id="demo-btns" class="btns">
          <p-button size="small" @click="onCookie">写入并读回 cookie</p-button>
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
