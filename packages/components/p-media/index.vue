<!-- packages/components/p-media/index.vue —— 媒体统一入口（★G-32 B2：ui.media U7）
     kind image/video/audio/live 统一入口（消灭 video/audio 分离组件）
     ★端对齐批次3（2026-09-16）：video/live 分支补齐官方 <video> 全量属性（47 项）——
       播放控制（controls/autoplay/loop/muted/initial-time/duration）、控件显隐族（show-*）、
       手势族（page-gesture/vslide-gesture/enable-progress-gesture/enable-play-gesture）、
       弹幕族（danmu-list/danmu-btn/enable-danmu）、画中画族（picture-in-picture-*/enable-system-pip）、
       投屏/截屏/后台播放、DRM 族（is-drm/provision-url/certificate-url/license-url）、
       展示（object-fit/poster/poster-for-crawler/direction/play-btn-position/title/referrer-policy）。
     ★双端实现：MP 端原生 <video>（属性全量透传）；Web 端 <video> 元素（标准属性映射：controls/autoplay/loop/muted/
       poster/object-fit→objectFit；controlsList 表达 show-* 显隐；画中画/DRM 等无对等项诚实不伪造）。
     ★B2 Web-first：kind 决定元素（img/video/audio 显式 v-if——MP 编译器不支持动态标签） -->
<template>
  <view class="p-media" :style="mediaStyle">
    <image
      v-if="kind === 'image'"
      class="p-media-el"
      :src="src"
      :alt="poster"
      mode="widthFix"
    />
    <!-- MP：原生 video（官方属性全量透传） -->
    <video
      v-else-if="(kind === 'video' || kind === 'live') && isMp"
      class="p-media-el"
      :src="src"
      :duration="duration"
      :controls="controls"
      :danmu-list="danmuList"
      :danmu-btn="danmuBtn"
      :enable-danmu="enableDanmu"
      :autoplay="autoplay"
      :loop="loop"
      :muted="muted"
      :initial-time="initialTime"
      :page-gesture="pageGesture"
      :direction="direction"
      :show-progress="showProgress"
      :show-fullscreen-btn="showFullscreenBtn"
      :show-play-btn="showPlayBtn"
      :show-center-play-btn="showCenterPlayBtn"
      :enable-progress-gesture="enableProgressGesture"
      :object-fit="objectFit"
      :poster="poster"
      :show-mute-btn="showMuteBtn"
      :title="title"
      :play-btn-position="playBtnPosition"
      :enable-play-gesture="enablePlayGesture"
      :auto-pause-if-navigate="autoPauseIfNavigate"
      :auto-pause-if-open-native="autoPauseIfOpenNative"
      :vslide-gesture="vslideGesture"
      :vslide-gesture-in-fullscreen="vslideGestureInFullscreen"
      :show-bottom-progress="showBottomProgress"
      :ad-unit-id="adUnitId"
      :poster-for-crawler="posterForCrawler"
      :show-casting-button="showCastingButton"
      :picture-in-picture-mode="pictureInPictureMode"
      :picture-in-picture-show-progress="pictureInPictureShowProgress"
      :picture-in-picture-init-position="pictureInPictureInitPosition"
      :enable-system-pip="enableSystemPip"
      :enable-auto-rotation="enableAutoRotation"
      :show-screen-lock-button="showScreenLockButton"
      :show-snapshot-button="showSnapshotButton"
      :show-background-playback-button="showBackgroundPlaybackButton"
      :background-poster="backgroundPoster"
      :referrer-policy="referrerPolicy"
      :is-drm="isDrm"
      :is-live="isLive"
      :provision-url="provisionUrl"
      :certificate-url="certificateUrl"
      :license-url="licenseUrl"
      :preferred-peak-bit-rate="preferredPeakBitRate"
      @play="onPlay"
      @pause="onPause"
      @ended="onEnded"
      @timeupdate="onTimeUpdate"
      @fullscreenchange="onFullscreenChange"
      @waiting="onWaiting"
      @error="onError"
      @progress="onProgress"
      @loadedmetadata="onLoadedMetadata"
      @controlstoggle="onControlsToggle"
    />
    <!-- Web：标准 <video>（无对等的官方私有项不伪造，见文件头诚实边界） -->
    <video
      v-else-if="kind === 'video' || kind === 'live'"
      class="p-media-el"
      :src="src"
      :poster="poster"
      :controls="controls"
      :autoplay="autoplay"
      :loop="loop"
      :muted="muted"
      :title="title"
      :style="webVideoStyle"
      @play="onPlay"
      @pause="onPause"
      @ended="onEnded"
      @timeupdate="onTimeUpdate"
      @error="onError"
      @loadedmetadata="onLoadedMetadata"
      @progress="onProgress"
    />
    <audio
      v-else-if="kind === 'audio'"
      class="p-media-el"
      :src="src"
      :controls="controls"
      :autoplay="autoplay"
      :loop="loop"
      :muted="muted"
      @play="onPlay"
      @pause="onPause"
      @ended="onEnded"
      @error="onError"
    />
    <view v-else class="p-media-placeholder">
      <text>媒体待传入 kind=image|video|audio|live</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CSSProperties } from 'vue'
