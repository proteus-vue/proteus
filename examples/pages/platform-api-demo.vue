<!-- examples/pages/platform-api-demo.vue —— PlatformAPI 收口演示（types-plus B9 + api-plan）
     业务代码零 wx.*：request / storage / router / ui 四域统一走 @proteus-vue/api 的 createPlatformAPI
     对照：mp-semantics-demo 直接 wx.*（小程序语义演示）→ 本页展示收口后的业务落地形态
     ★双端：MP 端平台分支自动生效（wx.request/setStorageSync/navigateTo/showToast），Web 端
       fetch/localStorage/history/DOM toast；request 默认 httpbin（CORS 开放；MP 端需开发者工具关闭域名校验） -->
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
        <button class="pad-btn" data-testid="pad-storage-set" @click="onStorageSet">写入</button>
        <button class="pad-btn" data-testid="pad-storage-get" @click="onStorageGet">读取</button>
        <button class="pad-btn" data-testid="pad-storage-remove" @click="onStorageRemove">删除</button>
      </view>
      <text class="pad-log" data-testid="pad-storage-log">{{ storageLog }}</text>
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
        <button class="pad-btn" data-testid="pad-modal" @click="onModal">showModal</button>
        <button class="pad-btn" data-testid="pad-action-sheet" @click="onActionSheet">showActionSheet</button>
        <button class="pad-btn" data-testid="pad-loading" @click="onLoading">showLoading（2s 自动关）</button>
        <button class="pad-btn" @click="onHideLoading">hideLoading</button>
      </view>
      <text class="pad-log" data-testid="pad-ui-log">{{ uiLog }}</text>
    </view>

    <view class="pad-box">
      <text class="pad-label">⑤ 能力 Hook（G-32：useDevice/useNetwork/useClipboard → Result&lt;T&gt; 无回调）</text>
      <view class="pad-row">
        <button class="pad-btn" data-testid="pad-cap-device" @click="onCapDevice">useDevice</button>
        <button class="pad-btn" data-testid="pad-cap-network" @click="onCapNetwork">useNetwork</button>
        <button class="pad-btn" data-testid="pad-cap-clipboard" @click="onCapClipboard">useClipboard</button>
        <button class="pad-btn" data-testid="pad-cap-fetch" @click="onCapFetch">useFetch</button>
      </view>
      <text class="pad-log" data-testid="pad-cap-log">{{ capLog }}</text>
      <text class="pad-sub">useFetch = G-32 C26（迁移文档：wx.request → await useFetch(url)）· usePermission/useStorage 见 @proteus-vue/api/capability.ts（probe 降级 + createReactiveStorage 响应式）</text>
    </view>

    <view class="pad-box">
      <text class="pad-label">⑥ 能力 Hook 三期（useSensor/useBiometric/useAuth/useQRCode——web 缺能力 → Err 降级）</text>
      <view class="pad-row">
        <button class="pad-btn" data-testid="pad-cap-sensor" @click="onCapSensor">useSensor</button>
        <button class="pad-btn" data-testid="pad-cap-biometric" @click="onCapBiometric">useBiometric</button>
        <button class="pad-btn" data-testid="pad-cap-auth" @click="onCapAuth">useAuth 登录</button>
        <button class="pad-btn" data-testid="pad-cap-auth-logout" @click="onCapAuthLogout">登出</button>
        <button class="pad-btn" data-testid="pad-cap-qr" @click="onCapQR">useQRCode</button>
      </view>
      <text class="pad-log" data-testid="pad-cap3-log">{{ cap3Log }}</text>
      <text class="pad-sub">useBiometric → web 无 WebAuthn 时 data:false（feature detection）；useQRCode web 需摄像头取流源 → Err · 小程序端 wx.scanCode 直通</text>
    </view>

    <view class="pad-box">
      <text class="pad-label">⑦ 能力 Hook 四期（useWebSocket/useAnalytics/useLog/useFileSystem——网络与工程类）</text>
      <view class="pad-row">
        <button class="pad-btn" data-testid="pad-cap-ws" @click="onCapWS">useWebSocket</button>
        <button class="pad-btn" data-testid="pad-cap-analytics" @click="onCapAnalytics">useAnalytics 埋点</button>
        <button class="pad-btn" data-testid="pad-cap-log" @click="onCapLog">useLog</button>
        <button class="pad-btn" data-testid="pad-cap-fs" @click="onCapFS">useFileSystem</button>
      </view>
      <text class="pad-log" data-testid="pad-cap4-log">{{ cap4Log }}</text>
      <text class="pad-sub">useWebSocket/useAnalytics 小程序端走 wx.connectSocket/reportEvent；useFileSystem web 端内存降级（非持久）· useUpload/useDownload 见 @proteus-vue/api/capability.ts</text>
    </view>

    <view class="pad-box">
      <text class="pad-label">⑧ 能力 Hook 五期（useNotification/useAppLifecycle/useContact/useCalendar/useArchive/useShortcut）</text>
      <view class="pad-row">
        <button class="pad-btn" data-testid="pad-cap-notification" @click="onCapNotification">useNotification</button>
        <button class="pad-btn" data-testid="pad-cap-lifecycle" @click="onCapLifecycle">useAppLifecycle</button>
        <button class="pad-btn" data-testid="pad-cap-contact" @click="onCapContact">useContact</button>
        <button class="pad-btn" data-testid="pad-cap-calendar" @click="onCapCalendar">useCalendar</button>
        <button class="pad-btn" data-testid="pad-cap-archive" @click="onCapArchive">useArchive</button>
        <button class="pad-btn" data-testid="pad-cap-shortcut" @click="onCapShortcut">useShortcut</button>
      </view>
      <text class="pad-log" data-testid="pad-cap5-log">{{ cap5Log }}</text>
      <text class="pad-sub">小程序端走 wx.requestSubscribeMessage/chooseContact/addPhoneCalendar/compressFile/addToDesktop + App 钩子；web 端仅 Notification 与 visibilitychange 有原生对应，其余诚实降级 → Err</text>
    </view>

    <view class="pad-box">
      <text class="pad-label">⑨ 能力 Hook 六期（usePageLifecycle/useBluetooth/useNFC/useCamera/useMicrophone/useKeyboard——媒体与近场）</text>
      <view class="pad-row">
        <button class="pad-btn" data-testid="pad-cap-page-lc" @click="onCapPageLC">usePageLifecycle</button>
        <button class="pad-btn" data-testid="pad-cap-bt" @click="onCapBt">useBluetooth</button>
        <button class="pad-btn" data-testid="pad-cap-nfc" @click="onCapNfc">useNFC</button>
        <button class="pad-btn" data-testid="pad-cap-cam" @click="onCapCam">useCamera</button>
        <button class="pad-btn" data-testid="pad-cap-mic" @click="onCapMic">useMicrophone</button>
        <button class="pad-btn" data-testid="pad-cap-kb" @click="onCapKb">useKeyboard</button>
      </view>
      <text class="pad-log" data-testid="pad-cap6-log">{{ cap6Log }}</text>
      <text class="pad-sub">小程序端走 wx.openBluetoothAdapter/getHCEState/authorize/onKeyboardHeightChange/onPageShow·onPageHide；web 端蓝牙·NFC 为特性探测，相机·麦克风走 getUserMedia（需 HTTPS），键盘走 visualViewport 启发式</text>
    </view>

    <view class="pad-box">
      <text class="pad-label">⑩ 工程原语（G-32 B5：useState/useComputed/usePageParam——injectable vue reactivity）</text>
      <view class="pad-row">
        <button class="pad-btn" data-testid="pad-eng-inc" @click="onEngInc">useState 自增</button>
        <button class="pad-btn" data-testid="pad-eng-log" @click="onEngLog">useState/Computed 读</button>
        <button class="pad-btn" data-testid="pad-eng-param" @click="onEngParam">usePageParam</button>
      </view>
      <text class="pad-log" data-testid="pad-eng-log-out">{{ engLog }}</text>
      <text class="pad-sub">createEngineering 注入 Vue reactivity——useState=ref 语义 / useComputed=computed / usePageParam 读页面参数（api 包零 vue 依赖，消费方注入）</text>
    </view>

    <view class="pad-box">
      <text class="pad-label">⑪ 路由语义化（G-32 B5 续：createRouterEngineering——E10 useRoute / E11-E15 导航语义 / E16-E17 守卫）</text>
      <view class="pad-row">
        <button class="pad-btn" data-testid="pad-route-push" @click="onRoutePush">push</button>
        <button class="pad-btn" data-testid="pad-route-replace" @click="onRouteReplace">replace</button>
        <button class="pad-btn" data-testid="pad-route-back" @click="onRouteBack">back</button>
        <button class="pad-btn" data-testid="pad-route-tab" @click="onRouteTab">switchTab</button>
        <button class="pad-btn" data-testid="pad-route-relaunch" @click="onRouteRelanch">reLaunch</button>
        <button class="pad-btn" data-testid="pad-route-read" @click="onRouteRead">useRoute</button>
      </view>
      <text class="pad-log" data-testid="pad-route-log">{{ routeLog }}</text>
      <text class="pad-sub">createRouterEngineering 注入兼容 router（mock 录制调用，不真实导航）——E11-E15 语义委托既有 router（replace=replace:true / switchTab / reLaunch 标志）；E10 useRoute 读注入 getCurrentRoute 源；E16/E17 守卫委托（router 缺省时安全 no-op）</text>
    </view>

    <view class="pad-box">
      <text class="pad-label">⑫ 动画语义（G-32 B5 续二：p-transition E19 / p-animate E20 / useAnimation E21-E23 注入式）</text>
      <view class="pad-row">
        <button class="pad-btn" data-testid="pad-anim-toggle" @click="onAnimToggle">p-transition 显隐</button>
        <button class="pad-btn" data-testid="pad-anim-run" @click="onAnimRun">useAnimation</button>
        <button class="pad-btn" data-testid="pad-anim-gesture" @click="onAnimGesture">useGestureAnimation</button>
        <button class="pad-btn" data-testid="pad-anim-scroll" @click="onAnimScroll">useScrollAnimation</button>
      </view>
      <view class="pad-anim-stage">
        <p-transition name="slide-up" mode="both" :duration="300" :visible="animVisible">
          <p-animate keyframes="bounce" :duration="800" :loop="false">
            <text class="pad-anim-box">Proteus</text>
          </p-animate>
        </p-transition>
      </view>
      <text class="pad-log" data-testid="pad-anim-log">{{ animLog }}</text>
      <text class="pad-sub">E19 p-transition（CSS 显隐过渡）· E20 p-animate（CSS 动画声明——组件形态，纯 CSS 双端）；E21 useAnimation（wx.createAnimation 语义构建器）/ E22 useGestureAnimation（增量累积→提交帧）/ E23 useScrollAnimation（进度→插值）——reactivity/driver 注入式，web 端 WAAPI 播放（MP/无 driver 安全 no-op）</text>
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
import { ref, computed } from 'vue'
import { createPlatformAPI, createCapabilityHooks, createEngineering, createRouterEngineering, createAnimationEngineering } from '@proteus-vue/api'
import type { AnimationDriver } from '@proteus-vue/api'
// ★工程原语动画组件形态（E19 p-transition / E20 p-animate——Web 按需 import）
import { PTransition, PAnimate } from '@proteus-vue/components'

