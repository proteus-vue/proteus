<script setup lang="ts">
// website/src/pages/MultiDevice.vue —— 多端同屏（★2026-09-26 按柔性系统方向重建）
//
// ★故事（对齐设计本意）：一套代码打通**差异化的多端平台** —— 大屏 / 车机 / 手表差异极大，
//   渲染出的形态完全不同、能力声明也完全不同。这就是**柔性系统**要演示的东西。
//
// ★零伪造：左栏展示的就是本页正在执行的**同一份源码**（?raw 直读 fluid-product/index.vue），
//   中栏七端全部在页面上**真渲染**——
//     · 每端设备框是**自然宽度**（手表 198 / 手机 390 / 车机 1280 / TV 1920…），
//       transform: scale 只做视觉缩放（ResizeObserver 按布局尺寸测量，断点判定不受影响）；
//     · p-zone 按**容器宽度**真实求解断点槽（sm/md/lg/xl）——各端真的是不同的布局分支，
//       不是同一份布局的缩放；
//     · 能力声明（tabs/rail/focusRows）真实驱动降级分支（v-if）——车机声明无 SKU 多选、
//       手表声明无底部 Tab，源码里能看到分支，页面上能看到差异。
//
// ★诚实边界：端能力表（TARGETS.caps）在本页按端注入——真实项目里它来自端 profile
//   （与组件文档「双端兼容进度表」同源协议：supported / fallback / unsupported 三态）。
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { locale } from '../i18n'
import FluidProduct from '../components/fluid-product/index.vue'
// ★★Fluid System v2：形态画像 SSOT（本页所有形态信息都从这里读——页面不重复定义能力/拓扑）
import { FORM_PROFILES } from '@proteus-vue/fluid'
import type { DeviceForm, FormProfile } from '@proteus-vue/fluid'
// ★SSOT：左栏源码 = 正在执行的这份文件（vite ?raw——零双源，不存在「展示的源码 ≠ 跑的源码」）
import fluidSource from '../components/fluid-product/index.vue?raw'

const isEn = computed(() => locale.value === 'en')
const showSource = ref(true)

/** ★端清单 = FORM_PROFILES 的形态 SSOT（布局/导航/能力/缩放全部从画像读，页面不重复定义） */
interface Target {
  key: DeviceForm
  ic: string
  profile: FormProfile
}
const ICONS: Record<DeviceForm, string> = {
  watch: '⌚', phone: '📱', fold: '📖', tablet: '📐', pc: '💻', car: '🚗', tv: '📺',
}
const TARGETS: Target[] = (Object.keys(FORM_PROFILES) as DeviceForm[]).map((k) => ({
  key: k,
  ic: ICONS[k],
  profile: FORM_PROFILES[k],
}))

/**
 * ★展示模型（解决「真实设备宽度差 10 倍 → 等比缩放后大屏内容看不清」）：
 *   渲染视口 = 真实设备尺寸（p-formfactor 据此判定形态，形态语义真实）
 *   展示切片 cropW = 只截取该端**代表性区域**（如 PC 取「侧栏+主区」、TV 取「Hero+信息区」），
 *   使每端缩放在 0.4~0.85 之间 → 内容可读、形态差异可辨（业界设计稿展示的通行手法）。
 */
/** 窄→宽排序（视觉同屏的稳定顺序） */
const ordered = computed(() => [...TARGETS].sort((a, b) => a.profile.viewport.width - b.profile.viewport.width))

/** 缩略条展示宽（小图：看形态轮廓） */
const THUMB_W = 128
/** 主展示裁剪宽（★可读性关键：超出此宽只截取代表区，缩放 0.5~1 → 大屏内容也能看清） */
const MAIN_CROP_W = 740

/**
 * ★展示模型（主展示 + 缩略条）：
 *   主展示：设备视口按 MAIN_CROP_W 裁剪（多出的部分裁掉，露出侧栏/Hero 等特征区），
 *          缩放 = min(1, 740/vw) → 手表/手机满量呈现，大屏 0.39~0.58 倍（文字仍可读）
 *   缩略条：全部七形态小图并排（视觉同屏），点击切换主展示
 */
