<!-- showcase/subpackages/components/pages/p-media.vue —— p-media 媒体 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-media.md ← gen-content.mjs ← packages/components/p-media/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PMedia, PText, PView } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  image: "<p-media kind=\"image\" src=\"…\" />",
  video: "<p-media kind=\"video\" src=\"…\" :poster=\"cover\" controls object-fit=\"contain\" />",
  ctrl: "<p-media kind=\"video\" :show-center-play-btn=\"false\" :show-fullscreen-btn=\"false\" />",
  live: "<p-media kind=\"live\" src=\"…\" is-live />",
})

// ★字面量直接内联进 ref()（编译器静态求值：标识符初值 → data undefined，见 S33/S57）
const cover = ref('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMjAiIGhlaWdodD0iMTgwIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjMjIyMjI2Ii8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZpbGw9IiNmZmYiIGZvbnQtc2l6ZT0iMTYiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuMzVlbSI+5bCB6Z2iPC90ZXh0Pjwvc3ZnPg==')
const state = ref('等待播放事件…')
function onPlay() { state.value = '▶ play 事件（播放中）' }
function onPause() { state.value = '⏸ pause 事件（已暂停）' }
function onEnded() { state.value = '⏹ ended 事件（播放结束）' }

const apiRows = ref([
  [
    "kind",
    "媒体类型：image / video / audio / live",
    "String"
  ],
  [
    "src",
    "资源地址（★官方 video src）",
    "String"
  ],
  [
    "duration",
    "指定视频时长（★官方 duration）",
    "Number"
  ],
  [
    "controls",
    "显示控制条（★官方 controls）",
    "Boolean"
  ],
  [
    "danmuList",
    "弹幕列表（★官方 danmu-list）",
    "Array as () => Record<string"
  ],
  [
    "danmuBtn",
    "显示弹幕按钮（★官方 danmu-btn，仅初始化有效）",
    "Boolean"
  ],
  [
    "enableDanmu",
    "展示弹幕（★官方 enable-danmu，仅初始化有效）",
    "Boolean"
  ],
  [
    "autoplay",
    "自动播放（★官方 autoplay）",
    "Boolean"
  ],
  [
    "loop",
    "循环（★官方 loop）",
    "Boolean"
  ],
  [
    "muted",
    "静音（★官方 muted）",
    "Boolean"
  ],
  [
    "initialTime",
    "初始播放位置（★官方 initial-time）",
    "Number"
  ],
  [
    "pageGesture",
    "非全屏下开启亮度/音量手势（★官方 page-gesture，已废弃）",
    "Boolean"
  ],
  [
    "direction",
    "全屏方向（★官方 direction，不指定按宽高比自动判断）",
    "Number"
  ],
  [
    "showProgress",
    "显示进度条（★官方 show-progress）",
    "Boolean"
  ],
  [
    "showFullscreenBtn",
    "显示全屏按钮（★官方 show-fullscreen-btn）",
    "Boolean"
  ],
  [
    "showPlayBtn",
    "显示底部控制栏播放按钮（★官方 show-play-btn）",
    "Boolean"
  ],
  [
    "showCenterPlayBtn",
    "显示中间播放按钮（★官方 show-center-play-btn）",
    "Boolean"
  ],
  [
    "enableProgressGesture",
    "开启控制进度手势（★官方 enable-progress-gesture）",
    "Boolean"
  ],
  [
    "objectFit",
    "视频与容器尺寸不一致时的表现（★官方 object-fit：contain/fill/cover）",
    "String"
  ],
  [
    "poster",
    "封面图（★官方 poster）",
    "String"
  ],
  [
    "showMuteBtn",
    "显示静音按钮（★官方 show-mute-btn）",
    "Boolean"
  ],
  [
    "title",
    "视频标题（全屏顶部展示，★官方 title）",
    "String"
  ],
  [
    "playBtnPosition",
    "播放按钮位置（★官方 play-btn-position）",
    "String"
  ],
  [
    "enablePlayGesture",
    "双击切换播放/暂停手势（★官方 enable-play-gesture）",
    "Boolean"
  ],
  [
    "autoPauseIfNavigate",
    "跳转本小程序其他页时自动暂停（★官方 auto-pause-if-navigate）",
    "Boolean"
  ],
  [
    "autoPauseIfOpenNative",
    "跳转微信原生页时自动暂停（★官方 auto-pause-if-open-native）",
    "Boolean"
  ],
  [
    "vslideGesture",
    "非全屏下亮度/音量手势（★官方 vslide-gesture）",
    "Boolean"
  ],
  [
    "vslideGestureInFullscreen",
    "全屏下亮度/音量手势（★官方 vslide-gesture-in-fullscreen）",
    "Boolean"
  ],
  [
    "showBottomProgress",
    "展示底部进度条（★官方 show-bottom-progress）",
    "Boolean"
  ],
  [
    "adUnitId",
    "视频前贴广告单元 id（★官方 ad-unit-id）",
    "String"
  ],
  [
    "posterForCrawler",
    "搜索引擎封面图（★官方 poster-for-crawler，仅网络地址）",
    "String"
  ],
  [
    "showCastingButton",
    "显示投屏按钮（★官方 show-casting-button）",
    "Boolean"
  ],
  [
    "pictureInPictureMode",
    "小窗模式：push / pop（可数组，★官方 picture-in-picture-mode）",
    "[String, Array] as unknown as () => string | string[]"
  ],
  [
    "pictureInPictureShowProgress",
    "小窗模式下显示播放进度（★官方 picture-in-picture-show-progress）",
    "Boolean"
  ],
  [
    "pictureInPictureInitPosition",
    "小窗初始显示位置（★官方 picture-in-picture-init-position）",
    "String"
  ],
  [
    "enableSystemPip",
    "支持 iOS 系统画中画（★官方 enable-system-pip）",
    "Boolean"
  ],
  [
    "enableAutoRotation",
    "手机横屏自动全屏（★官方 enable-auto-rotation）",
    "Boolean"
  ],
  [
    "showScreenLockButton",
    "显示锁屏按钮（★官方 show-screen-lock-button）",
    "Boolean"
  ],
  [
    "showSnapshotButton",
    "显示截屏按钮（★官方 show-snapshot-button）",
    "Boolean"
  ],
  [
    "showBackgroundPlaybackButton",
    "展示后台小窗播放按钮（★官方 show-background-playback-button）",
    "Boolean"
  ],
  [
    "backgroundPoster",
    "后台小窗播放通知栏图标（Android，★官方 background-poster）",
    "String"
  ],
  [
    "referrerPolicy",
    "防盗链 referrer 策略（★官方 referrer-policy）",
    "String"
  ],
  [
    "isDrm",
    "是否 DRM 视频源（★官方 is-drm）",
    "Boolean"
  ],
  [
    "isLive",
    "是否直播源（★官方 is-live）",
    "Boolean"
  ],
  [
    "provisionUrl",
    "DRM 设备身份认证 url（Android，★官方 provision-url）",
    "String"
  ],
  [
    "certificateUrl",
    "DRM 设备身份认证 url（iOS，★官方 certificate-url）",
    "String"
  ],
  [
    "licenseUrl",
    "DRM 获取加密信息 url（★官方 license-url）",
    "String"
  ],
  [
    "preferredPeakBitRate",
    "码率上界 bps（★官方 preferred-peak-bit-rate）",
    "Number"
  ],
  [
    "width",
    "宽 px（0=自适应）",
    "Number"
  ],
  [
    "height",
    "高 px（0=自适应）",
    "Number"
  ]
])
const eventRows = ref([
  [
    "play",
    "—",
    "—"
  ],
  [
    "pause",
    "—",
    "—"
  ],
  [
    "ended",
    "—",
    "—"
  ],
  [
    "timeupdate",
    "—",
    "—"
  ],
  [
    "fullscreenchange",
    "—",
    "—"
  ],
  [
    "waiting",
    "—",
    "—"
  ],
  [
    "error",
    "加载/执行失败",
    "—"
  ],
  [
    "progress",
    "—",
    "—"
  ],
  [
    "loadedmetadata",
    "—",
    "—"
  ],
  [
    "controlstoggle",
    "—",
    "—"
  ]
])
const slotRows = ref([
  [
    "—",
    "无插槽",
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
    "skyline（WebView 降级） · 原生控件映射 → <audio>（L1 原语） · <video>（L1 原语） · <live-player>（L1 原语） · <live-pusher>（L1 原语）"
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
  <page-shell title="p-media 媒体" subtitle="内容基元 · image / video / audio / live 统一入口">
    <demo-block index="01" title="图片" desc="kind=image 走图片分支（等价 p-image 的宽满自适应）" :has-output="false" :code="codes.image">
      <template #demo>
        <p-view class="frame"><p-media kind="image" :src="cover" /></p-view>
      </template>
    </demo-block>

    <demo-block index="02" title="视频与播放事件" desc="controls/object-fit/poster 透传；播放状态经事件回显（★浏览器自动播放策略可能需先点击）" :has-output="true" :code="codes.video">
      <template #demo>
        <p-view class="frame"><p-media kind="video" :src="''" :poster="cover" controls object-fit="contain" @play="onPlay" @pause="onPause" @ended="onEnded" /></p-view>
      </template>
      <template #output>
        <p-text class="out">{{ state }}</p-text>
      </template>
    </demo-block>

    <demo-block index="03" title="控件显隐族" desc="show-center-play-btn / show-fullscreen-btn 等控制原生控件显示" :has-output="false" :code="codes.ctrl">
      <template #demo>
        <p-view class="frame"><p-media kind="video" :src="''" :poster="cover" :show-center-play-btn="false" :show-fullscreen-btn="false" /></p-view>
      </template>
    </demo-block>

    <demo-block index="04" title="直播源" desc="kind=live + is-live（★官方 is-live；MP 端原生 video 承接）" :has-output="false" :code="codes.live">
      <template #demo>
        <p-view class="frame"><p-media kind="live" :src="''" :poster="cover" :is-live="true" /></p-view>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<style scoped>
.frame { width: 320px; max-width: 100%; border-radius: var(--sp-radius-sm); overflow: hidden; }
.out { display: block; font-size: 12.5px; color: #2f7a4d; }
</style>
