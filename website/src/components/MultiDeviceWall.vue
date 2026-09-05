<script setup lang="ts">
// website/src/components/MultiDeviceWall.vue —— ★#489 一套源码 · 六端同屏墙（v2：真实渲染，非色块）
// 把 design 期原型 flexible-multi-device.html 的价值收进官网：同一份真实 Vue 组件
// 在六种设备形态框里**真实渲染**（Web DOM 运行时 + 柔性容器自适应——小屏自然换行/收紧），
// 而不是画色块树。真实多后端输出树/IR 仍由 Playground（TransformDemo Render/Trace）负责。
// 原语优先：p-grid 墙 / p-segment 场景 / p-view / p-stack / p-text；设备框 chrome 仅页面级视觉。
import { computed, ref } from 'vue'
import { locale, t } from '../i18n'
import { DEVICES, deviceForm } from '../playground/backends'
import ProductScene from './mdev/ProductScene.vue'
import FeedScene from './mdev/FeedScene.vue'
import ShellScene from './mdev/ShellScene.vue'

interface Scene {
  key: string
  labelZh: string
  labelEn: string
  comp: unknown
}
const SCENES: Scene[] = [
  { key: 'product', labelZh: '商品详情', labelEn: 'Product detail', comp: ProductScene },
  { key: 'feed', labelZh: '能力信息流', labelEn: 'Capabilities feed', comp: FeedScene },
  { key: 'shell', labelZh: '应用壳', labelEn: 'App shell', comp: ShellScene },
]

/** 六个设备帧：端形态 + 屏幕几何/机型 chrome（真实宽高/F 档来自 DEVICES） */
const FRAMES = [
  { id: 'web', device: 'web', nameZh: 'Web · 桌面', nameEn: 'Web · Desktop', kind: 'full', chrome: 'none' },
  { id: 'tablet', device: 'tablet', nameZh: 'Android · 平板', nameEn: 'Android · Tablet', kind: 'mini', chrome: 'notch' },
  { id: 'phone', device: 'phone', nameZh: 'iOS · 手机', nameEn: 'iOS · Phone', kind: 'mini', chrome: 'notch' },
  { id: 'car', device: 'tv', nameZh: 'ArkUI · 车机', nameEn: 'ArkUI · In-car', kind: 'full', chrome: 'none' },
  { id: 'watch', device: 'watch', nameZh: 'Flutter · 手表', nameEn: 'Flutter · Watch', kind: 'mini', chrome: 'pill' },
  { id: 'ssr', device: 'tablet', nameZh: 'Headless · SSR/测试', nameEn: 'Headless · SSR/test', kind: 'full', chrome: 'dash' },
]

const isEn = computed(() => locale.value === 'en')
const activeKey = ref(SCENES[0]!.key)
const activeScene = computed(() => SCENES.find((s) => s.key === activeKey.value) ?? SCENES[0]!)
const sceneOptions = computed(() => SCENES.map((s) => ({ label: isEn.value ? s.labelEn : s.labelZh, value: s.key })))
function pick(key: string): void {
  activeKey.value = key
}

/** 迷你屏（手表/手机/平板）给内容套 p-scale level 0——小屏字号档真实生效 */
function isMini(f: (typeof FRAMES)[number]): boolean {
  return f.kind === 'mini'
}
function screenStyle(f: (typeof FRAMES)[number]): Record<string, string> {
  // mini 屏固定设备 px（放缩前，供视觉/比例）；全宽帧自适应卡内宽度
  if (f.kind === 'mini') {
    const dev = DEVICES.find((d) => d.id === f.device)
    const ratio = dev ? dev.height / dev.width : 1.9
    const w = f.device === 'watch' ? 112 : 172
    return { width: `${w}px`, aspectRatio: `1 / ${(ratio * 1.35).toFixed(2)}` }
  }
  const h = f.device === 'tv' ? 178 : 236
  return { width: '100%', height: `${h}px` }
}
function frameMeta(f: (typeof FRAMES)[number]): string {
  const dev = DEVICES.find((d) => d.id === f.device)
  return dev ? `${dev.width}×${dev.height} · F=${deviceForm(dev.width)}` : ''
}
</script>

<template>
  <p-view class="wall">
    <p-stack direction="row" :gap="14" wrap class="wall-head">
      <p-view class="seg">
        <p-text class="wall-label">{{ t('mdev.scenario') }}</p-text>
        <p-segment :options="sceneOptions" :active="activeKey" @update:active="pick($event as string)" />
      </p-view>
      <p-text class="wall-note">{{ t('mdev.sub') }}</p-text>
    </p-stack>

    <p-grid :min-col-width="236" :gap="14" class="grid">
      <p-view v-for="f in FRAMES" :key="f.id" class="frame" :class="'frame-' + f.id">
        <p-view class="frame-head">
          <p-text class="frame-name">{{ isEn ? f.nameEn : f.nameZh }}</p-text>
          <p-text class="frame-meta">{{ frameMeta(f) }}</p-text>
        </p-view>
        <p-view class="stage">
          <p-view class="screen" :class="'chrome-' + f.chrome" :style="screenStyle(f)">
            <p-scale :level="isMini(f) ? 0 : 1">
              <component :is="activeScene.comp" />
            </p-scale>
          </p-view>
        </p-view>
        <p-text class="frame-rt">{{ isEn ? 'Web DOM runtime · real render' : 'Web DOM 运行时 · 真实渲染' }}</p-text>
      </p-view>
    </p-grid>
  </p-view>
</template>

<style scoped>
.wall { gap: 14px; }
.wall-head { align-items: center; }
.seg { gap: 8px; }
.wall-label { font-size: 12px; color: var(--muted); }
.wall-note { flex: 1; min-width: 240px; font-size: 12.5px; color: var(--muted); line-height: 1.7; display: block; }
.grid { align-items: start; }
.frame {
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--panel);
  overflow: hidden;
}
.frame-head {
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  padding: 9px 12px;
  border-bottom: 1px solid var(--line);
  gap: 8px;
}
.frame-name { font-size: 12.5px; font-weight: 650; color: var(--ink); }
.frame-meta { font-size: 11px; color: var(--muted); font-family: ui-monospace, Menlo, monospace; }
.stage { padding: 12px 12px 4px; display: flex; justify-content: center; }
.screen {
  position: relative;
  border-radius: 14px;
  background: #fff;
  color: #14141a;
  overflow: hidden;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.35);
}
/* 机型 chrome（纯视觉，零布局逻辑） */
.chrome-notch::before {
  content: '';
  position: absolute;
  top: 6px;
  left: 50%;
  transform: translateX(-50%);
  width: 44%;
  height: 5px;
  border-radius: 999px;
  background: #101018;
  z-index: 2;
}
.chrome-pill {
  border-radius: 30px;
  border: 3px solid #3a3a46;
  box-shadow: 0 0 0 1px #2a2a34, 0 8px 18px rgba(0, 0, 0, 0.4);
}
.chrome-dash {
  border: 1.5px dashed #8a93b8;
  border-radius: 14px;
  box-shadow: none;
}
.frame-rt {
  display: block;
  padding: 4px 12px 12px;
  font-size: 10.5px;
  color: var(--dim);
  font-family: ui-monospace, Menlo, monospace;
}
</style>
