<!-- showcase/subpackages/components/pages/p-media.vue —— p-media 媒体演示
     覆盖：kind 统一入口（image/video/audio/live）+ 官方 <video> 属性族
     （controls/autoplay/loop/muted/poster/object-fit/title/show-* 控件显隐/手势/弹幕/画中画/DRM）。
     ★双端：MP 原生 <video>（属性全量透传）；Web 标准 <video>（无对等的官方私有项诚实不伪造）。
     ★诚实边界：画中画 / 投屏 / DRM / 后台播放 等依赖宿主能力，Web 端不伪造行为。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PMedia, PText, PView } from '@proteus-vue/components'

// ★字面量直接内联进 ref()（编译器静态求值：标识符初值 → data undefined，见 S33/S57）
const cover = ref('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMjAiIGhlaWdodD0iMTgwIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjMjIyMjI2Ii8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZpbGw9IiNmZmYiIGZvbnQtc2l6ZT0iMTYiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuMzVlbSI+5bCB6Z2iPC90ZXh0Pjwvc3ZnPg==')
const state = ref('等待播放事件…')
function onPlay() { state.value = '▶ play 事件（播放中）' }
function onPause() { state.value = '⏸ pause 事件（已暂停）' }
function onEnded() { state.value = '⏹ ended 事件（播放结束）' }

const codes = ref({
  image: '<p-media kind="image" src="…" />',
  video: '<p-media kind="video" src="…" :poster="cover" controls object-fit="contain" />',
  ctrl: '<p-media kind="video" :show-center-play-btn="false" :show-fullscreen-btn="false" />',
  live: '<p-media kind="live" src="…" is-live />',
})

const apiRows = ref([
  ['kind', '媒体类型 image / video / audio / live（框架统一入口）', 'string'],
  ['src', '资源地址（★官方 src）', 'string'],
  ['duration', '指定视频时长（★官方 duration）', 'number'],
  ['controls', '显示控制条（★官方 controls）', 'boolean'],
  ['autoplay', '自动播放（★官方 autoplay）', 'boolean'],
  ['loop', '循环（★官方 loop）', 'boolean'],
  ['muted', '静音（★官方 muted）', 'boolean'],
  ['initialTime', '初始播放位置（★官方 initial-time）', 'number'],
  ['poster', '封面图（★官方 poster）', 'string'],
  ['objectFit', 'contain / fill / cover（★官方 object-fit）', 'string'],
  ['title', '视频标题（全屏顶部展示，★官方 title）', 'string'],
  ['playBtnPosition', '播放按钮位置（★官方 play-btn-position）', 'string'],
  ['direction', '全屏方向（★官方 direction）', 'number'],
  ['showProgress', '显示进度条（★官方 show-progress）', 'boolean'],
  ['showFullscreenBtn', '显示全屏按钮（★官方 show-fullscreen-btn）', 'boolean'],
  ['showPlayBtn', '显示底部播放按钮（★官方 show-play-btn）', 'boolean'],
  ['showCenterPlayBtn', '显示中间播放按钮（★官方 show-center-play-btn）', 'boolean'],
  ['showMuteBtn', '显示静音按钮（★官方 show-mute-btn）', 'boolean'],
  ['showBottomProgress', '显示底部进度条（★官方 show-bottom-progress）', 'boolean'],
  ['enableProgressGesture', '开启控制进度手势（★官方 enable-progress-gesture）', 'boolean'],
  ['enablePlayGesture', '双击切换播放/暂停（★官方 enable-play-gesture）', 'boolean'],
  ['pageGesture', '非全屏亮度/音量手势（★官方 page-gesture，已废弃）', 'boolean'],
  ['vslideGesture', '非全屏亮度/音量手势（★官方 vslide-gesture）', 'boolean'],
  ['vslideGestureInFullscreen', '全屏亮度/音量手势（★官方 vslide-gesture-in-fullscreen）', 'boolean'],
  ['autoPauseIfNavigate', '跳转本小程序其他页自动暂停（★官方 auto-pause-if-navigate）', 'boolean'],
  ['autoPauseIfOpenNative', '跳转微信原生页自动暂停（★官方 auto-pause-if-open-native）', 'boolean'],
  ['danmuList', '弹幕列表（★官方 danmu-list）', 'array'],
  ['danmuBtn', '显示弹幕按钮（★官方 danmu-btn，仅初始化有效）', 'boolean'],
  ['enableDanmu', '展示弹幕（★官方 enable-danmu，仅初始化有效）', 'boolean'],
  ['adUnitId', '视频前贴广告单元 id（★官方 ad-unit-id）', 'string'],
  ['posterForCrawler', '搜索引擎封面图（★官方 poster-for-crawler）', 'string'],
  ['showCastingButton', '显示投屏按钮（★官方 show-casting-button）', 'boolean'],
  ['pictureInPictureMode', '小窗模式 push / pop（★官方 picture-in-picture-mode）', 'string | array'],
  ['pictureInPictureShowProgress', '小窗显示进度（★官方 picture-in-picture-show-progress）', 'boolean'],
  ['pictureInPictureInitPosition', '小窗初始位置（★官方 picture-in-picture-init-position）', 'string'],
  ['enableSystemPip', 'iOS 系统画中画（★官方 enable-system-pip）', 'boolean'],
  ['enableAutoRotation', '横屏自动全屏（★官方 enable-auto-rotation）', 'boolean'],
  ['showScreenLockButton', '显示锁屏按钮（★官方 show-screen-lock-button）', 'boolean'],
  ['showSnapshotButton', '显示截屏按钮（★官方 show-snapshot-button）', 'boolean'],
  ['showBackgroundPlaybackButton', '后台小窗播放按钮（★官方 show-background-playback-button）', 'boolean'],
  ['backgroundPoster', '后台小窗通知栏图标（Android，★官方 background-poster）', 'string'],
  ['referrerPolicy', '防盗链 referrer 策略（★官方 referrer-policy）', 'string'],
  ['isDrm', '是否 DRM 视频源（★官方 is-drm）', 'boolean'],
  ['isLive', '是否直播源（★官方 is-live）', 'boolean'],
  ['provisionUrl', 'DRM 认证 url（Android，★官方 provision-url）', 'string'],
  ['certificateUrl', 'DRM 认证 url（iOS，★官方 certificate-url）', 'string'],
  ['licenseUrl', 'DRM 取密钥 url（★官方 license-url）', 'string'],
  ['preferredPeakBitRate', '码率上界 bps（★官方 preferred-peak-bit-rate）', 'number'],
  ['width', '宽 px（0=自适应）', 'number'],
  ['height', '高 px（0=自适应）', 'number'],
])
const eventRows = ref([
  ['play / pause / ended', '播放 / 暂停 / 结束（★官方 bind:play / bind:pause / bind:ended）', 'event'],
  ['timeupdate', '播放进度变化（★官方 bind:timeupdate，detail={currentTime,duration}）', '{ currentTime, duration }'],
  ['fullscreenchange', '进入/退出全屏（★官方 bind:fullscreenchange）', '{ fullScreen, direction }'],
  ['waiting', '出现缓冲（★官方 bind:waiting）', 'event'],
  ['error', '播放出错（★官方 bind:error）', 'event'],
  ['progress', '加载进度变化（★官方 bind:progress）', '{ buffered }'],
  ['loadedmetadata', '元数据加载完成（★官方 bind:loadedmetadata）', '{ width, height, duration }'],
  ['controlstoggle', '切换 controls 显隐（★官方 bind:controlstoggle）', '{ show }'],
])
const slotRows = ref([['—', 'p-media 无插槽', '—']])
</script>

