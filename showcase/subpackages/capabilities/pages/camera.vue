<!-- showcase/subpackages/capabilities/pages/camera.vue —— 能力详情样板（useCamera，官方形态）
     结构：能力说明 + 真渲染演示块（真机渲染 <camera>）+ API 表 + 双端兼容进度。
     范式与组件样板页一致（subpackages/components/pages/*）——后续能力详情页复用同样板。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PText, PView } from '@proteus-vue/components'
import PCamera from '@proteus-vue/components/p-camera/index.vue'

// ★代码片段放 data（含 < > "。直写 :code="'<camera>'" 会破坏 WXML 解析）
const codeDemo = ref('const res = await useCamera()\nif (res.ok) { /* res.data: MediaAccess */ }\nelse { /* res.error.code === "camera.unsupported" */ }')

const camReady = ref(false)
const camErr = ref('')
function onCamReady() { camReady.value = true }
function onCamErr(e: unknown) {
  camErr.value = (e as { errMsg?: string })?.errMsg || '相机不可用（模拟器无摄像头属预期）'
}

const apiRows = ref([
  ['useCamera()', '返回 Promise<CapResult<MediaAccess>>——无回调、无 try/catch 义务，按 res.ok 分支', 'CapResult<MediaAccess>'],
  ['ok', '成功 true / 失败 false（铁律：能力原语统一 Result，不抛异常）', 'boolean'],
  ['data.kind', "媒体设备类型：'camera' | 'microphone'", 'string'],
  ['data.supported', '平台能力 / 设备是否存在', 'boolean'],
  ['data.granted', '用户是否已授权', 'boolean'],
  ['error.code', "机器码：camera.unsupported（桥未提供）等", 'string'],
  ['error.message', '人读失败原因', 'string'],
])
const compatRows = ref([
  ['Web SPA', 'vue-dom · webBridge 平台 API 直连（getUserMedia）', '✅'],
  ['微信小程序', 'skyline（WebView 降级）· wx 桥 → wx.createCameraContext', '✅'],
  ['Headless（SSR/测试）', 'headless · mock 桥注入', '✅'],
  ['iOS / Android / 鸿蒙 / Flutter', '端原型映射·能力桥未接线（Err 显式降级）', '🟡'],
])
</script>

<template>
  <page-shell title="useCamera 相机" subtitle="能力原语 C1 · capability.camera · 双端同源码">
    <demo-block index="01" title="真渲染演示" :has-output="true" desc="Web 端 getUserMedia / 小程序端原生 <camera>——同一份源码" :code="codeDemo">
      <template #demo>
        <pcamera :height="200" device-position="back" @initdone="onCamReady" @error="onCamErr" />
      </template>
      <template #output>
        <p-text class="out">结果：相机就绪 {{ camReady ? '是' : '否' }}{{ camErr ? ' · ' + camErr : '' }}</p-text>
      </template>
    </demo-block>

    <api-table title="API" :columns="['签名 / 字段', '说明', '类型']" :rows="apiRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<style scoped>
.out {
  display: block;
  background: #f2fbf5;
  border: 1px solid #d6f0e0;
  border-radius: var(--sp-radius-sm);
  padding: var(--sp-2) var(--sp-3);
  font-size: 12.5px;
  color: #2f7a4d;
  font-weight: 600;
}
</style>