// ★业务侧统一平台 API 入口（演示用每页独立实例；生产建议模块级单例 / DI 注入）
const api = createPlatformAPI()
// ★G-32 能力 Hook 层（useXxx → Result<T>，无回调）——演示用每页独立实例
const cap = createCapabilityHooks()

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

// ---------- ⑤ 能力 Hook（G-32：useXxx → Result<T>，无回调） ----------
const capLog = ref('点击按钮调用能力 Hook')
function onCapDevice() {
  void cap.useDevice().then((r) => {
    capLog.value = r.ok ? `useDevice → ${r.data.platform} · ${r.data.model}` : `useDevice → Err(${r.error.code}) ${r.error.message}`
  })
}
function onCapNetwork() {
  void cap.useNetwork().then((r) => {
    capLog.value = r.ok ? `useNetwork → online=${r.data.online} · type=${r.data.type}` : `useNetwork → Err(${r.error.code})`
  })
}
function onCapClipboard() {
  void cap.useClipboard().then((r) => {
    capLog.value = r.ok ? `useClipboard → ${r.data.slice(0, 40)}` : `useClipboard → Err(${r.error.code}) ${r.error.message}`
  })
}
function onCapFetch() {
  // ★G-32 C26：wx.request → await useFetch(url)（迁移文档标题目标；demo 用 httpbin CORS 端点）
  void cap.useFetch<{ url: string }>('https://httpbin.org/get', { timeout: 8000 }).then((r) => {
    capLog.value = r.ok ? `useFetch → ${JSON.stringify(r.data).slice(0, 60)}` : `useFetch → Err(${r.error.code}) ${r.error.message}`
  })
}

