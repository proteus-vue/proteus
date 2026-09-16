<!-- showcase/subpackages/components/pages/p-camera.vue —— p-camera 相机演示
     覆盖：mode（normal / scanCode）/ resolution / device-position / flash / frame-size / aspectRatio。
     ★双端：MP 原生 <camera>（属性全量透传 + initdone/stop/scancode/error 事件）；
       Web getUserMedia + <video> 预览（标准 API，需用户授权）。
     ★诚实边界：Web 端无摄像头/未授权时显示明确提示（非静默空白）；扫码（mode=scanCode）仅 MP 原生支持。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PCamera, PText } from '@proteus-vue/components'

const state = ref('等待相机事件…')
function onReady() { state.value = 'ready：Web 相机已启动' }
function onInitDone() { state.value = 'initdone：MP 相机初始化完成' }
function onError(e: unknown) { state.value = 'error：' + JSON.stringify(e) }

const codes = ref({
  base: '<p-camera @initdone="onInitDone" />',
  front: '<p-camera device-position="front" flash="on" />',
  res: '<p-camera resolution="high" frame-size="large" />',
  scan: '<p-camera mode="scanCode" @scancode="onScanCode" />',
})

const apiRows = ref([
  ['mode', '应用模式 normal / scanCode（★官方 mode；仅初始化有效，不可动态变更）', 'string'],
  ['resolution', '分辨率 low / medium / high（★官方 resolution，不支持动态修改）', 'string'],
  ['devicePosition', '摄像头朝向 back / front（★官方 device-position）', 'string'],
  ['flash', '闪光灯 auto / on / off（★官方 flash）', 'string'],
  ['frameSize', '帧数据尺寸 small / medium / large（★官方 frame-size）', 'string'],
  ['aspectRatio', '预览宽高比（框架扩展，缺省 4:3）', 'number'],
])
const eventRows = ref([
  ['initdone', '相机初始化完成（★官方 bind:initdone，detail={maxZoom}）', '{ maxZoom }'],
  ['stop', '摄像头非正常终止（★官方 bind:stop，如退出后台）', 'event'],
  ['scancode', '扫码成功（★官方 bind:scancode，仅 mode=scanCode）', 'event'],
  ['error', '用户不允许使用摄像头（★官方 bind:error）', 'event'],
  ['ready', 'Web 相机预览就绪（兼容事件，框架扩展）', '{ kind, supported, granted }'],
])
const slotRows = ref([['default', '相机预览层叠加内容（MP 端 <camera> 子节点）', '—']])
</script>

<template>
  <page-shell title="p-camera 相机" subtitle="内容基元 · 相机预览与拍照（Web 需授权）">
    <demo-block index="01" title="相机预览" :has-output="true"
      desc="MP 原生 <camera>；Web getUserMedia（未授权时显示明确提示）" :code="codes.base">
      <template #demo>
        <p-camera @ready="onReady" @initdone="onInitDone" @error="onError" />
      </template>
      <template #output><p-text class="out">{{ state }}</p-text></template>
    </demo-block>

    <demo-block index="02" title="朝向与闪光灯" desc="device-position=front 前置；flash=on 强制闪光" :code="codes.front">
      <template #demo>
        <p-camera device-position="front" flash="on" />
      </template>
    </demo-block>

    <demo-block index="03" title="分辨率与帧尺寸" desc="resolution / frame-size（★仅初始化生效，不可动态修改）" :code="codes.res">
      <template #demo>
        <p-camera resolution="high" frame-size="large" />
      </template>
    </demo-block>

    <demo-block index="04" title="扫码模式" desc="mode=scanCode：MP 端原生扫码；Web 端无对等能力（诚实降级为普通预览）" :code="codes.scan">
      <template #demo>
        <p-camera mode="scanCode" @error="onError" />
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="Slots" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
  </page-shell>
</template>

<style scoped>
.out { display: block; font-size: 12.5px; color: #2f7a4d; }
</style>
