<script setup lang="ts">
// website/src/components/MultiDeviceWall.vue —— ★#489v3 一份语义 → 六端呈现 + 每端能力声明
// 主题回归原型（flexible-multi-device.html）：差异来自 RenderBackend 对语义（layout/columns/nav/input）的推导，
// 而不是把页面缩放/折叠加 #ifdef。六帧 = 真实 DOM 渲染同一份 ProductDetail（Web 运行时，诚实标注），
// 每端卡附带其「形态推导 + 能力声明」（绿=Backend 已声明支持 · 橙=需条件降级）——语义效果直给。
import { computed } from 'vue'
import { locale, t } from '../i18n'
import { deviceForm } from '../playground/backends'
import ProductScene from './mdev/ProductScene.vue'

type Cap = { id: string; zh: string; en: string; state: 'ok' | 'cond' }
interface Target {
  id: string
  nameZh: string
  nameEn: string
  icon: string
  aspect: number // 屏宽高比 h/w（迷你帧使用）
  screen: { w?: number; h: number } // mini 帧固定宽（watch 等）或全宽定高
  chrome: 'notch' | 'pill' | 'none' | 'dash'
  dims: string
  formZh: string
  formEn: string
  inputZh: string
  inputEn: string
  backendZh: string
  backendEn: string
  topologyZh: string
  topologyEn: string
  caps: Cap[]
}

/** ★语义声明集（对齐 G-24 桌面原语 / G-25 全终端 / 端矩阵已文档化的能力语义——非虚构） */
const TARGETS: Target[] = [
  {
    id: 'phone', nameZh: 'iOS · 手机', nameEn: 'iOS · Phone', icon: '📱',
    aspect: 1.62, screen: { w: 172, h: 300 }, chrome: 'notch', dims: '390×844',
    formZh: '竖屏 · 触控 · 单手', formEn: 'portrait · touch · one-handed',
    inputZh: '触控', inputEn: 'touch',
    backendZh: 'NativeBackend（iOS/Android）', backendEn: 'NativeBackend (iOS/Android)',
    topologyZh: '单列纵向 · 底部 Tab 式', topologyEn: 'single column · bottom-nav style',
    caps: [
      { id: 'tap', zh: '触控 tap', en: 'tap', state: 'ok' },
      { id: 'cols', zh: '单列网格', en: 'single-column grid', state: 'ok' },
      { id: 'sku', zh: 'SKU 多选', en: 'full SKU picker', state: 'ok' },
      { id: 'hover', zh: '悬停→tap 高亮', en: 'hover → tap highlight', state: 'cond' },
    ],
  },
  {
    id: 'tablet', nameZh: 'Android · 平板', nameEn: 'Android · Tablet', icon: '📲',
    aspect: 1.33, screen: { w: 190, h: 252 }, chrome: 'notch', dims: '834×1112',
    formZh: '横竖屏 · 触控 · 双手', formEn: 'any orientation · touch · two hands',
    inputZh: '触控', inputEn: 'touch',
    backendZh: 'NativeBackend（Jetpack）', backendEn: 'NativeBackend (Jetpack)',
    topologyZh: '侧栏 + 多列并排', topologyEn: 'side rail + multi-column',
    caps: [
      { id: 'cols', zh: '双列以上网格', en: '2+ column grid', state: 'ok' },
      { id: 'sku', zh: 'SKU 多选', en: 'full SKU picker', state: 'ok' },
      { id: 'hover', zh: '悬停→tap 高亮', en: 'hover → tap highlight', state: 'cond' },
    ],
  },
  {
    id: 'pc', nameZh: 'Web · 桌面', nameEn: 'Web · Desktop', icon: '🖥️',
    aspect: 0.6, screen: { w: undefined, h: 246 }, chrome: 'none', dims: '1440×900',
    formZh: '桌面 · 鼠标键盘', formEn: 'desktop · mouse + keyboard',
    inputZh: '鼠标键盘', inputEn: 'mouse + keyboard',
    backendZh: 'VueDomBackend · CSS Grid', backendEn: 'VueDomBackend · CSS Grid',
    topologyZh: '宽幅多列 · 可悬停', topologyEn: 'wide multi-column · hoverable',
    caps: [
      { id: 'hover', zh: '悬停态（v-p-hover）', en: 'hover (v-p-hover)', state: 'ok' },
      { id: 'cols', zh: '三列网格', en: '3-column grid', state: 'ok' },
      { id: 'shortcut', zh: '键盘可达', en: 'keyboard reachable', state: 'ok' },
      { id: 'sku', zh: 'SKU 多选', en: 'full SKU picker', state: 'ok' },
    ],
  },
  {
    id: 'car', nameZh: 'ArkUI · 车机', nameEn: 'ArkUI · In-car', icon: '🚗',
    aspect: 0.62, screen: { w: undefined, h: 190 }, chrome: 'none', dims: '1280×720',
    formZh: '仪表盘 · 驾驶场景', formEn: 'dashboard · driving',
    inputZh: '旋钮 / d-pad', inputEn: 'rotary / d-pad',
    backendZh: 'NativeBackend（ArkUI）', backendEn: 'NativeBackend (ArkUI)',
    topologyZh: '大热区卡片 · 焦点导航 · 驾驶降干扰', topologyEn: 'big hit areas · focus nav · drive-aware',
    caps: [
      { id: 'dpad', zh: '焦点树 / d-pad', en: 'focus tree / d-pad', state: 'ok' },
      { id: 'big', zh: '大热区', en: 'large hit targets', state: 'ok' },
      { id: 'dense', zh: '高密度信息', en: 'dense info', state: 'ok' },
      { id: 'sku', zh: 'SKU 精简', en: 'condensed SKU', state: 'cond' },
    ],
  },
  {
    id: 'tv', nameZh: 'TV · 大屏', nameEn: 'TV · big screen', icon: '📺',
    aspect: 0.56, screen: { w: undefined, h: 200 }, chrome: 'none', dims: '1920×1080',
    formZh: '遥控 · 3m 观看', formEn: 'remote · 10-ft viewing',
    inputZh: '遥控器 d-pad', inputEn: 'remote d-pad',
    backendZh: 'SkiaBackend / WebGL 类后端', backendEn: 'Skia/WebGL-class backend',
    topologyZh: '横向海报流 · Hero', topologyEn: 'hero + horizontal poster rows',
    caps: [
      { id: 'dpad', zh: '焦点行 / 遥控', en: 'focus row / remote', state: 'ok' },
      { id: 'cols', zh: '横向多列海报', en: 'horizontal poster rows', state: 'ok' },
      { id: 'sku', zh: 'SKU 精简', en: 'condensed SKU', state: 'cond' },
    ],
  },
  {
    id: 'watch', nameZh: 'Flutter · 手表', nameEn: 'Flutter · Watch', icon: '⌚',
    aspect: 1, screen: { w: 124, h: 124 }, chrome: 'pill', dims: '198×194',
    formZh: '腕上 · 抬腕一瞥', formEn: 'wearable · glance',
    inputZh: '表冠 + 触控', inputEn: 'crown + touch',
    backendZh: 'FlutterBackend（Widget）', backendEn: 'FlutterBackend (Widget)',
    topologyZh: '一屏一意 · 精简 SKU', topologyEn: 'one screen, one meaning · trimmed SKU',
    caps: [
      { id: 'crown', zh: '表冠缩放', en: 'crown scaling', state: 'ok' },
      { id: 'dense', zh: '紧凑密度', en: 'dense layout', state: 'ok' },
      { id: 'sku', zh: 'SKU 精简（一屏一意）', en: 'condensed SKU (one meaning per screen)', state: 'cond' },
      { id: 'hover', zh: '无悬停 → tap', en: 'no hover → tap', state: 'cond' },
    ],
  },
]

