<!-- examples/pages/native-components-demo.vue —— 原生/宿主能力组件演示（★真机验收 2026-09-12）
     p-camera（相机）/ p-map（地图）/ p-webview（内嵌网页）/ p-ad（广告位）/ p-keyboard-accessory（键盘工具栏）
     ★诚实边界（真机验收须知）：
       - camera/map：DevTools 模拟器可渲染；真机需相机/定位权限（首次弹授权）
       - web-view：需在微信后台配置**业务域名**（否则真机报「非业务域名」）；DevTools 可勾选「不校验合法域名」
       - ad：需在微信后台创建**广告单元**并填入真实 adUnitId（示例 unitId 无效，真机不展示广告属预期）
       - keyboard-accessory：需真机（键盘弹起），模拟器不可见
     本页价值：驱动 MP 产物生成 + 组件注册 + 真机逐项对照（见本页各节「验证点」注释） -->
<script setup lang="ts">
import { ref } from 'vue'
import { PView, PText, PButton, PInput, PKeyboardAccessory } from '@proteus-vue/components'
import { PCamera, PMap, PWebview, PAd } from '@proteus-vue/components'

const camReady = ref(false)
const camError = ref('')
const mapTapCount = ref(0)
const adLoaded = ref(false)
const adError = ref('')
const webviewMsg = ref('')
const webviewErr = ref('')
// web-view 源切换：本地静态 HTML / 远程官网（★平台限制：一页仅一个 <web-view>，故二选一）
// ★注意：不要写 ref<'local'|'remote'>('local')——编译器对带泛型实参的 ref() 无法静态求值初值
//   （会令 data.srcMode = undefined → 首帧 wx:if 判空错走远程分支）；用无泛型 ref，读取处比较即可。
const srcMode = ref('local')

// 地图标记（对齐小程序 markers；★width/height 必填，否则 DevTools 报「width and height of marker id ... are required」）
const markers = ref([
  { id: 1, latitude: 39.908823, longitude: 116.39747, title: '天安门', width: 32, height: 32 },
])

function onCamReady() {
  camReady.value = true
}
function onCamError(e: unknown) {
  camError.value = typeof e === 'string' ? e : '相机初始化失败'
}
function onMarkerTap() {
  mapTapCount.value++
}
function onAdLoad() {
  adLoaded.value = true
}
function onAdError(e: { errMsg?: string } | unknown) {
  adError.value = (e as { errMsg?: string })?.errMsg ?? '广告加载失败（需真实 adUnitId）'
}
// web-view 消息（H5 内 postMessage → @message）与错误
function onWebviewMessage(e: unknown) {
  const d = (e as { detail?: { data?: unknown } })?.detail?.data ?? e
  webviewMsg.value = JSON.stringify(d)
}
function onWebviewError(e: { errMsg?: string } | unknown) {
  webviewErr.value = (e as { errMsg?: string })?.errMsg ?? 'web-view 加载失败'
}
</script>

