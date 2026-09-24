<!-- showcase/subpackages/capabilities/pages/background.vue —— 能力详情页（useBackground，官方形态）
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
const codeDemo = ref("const bg = useBackground()\nconst off = bg.onEvent((e) => { /* e.type: \"enter-background\" | \"enter-foreground\" */ })")

const out = ref('订阅已就绪——切走标签页（进入后台）再切回，事件会被记录')
let unsubB: (() => void) | null = null
const bgEvents = ref<string[]>([])
async function onSubscribeBg(): Promise<void> {
  // ★useBackground() 是**异步** hook（返回 Promise<CapResult<BackgroundAPI>>）——
  //   必须先 await 再解包 .ok/.data 才能拿到句柄；直接当同步句柄用会得到
  //   「onEvent is not a function」（实测定论：raw 返回 Promise，无句柄字段）。
  //   ★同族的 useAppLifecycle / useKeyboard 是**同步** CapResult，两者形态不同，不能照抄。
  const r = await cap.useBackground()
  if (!r.ok) { out.value = `⚠ 降级：${r.error.code}`; return }
  unsubB = r.data.onEvent((e) => { bgEvents.value.push(e.type) })
  out.value = '✅ 已订阅前后台变化——切走/切回标签页观察下方记录'
}
function onUnsubscribeBg(): void {
  if (!unsubB) { out.value = '（尚未订阅）'; return }
  unsubB(); unsubB = null
  out.value = '✅ 已取消订阅'
}

const apiRows = ref([
  ["useBackground()", "前后台事件句柄（★同步返回）", "BackgroundAPI"],
  ["onEvent(cb)", "订阅前后台切换（载荷 type: 'enter-background' | 'enter-foreground' + time；返回取消函数）", "() => void"],
  ["onMemoryWarning(cb) / onThemeChange(cb) / onWindowResize(cb)", "内存警告 / 主题切换 / 窗口尺寸变化（Web 端按平台支持度降级）", "() => void"],
])
const compatRows = ref([
  ["Web SPA", "document visibilitychange（★真可触发——切标签页）", "✅"],
  ["微信小程序", "wx.onAppShow / onAppHide（前后台切换）", "✅"],
  ["Headless（SSR/测试）", "mock 桥注入", "✅"],
  ["iOS / Android / 鸿蒙 / Flutter", "端原型映射·能力桥未接线（Err 显式降级）", "🟡"],
])
</script>

<template>
  <page-shell title="useBackground 前后台事件" subtitle="能力原语 · capability.background · 双端同源码">
    <demo-block index="01" title="真交互演示" :has-output="true" desc="同一份源码、同一个 Result&lt;T&gt; 契约——按 res.ok 分支，无回调、无 try/catch 义务" :code="codeDemo">
      <template #demo>
        <p-view id="demo-btns" class="btns">
          <p-button size="small" @click="onSubscribeBg">订阅前后台</p-button>
          <p-button size="small" @click="onUnsubscribeBg">取消订阅</p-button>
        </p-view>
      </template>
      <template #output>
        <p-text class="out">{{ out }}</p-text>
        <p-text class="out out-extra">已记录事件：{{ bgEvents.join(" → ") || "（暂无）" }}</p-text>      </template>
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