// ---------- ⑥ 能力 Hook 三期（G-32 B3 续） ----------
const cap3Log = ref('点击按钮调用三期能力 Hook')
const auth = cap.useAuth() // ★C33 组合：token 托管 + login 桥 + storage 桥（业务不读 raw token）
function onCapSensor() {
  // ★C5：一次性读取（web 需设备授权；Node 无事件环境 → Err 降级）
  void cap.useSensor('accelerometer').then((r) => {
    cap3Log.value = r.ok ? `useSensor → ${JSON.stringify(r.data)}` : `useSensor → Err(${r.error.code}) ${r.error.message}`
  })
}
function onCapBiometric() {
  // ★C38：feature detection——web 无 WebAuthn → data:false
  void cap.useBiometric().then((r) => {
    cap3Log.value = r.ok ? `useBiometric → 支持=${r.data}` : `useBiometric → Err(${r.error.code})`
  })
}
function onCapAuth() {
  // ★C33：login 桥（wx.login / 第三方 provider）→ 存 token；无桥 → Err 降级
  void auth.login().then((r) => {
    cap3Log.value = r.ok ? `useAuth.login → token=${r.data} · 已登录=${auth.isAuthenticated}` : `useAuth.login → Err(${r.error.code}) ${r.error.message}`
  })
}
function onCapAuthLogout() {
  void auth.logout().then((r) => {
    cap3Log.value = r.ok ? `useAuth.logout → 已登出（token=${auth.token}）` : `useAuth.logout → Err(${r.error.code})`
  })
}
function onCapQR() {
  // ★C42：wx.scanCode 直通；web 无摄像头取流桥 → Err 降级（非抛异常）
  void cap.useQRCode().then((r) => {
    cap3Log.value = r.ok ? `useQRCode → ${r.data.slice(0, 40)}` : `useQRCode → Err(${r.error.code}) ${r.error.message}`
  })
}