function viewOf(t: Target) {
  const vw = t.profile.viewport.width
  const vh = t.profile.viewport.height
  const scale = Math.min(1, MAIN_CROP_W / vw)
  const cropW = Math.min(vw, MAIN_CROP_W)
  const displayW = Math.round(cropW * scale)
  const displayH = Math.round(Math.min(vh, 520 / Math.max(scale, 0.4)) * scale)
  return { cropW, displayW, displayH, scale }
}
function thumbView(t: Target) {
  const vw = t.profile.viewport.width
  const vh = t.profile.viewport.height
  const scale = THUMB_W / vw
  return { displayW: THUMB_W, displayH: Math.round(Math.min(vh, vw * 0.7) * scale), scale }
}

const active = ref<DeviceForm>('car')

/** 形态筛选（按输入族聚焦查看——触控系 / 指针系 / 遥控系；默认全部） */
type FilterKey = 'all' | 'touch' | 'cursor' | 'remote'
// ★URL query 驱动（?form=remote）——筛选状态可分享、可直达、可复现（与 Playground 分享链接同思路）
const route = useRoute()
const router = useRouter()
const initial = (route.query.form as string) ?? 'all'
const filter = ref<FilterKey>(initial === 'touch' || initial === 'cursor' || initial === 'remote' ? initial : 'all')
watch(filter, (f) => {
  void router.replace({ query: f === 'all' ? {} : { form: f } })
})
const FILTERS: Array<{ k: FilterKey; zh: string; en: string }> = [
  { k: 'all', zh: '全部形态', en: 'All forms' },
  { k: 'touch', zh: '触控系（表/手机/折叠/平板）', en: 'Touch (watch/phone/fold/tablet)' },
  { k: 'cursor', zh: '指针系（PC）', en: 'Pointer (PC)' },
  { k: 'remote', zh: '遥控系（车机 / TV）', en: 'Remote (car / TV)' },
]
const visibleTargets = computed(() => {
  const list = ordered.value
  if (filter.value === 'all') return list
  if (filter.value === 'touch') return list.filter((t) => t.profile.input === 'touch')
  if (filter.value === 'cursor') return list.filter((t) => t.profile.input === 'cursor')
  return list.filter((t) => t.profile.input === 'remote')
})
const target = computed(() => TARGETS.find((t) => t.key === active.value) ?? TARGETS[0]!)

/** 右侧推导行（★全部来自形态画像——非页面硬编码） */
const rows = computed(() => {
  const t = target.value
  const p = t.profile
  return [
    { k: isEn.value ? 'form' : '设备形态', v: `${isEn.value ? p.label.en : p.label.zh}（${isEn.value ? t.profile.form : p.form}）` },
    { k: 'input', v: p.input },
    { k: isEn.value ? 'layout topology' : '布局拓扑', v: p.topology },
    { k: isEn.value ? 'navigation' : '导航形态', v: p.nav },
    { k: isEn.value ? 'density / scale' : '密度 / 缩放', v: `${p.density} · ${p.scale}×` },
    { k: isEn.value ? 'viewport' : '典型视口', v: `${p.viewport.width} × ${p.viewport.height}` },
  ]
})

/** 能力清单（★画像 SSOT 全量——不是固定的 4 项） */
const CAP_LABELS: Array<{ k: keyof FormProfile['caps']; zh: string; en: string }> = [
  { k: 'hover', zh: '指针悬停态', en: 'pointer hover' },
  { k: 'skuMulti', zh: '多规格选择', en: 'multi-SKU picker' },
  { k: 'tabs', zh: '底部 Tab 栏', en: 'bottom tabs' },
  { k: 'sidebar', zh: '持久侧栏', en: 'persistent sidebar' },
  { k: 'focusRows', zh: '横向焦点行', en: 'focus rows' },
  { k: 'dense', zh: '高密度信息', en: 'dense info' },
  { k: 'drawer', zh: '抽屉 / 侧滑弹层', en: 'drawer / sheet' },
  { k: 'notch', zh: '异形屏安全区', en: 'notch safe area' },
  { k: 'keyboard', zh: '物理键盘', en: 'hardware keyboard' },
  { k: 'driveAware', zh: '驾驶降干扰', en: 'drive-aware' },
]