<template>
  <div class="ncd">
    <h2>原生/宿主能力组件</h2>
    <p class="sub">camera / map / web-view / ad / keyboard-accessory（对齐小程序内置组件）</p>

    <!-- 验证点 ①：相机预览渲染 + initdone 回调（真机需授权） -->
    <h3>p-camera（&lt;camera&gt;）</h3>
    <p-camera :device-position="'back'" :flash="'off'" :height="240" @initdone="onCamReady" @error="onCamError" />
    <p-text class="stat">相机就绪：{{ camReady ? '是' : '否' }}{{ camError ? ' · ' + camError : '' }}</p-text>

    <!-- 验证点 ②：地图渲染 + 标记 + markertap 事件 -->
    <h3>p-map（&lt;map&gt;）</h3>
    <p-map :latitude="39.908823" :longitude="116.39747" :scale="14" :markers="markers" :height="240" @markertap="onMarkerTap" />
    <p-text class="stat">标记点击次数：{{ mapTapCount }}</p-text>

    <!-- 验证点 ③：内嵌网页——本地静态 HTML / 远程官网（proteus-vue.cn）二选一切换
         ★平台硬约束 ①：官方规定 <web-view> **一个页面只能插入一个**（否则 DevTools 报「一个页面只能插入一个」、
           区域渲染空白）→ 此处用 v-if 二选一，保证同一时刻 DOM 中只有一个 <web-view>。
         ★平台硬约束 ②（真机实测确认）：小程序 <web-view> 的 src **必须是 https 业务域名内的网页**，
           **不支持加载小程序包内的本地 HTML**——实测 raw `<web-view src="/x.html">` 与 `data:text/html` URI
           在模拟器/真机均渲染空白（对照：远程 https 正常渲染）。故「本地网页」在 MP 端只能诚实占位（组件内建）；
           Web 端 <iframe> 不受此限，本地相对路径可正常加载。
         ★诚实前提：远程 src 真机需在后台配 **业务域名**；DevTools 可勾选「不校验合法域名、web-view（业务域名）」直接验证。 -->
    <h3>p-webview（&lt;web-view&gt;）</h3>
    <div class="seg">
      <p-button class="seg__btn" @click="srcMode = 'local'">本地网页{{ srcMode === 'local' ? ' ✓' : '' }}</p-button>
      <p-button class="seg__btn" @click="srcMode = 'remote'">远程官网{{ srcMode === 'remote' ? ' ✓' : '' }}</p-button>
    </div>
    <p-text class="hint">{{ srcMode === 'local' ? 'src=/webview-local.html（包内本地 HTML）——Web 端 iframe 可加载；MP 端原生 web-view 平台限制仅支持 https 业务域名（下方为诚实占位）' : 'src=https://proteus-vue.cn（远程官网）——两端均可（真机需配业务域名 / DevTools 关校验）' }}</p-text>
    <p-webview v-if="srcMode === 'local'" src="/webview-local.html" :height="200" @message="onWebviewMessage" @error="onWebviewError" />
    <p-webview v-else src="https://proteus-vue.cn/" :height="200" @message="onWebviewMessage" @error="onWebviewError" />
    <p-text class="stat">web-view 消息：{{ webviewMsg || '（未收到，点本地页按钮试）' }}{{ webviewErr ? ' · ' + webviewErr : '' }}</p-text>

    <!-- 验证点 ④：广告位（需真实 adUnitId；示例 id 真机不展示广告属预期，load/error 事件可见） -->
    <h3>p-ad（&lt;ad&gt;）</h3>
    <p-ad unit-id="adunit-demo-placeholder" :height="120" @load="onAdLoad" @error="onAdError" />
    <p-text class="stat">广告加载：{{ adLoaded ? '成功' : '未加载' }}{{ adError ? ' · ' + adError : '' }}</p-text>

    <!-- 验证点 ⑤：键盘工具栏（需真机 + 聚焦输入框） -->
    <h3>p-keyboard-accessory（&lt;keyboard-accessory&gt;）</h3>
    <p-input placeholder="点我聚焦 → 真机查看键盘上方工具栏" />
    <p-keyboard-accessory>
      <p-view class="kb-row">
        <p-button>工具 A</p-button>
        <p-button>工具 B</p-button>
      </p-view>
    </p-keyboard-accessory>
  </div>
</template>

<style scoped>
.ncd {
  padding: 24px;
}
.sub {
  color: #888;
  font-size: 13px;
  margin-bottom: 16px;
}
h3 {
  margin: 20px 0 8px;
  font-size: 15px;
}
.hint {
  display: block;
  color: #999;
  font-size: 12px;
  margin: 2px 0 8px;
}
.stat {
  display: block;
  color: #666;
  font-size: 13px;
  margin: 8px 0 4px;
}
.seg {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
.kb-row {
  display: flex;
  gap: 8px;
  padding: 6px 0;
}
</style>