<template>
  <page-shell title="p-media 媒体" subtitle="内容基元 · image / video / audio / live 统一入口">
    <demo-block index="01" title="图片" desc="kind=image 走图片分支（等价 p-image 的宽满自适应）" :code="codes.image">
      <template #demo>
        <p-view class="frame"><p-media kind="image" :src="cover" /></p-view>
      </template>
    </demo-block>

    <demo-block index="02" title="视频与播放事件" :has-output="true"
      desc="controls/object-fit/poster 透传；播放状态经事件回显（★浏览器自动播放策略可能需先点击）" :code="codes.video">
      <template #demo>
        <p-view class="frame"><p-media kind="video" :src="''" :poster="cover" controls object-fit="contain" @play="onPlay" @pause="onPause" @ended="onEnded" /></p-view>
      </template>
      <template #output><p-text class="out">{{ state }}</p-text></template>
    </demo-block>

    <demo-block index="03" title="控件显隐族" desc="show-center-play-btn / show-fullscreen-btn 等控制原生控件显示" :code="codes.ctrl">
      <template #demo>
        <p-view class="frame"><p-media kind="video" :src="''" :poster="cover" :show-center-play-btn="false" :show-fullscreen-btn="false" /></p-view>
      </template>
    </demo-block>

    <demo-block index="04" title="直播源" desc="kind=live + is-live（★官方 is-live；MP 端原生 video 承接）" :code="codes.live">
      <template #demo>
        <p-view class="frame"><p-media kind="live" :src="''" :poster="cover" :is-live="true" /></p-view>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="Slots" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
  </page-shell>
</template>

<style scoped>
.frame { width: 320px; max-width: 100%; border-radius: var(--sp-radius-sm); overflow: hidden; }
.out { display: block; font-size: 12.5px; color: #2f7a4d; }
</style>
