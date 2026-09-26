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
import { computed, ref } from 'vue'
import { locale } from '../i18n'
import FluidProduct from '../components/fluid-product/index.vue'
// ★SSOT：左栏源码 = 正在执行的这份文件（vite ?raw——零双源，不存在「展示的源码 ≠ 跑的源码」）
import fluidSource from '../components/fluid-product/index.vue?raw'

const isEn = computed(() => locale.value === 'en')
const showSource = ref(true)

interface Target {
  key: string
  ic: string
  nm: { zh: string; en: string }
  /** 设备视口（自然尺寸——p-zone 按此宽度真实判断点） */
  w: number
  h: number
  /** 展示宽（mosaic 视觉适配：scale = dw / w；断点判定按布局尺寸 w，不受缩放影响） */
  dw: number
  /** 输入形态（能力声明） */
  form: 'touch' | 'cursor' | 'remote' | 'dial'
  /** 端能力声明：true = 该端声明支持；缺省 = 不支持（源码走降级分支） */
  caps: { tabs?: boolean; rail?: boolean; focusRows?: boolean; dense?: boolean }
  /** 形态/导航说明（右侧面板） */
  nav: { zh: string; en: string }
}

const TARGETS: Target[] = [
  { key: 'watch', ic: '⌚', nm: { zh: '手表', en: 'Watch' }, w: 198, h: 214, dw: 168, form: 'dial', caps: { dense: true }, nav: { zh: '一屏一意 · 表冠滚动', en: 'one screen · crown' } },
  { key: 'phone', ic: '📱', nm: { zh: '手机', en: 'Phone' }, w: 390, h: 640, dw: 206, form: 'touch', caps: { tabs: true, dense: true }, nav: { zh: '单列 · 底部 Tab', en: 'single column · tab bar' } },
  { key: 'fold', ic: '📖', nm: { zh: '折叠屏 / 小平板', en: 'Fold / small tablet' }, w: 520, h: 520, dw: 246, form: 'touch', caps: { dense: true }, nav: { zh: '图 + 详情双列', en: 'duo columns' } },
  { key: 'tablet', ic: '📐', nm: { zh: '平板', en: 'Tablet' }, w: 834, h: 520, dw: 290, form: 'touch', caps: { rail: true, dense: true }, nav: { zh: '侧栏 + 多列', en: 'side rail · columns' } },
  { key: 'pc', ic: '💻', nm: { zh: 'PC / Mac', en: 'PC / Mac' }, w: 1280, h: 620, dw: 372, form: 'cursor', caps: { rail: true }, nav: { zh: '侧栏 + 三列 + hover', en: 'rail · 3 cols · hover' } },
  { key: 'car', ic: '🚗', nm: { zh: '车机', en: 'In-car' }, w: 1280, h: 420, dw: 372, form: 'remote', caps: { focusRows: true, dense: true }, nav: { zh: '焦点行 · d-pad 大热区', en: 'focus rows · d-pad targets' } },
  { key: 'tv', ic: '📺', nm: { zh: 'TV / 大屏', en: 'TV / large screen' }, w: 1920, h: 620, dw: 420, form: 'remote', caps: { focusRows: true }, nav: { zh: '海报流 · 遥控焦点', en: 'poster rail · remote focus' } },
]

/** 窄→宽排序展示（同屏 mosaic） */
const ordered = computed(() => [...TARGETS].sort((a, b) => a.w - b.w))

/** 缩放 = 展示宽 / 自然宽（ResizeObserver 按布局尺寸测量——断点判定不受 scale 影响） */
function scaleOf(t: Target): number {
  return t.dw / t.w
}

/** 断点阈值（与 @proteus-vue/fluid DEFAULT_BREAKPOINT_RATIOS × designWidth 375 同源） */
const BP = [
  { name: 'sm', min: 188 },
  { name: 'md', min: 328 },
  { name: 'lg', min: 469 },
  { name: 'xl', min: 609 },
]
function bpOf(w: number): string {
  let hit = 'sm'
  for (const b of BP) if (w >= b.min) hit = b.name
  return hit
}

/** 能力声明表（右侧面板——supported ✅ / 未声明 🟡 条件降级） */
const CAP_KEYS = [
  { k: 'tabs', zh: '底部 Tab', en: 'bottom tabs' },
  { k: 'rail', zh: '侧栏', en: 'side rail' },
  { k: 'focusRows', zh: '焦点行 / 大热区', en: 'focus rows / d-pad' },
  { k: 'dense', zh: '高密度信息', en: 'dense info' },
] as const