const sourceLines = computed(() => fluidSource.split('\n').length)
</script>

<template>
  <p-view class="six-root">
    <header class="hero">
      <h1>
        {{ isEn ? 'One source, ' : '同一份源码，' }}<em>{{ isEn ? 'seven terminals, radically different forms' : '七种终端，形态完全不同' }}</em>
      </h1>
      <p>
        {{
          isEn
            ? 'The business writes one set of semantic content slots — nothing else. The framework senses the device form and derives layout topology, navigation, capability set, density, scale and hit-area size automatically. Same file, seven forms, zero per-device branching.'
            : '业务只写一份语义内容槽——没有别的。框架感知设备形态后，自动推导布局拓扑、导航形态、能力集、密度、缩放与热区尺寸。同一份文件、七种形态、业务零分支。'
        }}
      </p>
      <p-view class="honest">
        <p-text class="honest-text">
          {{
            isEn
              ? '✅ Real: form-factor profiles (FORM_PROFILES SSOT in @proteus-vue/fluid) + p-formfactor auto-orchestration + all seven frames rendering the left file. 🟡 Forms are declared by the host (watch/car/tv cannot be auto-detected on the web) — detecting pointer/touch and viewport is real.'
              : '✅ 真实：形态画像表（@proteus-vue/fluid 的 FORM_PROFILES SSOT）+ p-formfactor 自动编排 + 七端渲染的都是左栏那份文件。🟡 形态由宿主声明（Web 无法自动识别手表/车机/TV）——指针/触控与视口探测是真实的。'
          }}
        </p-text>
      </p-view>
    </header>

    <section class="work">
      <!-- 左：源码（?raw = 正在执行的这份文件） -->
      <div class="col col--src">
        <div class="col-title">
          <span class="dot" />
          {{ isEn ? 'Content slots · this exact file is running' : '内容槽 · 运行的就是这份文件' }}
          <button type="button" class="mini" @click="showSource = !showSource">{{ showSource ? (isEn ? 'hide' : '收起') : (isEn ? 'show' : '展开') }}</button>
        </div>
        <pre v-if="showSource" class="src"><code>{{ fluidSource }}</code></pre>
        <div class="src-foot">
          <span class="eq">✓</span>
          {{
            isEn
              ? `${sourceLines} lines · imported with ?raw from the very component being rendered — zero dual source`
              : `${sourceLines} 行 · ?raw 直读「正在被渲染的那个组件」——零双源`
          }}
        </div>
      </div>

      <!-- 中：同屏（真实渲染 mosaic） -->
      <div class="col col--stage">
        <div class="col-title"><span class="dot" /><span class="live">LIVE</span> {{ isEn ? 'Same screen · all real renders' : '同屏 · 全部真实渲染' }}</div>
        <div class="filters">
          <button
            v-for="f in FILTERS"
            :key="f.k"
            type="button"
            class="filter-pill"
            :class="{ on: filter === f.k }"
            @click="filter = f.k"
          >{{ isEn ? f.en : f.zh }}</button>
        </div>
        <!-- ★主展示：当前形态的细节（可读尺寸） -->
        <div class="main-stage">
          <div class="ms-head">
            <span class="ms-nm">{{ target.ic }} {{ isEn ? target.profile.label.en : target.profile.label.zh }}</span>
            <span class="ms-topo">{{ target.profile.topology }}</span>
            <span class="ms-input">{{ target.profile.input }}</span>
          </div>
          <div
            class="ms-body"
            :style="{ width: `${viewOf(target).displayW}px`, height: `${viewOf(target).displayH}px`, borderColor: target.profile.caps.focusRows ? 'rgba(255,180,84,0.4)' : 'var(--line)' }"
          >
            <div
              class="ms-screen"
              :style="{
                width: `${target.profile.viewport.width}px`,
                height: `${target.profile.viewport.height}px`,
                transform: `scale(${viewOf(target).scale})`,
              }"
            >
              <FluidProduct :form="target.key" :width="target.profile.viewport.width" :height="target.profile.viewport.height" />
            </div>
          </div>
        </div>

        <!-- ★缩略条：七形态视觉同屏（点击切换） -->
        <div class="thumbs">
          <button
            v-for="t in visibleTargets"
            :key="t.key"
            type="button"
            class="thumb"
            :class="{ on: t.key === active }"
            @click="active = t.key"
          >
            <span class="thumb-nm">{{ t.ic }} {{ isEn ? t.profile.label.en : t.profile.label.zh }}</span>
            <span class="thumb-ic" :style="{ width: `${thumbView(t).displayW}px`, height: `${thumbView(t).displayH}px` }">
              <span
                class="thumb-screen"
                :style="{ width: `${t.profile.viewport.width}px`, height: `${t.profile.viewport.height}px`, transform: `scale(${thumbView(t).scale})` }"
              >
                <FluidProduct :form="t.key" :width="t.profile.viewport.width" :height="t.profile.viewport.height" />
              </span>
            </span>
            <span class="thumb-topo">{{ t.profile.topology }}</span>
          </button>
        </div>
      </div>

      <!-- 右：能力声明（真实数据） -->
      <div class="col col--panel">
        <div class="col-title"><span class="dot" />{{ isEn ? 'Declaration · derived from the container' : '能力声明 · 由容器真实推导' }}</div>
        <div class="ir">
          <div v-for="r in rows" :key="r.k" class="row">
            <span class="k">{{ r.k }}</span>
            <span class="v">{{ r.v }}</span>
          </div>
        </div>
        <h4 class="cap-title">{{ isEn ? 'Capability declarations (from the form profile)' : '能力声明（来自形态画像 SSOT）' }}</h4>
        <div class="cap-table">
          <div
            v-for="c in CAP_LABELS"
            :key="c.k"
            class="cap-row"
            :class="{ on: target.profile.caps[c.k] }"
          >
            <span class="cap-dot" />
            <span class="cap-nm">{{ isEn ? c.en : c.zh }}</span>
            <span class="cap-v">{{ target.profile.caps[c.k] ? (isEn ? 'declared' : '声明支持') : (isEn ? 'auto-degraded' : '自动降级') }}</span>
          </div>
        </div>
        <p-view class="cap-note">
          <p-text class="cap-note-text">
            {{
              isEn
                ? 'Click a device to inspect its declaration — the highlighted one drives the branches you see rendered.'
                : '点击任一设备查看其能力声明——高亮项即源码里真实生效的分支。'
            }}
          </p-text>
        </p-view>
      </div>
    </section>
  </p-view>
