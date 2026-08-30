<!-- examples/pages/mp-semantics-demo.vue —— 小程序语义演示（14-mp-first-semantics）
     以小程序组件/API 为标准：view/text/button/image/input 双端直用（MP 原生 / Web 模拟层对齐）
     open-type 开放能力：MP 原生分享，Web 触发 openshare 事件（开发者自定义处理） -->
<template>
  <!-- ★Skyline 页面本身不滚动——编译器自动包 scroll-view（15-page-scroll-container）；onPageScroll 桥接自动绑定 -->
  <view class="msd">
    <text class="msd-title">小程序语义（14-mp-first-semantics）</text>
    <text class="msd-sub">view/text/button/image/input + wx API —— MP 原生 / Web 模拟层对齐</text>

    <view class="msd-box">
      <text class="msd-label">容器与文本（selectable 可选）</text>
      <view class="msd-row">
        <text selectable>可选中文本（selectable）</text>
      </view>
    </view>

    <view class="msd-box">
      <text class="msd-label">button open-type（开放能力：MP 原生 / Web 降级事件）</text>
      <button open-type="share" @openshare="onShare">分享（open-type="share"）</button>
      <button open-type="contact" @opencontact="onContact">客服（open-type="contact"）</button>
    </view>

    <view class="msd-box">
      <text class="msd-label">wx API（路由/存储/交互/系统信息）</text>
      <button @click="onToast">wx.showToast</button>
      <button @click="onStorage">wx.setStorageSync / getStorageSync</button>
      <button @click="onModal">wx.showModal</button>
      <button @click="onNavigate">wx.navigateTo（showcase）</button>
      <button @click="onSystemInfo">wx.getSystemInfoSync</button>
    </view>

    <view class="msd-box">
      <text class="msd-label">image（mode="widthFix"）+ input</text>
      <image src="https://picsum.photos/300/100" mode="widthFix" class="msd-img" />
      <input class="msd-input" placeholder="wx input（@input 载荷 { value }）" @input="onInput" />
      <text class="msd-log">输入：{{ inputLog }}</text>
    </view>

    <!-- 滚动测试：长列表区块（页面级滚动，双端验证） -->
    <view class="msd-box">
      <text class="msd-label">onPageScroll 桥接（15-page-scroll-container 批次2）</text>
      <text class="msd-scroll-text">滚动位置 scrollTop：{{ scrollTop }}（Skyline 页面不滚动，页面钩子经自动包装 scroll-view 触发）</text>
    </view>
    <view class="msd-box" v-for="(n, idx) in scrollBlocks" :key="idx">
      <text class="msd-label">滚动区块 {{ n }} / 20</text>
      <view class="msd-row">
        <text class="msd-scroll-text">
          内容 {{ n }}：这是一段较长的文本，用于验证页面在长内容场景下能否正常滚动。
          小程序端为页面级滚动（Skyline / WebView），Web 端为浏览器滚动——双端行为应对齐。
        </text>
      </view>
    </view>
    </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const inputLog = ref('')
// 页面滚动桥接演示（15-page-scroll-container 批次2：onPageScroll → 自动包装 scroll-view bindscroll，载荷归一）
const scrollTop = ref(0)
function onPageScroll(e: { scrollTop: number }) {
  scrollTop.value = e.scrollTop
}
// 滚动测试：长列表区块（小程序 wx:for 只接受数组，用字面量数组初始化）
const scrollBlocks = ref([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20])
// ★Vue 对 <input> 用原生 InputHTMLAttributes 类型（HTML 标签优先于 GlobalComponents）；运行时载荷对齐小程序 { detail: { value } }——any 兼容（透明）
function onInput(e: any) {
  inputLog.value = e?.detail?.value ?? ''
}

// open-type 降级事件（Web 端触发；MP 端为原生能力不触发）
function onShare() {
  // Web：可走 Web Share API
  console.log('[mp-semantics] openshare 触发（Web 端自定义处理）')
  if (typeof navigator.share === 'function') {
    void navigator.share({ title: 'Proteus 小程序语义', text: 'Web Share API 对齐' })
  }
}
function onContact() {
  console.log('[mp-semantics] opencontact 触发（Web 端自定义处理）')
}

// wx API（MP 原生 / Web 模拟层）
function onToast() {
  wx.showToast({ title: 'Web 端 toast（模拟层）' })
}
function onStorage() {
  const key = 'msd-key'
  wx.setStorageSync(key, { t: Date.now(), from: 'mp-semantics-demo' })
  console.log('[mp-semantics] getStorageSync:', wx.getStorageSync(key))
  wx.removeStorageSync(key)
}
async function onModal() {
  const r = await wx.showModal({ title: '确认', content: 'wx.showModal Web 模拟（confirm 对话框）' })
  console.log('[mp-semantics] modal:', r)
}
function onNavigate() {
  void wx.navigateTo({ url: '/pages/showcase' })
}
function onSystemInfo() {
  console.log('[mp-semantics] systemInfo:', wx.getSystemInfoSync())
}
</script>

<style scoped>
.msd {
  padding: 24px;
  text-align: left;
}
.msd-title {
  display: block;
  font-size: 20px;
  font-weight: 700;
  margin-bottom: 8px;
}
.msd-sub {
  display: block;
  color: #888;
  font-size: 13px;
  margin-bottom: 16px;
}
.msd-box {
  border: 1px solid #eee;
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 12px;
}
.msd-label {
  display: block;
  color: #666;
  font-size: 12px;
  margin-bottom: 8px;
}
.msd-row {
  margin: 4px 0;
}
.msd-img {
  display: block;
  margin-bottom: 8px;
}
.msd-input {
  box-sizing: border-box;
  width: 100%;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 14px;
}
.msd-log {
  display: block;
  color: #1a7af8;
  font-size: 13px;
  margin-top: 6px;
}
.msd-scroll-text {
  font-size: 13px;
  color: #444;
  line-height: 1.6;
}
</style>