const active = ref('car')
const target = computed(() => TARGETS.find((t) => t.key === active.value) ?? TARGETS[0]!)

/** 右侧：当前端真实推导行（断点 = 容器宽真实求解；形态/导航 = 能力声明推导） */
const rows = computed(() => {
  const t = target.value
  return [
    { k: isEn.value ? 'target' : '目标端', v: isEn.value ? t.nm.en : t.nm.zh },
    { k: isEn.value ? 'viewport' : '容器宽', v: `${t.w} × ${t.h}` },
    { k: 'breakpoint', v: `${bpOf(t.w)}（p-zone 真实求解——决定渲染哪个槽）` },
    { k: 'form', v: t.form },
    { k: 'nav', v: isEn.value ? t.nav.en : t.nav.zh },
  ]
})

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
            ? 'Not the same layout scaled — the same file renders into entirely different structures per target. Two real mechanisms from the Fluid System drive it: container breakpoints (p-zone switches named slots by container width) and capability declarations (unsupported features take degradation branches).'
            : '不是同一布局的缩放——同一份文件在不同端渲染出完全不同的结构。驱动它的是柔性系统的两条真实机制：容器断点（p-zone 按容器宽度选命名槽）与能力声明（不支持的能力走降级分支）。下面每一个设备框都是真实渲染。'
        }}
      </p>
      <p-view class="honest">
        <p-text class="honest-text">
          {{
            isEn
              ? '✅ Real: container queries (p-zone), capability-driven branches, all seven frames render the actual SFC shown on the left. 🟡 This page injects the per-target capability table — in a real app it comes from the target profile (same supported / fallback / unsupported protocol as the component compatibility tables).'
              : '✅ 真实：容器断点（p-zone）、能力声明分支、七端渲染的都是左栏那份源码本身。🟡 端能力表由本页按端注入——真实项目里来自端 profile（与组件文档兼容进度表同一套 supported / fallback / unsupported 协议）。'
          }}
        </p-text>
      </p-view>
    </header>

    <section class="work">
      <!-- 左：源码（?raw = 正在执行的这份文件） -->
      <div class="col col--src">
        <div class="col-title">
          <span class="dot" />
          {{ isEn ? 'Source · this exact file is running' : '源码 · 运行的就是这份文件' }}
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
        <div class="grid">
          <div
            v-for="t in ordered"
            :key="t.key"
            class="device"
            :class="{ active: t.key === active }"
            @click="active = t.key"
          >
            <div class="dev-head">
              <span class="dev-nm">{{ t.ic }} {{ isEn ? t.nm.en : t.nm.zh }}</span>
              <span class="dev-bp">{{ bpOf(t.w) }}</span>
            </div>
            <div class="dev-body" :style="{ width: `${t.dw}px`, height: `${Math.round(t.h * scaleOf(t))}px` }">
              <div class="dev-screen" :style="{ width: `${t.w}px`, height: `${t.h}px`, transform: `scale(${scaleOf(t)})` }">
                <FluidProduct :form="t.form" :caps="t.caps" />
              </div>
            </div>
          </div>
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
        <h4 class="cap-title">{{ isEn ? 'Capability declarations' : '能力声明（按端）' }}</h4>
        <div class="cap-table">
          <div v-for="c in CAP_KEYS" :key="c.k" class="cap-row" :class="{ on: Boolean((target.caps as Record<string, boolean | undefined>)[c.k]) }">
            <span class="cap-dot" />
            <span class="cap-nm">{{ isEn ? c.en : c.zh }}</span>
            <span class="cap-v">{{ (target.caps as Record<string, boolean | undefined>)[c.k] ? (isEn ? 'declared' : '声明支持') : (isEn ? 'degraded' : '降级分支') }}</span>
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

/* 同屏 mosaic */
.grid { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-start; }
.device { flex: 0 0 auto; }
.device {
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 10px;
  background: var(--panel2);
  cursor: pointer;
  transition: border-color 0.15s ease;
}
.device:hover { border-color: rgba(124, 92, 255, 0.5); }
.device.active { border-color: var(--brand); box-shadow: 0 0 0 1px rgba(124, 92, 255, 0.35); }
.dev-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.dev-nm { font-size: 11.5px; font-weight: 700; color: var(--ink); }
.dev-bp { font-family: var(--mono); font-size: 10px; color: var(--brand-ink); background: var(--brand-soft); border-radius: 999px; padding: 2px 8px; }
.dev-body { overflow: hidden; border-radius: 8px; border: 1px solid var(--line); background: #f7f8fa; position: relative; }
.dev-screen { transform-origin: top left; }
.dev-screen :deep(.fp) { width: 100%; }

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
