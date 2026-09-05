<script setup lang="ts">
// website/src/components/MultiDeviceWall.vue —— ★#489 一套源码 · 六端同屏墙
// 把 design 期原型 flexible-multi-device.html 的价值收进官网，且零伪造：
// 一份标准 Vue SFC → createNodeCompilerBackend 真实 CompilerIR → renderIRTree 同时喂给六个渲染后端
// （VueDom / Headless / Native × 3 / Flutter），每个帧都是真实输出树——复用 Playground 同源管线。
// 原语优先：布局全走 p-*（p-segment 场景切换 / p-grid 自适应列 / p-view / p-stack / p-text），页面零裸平台 API。
import { computed, onMounted, ref, watch } from 'vue'
// G-29 NodeBackend（浏览器安全单入口——与 Playground 同源）
import { createNodeCompilerBackend } from '@proteus-vue/compiler-backend/node'
import { locale, t } from '../i18n'
import { RENDER_BACKENDS, DEVICES, renderWithBackend, deviceForm, type TreeJsonNode } from '../playground/backends'
import RenderBox from './RenderBox.vue'

const backend = createNodeCompilerBackend()

/** 场景预设（EN 示例文案——两种语言下源码一致，改完六端实时重渲） */
interface Scenario {
  key: string
  labelZh: string
  labelEn: string
  source: string
}
const SCENARIOS: Scenario[] = [
  {
    key: 'product',
    labelZh: '商品详情',
    labelEn: 'Product detail',
    source: `<script setup lang="ts">
import { ref } from 'vue'

const count = ref(1)
const price = '¥ 299'
<\/script>

<template>
  <p-view class="card">
    <p-heading :level="1">Mono speaker</p-heading>
    <p-text class="price">{{ price }}</p-text>
    <p-stack direction="row" :gap="8" wrap>
      <p-button @tap="count = Math.max(1, count - 1)">−</p-button>
      <p-text class="qty">× {{ count }}</p-text>
      <p-button @tap="count = count + 1">＋</p-button>
    </p-stack>
    <p-text class="note">One semantic card, six targets — same source.</p-text>
  </p-view>
</template>

<style scoped>
.card { padding: 24px 28px; }
.price { color: #0e0e10; font-size: 18px; }
.qty { align-self: center; }
.note { color: #666; font-size: 12px; }
</style>
`,
  },
  {
    key: 'feed',
    labelZh: '信息流',
    labelEn: 'Feed grid',
    source: `<script setup lang="ts">
const items = ['Semantic core', 'Pluggable backends', 'Transparent compile', 'Zero native glue']
<\/script>

<template>
  <p-view class="feed">
    <p-heading :level="2">Capabilities</p-heading>
    <p-grid :min-col-width="160" :gap="10">
      <p-view v-for="(it, i) in items" :key="i" class="tile">
        <p-text>{{ i + 1 }} · {{ it }}</p-text>
      </p-view>
    </p-grid>
  </p-view>
</template>

<style scoped>
.feed { padding: 20px 22px; }
.tile { padding: 14px 12px; border: 1px solid #e2e2ea; border-radius: 10px; }
</style>
`,
  },
  {
    key: 'shell',
    labelZh: '应用壳',
    labelEn: 'App shell',
    source: `<template>
  <p-view class="shell">
    <p-view class="bar">
      <p-text class="bar-title">Proteus</p-text>
    </p-view>
    <p-stack class="body" :gap="10">
      <p-heading :level="1">Hello, every target</p-heading>
      <p-text>Web renders DOM; mini programs compile to WXML; native hosts draw UIKit / Jetpack / ArkUI / Widget trees from the same IR.</p-text>
    </p-stack>
  </p-view>
</template>

<style scoped>
.shell { min-height: 320px; }
.bar { padding: 12px 16px; border-bottom: 1px solid #d9d9e3; }
.bar-title { font-weight: 700; }
.body { padding: 20px 16px; }
</style>
`,
  },
]

/** 六个帧 = 六个渲染后端 × 端形态（device 档位真实宽高/形态档） */
const FRAMES = [
  { id: 'web', device: 'web', backendId: 'vuedom', nameZh: 'Web · 桌面', nameEn: 'Web · Desktop' },
  { id: 'tablet', device: 'tablet', backendId: 'native-android', nameZh: 'Android · 平板', nameEn: 'Android · Tablet' },
  { id: 'phone', device: 'phone', backendId: 'native-ios', nameZh: 'iOS · 手机', nameEn: 'iOS · Phone' },
  { id: 'car', device: 'tv', backendId: 'native-harmony', nameZh: 'ArkUI · 车机', nameEn: 'ArkUI · In-car' },
  { id: 'watch', device: 'watch', backendId: 'flutter', nameZh: 'Flutter · 手表', nameEn: 'Flutter · Watch' },
  { id: 'ssr', device: 'tablet', backendId: 'headless', nameZh: 'Headless · SSR/测试', nameEn: 'Headless · SSR/test' },
]

