<!--
  css-conformance/pages/safe-area.vue —— CSS 验收 · 安全区 / 系统栏内置变量（--pf-inset-*）

  【验收对象】框架**内置 CSS 环境变量**（决策 #593）：--pf-inset-top/right/bottom/left、
   --pf-status-bar-height、--pf-nav-bar-height 等（安全区/系统栏**运行期环境量**）。
  【四端口径】Web = env(safe-area-inset-*)（:root 定义）；App 自绘 = 编译期发射 env 引用 token →
   宿主采集平台 insets（WindowInsets / safeAreaInsets / avoidArea）；MP = 运行期 wx.getWindowInfo 读数。
  【案例即真实业务形态】顶部状态栏区铺背景（高 = --pf-inset-top）、底部内容避让（padding-bottom）、
   系统栏本体高（--pf-status-bar-height）。
  【★诚实边界】① 桌面浏览器 env()=0（无刘海）⇒ Web 基准三块高度均 0；真机（刘海/手势机）有值。
   ② **MP/Skyline 引擎边界**：Skyline 不应用**内联 style 的自定义属性**（本页把 readEnvVars() 的 --pf-*
     经 wx.getWindowInfo 注入页面根 :style，js 已 setData、wxml 已绑定，但引擎不生效——与 Skyline 不支持
     env() 同类）。MP 端的安全区避让由 **p-safe 组件**（直接 style 值，Skyline 支持）交付——见页面顶部具名。
-->
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { readEnvVars } from '@proteus-vue/fluid'

// ★MP 运行期注入 `--pf-*`（MP 的 env() 不受支持、wxss 无运行期覆盖——唯一可行通道是内联自定义属性）。
//   Web/App 由各自通道提供（Web :root / App 宿主解析），此处读数为空对象（无 wx）⇒ 不干扰。
const envVars = ref<Record<string, string>>({})
onMounted(() => { envVars.value = readEnvVars() })
</script>

<template>
  <view class="cc-page" :style="envVars">
    <text class="cc-page__title">CSS 验收 · 安全区</text>
    <text class="cc-page__sub">--pf-inset-* · 框架内置环境变量 · Web 基准（env safe-area-inset）</text>

    <!-- A · 顶部避让（状态栏区铺色，高 = --pf-inset-top；真机有值，桌面 0） -->
    <text class="cc-sec">A · 顶部避让 var(--pf-inset-top)</text>
    <view class="cc-card">
      <view id="case-inset-top" class="sa-top">
        <text class="sa-t">顶部避让区</text>
      </view>
    </view>

    <!-- B · 底部避让（padding-bottom = --pf-inset-bottom + 16px 底距） -->
    <text class="cc-sec">B · 底部避让 var(--pf-inset-bottom)</text>
    <view class="cc-card">
      <view id="case-inset-bottom" class="sa-bottom">
        <text class="sa-t">底部避让区</text>
      </view>
    </view>

    <!-- C · 系统栏本体高（--pf-status-bar-height 作块高；真机=状态栏高，桌面 0 ⇒ 兜底 24px） -->
    <text class="cc-sec">C · 状态栏本体高 var(--pf-status-bar-height)</text>
    <view class="cc-card">
      <view id="case-status-bar" class="sa-bar">
        <text class="sa-t">系统栏本体</text>
      </view>
    </view>
  </view>
</template>

<style scoped>
/* A：块高 = 顶部避让（真机状态栏/刘海高；桌面 env=0 ⇒ 0 高，靠背景色仍可见 0 高占位） */
.sa-top { background: #5b5bd6; padding-top: var(--pf-inset-top, 0px); min-height: 12px; display: flex; flex-direction: row; align-items: center; }
/* B：底部内边距 = 底部避让 + 16px 固定底距（内容整体上移） */
.sa-bottom { background: #eef1f6; padding-bottom: calc(var(--pf-inset-bottom, 0px) + 16px); padding-top: 12px; display: flex; flex-direction: column; }
/* C：块高 = 系统栏本体高（真机=状态栏高；桌面 0 ⇒ 兜底 24px 使块可见） */
.sa-bar { background: #2a2d3a; height: var(--pf-status-bar-height, 0px); min-height: 24px; display: flex; flex-direction: row; align-items: center; }
.sa-t { color: #ffffff; font-size: 14px; font-weight: 600; padding-left: 12px; }
</style>
