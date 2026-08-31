<!-- examples/pages/platform-api-demo.vue —— PlatformAPI 收口演示（types-plus B9 + api-plan）
     业务代码零 wx.*：request / storage / router / ui 四域统一走 @proteus-vue/api 的 createPlatformAPI
     对照：mp-semantics-demo 直接 wx.*（小程序语义演示）→ 本页展示收口后的业务落地形态
     ★双端：MP 端平台分支自动生效（wx.request/setStorageSync/navigateTo/showToast），Web 端
       fetch/localStorage/history/DOM toast；request 默认 httpbin（CORS 开放；MP 端需开发者工具关闭域名校验） -->
<route>
{
  "path": "/pages/platform-api-demo",
  "meta": {
    "title": "PlatformAPI 收口"
  }
}
</route>
<template>
  <view class="pad">
    <text class="pad-title">PlatformAPI 收口演示（B9）</text>
    <text class="pad-sub">业务代码零 wx.* —— request / storage / router / ui 统一走 createPlatformAPI</text>

    <view class="pad-box">
      <text class="pad-label">① request（wx.request → platformAPI.request）</text>
      <input class="pad-input" :value="url" placeholder="请求 URL（默认 httpbin.org/get）" @input="onUrlInput" />
      <view class="pad-row">
        <button class="pad-btn" @click="onRequest">GET 请求</button>
        <text class="pad-log">status {{ respStatus === null ? '—' : respStatus }} · {{ respData }}</text>
      </view>
    </view>

    <view class="pad-box">
      <text class="pad-label">② storage（wx.setStorageSync → platformAPI.storage，JSON 往返）</text>
      <view class="pad-row">
        <button class="pad-btn" @click="onStorageSet">写入</button>
        <button class="pad-btn" @click="onStorageGet">读取</button>
        <button class="pad-btn" @click="onStorageRemove">删除</button>
      </view>
      <text class="pad-log">{{ storageLog }}</text>
    </view>

    <view class="pad-box">
      <text class="pad-label">③ router（wx.navigateTo → platformAPI.router）</text>
      <view class="pad-row">
        <button class="pad-btn" @click="onRouterPush">push → showcase</button>
        <button class="pad-btn" @click="onRouterBack">back（带参数 delta）</button>
      </view>
    </view>

    <view class="pad-box">
      <text class="pad-label">④ ui（wx.showToast / showModal / showActionSheet → platformAPI.ui）</text>
      <view class="pad-row">
        <button class="pad-btn" @click="onToast">showToast</button>
        <button class="pad-btn" @click="onModal">showModal</button>
        <button class="pad-btn" @click="onActionSheet">showActionSheet</button>
        <button class="pad-btn" @click="onLoading">showLoading（2s 自动关）</button>
        <button class="pad-btn" @click="onHideLoading">hideLoading</button>
      </view>
      <text class="pad-log">{{ uiLog }}</text>
    </view>

    <view class="pad-box">
      <text class="pad-label">对照（wx.* 直写 → platformAPI.* 收口）</text>
      <text class="pad-sub">
        wx.showToast → api.ui.showToast · wx.showModal → api.ui.showModal · wx.showActionSheet → api.ui.showActionSheet ·
        wx.setStorageSync → api.storage.set · wx.navigateTo → api.router.push · wx.switchTab → api.router.switchTab · wx.request → api.request
      </text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { createPlatformAPI } from '@proteus-vue/api'

// ★业务侧统一平台 API 入口（演示用每页独立实例；生产建议模块级单例 / DI 注入）
const api = createPlatformAPI()

// ---------- ① request ----------
const url = ref('https://httpbin.org/get')
const respStatus = ref<number | null>(null)
const respData = ref('')
function onUrlInput(e: any) {
  url.value = e?.detail?.value ?? ''
}
async function onRequest() {
  try {
    const res = await api.request<{ url: string }>({ url: url.value, method: 'GET', timeout: 8000 })
    respStatus.value = res.status
    respData.value = JSON.stringify(res.data).slice(0, 140)
  } catch (err) {
    respStatus.value = -1
    respData.value = (err as Error).message
  }
}

// ---------- ② storage ----------
const STORAGE_KEY = 'pad-key'
const storageLog = ref('')
function onStorageSet() {
  api.storage.set(STORAGE_KEY, { t: Date.now(), from: 'platform-api-demo' })
  storageLog.value = `已写入 { t: ${Date.now()}, from: 'platform-api-demo' }`
}
function onStorageGet() {
  const v = api.storage.get<{ t: number }>(STORAGE_KEY)
  storageLog.value = v === undefined ? '读取到 undefined（未写入）' : `读取到 t = ${v.t}`
}
function onStorageRemove() {
  api.storage.remove(STORAGE_KEY)
  storageLog.value = '已删除'
}

// ---------- ③ router ----------
function onRouterPush() {
  api.router.push('/pages/showcase')
}
function onRouterBack() {
  api.router.back(1)
}

// ---------- ④ ui ----------
const uiLog = ref('')
function onToast() {
  api.ui.showToast('platformAPI.ui.showToast')
}
function onModal() {
  void api.ui.showModal({ title: '确认', content: 'platformAPI.ui.showModal（确认对话框）' }).then((r) => {
    uiLog.value = r.confirm ? 'showModal → 点了确定' : 'showModal → 取消'
  })
}
function onActionSheet() {
  void api.ui.showActionSheet({ itemList: ['编辑', '删除'] }).then((r) => {
    uiLog.value = r.tapIndex === -1 ? 'showActionSheet → 取消' : `showActionSheet → 点了第 ${r.tapIndex + 1} 项`
  })
}
function onLoading() {
  api.ui.showLoading('加载中…')
  setTimeout(() => api.ui.hideLoading(), 2000)
}
function onHideLoading() {
  api.ui.hideLoading()
}
</script>

<style scoped>
.pad {
  padding: 24px;
  text-align: left;
}
.pad-title {
  display: block;
  font-size: 20px;
  font-weight: 700;
  margin-bottom: 8px;
}
.pad-sub {
  display: block;
  color: #888;
  font-size: 13px;
  margin-bottom: 16px;
  line-height: 1.6;
}
.pad-box {
  border: 1px solid #eee;
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 12px;
}
.pad-label {
  display: block;
  color: #666;
  font-size: 12px;
  margin-bottom: 8px;
}
.pad-row {
  /* ★Skyline 引擎不支持 inline 布局——行内排布必须 flex 容器 */
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 4px 0;
  flex-wrap: wrap;
}
.pad-btn {
  margin-top: 4px;
}
.pad-input {
  box-sizing: border-box;
  width: 100%;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 14px;
  margin-bottom: 8px;
}
.pad-log {
  display: block;
  color: #1a7af8;
  font-size: 13px;
  margin-top: 6px;
  word-break: break-all;
}

/* 暗黑模式：页面深底（RouterView .page #111）——配色适配 */
@media (prefers-color-scheme: dark) {
  .pad-title {
    color: rgba(255, 255, 255, 0.8);
  }
  .pad-sub {
    color: rgba(255, 255, 255, 0.5);
  }
  .pad-box {
    border-color: rgba(255, 255, 255, 0.1);
  }
  .pad-label {
    color: rgba(255, 255, 255, 0.5);
  }
  .pad-input {
    border-color: rgba(255, 255, 255, 0.2);
    background: #191919;
    color: rgba(255, 255, 255, 0.8);
  }
  .pad-log {
    color: #7d90a9;
  }
}
</style>
