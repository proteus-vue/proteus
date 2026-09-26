<!-- showcase/subpackages/components/pages/p-camera.vue —— p-camera 相机 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-camera.md ← gen-content.mjs ← packages/components/p-camera/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PCamera, PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  base: "<p-camera @initdone=\"onInitDone\" />",
  front: "<p-camera device-position=\"front\" flash=\"on\" />",
  res: "<p-camera resolution=\"high\" frame-size=\"large\" />",
  scan: "<p-camera mode=\"scanCode\" @scancode=\"onScanCode\" />",
})

const state = ref('等待相机事件…')
function onReady() { state.value = 'ready：Web 相机已启动' }
function onInitDone() { state.value = 'initdone：MP 相机初始化完成' }
function onError(e: unknown) { state.value = 'error：' + JSON.stringify(e) }

const apiRows = ref([
  [
    "mode",
    "应用模式：normal 拍照 / scanCode 扫码（对齐 mode；★仅初始化生效，不能动态变更）",
    "String"
  ],
  [
    "resolution",
    "分辨率：low / medium / high（对齐 resolution；★不支持动态修改）",
    "String"
  ],
  [
    "devicePosition",
    "摄像头朝向：back 后置 / front 前置（对齐 device-position）",
    "String"
  ],
  [
    "flash",
    "闪光灯：auto / on / off（对齐 flash）",
    "String"
  ],
  [
    "frameSize",
    "期望的相机帧数据尺寸：small / medium / large（对齐 frame-size）",
    "String"
  ],
  [
    "aspectRatio",
    "预览宽高比（padding-top 百分比；缺省 4:3）",
    "Number"
  ]
])
const eventRows = ref([
  [
    "initdone",
    "—",
    "—"
  ],
  [
    "error",
    "加载/执行失败",
    "e"
  ],
  [
    "ready",
    "—",
    "{ kind: 'camera', supported: true, granted: true }"
  ],
  [
    "stop",
    "—",
    "e"
  ],
  [
    "scancode",
    "—",
    "e"
  ]
])
const slotRows = ref([
  [
    "default",
    "默认插槽（组件主内容）",
    "—"
  ]
])
const compatRows = ref([
  [
    "Web SPA",
    "✅",
    "vue-dom · 双端同源码编译目标（编译期映射 + 事件归一）"
  ],
  [
    "微信小程序",
    "✅",
    "skyline（WebView 降级） · 原生控件映射 → <camera>（L1 原语）"
  ],
  [
    "Headless（SSR / 测试）",
    "✅",
    "headless · IR 渲染测试档（工具端）"
  ],
  [
    "iOS 原生",
    "🟡",
    "native-ios（UIKit） · 端原型映射——组件级接线未开始"
  ],
  [
    "Android 原生",
    "🟡",
    "native-android（Jetpack） · 端原型映射——组件级接线未开始"
  ],
  [
    "鸿蒙",
    "🟡",
    "native-harmony（ArkUI） · 端原型映射——组件级接线未开始"
  ],
  [
    "Flutter 混合",
    "🟡",
    "flutter · widget 级映射——组件级未验证"
  ],
  [
    "快应用",
    "⬜",
    "快应用引擎（待定） · 端未开始"
  ]
])
</script>

<template>
  <page-shell title="p-camera 相机" subtitle="内容基元 · 相机预览与拍照（Web 需授权）">
    <demo-block index="01" title="相机预览" desc="MP 原生 <camera>；Web getUserMedia（未授权时显示明确提示）" :has-output="true" :code="codes.base">
      <template #demo>
        <p-camera @ready="onReady" @initdone="onInitDone" @error="onError" />
      </template>
      <template #output>
        <p-text class="out">{{ state }}</p-text>
      </template>
    </demo-block>

    <demo-block index="02" title="朝向与闪光灯" desc="device-position=front 前置；flash=on 强制闪光" :has-output="false" :code="codes.front">
      <template #demo>
        <p-camera device-position="front" flash="on" />
      </template>
    </demo-block>

    <demo-block index="03" title="分辨率与帧尺寸" desc="resolution / frame-size（★仅初始化生效，不可动态修改）" :has-output="false" :code="codes.res">
      <template #demo>
        <p-camera resolution="high" frame-size="large" />
      </template>
    </demo-block>

    <demo-block index="04" title="扫码模式" desc="mode=scanCode：MP 端原生扫码；Web 端无对等能力（诚实降级为普通预览）" :has-output="false" :code="codes.scan">
      <template #demo>
        <p-camera mode="scanCode" @error="onError" />
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<style scoped>
.out { display: block; font-size: 12.5px; color: #2f7a4d; }
</style>