// ---------- ⑦ 能力 Hook 四期（G-32 B3 续） ----------
const cap4Log = ref('点击按钮调用四期能力 Hook')
const analytics = cap.useAnalytics() // ★C34：句柄（web 无标准 → track 返回 Err）
const logger = cap.useLog() // ★C35：console + 上报
const fsHandle = cap.useFileSystem() // ★C43：wx FS / web 内存降级
function onCapWS() {
  // ★C27：wss 连接句柄（demo 用不存在的 echo 端点——验证连接流程/降级；web 无 WebSocket 支持则 Err）
  void cap.useWebSocket('wss://echo.example.invalid/ws').then((r) => {
    cap4Log.value = r.ok ? `useWebSocket → 已连接（send/close/on 可用）` : `useWebSocket → Err(${r.error.code}) ${r.error.message}`
  })
}
function onCapAnalytics() {
  void analytics.track('demo_click', { block: 7 }).then((r) => {
    cap4Log.value = r.ok ? 'useAnalytics → track ok（wx.reportEvent 已上报）' : `useAnalytics → Err(${r.error.code}) ${r.error.message}`
  })
}
function onCapLog() {
  void logger.log('proteus demo', { block: 7 }).then((r) => {
    cap4Log.value = r.ok ? 'useLog → console.log 已输出（可接上报链）' : `useLog → Err(${r.error.code})`
  })
}
function onCapFS() {
  // C43：写读往返（web 内存降级 / wx getFileSystemManager）
  void fsHandle.writeFile('/demo.txt', 'hello').then((w) => {
    if (!w.ok) {
      cap4Log.value = `useFileSystem → 写入 Err(${w.error.code})`
      return
    }
    void fsHandle.readFile('/demo.txt').then((r) => {
      cap4Log.value = r.ok ? `useFileSystem → /demo.txt = ${r.data}` : `useFileSystem → 读取 Err(${r.error.code})`
    })
  })
}

