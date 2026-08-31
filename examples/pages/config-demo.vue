<!-- examples/pages/config-demo.vue —— proteus.config 规则覆盖演示页（★底线循环 ③）
     演示 proteus.config.ts 的 rules 段：改配置即改变编译行为，无需改框架代码 -->
<script setup lang="ts">
import { ref } from 'vue'
// ★platform-plan B1：Capability 能力（业务依赖能力不依赖平台）——Web 端 Vite ESM 可用；MP 端接入待能力包打包放行
import clipboardCap from '../capabilities/clipboard.capability'
import type { ClipboardAPI } from '../capabilities/clipboard.capability'
import { registerCapability, useCapability } from '@proteus-vue/capabilities'
import type { Capability } from '@proteus-vue/capabilities'
// ★api-plan B1：设备信息（@proteus-vue/api 框架包——MP 端经共享模块放行 _proteus/api.js）
import { getDeviceInfo } from '@proteus-vue/api'

registerCapability(clipboardCap)

const clicked = ref(0)
const copyStatus = ref('')
const device = ref({ platform: '', screenWidth: 0, screenHeight: 0, isSkyline: false })

function bump() {
  clicked.value++
}

async function copyText() {
  // 方法体内避免 TS 泛型调用（MP 产物限制）——断言 as unknown as Capability<...>（编译期剥离）
  const clipboard = useCapability('clipboard') as unknown as Capability<ClipboardAPI>
  if (!(await clipboard.isSupported())) {
    copyStatus.value = '当前环境不支持剪贴板（isSupported 探测）'
    return
  }
  await clipboard.api.write('Proteus Capability ' + Date.now())
  copyStatus.value = '已复制（Capability 抽象，无平台判断）'
}

function showDevice() {
  const info = getDeviceInfo()
  device.value = { platform: info.platform, screenWidth: info.screenWidth, screenHeight: info.screenHeight, isSkyline: info.isSkyline }
}
</script>

<template>
  <div class="config-demo">
    <h2>proteus.config rules</h2>
    <p class="sub">本页演示 <code>proteus.config.ts</code> 的规则覆盖：改配置 → 重新构建 → 产物即时变化</p>

    <!-- customTags 演示：config 里 customTags: { 'demo-box': 'view' } 已启用，
         此标签编译为 <view class="demo-box">；删除 config 中该键即回到"未注册标签原样输出" -->
    <demo-box class="demo-box">customTags：'demo-box' → view（config 启用）</demo-box>

    <button @click="bump">计数：{{ clicked }}</button>

    <!-- ★platform-plan B1：Capability 能力 demo（web: navigator.clipboard / skyline: wx.setClipboardData） -->
    <div class="box">
      <button @click="copyText">复制（Capability）</button>
      <p class="sub">{{ copyStatus }}</p>
    </div>

    <!-- ★api-plan B1：设备信息（@proteus-vue/api getDeviceInfo——业务零平台分支） -->
    <div class="box">
      <button @click="showDevice">设备信息（@proteus-vue/api）</button>
      <p class="sub">{{ device.platform }} {{ device.screenWidth }}×{{ device.screenHeight }}{{ device.isSkyline ? '（Skyline）' : '' }}</p>
    </div>

    <div class="note">
      <p><b>试玩三个开关</b>（编辑 proteus.config.ts 的 rules 段后 <code>npm run build:mp</code>）：</p>
      <ul>
        <li><code>customTags</code>：新增标签映射（本页 demo-box）</li>
        <li><code>mapping</code>：改写映射（如 'tag/link-to-view': { a: 'text' }）</li>
        <li><code>disabled</code>：禁用规则（如 'directive/v-if'，v-if 将被忽略 + 编译期警告）</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.config-demo {
  padding: 24px;
  text-align: center;
}
.sub {
  color: #888;
  font-size: 13px;
}
.demo-box {
  display: block;
  padding: 16px;
  background: #eef4ff;
  border-radius: 8px;
  margin: 12px 0;
}
.box {
  margin: 12px 0;
  padding: 12px;
  background: #f5f6f7;
  border-radius: 8px;
}
.note {
  margin-top: 20px;
  text-align: left;
  background: #f5f6f7;
  padding: 12px;
  border-radius: 8px;
  font-size: 13px;
}
.note code {
  background: #e6e8eb;
  padding: 1px 4px;
  border-radius: 4px;
  font-size: 12px;
}
</style>
