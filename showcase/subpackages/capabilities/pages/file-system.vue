<!-- showcase/subpackages/capabilities/pages/file-system.vue —— 能力详情页（useFileSystem，官方形态）
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
const codeDemo = ref("const fs = useFileSystem()\nif (fs.supported) {\n  await fs.writeFile(\"/demo/a.txt\", \"hello\")\n  const r = await fs.readFile(\"/demo/a.txt\")   // r.data === \"hello\"\n}")

const out = ref('点击按钮做一次「写入 → 读回 → 列目录」往返')
async function onFs(): Promise<void> {
  const fs = cap.useFileSystem()
  const w = await fs.writeFile('/demo/note.txt', 'hello-proteus ' + Date.now())
  if (!w.ok) { out.value = `⚠ 降级：${w.error.code}`; return }
  const r = await fs.readFile('/demo/note.txt')
  const list = await fs.readdir('/demo')
  // ★修正（类型检查暴露）：CapResult 是**判别联合**——必须先判 ok 才能访问 data
  //   （此前在 err 分支也直接取 .data，属类型不安全的写法）
  const dirCount = list.ok && Array.isArray(list.data) ? list.data.length : 0
  out.value = r.ok
    ? `✅ 读回 "${String(r.data).slice(0, 28)}" · 目录 ${dirCount} 项`
    : `⚠ 降级：${r.error.code}`
}

const apiRows = ref([
  ["useFileSystem()", "文件系统适配器（★同步返回 FSAdapter；supported=是否可用）", "FSAdapter"],
  ["writeFile(path, data)", "写入文本（覆盖；不存在则创建）", "Promise<CapResult<void>>"],
  ["readFile(path)", "读取文本（UTF-8）", "Promise<CapResult<string>>"],
  ["appendFile / copyFile / rename / remove", "追加 / 复制 / 重命名 / 删除", "Promise<CapResult<…>>"],
  ["exists / stat / mkdir / rmdir / readdir", "存在性 / 元信息 / 建目录 / 删目录 / 列目录", "Promise<CapResult<…>>"],
])
const compatRows = ref([
  ["Web SPA", "★内存降级（可读写但非持久——Web 无标准同步 FS，OPFS 需安全上下文）", "✅"],
  ["微信小程序", "wx.getFileSystemManager（真持久化到 USER_DATA_PATH）", "✅"],
  ["Headless（SSR/测试）", "mock 桥注入", "✅"],
  ["iOS / Android / 鸿蒙 / Flutter", "端原型映射·能力桥未接线（Err 显式降级）", "🟡"],
])
</script>

<template>
  <page-shell title="useFileSystem 文件系统" subtitle="能力原语 · capability.file-system · 双端同源码">
    <demo-block index="01" title="真交互演示" :has-output="true" desc="同一份源码、同一个 Result&lt;T&gt; 契约——按 res.ok 分支，无回调、无 try/catch 义务" :code="codeDemo">
      <template #demo>
        <p-view id="demo-btns" class="btns">
          <p-button size="small" @click="onFs">写入并读回</p-button>
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