const isEn = computed(() => locale.value === 'en')
function name(t: Target): string {
  return isEn.value ? t.nameEn : t.nameZh
}
function capLabel(c: Cap): string {
  return isEn.value ? c.en : c.zh
}
function screenStyle(t: Target): Record<string, string> {
  if (t.screen.w) {
    return { width: `${t.screen.w}px`, aspectRatio: `1 / ${t.aspect}` }
  }
  return { width: '100%', height: `${t.screen.h}px` }
}
function meta(t: Target): string {
  return `${t.dims} · F=${deviceForm(Number(t.dims.split('×')[0]))}`
}
</script>

<template>
  <p-view class="wall">
    <p-stack direction="row" :gap="18" wrap class="wall-head">
      <p-view class="legend">
        <p-text class="wall-label">{{ t('mdev.theme') }}</p-text>
        <p-text class="wall-note">{{ t('mdev.sub') }}</p-text>
      </p-view>
      <p-view class="cap-legend">
        <span class="dot ok" /><p-text class="lg">{{ isEn ? 'declared & supported by the backend' : 'Backend 已声明支持' }}</p-text>
        <span class="dot cond" /><p-text class="lg">{{ isEn ? 'needs conditional degradation (@conditional)' : '需条件降级（@conditional）' }}</p-text>
      </p-view>
    </p-stack>

    <p-grid :min-col-width="252" :gap="16" class="grid">
      <p-view v-for="t in TARGETS" :key="t.id" class="frame">
        <p-view class="frame-head">
          <p-text class="frame-name"><span class="frame-ic">{{ t.icon }}</span>{{ name(t) }}</p-text>
          <p-text class="frame-meta">{{ meta(t) }}</p-text>
        </p-view>

        <p-view class="stage">
          <p-view class="screen" :class="'chrome-' + t.chrome" :style="screenStyle(t)">
            <p-scale :level="t.screen.w && t.screen.w <= 130 ? 0 : 1">
              <ProductScene />
            </p-scale>
          </p-view>
        </p-view>

        <!-- 端形态推导（form · input · backend · topology） -->
        <p-view class="derive">
          <p-text class="d-row"><span class="d-k">{{ isEn ? 'form' : '形态' }}</span>{{ isEn ? t.formEn : t.formZh }}</p-text>
          <p-text class="d-row"><span class="d-k">{{ isEn ? 'input' : '输入' }}</span>{{ isEn ? t.inputEn : t.inputZh }} · {{ isEn ? 'nav derived per target' : '导航按端推导' }}</p-text>
          <p-text class="d-row"><span class="d-k">{{ isEn ? 'backend' : '后端' }}</span>{{ isEn ? t.backendEn : t.backendZh }}</p-text>
          <p-text class="d-row"><span class="d-k">{{ isEn ? 'topology' : '拓扑' }}</span>{{ isEn ? t.topologyEn : t.topologyZh }}</p-text>
        </p-view>

        <!-- 能力声明（绿=声明支持 / 橙=条件降级） -->
        <p-view class="caps">
          <p-text class="caps-title">{{ isEn ? 'Capability declarations' : '能力声明' }}</p-text>
          <p-stack direction="row" :gap="6" wrap>
            <span v-for="c in t.caps" :key="c.id" class="chip" :class="'cap-' + c.state">{{ capLabel(c) }}</span>
          </p-stack>
        </p-view>
      </p-view>
    </p-grid>
  </p-view>
