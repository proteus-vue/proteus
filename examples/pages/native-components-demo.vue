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

// 地图标记（对齐小程序 markers）
const markers = ref([
  { id: 1, latitude: 39.908823, longitude: 116.39747, title: '天安门' },
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

    <!-- 验证点 ③：内嵌网页（真机需业务域名；DevTools 可关校验） -->
    <h3>p-webview（&lt;web-view&gt;）</h3>
    <p-webview src="https://developers.weixin.qq.com/" :height="240" />

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
.stat {
  display: block;
  color: #666;
  font-size: 13px;
  margin: 8px 0 4px;
}
.kb-row {
  display: flex;
  gap: 8px;
  padding: 6px 0;
}
</style>