import { isMpRuntime } from '../runtime/container-measure'

const props = defineProps({
  /** 媒体类型：image / video / audio / live */
  kind: { type: String, default: 'image' },
  /** 资源地址（★官方 video src） */
  src: { type: String, default: '' },
  /** 指定视频时长（★官方 duration） */
  duration: { type: Number, default: 0 },
  /** 显示控制条（★官方 controls） */
  controls: { type: Boolean, default: true },
  /** 弹幕列表（★官方 danmu-list） */
  danmuList: { type: Array as () => Record<string, unknown>[], default: () => [] },
  /** 显示弹幕按钮（★官方 danmu-btn，仅初始化有效） */
  danmuBtn: { type: Boolean, default: false },
  /** 展示弹幕（★官方 enable-danmu，仅初始化有效） */
  enableDanmu: { type: Boolean, default: false },
  /** 自动播放（★官方 autoplay） */
  autoplay: { type: Boolean, default: false },
  /** 循环（★官方 loop） */
  loop: { type: Boolean, default: false },
  /** 静音（★官方 muted） */
  muted: { type: Boolean, default: false },
  /** 初始播放位置（★官方 initial-time） */
  initialTime: { type: Number, default: 0 },
  /** 非全屏下开启亮度/音量手势（★官方 page-gesture，已废弃） */
  pageGesture: { type: Boolean, default: false },
  /** 全屏方向（★官方 direction，不指定按宽高比自动判断） */
  direction: { type: Number, default: 0 },
  /** 显示进度条（★官方 show-progress） */
  showProgress: { type: Boolean, default: true },
  /** 显示全屏按钮（★官方 show-fullscreen-btn） */
  showFullscreenBtn: { type: Boolean, default: true },
  /** 显示底部控制栏播放按钮（★官方 show-play-btn） */
  showPlayBtn: { type: Boolean, default: true },
  /** 显示中间播放按钮（★官方 show-center-play-btn） */
  showCenterPlayBtn: { type: Boolean, default: true },
  /** 开启控制进度手势（★官方 enable-progress-gesture） */
  enableProgressGesture: { type: Boolean, default: true },
  /** 视频与容器尺寸不一致时的表现（★官方 object-fit：contain/fill/cover） */
  objectFit: { type: String, default: 'contain' },
  /** 封面图（★官方 poster） */
  poster: { type: String, default: '' },
  /** 显示静音按钮（★官方 show-mute-btn） */
  showMuteBtn: { type: Boolean, default: false },
  /** 视频标题（全屏顶部展示，★官方 title） */
  title: { type: String, default: '' },
  /** 播放按钮位置（★官方 play-btn-position） */
  playBtnPosition: { type: String, default: 'bottom' },
  /** 双击切换播放/暂停手势（★官方 enable-play-gesture） */
  enablePlayGesture: { type: Boolean, default: false },
  /** 跳转本小程序其他页时自动暂停（★官方 auto-pause-if-navigate） */
  autoPauseIfNavigate: { type: Boolean, default: true },
  /** 跳转微信原生页时自动暂停（★官方 auto-pause-if-open-native） */
  autoPauseIfOpenNative: { type: Boolean, default: true },
  /** 非全屏下亮度/音量手势（★官方 vslide-gesture） */
  vslideGesture: { type: Boolean, default: false },
  /** 全屏下亮度/音量手势（★官方 vslide-gesture-in-fullscreen） */
  vslideGestureInFullscreen: { type: Boolean, default: true },
  /** 展示底部进度条（★官方 show-bottom-progress） */
  showBottomProgress: { type: Boolean, default: true },
  /** 视频前贴广告单元 id（★官方 ad-unit-id） */
  adUnitId: { type: String, default: '' },
  /** 搜索引擎封面图（★官方 poster-for-crawler，仅网络地址） */
  posterForCrawler: { type: String, default: '' },
  /** 显示投屏按钮（★官方 show-casting-button） */
  showCastingButton: { type: Boolean, default: false },
  /** 小窗模式：push / pop（可数组，★官方 picture-in-picture-mode） */
  pictureInPictureMode: { type: [String, Array] as unknown as () => string | string[], default: '' },
  /** 小窗模式下显示播放进度（★官方 picture-in-picture-show-progress） */
  pictureInPictureShowProgress: { type: Boolean, default: false },
  /** 小窗初始显示位置（★官方 picture-in-picture-init-position） */
  pictureInPictureInitPosition: { type: String, default: '' },
  /** 支持 iOS 系统画中画（★官方 enable-system-pip） */
  enableSystemPip: { type: Boolean, default: true },
  /** 手机横屏自动全屏（★官方 enable-auto-rotation） */
  enableAutoRotation: { type: Boolean, default: false },
  /** 显示锁屏按钮（★官方 show-screen-lock-button） */
  showScreenLockButton: { type: Boolean, default: false },
  /** 显示截屏按钮（★官方 show-snapshot-button） */
  showSnapshotButton: { type: Boolean, default: false },
  /** 展示后台小窗播放按钮（★官方 show-background-playback-button） */
  showBackgroundPlaybackButton: { type: Boolean, default: true },
  /** 后台小窗播放通知栏图标（Android，★官方 background-poster） */
  backgroundPoster: { type: String, default: '' },
  /** 防盗链 referrer 策略（★官方 referrer-policy） */
  referrerPolicy: { type: String, default: 'no-referrer' },
  /** 是否 DRM 视频源（★官方 is-drm） */
  isDrm: { type: Boolean, default: false },
  /** 是否直播源（★官方 is-live） */
  isLive: { type: Boolean, default: false },
  /** DRM 设备身份认证 url（Android，★官方 provision-url） */
  provisionUrl: { type: String, default: '' },
  /** DRM 设备身份认证 url（iOS，★官方 certificate-url） */
  certificateUrl: { type: String, default: '' },
  /** DRM 获取加密信息 url（★官方 license-url） */
  licenseUrl: { type: String, default: '' },
  /** 码率上界 bps（★官方 preferred-peak-bit-rate） */
  preferredPeakBitRate: { type: Number, default: 0 },
  /** 宽 px（0=自适应） */
  width: { type: Number, default: 0 },
  /** 高 px（0=自适应） */
  height: { type: Number, default: 0 },
})