// ---------- ⑧ 能力 Hook 五期（G-32 B3 续） ----------
const cap5Log = ref('点击按钮调用五期能力 Hook')
const lifecycle = cap.useAppLifecycle() // ★C23：App 生命周期订阅句柄
function onCapNotification() {
  // ★C17：模板订阅授权（web Notification.requestPermission——需 HTTPS；wx requestSubscribeMessage）
  void cap.useNotification('demo_template_1').then((r) => {
    cap5Log.value = r.ok ? `useNotification → granted=${r.data.granted} status=${r.data.status}` : `useNotification → Err(${r.error.code}) ${r.error.message}`
  })
}
function onCapLifecycle() {
  // ★C23：订阅当前生命周期阶段
  let count = 0
  let log = ''
  const off = lifecycle.onShow(() => {
    count += 1
    log = `onShow ×${count}`
  })
  cap5Log.value = 'useAppLifecycle → 已订阅 onShow（当前 phase=' + lifecycle.phase + '）'
  // Web 端已触发过 load → 若 count 未涨说明 handler 尚未被调用，主动展示一次
  if (count === 0) {
    cap5Log.value = cap5Log.value + ' · 等待 visibilitychange 触发'
  }
  void log
  void off
}
function onCapContact() {
  // ★C19：wx.chooseContact 直通；web 无标准 → Err
  void cap.useContact().then((r) => {
    cap5Log.value = r.ok ? `useContact → ${r.data.map((c) => c.name).join(', ')}` : `useContact → Err(${r.error.code}) ${r.error.message}`
  })
}
function onCapCalendar() {
  // ★C20：wx.addPhoneCalendar 直通；web → Err
  void cap
    .useCalendar({ title: 'Proteus 演示', startTime: Date.now() + 3600_000 })
    .then((r) => {
      cap5Log.value = r.ok ? 'useCalendar → 已添加到系统日历' : `useCalendar → Err(${r.error.code}) ${r.error.message}`
    })
}
function onCapArchive() {
  // ★C44：wx.compressFile 直通；web → Err
  void cap.useArchive({ src: '/demo.png' }).then((r) => {
    cap5Log.value = r.ok ? 'useArchive → 压缩完成' : `useArchive → Err(${r.error.code}) ${r.error.message}`
  })
}
function onCapShortcut() {
  // ★C45：wx.addToDesktop 直通；web → Err
  void cap.useShortcut().then((r) => {
    cap5Log.value = r.ok ? 'useShortcut → 已添加快捷方式' : `useShortcut → Err(${r.error.code}) ${r.error.message}`
  })
}

// ---------- ⑨ 能力 Hook 六期（G-32 B3 续） ----------
const cap6Log = ref('点击按钮调用六期能力 Hook')
const pageLifecycle = cap.usePageLifecycle() // ★C24：页面生命周期订阅
const keyboardLifecycle = cap.useKeyboard() // ★C14：键盘生命周期（wx 真实 / web visualViewport 启发式）
function onCapPageLC() {
  // ★C24：订阅页面 onShow/onHide（web visibilitychange / wx onPageShow·onPageHide）
  let count = 0
  pageLifecycle.onShow(() => {
    count += 1
    cap6Log.value = `usePageLifecycle → onShow ×${count}`
  })
  cap6Log.value = 'usePageLifecycle → 已订阅 onShow（phase=' + pageLifecycle.phase + '）'
}
function onCapBt() {
  // ★C36：wx.openBluetoothAdapter 直通；web 特性探测（navigator.bluetooth）
  void cap.useBluetooth().then((r) => {
    cap6Log.value = r.ok ? `useBluetooth → available=${r.data.available} devices=${r.data.devices.length}` : `useBluetooth → Err(${r.error.code}) ${r.error.message}`
  })
}
function onCapNfc() {
  // ★C37：wx.getHCEState 直通；web NDEFReader 探测
  void cap.useNFC().then((r) => {
    cap6Log.value = r.ok ? `useNFC → supported=${r.data.supported} available=${r.data.available}` : `useNFC → Err(${r.error.code}) ${r.error.message}`
  })
}
function onCapCam() {
  // ★C1：wx.authorize scope.camera；web getUserMedia（需 HTTPS + 用户授权）
  void cap.useCamera().then((r) => {
    cap6Log.value = r.ok ? `useCamera → supported=${r.data.supported} granted=${r.data.granted}` : `useCamera → Err(${r.error.code}) ${r.error.message}`
  })
}
function onCapMic() {
  // ★C2：wx.authorize scope.record；web getUserMedia audio
  void cap.useMicrophone().then((r) => {
    cap6Log.value = r.ok ? `useMicrophone → supported=${r.data.supported} granted=${r.data.granted}` : `useMicrophone → Err(${r.error.code}) ${r.error.message}`
  })
}
function onCapKb() {
  // ★C14：订阅键盘高度变化（wx onKeyboardHeightChange / web visualViewport）
  keyboardLifecycle.onChange((info) => {
    cap6Log.value = `useKeyboard → height=${info.height} visible=${info.visible}`
  })
  cap6Log.value = `useKeyboard → 已订阅（当前 height=${keyboardLifecycle.info.height}）`
}

