<!-- showcase/subpackages/capabilities/pages/fetch.vue —— 能力详情页（useFetch，官方形态）
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
const codeDemo = ref("const res = await useFetch<{ name: string }>(\"/assets/demo-fetch.json\")\nif (res.ok) { /* res.data / res.status */ }\nelse { /* res.error.code */ }")

const out = ref('点击按钮发起同源请求（演示站自带 /assets/demo-fetch.json）')
async function onFetch(): Promise<void> {
  const res = await cap.useFetch<{ name: string; capability: string }>('/assets/demo-fetch.json', {
    params: { t: Date.now() },
  })
  out.value = res.ok
    ? `✅ 收到 JSON：name=${res.data.name} · capability=${res.data.capability}`
    : `⚠ 降级：${res.error.code}`
}

const apiRows = ref([
  ["useFetch<T>(url, config?)", "网络请求；返回 Promise<FetchResult<T>>", "FetchResult<T>"],
  ["config.method / data", "HTTP 方法（缺省 GET）/ 请求体（对象自动 JSON 序列化）", "'GET' | 'POST' | … / unknown"],
  ["config.params / headers", "查询参数（自动拼接）/ 自定义请求头", "Record<string, unknown> / Record<string, string>"],
  ["config.timeout", "★已接线：Web 用 AbortController、MP 传 wx.request；超时 ⇒ fetch.timeout", "number?"],
  ["config.responseType", "★响应体解释方式；arraybuffer 时 data 是裸字节（不走文本解码）", "'text' | 'json' | 'arraybuffer'"],
  ["res.data", "响应载荷：JSON 自动解析，非 JSON 原样文本", "T"],
  ["res.status / res.headers", "★HTTP 状态码 / 响应头（此前被丢弃 ⇒ 无法区分 404/500）", "number / Record<string, string>"],
  ["res.error.code", "fetch.aborted / fetch.timeout / fetch.failed / fetch.unsupported", "string"],
  ["config.signal", "取消：abort() 后立即以 fetch.aborted 结束（App 用 createAbortController）", "{ readonly aborted: boolean }?"],
  ["config.onChunk", "流式消费：每块回调一次，内存不随响应体增长（App 回推 / Web ReadableStream；MP 不支持）", "(chunk, seq) => void?"],
  ["config.savePath / upload", "★仅 App：宿主直写沙箱 / 宿主自读文件上传（Web、MP 明确 unsupported）", "string? / UploadSpec?"],
  ["config.retry / priority", "★#1133 请求治理：失败重试（指数退避，只重试可恢复失败）/ 并发队列优先级（越大越先发）", "number | RetryPolicy / number?"],
  ["config.redirect / maxRedirects / onRedirect / redirectManual", "★#1134 重定向：follow/manual/error + 上限（默认 5）+ 逐跳回调（可 stop）；★跨域自动剥离 Authorization/Cookie；redirectManual 是内部字段（自动置位）", "'follow' | 'manual' | 'error' / number? / (hop) => decision? / boolean?"],
  ["config.deadline", "★#1135 **总时限**（从入队起算，跨排队/重试/多跳）：耗尽 ⇒ fetch.deadline；与单轮 timeout 取更紧者", "number?"],
  ["config.cache / bypassPlatformCache", "★★#1149 **HTTP 缓存**（对齐浏览器 Request.cache）：default / no-store / reload / no-cache / force-cache / only-if-cached；过期后自动带 If-None-Match / If-Modified-Since 回源，304 ⇒ 复用缓存体。★App 三端字节腿不会自动做 304 ⇒ 由框架层收口；落空（only-if-cached）⇒ fetch.cacheMiss。bypassPlatformCache 是内部字段（管线自动置位，让浏览器自带缓存让开）", "'default' | 'no-store' | 'reload' | 'no-cache' | 'force-cache' | 'only-if-cached'? / boolean?"],
  ["res.meta.cache", "★★#1149 缓存结局：hit（**没发网络**）/ revalidated（304 复用）/ miss（回源）/ bypass（非 GET、流式等）；★#1150 新增 **stale**（返回了过期值：`staleReason` = swr | stale-if-error | force-cache，`revalidating` 表示已起后台校验）", "{ status, ageMs?, stored?, mode?, staleReason?, revalidating? }?"],
  ["Cache-Control: stale-while-revalidate", "★★#1150 **立即回旧值 + 后台校验**（RFC 5861）：变 stale 后 N 秒内直接返回旧值，同时后台发条件请求刷新缓存 ⇒ 接口慢也不卡首屏。★`must-revalidate` 优先（一旦 stale 就 MUST NOT 复用，RFC 9111 §5.2.2.2）；无 `setTimeout` 的引擎上后台校验同样能跑（靠宿主回推）", "响应头指令（秒）"],
  ["Cache-Control: stale-if-error", "★★#1150 **源站故障时用旧值兜底**（RFC 5861）：回源遇网络失败 / 500·502·503·504 ⇒ 返回缓存旧值（`meta.cache.status=stale`）。★**不兜底**用户取消（fetch.aborted）与 4xx（那不是\"源站错误\"，RFC 原文只列 500/502/503/504）", "响应头指令（秒）"],
  ["res.headers.age", "★#1150 由缓存生成的响应必带 `Age`（RFC 9111 §5.1 MUST）——业务据此知道\"这份数据多旧\"（SWR 场景尤其关键）", "string（秒）"],
  ["config.cache.persist", "★★★#1151 **L2 持久层**：`true` ⇒ 缓存跨**进程重启**仍可用（Web/MP 走 KV、App 走文件；App 没有 getStorage）。★不开则只在内存，冷启动后一条都用不上。可配 `{ dir, maxPersistEntries, flushDelayMs }`；介质不可用时自动退回内存（不报错）", "boolean | { dir?, maxPersistEntries?, flushDelayMs? }?"],
])
const compatRows = ref([
  ["Web SPA", "fetch + AbortController（timeout/取消）+ ReadableStream（流式）；★缓存由框架层接管（浏览器自带缓存让开）", "✅"],
  ["微信小程序", "wx.request（timeout + responseType）；流式/落盘/上传/取消明确 unsupported；缓存走框架层（wx.request 不做 HTTP 缓存）", "✅"],
  ["Headless（SSR/测试）", "mock 桥注入", "✅"],
  ["iOS / Android", "宿主原生 HTTP；流式/落盘/上传/取消 + 32 MiB 上限（S3）", "✅"],
  ["鸿蒙", "RCP 同步往返 + 32 MiB 上限（S2）；流式/取消 unsupported", "🟡"],
])
</script>

<template>
  <page-shell title="useFetch 网络请求" subtitle="能力原语 · capability.fetch · 双端同源码">
    <demo-block index="01" title="真交互演示" :has-output="true" desc="同一份源码、同一个 Result&lt;T&gt; 契约——按 res.ok 分支，无回调、无 try/catch 义务" :code="codeDemo">
      <template #demo>
        <p-view id="demo-btns" class="btns">
          <p-button size="small" @click="onFetch">发起请求</p-button>
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