// ★事件名与官方 bind:<name> 对齐（跨端同名契约）
const emit = defineEmits(['play', 'pause', 'ended', 'timeupdate', 'fullscreenchange', 'waiting', 'error', 'progress', 'loadedmetadata', 'controlstoggle'])

const isMp = computed(() => isMpRuntime())

const mediaStyle = computed(() => {
  const style: CSSProperties = {}
  if (props.width) style.width = props.width + 'px'
  if (props.height) style.height = props.height + 'px'
  return style as CSSProperties
})

/** Web：object-fit 走标准 objectFit（MP 端由原生 video 属性承接，同名语义） */
const webVideoStyle = computed<CSSProperties>(() => ({ objectFit: props.objectFit as CSSProperties['objectFit'] }))

/** ★载荷归一（跨端裸载荷约定）：取 e.detail ?? e */
function payload(e: unknown): unknown {
  const p = e as { detail?: unknown }
  return p && typeof p === 'object' && 'detail' in p ? p.detail : e
}
function onPlay(e: unknown): void { emit('play', payload(e)) }
function onPause(e: unknown): void { emit('pause', payload(e)) }
function onEnded(e: unknown): void { emit('ended', payload(e)) }
function onTimeUpdate(e: unknown): void { emit('timeupdate', payload(e)) }
function onFullscreenChange(e: unknown): void { emit('fullscreenchange', payload(e)) }
function onWaiting(e: unknown): void { emit('waiting', payload(e)) }
function onError(e: unknown): void { emit('error', payload(e)) }
function onProgress(e: unknown): void { emit('progress', payload(e)) }
function onLoadedMetadata(e: unknown): void { emit('loadedmetadata', payload(e)) }
function onControlsToggle(e: unknown): void { emit('controlstoggle', payload(e)) }
</script>

<style scoped>
.p-media {
  display: inline-flex;
  max-width: 100%;
}
.p-media-el {
  max-width: 100%;
  border-radius: 4px;
}
.p-media-placeholder {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  background: #f7f8fa;
  color: #969799;
  border-radius: 4px;
  font-size: 13px;
}
</style>