</template>

<style scoped>
.wall { gap: 16px; }
.wall-head { align-items: flex-start; justify-content: space-between; }
.legend { gap: 6px; min-width: 280px; }
.wall-label { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--dim); }
.wall-note { font-size: 12.5px; color: var(--muted); line-height: 1.7; display: block; max-width: 560px; }
.cap-legend { flex-direction: row; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 11px; color: var(--muted); }
.dot { width: 8px; height: 8px; border-radius: 50%; margin-left: 6px; }
.dot.ok { background: var(--ok, #39d0c4); }
.dot.cond { background: var(--warn, #ff8b5b); }
.lg { font-size: 11px; }
.grid { align-items: start; }
.frame { border: 1px solid var(--line); border-radius: 16px; background: var(--panel); overflow: hidden; }
.frame-head { flex-direction: row; justify-content: space-between; align-items: center; padding: 10px 12px; border-bottom: 1px solid var(--line); gap: 8px; }
.frame-name { font-size: 12.5px; font-weight: 700; color: var(--ink); display: inline-flex; align-items: center; gap: 6px; }
.frame-ic { font-size: 14px; }
.frame-meta { font-size: 10.5px; color: var(--dim); font-family: ui-monospace, Menlo, monospace; }
.stage { padding: 14px 12px 6px; display: flex; justify-content: center; }
.screen { position: relative; border-radius: 14px; background: #fff; color: #14141a; overflow: hidden; box-shadow: 0 8px 20px rgba(0, 0, 0, 0.4); }
.chrome-notch::before { content: ''; position: absolute; top: 5px; left: 50%; transform: translateX(-50%); width: 42%; height: 4px; border-radius: 999px; background: #101018; z-index: 3; }
.chrome-pill { border-radius: 32px; border: 3px solid #3a3a46; }
.chrome-dash { border: 1.5px dashed #8a93b8; box-shadow: none; }
.derive { padding: 8px 12px 2px; gap: 3px; }
.d-row { font-size: 10.5px; color: var(--muted); line-height: 1.5; display: block; }
.d-k { display: inline-block; width: 58px; color: var(--dim); font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
.caps { padding: 8px 12px 12px; gap: 6px; }
.caps-title { font-size: 10px; color: var(--dim); text-transform: uppercase; letter-spacing: 1px; }
.chip { font-size: 10.5px; padding: 3px 9px; border-radius: 999px; border: 1px solid transparent; }
.cap-ok { color: #19b8a8; border-color: rgba(57, 208, 196, 0.45); background: rgba(57, 208, 196, 0.1); }
.cap-cond { color: #ffa06a; border-color: rgba(255, 139, 91, 0.5); background: rgba(255, 139, 91, 0.12); }
</style>
