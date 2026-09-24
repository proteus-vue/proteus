<!-- showcase/subpackages/capabilities/pages/storage.vue —— 能力详情页（useStorage，官方形态）
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
const codeDemo = ref("const st = useStorage()\nst.set(\"k\", { msg: \"hi\" })        // 同步语义\nconst back = st.get(\"k\")\nconst info = await st.info()      // 异步 / 批量 API 同样齐备")

const out = ref('点击按钮做一次「写入 → 读回」往返（Web 落 localStorage，小程序落 wx storage）')
function onRoundtrip(): void {
  try {
    const st = cap.useStorage()
    st.set('demo:greet', { msg: 'hello', at: Date.now() })
    const back = st.get<{ msg: string }>('demo:greet')
    out.value = back ? `✅ 往返成功：${JSON.stringify(back)}` : '⚠ 写入后读不到（存储不可用？）'
  } catch (e) {
    out.value = `⚠ 降级：${e instanceof Error ? e.message : String(e)}`
  }
}
async function onInfo(): Promise<void> {
  const res = await cap.useStorage().info()
  out.value = res.ok
    ? `✅ 已存 ${res.data.keys.length} 键 · 上限 ${(res.data.limitSize / 1024 / 1024).toFixed(0)}MB`
    : `⚠ 降级：${res.error.code}`
}

const apiRows = ref([
  ["useStorage()", "存储句柄（★同步语义，非 CapResult——未命中返回 undefined）", "CompatStorage"],
  ["get(key) / set(key, value)", "同步读 / 写（值自动 JSON 序列化）", "T | undefined / void"],
  ["remove(key) / clear()", "同步删除 / 清空", "void"],
  ["getAsync / setAsync", "异步读写（对齐官方 setStorage/getStorage；大值不阻塞主线程）", "Promise<CapResult<…>>"],
  ["info()", "用量信息 keys / currentSize / limitSize", "Promise<CapResult<…>>"],
  ["batchGet(keys) / batchSet(list)", "批量读 / 批量写", "Promise<CapResult<…>>"],
])
const compatRows = ref([
  ["Web SPA", "localStorage（无 localStorage 的宿主 → 内存降级）；异步 API 由同步语义包装为 CapResult", "✅"],
  ["微信小程序", "wx.setStorageSync/getStorageSync（含异步 wx.getStorage 系列 + wx.getStorageInfo）", "✅"],
  ["Headless（SSR/测试）", "mock 桥注入", "✅"],
  ["iOS / Android / 鸿蒙 / Flutter", "端原型映射·能力桥未接线（Err 显式降级）", "🟡"],
])
</script>

<template>
  <page-shell title="useStorage 本地存储" subtitle="能力原语 · capability.storage · 双端同源码">
    <demo-block index="01" title="真交互演示" :has-output="true" desc="同一份源码、同一个 Result&lt;T&gt; 契约——按 res.ok 分支，无回调、无 try/catch 义务" :code="codeDemo">
      <template #demo>
        <p-view id="demo-btns" class="btns">
          <p-button size="small" @click="onRoundtrip">写入并读回</p-button>
          <p-button size="small" @click="onInfo">存储用量</p-button>
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