</template>

<style scoped>
.six-root { max-width: 1440px; margin: 0 auto; padding: 6px 0 44px; }
.hero h1 { color: var(--ink); font-size: 26px; font-weight: 800; margin: 6px 0 10px; }
.hero h1 em { color: var(--brand-ink); font-style: normal; }
.hero > p { color: var(--muted); font-size: 13.5px; line-height: 1.75; max-width: 820px; }
.honest {
  margin-top: 12px;
  padding: 10px 14px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-left: 3px solid var(--brand);
  border-radius: 8px;
  max-width: 900px;
}
.honest-text { font-size: 12px; color: var(--muted); line-height: 1.7; }

.work { margin-top: 22px; display: grid; grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.5fr) minmax(0, 0.75fr); gap: 16px; }
.col { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 14px; min-width: 0; }
.col-title { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 700; color: var(--muted); margin-bottom: 12px; }
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--brand); }
.live { font-size: 10px; font-weight: 800; letter-spacing: 0.6px; color: var(--ok, #3ddc97); }
.mini {
  margin-left: auto; font-size: 10.5px; color: var(--muted);
  background: transparent; border: 1px solid var(--line); border-radius: 999px; padding: 3px 10px; cursor: pointer;
}
.src {
  margin: 0; background: var(--panel2); border: 1px solid var(--line-soft); border-radius: 10px;
  padding: 12px; font-family: var(--mono); font-size: 10px; line-height: 1.6; color: var(--ink);
  overflow: auto; max-height: 640px; white-space: pre;
}
.src-foot { margin-top: 10px; font-size: 11px; color: var(--dim); }
.eq { color: var(--ok, #3ddc97); font-weight: 800; }

/* 形态筛选 pills */
.filters { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 12px; }
.filter-pill {
  font-size: 11px;
  font-weight: 700;
  color: var(--muted);
  background: var(--panel2);
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 5px 12px;
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease;
}
.filter-pill:hover { color: var(--ink); }
.filter-pill.on { color: var(--brand-ink); border-color: rgba(124, 92, 255, 0.55); background: var(--brand-soft); }

/* 主展示（细节可读） */
.main-stage { margin-bottom: 14px; }
.ms-head { display: flex; align-items: center; gap: 9px; margin-bottom: 9px; }
.ms-nm { font-size: 13px; font-weight: 800; color: var(--ink); }
.ms-topo {
  font-family: var(--mono); font-size: 10.5px; color: var(--brand-ink);
  background: var(--brand-soft); border-radius: 999px; padding: 3px 9px;
}
.ms-input { font-family: var(--mono); font-size: 10.5px; color: var(--dim); }
.ms-body {
  max-width: 100%;
  border: 1px solid var(--line);
  border-radius: 12px;
  overflow: hidden;
  background: #f7f8fa;
  position: relative;
}
.ms-screen { transform-origin: top left; }

/* 缩略条（七形态视觉同屏对比） */
.thumbs { display: flex; flex-wrap: wrap; gap: 9px; }
.thumb {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  padding: 8px;
  background: var(--panel2);
  border: 1px solid var(--line);
  border-radius: 10px;
  cursor: pointer;
  transition: border-color 0.15s ease;
}
.thumb:hover { border-color: rgba(124, 92, 255, 0.5); }
.thumb.on { border-color: var(--brand); box-shadow: 0 0 0 1px rgba(124, 92, 255, 0.35); }
.thumb-nm { font-size: 10.5px; font-weight: 700; color: var(--ink); }
.thumb-ic { display: block; overflow: hidden; border-radius: 6px; background: #f7f8fa; position: relative; }
.thumb-screen { transform-origin: top left; display: block; }
.thumb-topo { font-family: var(--mono); font-size: 9px; color: var(--dim); }

/* 右侧面板 */
.ir { display: grid; gap: 7px; }
.row { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; padding: 7px 10px; background: var(--panel2); border: 1px solid var(--line-soft); border-radius: 8px; }
.row .k { font-size: 10.5px; color: var(--dim); font-weight: 700; flex-shrink: 0; }
.row .v { font-family: var(--mono); font-size: 11px; color: var(--ink); text-align: right; word-break: break-word; }
.cap-title { margin: 16px 0 8px; font-size: 12.5px; color: var(--muted); }
.cap-table { display: grid; gap: 6px; }
.cap-row { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-radius: 8px; background: rgba(255, 180, 84, 0.07); border: 1px solid rgba(255, 180, 84, 0.22); }
.cap-row.on { background: rgba(61, 220, 151, 0.08); border-color: rgba(61, 220, 151, 0.28); }
.cap-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--warn, #ffb454); }
.cap-row.on .cap-dot { background: var(--ok, #3ddc97); }
.cap-nm { flex: 1; font-size: 11.5px; color: var(--ink); }
.cap-v { font-size: 10px; color: var(--dim); }
.cap-note { margin-top: 12px; }
.cap-note-text { font-size: 11px; color: var(--dim); line-height: 1.6; }

@media (max-width: 1240px) {
  .work { grid-template-columns: 1fr; }
}
</style>