// ---------- ⑩ 工程原语（G-32 B5：injectable reactivity） ----------
const eng = createEngineering({
  reactivity: { ref, computed, watch: () => () => undefined },
  paramSource: () => ({ demoId: '42', demoKey: 'hello' }),
}) // ★useState=ref / useComputed=computed；watch 演示页不注入（测试覆盖），lifecycle 缺省
const engCount = eng.useState(0)
const engDouble = eng.useComputed(() => engCount.value * 2)
const engLog = ref('点击按钮演示工程原语')
function onEngInc() {
  engCount.value += 1
  engLog.value = `useState → count=${engCount.value} · useComputed → double=${engDouble.value}`
}
function onEngLog() {
  engLog.value = `useState → count=${engCount.value} · useComputed → double=${engDouble.value}`
}
function onEngParam() {
  const id = eng.usePageParam('demoId')
  const key = eng.usePageParam('demoKey')
  engLog.value = `usePageParam → demoId=${id.value} · demoKey=${key.value}`
}

// ---------- ⑪ 路由语义化（G-32 B5 续：createRouterEngineering——mock 录制调用，不真实导航） ----------
const routeLog = ref('点击按钮演示路由语义化（mock router 录制调用）')
const rx = createRouterEngineering({
  router: {
    push: (target) => {
      routeLog.value = `mockRouter.push → ${JSON.stringify(target)}`
      return Promise.resolve()
    },
    back: (delta) => {
      routeLog.value = `mockRouter.back → delta=${delta}`
    },
  },
  reactivity: { ref, computed, watch: () => () => undefined },
  getCurrentRoute: () => ({ path: '/pages/platform-api-demo/index', name: 'platform-api-demo' }),
}) // ★E11-E15 语义委托 mock router 录制（不真实导航）；E10 useRoute 读注入源；E16/E17 守卫委托缺省安全
const currentRoute = rx.useRoute()
function onRoutePush() {
  rx.push({ name: 'showcase', params: { id: 42 } })
}
function onRouteReplace() {
  rx.replace({ path: '/pages/demo/showcase' })
}
function onRouteBack() {
  rx.back(1)
}
function onRouteTab() {
  rx.switchTab({ path: '/pages/demo/home' })
}
function onRouteRelanch() {
  rx.reLaunch({ path: '/pages/demo/entry' })
}
function onRouteRead() {
  const cur = currentRoute.value
  routeLog.value = cur ? `useRoute → path=${cur.path} · name=${cur.name}` : 'useRoute → undefined（未注入当前路由源）'
}

// ---------- ⑫ 动画语义（G-32 B5 续二：E19 p-transition / E20 p-animate / E21-E23 useXxx 注入式） ----------
const anim = createAnimationEngineering({
  reactivity: { ref, computed, watch: () => () => undefined },
  driver: typeof document !== 'undefined' ? createWebAnimationDriver() : undefined,
}) // ★E21-E23 语义面：构建器/句柄产出 AnimationDescriptor；driver 注入 Web WAAPI（MP/SSR 无 document → no-op）
const animVisible = ref(true)
const animLog = ref('点击按钮演示动画语义（web 端 WAAPI 真实播放；MP 走组件 CSS 声明）')
// E22/E23 持久句柄（手势会话 / 滚动进度跨调用保持）
const gestureAnim = anim.useGestureAnimation()
const scrollAnim = anim.useScrollAnimation({
  from: { opacity: 1, y: 0 },
  to: { opacity: 0.2, y: -60 },
})