const isEn = computed(() => locale.value === 'en')
const scenarioKey = ref(SCENARIOS[0]!.key)
const source = ref(SCENARIOS[0]!.source)
const scenario = computed(() => SCENARIOS.find((s) => s.key === scenarioKey.value) ?? SCENARIOS[0]!)

/** 每帧真实输出树（ir 编译一次，六后端各跑 renderIRTree） */
interface FrameState {
  cfg: (typeof FRAMES)[number]
  tree: TreeJsonNode | null
  error: string
}
const frames = ref<FrameState[]>([])
let treeErr = ''

function refresh(): void {
  treeErr = ''
  try {
    const ir = backend.compile({ source: source.value, filename: 'wall.vue' })
    frames.value = FRAMES.map((cfg) => {
      try {
        const { tree } = renderWithBackend(ir.render.root as never, cfg.backendId)
        return { cfg, tree, error: '' }
      } catch (e) {
        return { cfg, tree: null, error: String(e instanceof Error ? e.message : e) }
      }
    })
  } catch (e) {
    treeErr = String(e instanceof Error ? e.message : e)
    frames.value = []
  }
}

function pickScenario(key: string): void {
  const s = SCENARIOS.find((x) => x.key === key)
  if (s) {
    scenarioKey.value = key
    source.value = s.source
  }
}
const scenarioOptions = computed(() => SCENARIOS.map((s) => ({ label: isEn.value ? s.labelEn : s.labelZh, value: s.key })))
const segmentOptions = computed(() => SCENARIOS.map((s) => ({ label: isEn.value ? s.labelEn : s.labelZh, value: s.key })))

let timer: ReturnType<typeof setTimeout> | undefined
watch(source, () => {
  clearTimeout(timer)
  timer = setTimeout(refresh, 200)
})

function backendColor(id: string): string {
  return RENDER_BACKENDS.find((r) => r.id === id)?.color ?? 'var(--brand)'
}
function frameName(cfg: (typeof FRAMES)[number]): string {
  return isEn.value ? cfg.nameEn : cfg.nameZh
}
function frameMeta(cfg: (typeof FRAMES)[number]): string {
  const dev = DEVICES.find((d) => d.id === cfg.device)
  return dev ? `${dev.width}×${dev.height} · F=${deviceForm(dev.width)}` : ''
}

onMounted(refresh)
</script>

<template>
  <p-view class="wall">
    <p-stack direction="row" :gap="14" wrap class="wall-head">
      <!-- 场景预设（p-segment——手写 Tab 禁用的既有约定） -->
      <p-view class="seg">
        <p-text class="wall-label">{{ t('mdev.scenario') }}</p-text>
        <p-segment :options="scenarioOptions" :active="scenarioKey" @update:active="pickScenario($event as string)" />
      </p-view>
      <p-text class="wall-note">{{ t('mdev.sub') }}</p-text>
    </p-stack>

    <p-grid :min-col-width="240" :gap="14" class="grid">
      <p-view v-for="f in frames" :key="f.cfg.id" class="frame" :class="'frame-' + f.cfg.id">
        <p-view class="frame-head">
          <p-text class="frame-name">{{ frameName(f.cfg) }}</p-text>
          <p-text class="frame-meta">{{ frameMeta(f.cfg) }}</p-text>
        </p-view>
        <p-view class="screen" :style="{ borderColor: backendColor(f.cfg.backendId) }">
          <p-text v-if="f.error" class="frame-err">✗ {{ f.error }}</p-text>
          <RenderBox v-else-if="f.tree" :node="f.tree" :color="backendColor(f.cfg.backendId)" :root="true" />
          <p-text v-else class="frame-err">{{ t('mdev.empty') }}</p-text>
        </p-view>
        <p-text class="frame-backend">{{ f.cfg.backendId }}</p-text>
      </p-view>
    </p-grid>
    <p-text v-if="treeErr" class="wall-err">✗ {{ treeErr }}</p-text>
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
.screen {
  margin: 10px 10px 4px;
  border: 1px solid;
  border-radius: 10px;
  padding: 8px;
  max-height: 230px;
  overflow: auto;
  background: rgba(255, 255, 255, 0.5);
}
.frame-err { color: var(--warn); font-size: 12px; }
.frame-backend {
  display: block;
  padding: 0 12px 10px;
  font-size: 11px;
  color: var(--dim);
  font-family: ui-monospace, Menlo, monospace;
}
.wall-err { color: var(--warn); font-size: 12.5px; }
</style>