// ★Web-only 驱动（demo 页非组件不受 no-platform-api 审计约束）：script 顶层 typeof document 守卫——MP 逻辑层无 document → undefined
//   ★MP 编译安全：返回类型标注在函数声明上（contextual typing——对象字面量内 arrow 不写内联类型标注，避 #307 坑）
function createWebAnimationDriver(): AnimationDriver {
  return {
    run: (target, descriptor) => {
      const el = target as HTMLElement
      const frames = descriptor.keyframes.map((k) => {
        const f: Record<string, string | number> = { offset: k.offset, easing: k.easing ?? 'ease' }
        const ops: string[] = []
        if (k.props.x !== undefined) ops.push(`translateX(${k.props.x}px)`)
        if (k.props.y !== undefined) ops.push(`translateY(${k.props.y}px)`)
        if (k.props.scale !== undefined) ops.push(`scale(${k.props.scale})`)
        if (k.props.rotate !== undefined) ops.push(`rotate(${k.props.rotate}deg)`)
        if (k.props.opacity !== undefined) f.opacity = String(k.props.opacity)
        if (ops.length > 0) f.transform = ops.join(' ')
        return f
      })
      const wa = el.animate(frames, {
        duration: descriptor.duration,
        easing: descriptor.timingFunction,
        delay: descriptor.delay,
        iterations: descriptor.iterations,
        fill: 'forwards',
      })
      return {
        play: () => wa.play(),
        pause: () => wa.pause(),
        reverse: () => wa.reverse(),
        cancel: () => wa.cancel(),
        finish: () => wa.finish(),
        seek: (t) => {
          wa.currentTime = t
        },
        onFinish: (cb) => {
          wa.onfinish = () => cb()
        },
      }
    },
  }
}

function onAnimToggle() {
  animVisible.value = !animVisible.value
  animLog.value = `p-transition → visible=${animVisible.value}（CSS 类切换显隐过渡）`
}
function onAnimRun() {
  if (typeof document === 'undefined') {
    animLog.value = 'useAnimation → 无 document（MP 逻辑层）——组件 CSS 声明承担动画'
    return
  }
  const stage = document.querySelector('.pad-anim-stage')
  const c = anim.useAnimation({ duration: 400 })
  c.set({ opacity: 0, x: 0 }).step()
  c.set({ opacity: 1, x: 120, rotate: 30 }).step({ duration: 500 })
  c.set({ x: 0, rotate: 0 }).step({ duration: 400 })
  const run = c.play(stage)
  animLog.value = run ? `useAnimation → 3 步关键帧播放（state=${c.state.value}；末帧 rotate=0 回位）` : 'useAnimation → 无 driver 安全 no-op'
}
function onAnimGesture() {
  gestureAnim.reset()
  gestureAnim.apply({ x: 20 })
  gestureAnim.commit({ duration: 200 })
  gestureAnim.apply({ x: 60, rotate: 12 })
  gestureAnim.commit({ duration: 200 })
  const d = gestureAnim.export()
  animLog.value = `useGestureAnimation → ${d.keyframes.length} 关键帧（手势增量 x=60 · rotate=12 累积）· state=${gestureAnim.state.value}`
}
function onAnimScroll() {
  scrollAnim.setProgress(0)
  const v0 = scrollAnim.value()
  scrollAnim.setProgress(0.5)
  const v50 = scrollAnim.value()
  scrollAnim.setProgress(1)
  const v100 = scrollAnim.value()
  animLog.value = `useScrollAnimation → p=0.5 插值 y=${v50.y}·opacity=${v50.opacity}（0：y=${v0.y}·o=${v0.opacity} → 1：y=${v100.y}·o=${v100.opacity}）`
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
/* ⑫ 动画语义舞台（useAnimation WAAPI 播放目标） */
.pad-anim-stage {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 88px;
  margin: 8px 0;
  border: 1px dashed rgba(26, 122, 248, 0.35);
  border-radius: 8px;
  background: rgba(26, 122, 248, 0.06);
}
.pad-anim-box {
  display: inline-block;
  padding: 10px 22px;
  border-radius: 8px;
  background: linear-gradient(135deg, #1a7af8, #7b5ce0);
  color: #fff;
  font-size: 16px;
  font-weight: 700;
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
