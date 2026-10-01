<script setup lang="ts">
// website/src/components/anim/StarfieldBackdrop.vue —— ★★★**真实星空背景**（产品页的"深空"）
//
// 【能不能做？——能力映射（每一条都是引擎的真能力，不是贴图/视频/第三方库）】
//   "真实星空"在视觉上拆开是五件事，逐条对应到引擎的声明面：
//     ① **去同步闪烁**（星空最要紧的一条：每颗星有自己的呼吸周期）——
//        N 条 `opacity` 无限循环（`repeat:'infinite'` + `alternate`），**周期逐星不同**
//        （1.8s–7.2s 由种子随机生成）⇒ 相位自然散开，不会"整片一起闪"。
//        ★这正是引擎擅长的形态：**几百条互不同步的无限循环**（真机侧同一条声明由内核求值）。
//     ② **亮度/尺寸分布**（少数亮星、多数微光——"真实"的来源之一）——
//        三层景深（far 110 / mid 48 / near 26）各有尺寸与亮度区间；亮星额外 `scale` 呼吸。
//     ③ **流星**——`strokeProgress` 让尾迹**自己画出来**（0→1 沿弧长），
//        配 `translate` 划过天际 + `opacity` 包络（keyframes 序列：亮起→拖尾淡出→长静默）。
//        ★静默段由**序列里的长尾段**表达（不是定时器）；三者全是声明面原语。
//     ④ **多层视差**——**一条进度 → 三个节点**：指针横移映射为进度，三层各按自己的振幅偏移
//        （near ±22px / mid ±12px / far ±6px）——与真机手势 seek 同构（手指到哪、画面到哪）。
//     ⑤ **星云/银河带**——大尺度径向渐变（静态 paint）+ 超慢漂移（90–140s 周期）与呼吸。
//
// 【★诚实边界（写在这里，也会如实答给用户）】
//   · 这不是 GPU 粒子系统：浏览器宿主写 DOM，健康区间是**几百颗星**（几百条循环）。
//     "十万粒子"级别的星空需要 canvas/shader 渲染后端——**不在当前能力集内**，不假装有。
//   · 写层分层节流（`writeStride`）：远景星 30Hz（周期 3–7s，视觉无差别）、近景 60Hz
//     ——只降**写层频率**，不改求值语义（曲线仍每帧照算）。
//   · `prefers-reduced-motion`：星空**静态呈现**（按基线亮度画上，无闪烁/无流星/无视差）。
//
// 【性能设计（实测导向）】
//   · 星体的光晕用**静态径向渐变**（不用逐帧 drop-shadow——那是 GPU 光栅税）；
//   · 视差用**一个** runner 驱动三个节点（一次 seek 写三层）；
//   · `density` 按视口分档（窄屏 92 颗 / 常规 184 颗）。
import { onMounted, onUnmounted, ref } from 'vue'
import type { EngineAnim } from '@proteus-vue/animation'
import { compile, createRunner, motionAllowed, type Runner } from '../../motion/engine-motion'

/* ═══════════════ 生成（种子确定性——每次加载同一片星空，便于验收/截图对账） ═══════════════ */

/** mulberry32（小、快、确定的 PRNG——星场每次加载一致） */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 星色温（白 / 冷白 / 暖白 / 淡蓝——"真实"里的色温微差） */
const TEMPS = ['#ffffff', '#e9f0ff', '#fff3da', '#d7e7ff'] as const
const TEMP_W = [0.52, 0.22, 0.16, 0.1] as const

interface Star {
  id: number
  /** 位置（视口百分比——星空不与内容同滚） */
  x: number
  y: number
  /** 元素尺寸 px（含渐变光晕） */
  size: number
  color: string
  /** 基线 / 峰值亮度（呼吸的两端） */
  base: number
  peak: number
  /** 呼吸周期 ms（逐星不同 = 去同步的关键） */
  period: number
  /** 亮星额外做 scale 呼吸 */
  pulse: boolean
  tier: 0 | 1 | 2
}

/**
 * 生成星场：三层景深各有尺寸/亮度区间（分布"少数亮、多数微光"）。
 * `density`: 0 = 常规（184 颗）· 1 = 窄屏（92 颗）——按视口一次性分档。
 */
function makeStars(density: 0 | 1): Star[] {
  const r = rng(0x5eed2026 ^ (density === 1 ? 0x9e3779b9 : 0))
  const tiers =
    density === 1
      ? [
          { n: 58, size: [1.2, 1.8], base: [0.16, 0.36], peak: [0.5, 0.86], per: [3200, 7000], pulseP: 0 },
          { n: 24, size: [1.8, 2.6], base: [0.22, 0.46], peak: [0.62, 0.95], per: [2400, 5200], pulseP: 0.2 },
          { n: 10, size: [2.6, 3.8], base: [0.3, 0.55], peak: [0.8, 1], per: [1900, 3900], pulseP: 1 },
        ]
      : [
          { n: 110, size: [1.2, 1.8], base: [0.16, 0.36], peak: [0.5, 0.86], per: [3200, 7200], pulseP: 0 },
          { n: 48, size: [1.8, 2.6], base: [0.22, 0.46], peak: [0.62, 0.95], per: [2400, 5200], pulseP: 0.2 },
          { n: 26, size: [2.6, 3.8], base: [0.3, 0.55], peak: [0.8, 1], per: [1900, 3900], pulseP: 1 },
        ]
  const pick = (): string => {
    const u = r()
    let acc = 0
    for (let i = 0; i < TEMP_W.length; i++) {
      acc += TEMP_W[i]!
      if (u < acc) return TEMPS[i]!
    }
    return TEMPS[0]!
  }
  const lerp = (a: number, b: number, u: number): number => a + (b - a) * u
  const stars: Star[] = []
  let id = 1
  tiers.forEach((t, tier) => {
    for (let i = 0; i < t.n; i++) {
      stars.push({
        id: id++,
        x: r() * 100,
        y: r() * 100,
        size: lerp(t.size[0]!, t.size[1]!, r()),
        color: pick(),
        base: lerp(t.base[0]!, t.base[1]!, r()),
        peak: lerp(t.peak[0]!, t.peak[1]!, r()),
        period: Math.round(lerp(t.per[0]!, t.per[1]!, r())),
        pulse: r() < t.pulseP,
        tier: tier as 0 | 1 | 2,
      })
    }
  })
  return stars
}

/** 视口分档（一次性读；无观察器——d2-exempt 见下） */
function pickDensity(): 0 | 1 {
  const w = globalThis.innerWidth || 0 // d2-exempt: 星空密度按视口一次性分档（无框架原语；不装观察器）
  return w > 0 && w < 720 ? 1 : 0
}

const stars = ref<Star[]>([])
const farStars = ref<Star[]>([])
const midStars = ref<Star[]>([])
const nearStars = ref<Star[]>([])
const meteorRoots = ref<Array<{ x0: number; y0: number; angle: number }>>([])

/* ═══════════════ 节点命名（每个 runner 独立命名空间；slots 各自建） ═══════════════ */

// 星：nodeId = 数组下标 + 1（呼吸 runner 用）；近/中景的 scale 用同一 nodeId（同节点多属性）
let starEls: HTMLElement[] = []
let farRunner: Runner | null = null
let nearRunner: Runner | null = null
let meteorRunner: Runner | null = null
let parallaxRunner: Runner | null = null
let skyRunner: Runner | null = null
let ptrRaf = 0
let scrollRaf = 0
let targetP = 0.5
let curP = 0.5
const reduced = ref(false)

const rootEl = ref<HTMLElement>()
let cleanupPtr: (() => void) | null = null
let cleanupScroll: (() => void) | null = null
const farEl = ref<HTMLElement>()
const midEl = ref<HTMLElement>()
const nearEl = ref<HTMLElement>()
const nebulaEl = ref<HTMLElement>()
const meteorEl = ref<HTMLElement>()
const meteorLineEls = ref<SVGLineElement[]>([])

onMounted(() => {
  const density = pickDensity()
  stars.value = makeStars(density)
  farStars.value = stars.value.filter((st) => st.tier === 0)
  midStars.value = stars.value.filter((st) => st.tier === 1)
  nearStars.value = stars.value.filter((st) => st.tier === 2)
  reduced.value = !motionAllowed()
  // 流星：5 条，散布在上半天空，各自角度/起点不同（周期不同 ⇒ 不会同步出现）
  const r = rng(0x1ce1ce)
  meteorRoots.value = Array.from({ length: 5 }, () => ({
    x0: -18 + r() * 30,
    y0: 4 + r() * 34,
    angle: 14 + r() * 16,
  }))

  // 等一帧：星元素挂载完再装配（每层各自查 DOM——按 id 建槽，不做下标假设）
  requestAnimationFrame(() => {
    const root = rootEl.value
    if (!root) return
    const byLayer = (layer: HTMLElement | undefined): HTMLElement[] =>
      layer ? Array.from(layer.querySelectorAll<HTMLElement>('[data-star]')) : []

    if (reduced.value) {
      // 静态星空：按基线亮度直出（无循环、无流星、无视差）
      for (const list of [farStars.value, midStars.value, nearStars.value]) {
        const els = byLayer(list === farStars.value ? farEl.value : list === midStars.value ? midEl.value : nearEl.value)
        list.forEach((st, i) => {
          const el = els[i]
          if (el) el.style.opacity = String(st.base + (st.peak - st.base) * 0.45)
        })
      }
      // ★流星整体藏掉（2026-10-01 实测抓出的降级缺陷）：没有 runner ⇒ 它们的 inline opacity
      //   停在 CSS 初值 1 ⇒ **五条亮线挂在天上**（截图可见）。降级环境下流星本就不该存在。
      meteorRoots.value.forEach((_m, k) => {
        const el = meteorEl.value?.children[k] as HTMLElement | undefined
        if (el) el.style.opacity = '0'
      })
      return
    }

    const twinkleOf = (st: Star): EngineAnim[] =>
      compile(
        [{ kind: 'opacity', from: st.base, to: st.peak, durationMs: st.period, repeat: 'infinite', direction: 'alternate', curve: 'easeInOut' }],
        st.id,
      )
    const pulseOf = (st: Star): EngineAnim[] =>
      st.pulse
        ? compile([{ kind: 'scale', from: 1, to: 1.16, durationMs: Math.round(st.period * 1.31), repeat: 'infinite', direction: 'alternate', curve: 'easeInOut' }], st.id)
        : []

    // 远景 30Hz 写层（周期 3–7s，视觉无差别）/ 中+近景 60Hz
    const farSlots = new Map<number, HTMLElement>()
    const farAnims: EngineAnim[] = []
    byLayer(farEl.value).forEach((el, i) => {
      const st = farStars.value[i]
      if (!st) return
      farSlots.set(st.id, el)
      farAnims.push(...twinkleOf(st))
    })
    const nearSlots = new Map<number, HTMLElement>()
    const nearAnims: EngineAnim[] = []
    byLayer(midEl.value).forEach((el, i) => {
      const st = midStars.value[i]
      if (!st) return
      nearSlots.set(st.id, el)
      nearAnims.push(...twinkleOf(st), ...pulseOf(st))
    })
    byLayer(nearEl.value).forEach((el, i) => {
      const st = nearStars.value[i]
      if (!st) return
      nearSlots.set(st.id, el)
      nearAnims.push(...twinkleOf(st), ...pulseOf(st))
    })
    farRunner = createRunner(farAnims, farSlots, { writeStride: 4 }) // 远景 15Hz（周期 3.2–7.2s，视觉无差别）
    nearRunner = createRunner(nearAnims, nearSlots, { writeStride: 2 }) // 近+中景 30Hz（呼吸周期 ≥1.9s）
    farRunner.play()
    nearRunner.play()

    // ③ 流星：strokeProgress 画尾迹 + translate 划过 + opacity 包络（keyframes 长尾静默）
    const mSlots = new Map<number, SVGElement | HTMLElement>()
    const mAnims: EngineAnim[] = []
    const mLens = new Map<number, number>()
    meteorRoots.value.forEach((_m, k) => {
      const rootEl2 = meteorEl.value?.children[k] as HTMLElement | undefined
      if (!rootEl2) return
      const line = meteorLineEls.value[k]
      const cycle = 9200 + k * 1650
      const travel = 780 + k * 130
      const gid = 1000 + k
      const lid = 2000 + k
      mSlots.set(gid, rootEl2)
      if (line) {
        mSlots.set(lid, line)
        if (typeof line.getTotalLength === 'function') mLens.set(lid, line.getTotalLength())
      }
      mAnims.push(
        ...compile(
          [
            {
              kind: 'translateX',
              from: 0,
              to: travel,
              durationMs: cycle,
              repeat: 'infinite',
              // ★sequence 模式不能说 curve（引擎校验：段内曲线由每段自己的 curve 决定）
              keyframes: [
                { to: travel, durationMs: travel, curve: 'easeIn' },
                { to: travel, durationMs: cycle - travel, curve: 'linear' },
              ],
            },
            {
              kind: 'opacity',
              from: 0,
              to: 0,
              durationMs: cycle,
              delayMs: 420 + k * 1750,
              repeat: 'infinite',
              keyframes: [
                { to: 1, durationMs: Math.round(travel * 0.22), curve: 'easeOut' },
                { to: 0, durationMs: cycle - Math.round(travel * 0.22), curve: 'easeIn' },
              ],
            },
          ],
          gid,
        ),
      )
      if (line) {
        mAnims.push(
          ...compile(
            [
              {
                kind: 'strokeProgress',
                from: 0,
                to: 1,
                durationMs: cycle,
                repeat: 'infinite',
                keyframes: [
                  { to: 1, durationMs: travel, curve: 'easeOut' },
                  { to: 1, durationMs: cycle - travel, curve: 'linear' },
                ],
              },
            ],
            lid,
          ),
        )
      }
    })
    if (mAnims.length) {
      meteorRunner = createRunner(mAnims, mSlots, { strokeLens: mLens })
      meteorRunner.play()
    }

    // ④ 视差：**一条进度 → 三个节点**（指针横移 → seek；三层各按自己的振幅）
    const pSlots = new Map<number, HTMLElement>()
    const pAnims: EngineAnim[] = []
    const layers: Array<[HTMLElement | undefined, number]> = [
      [farEl.value, 6],
      [midEl.value, 12],
      [nearEl.value, 22],
    ]
    layers.forEach(([el, amp], i) => {
      if (!el) return
      pSlots.set(i + 1, el)
      pAnims.push(...compile([{ kind: 'translateX', from: -amp, to: amp, durationMs: 1000, curve: 'linear' }], i + 1))
    })
    if (pAnims.length) {
      // ★`durationMs` 必须与声明时长一致（1000）：`seek(p)` 是按**名义跨度**映射到时间的
      //   （首版传 1ms ⇒ u≈0 ⇒ 三层永远贴在 from 值上——实测 transform 恒为 -21.98 抓出）
      const pr = createRunner(pAnims, pSlots, { durationMs: 1000 })
      pr.seek(0.5) // 立即写一次中位（不等第一次指针事件——否则初始 transform=none）
      parallaxRunner = pr
      const onMove = (ev: PointerEvent): void => {
        const w = globalThis.innerWidth || 1 // d2-exempt: 指针横移比例（无框架原语；与真机 seek 同构）
        targetP = Math.max(0, Math.min(1, ev.clientX / w))
        if (!ptrRaf) ptrRaf = requestAnimationFrame(lerpTo)
      }
      const lerpTo = (): void => {
        curP += (targetP - curP) * 0.06
        parallaxRunner?.seek(curP)
        ptrRaf = Math.abs(curP - targetP) > 0.002 ? requestAnimationFrame(lerpTo) : 0
      }
      globalThis.addEventListener('pointermove', onMove) // d2-exempt: 全页指针视差（无框架原语；与真机 seek 同构）
      cleanupPtr = (): void => {
        globalThis.removeEventListener('pointermove', onMove) // d2-exempt: 清理（同上因）
        if (ptrRaf) cancelAnimationFrame(ptrRaf)
        ptrRaf = 0
      }
    }

    // ⑤ 天空整体随滚动**微旋**（深空感；一个节点、进度驱动）+ 星云呼吸
    const skySlots = new Map<number, HTMLElement>()
    const skyAnims: EngineAnim[] = []
    if (nebulaEl.value) {
      skySlots.set(1, nebulaEl.value)
      skyAnims.push(...compile([{ kind: 'rotate', from: -1.2, to: 1.2, durationMs: 1000, curve: 'linear' }], 1))
      skyAnims.push(...compile([{ kind: 'opacity', from: 0.55, to: 1, durationMs: 46000, repeat: 'infinite', direction: 'alternate', curve: 'easeInOut' }], 1))
    }
    if (skyAnims.length) {
      // 同上：名义跨度 = 声明的 1000ms，滚动进度才能 1:1 映射
      const sr = createRunner(skyAnims, skySlots, { durationMs: 1000 })
      skyRunner = sr
      const onScroll = (): void => {
        if (scrollRaf) return
        scrollRaf = requestAnimationFrame(() => {
          scrollRaf = 0
          const doc = globalThis.document // d2-exempt: 滚动进度（无框架原语；驱动天空微旋）
          const max = Math.max(1, (doc?.documentElement?.scrollHeight ?? 1) - (globalThis.innerHeight || 1))
          const p = Math.max(0, Math.min(1, (globalThis.scrollY || 0) / max)) // d2-exempt: 同上
          skyRunner?.seek(p)
        })
      }
      globalThis.addEventListener('scroll', onScroll, { passive: true }) // d2-exempt: 滚动联动（同上因）
      cleanupScroll = (): void => {
        globalThis.removeEventListener('scroll', onScroll) // d2-exempt: 清理（同上因）
        if (scrollRaf) cancelAnimationFrame(scrollRaf)
      }
    }
  })
})

onUnmounted(() => {
  farRunner?.stop()
  nearRunner?.stop()
  meteorRunner?.stop()
  parallaxRunner?.stop()
  skyRunner?.stop()
  cleanupPtr?.()
  cleanupScroll?.()
})
</script>

<template>
  <!-- ★星空（全视口固定；不与内容同滚 = "天空"隐喻）——纯背景：不接收指针事件 -->
  <div ref="rootEl" class="sky" :data-star-count="stars.length" aria-hidden="true">
    <!-- 星云 / 银河带（大尺度渐变 + 超慢漂移；随滚动微旋） -->
    <div ref="nebulaEl" class="sky-nebula">
      <span class="sky-band" />
      <span class="sky-blob sky-blob--a" />
      <span class="sky-blob sky-blob--b" />
      <span class="sky-blob sky-blob--c" />
    </div>

    <!-- 三层星场（视差各按自己的振幅偏移——wrapper 被视差 runner 平移） -->
    <div ref="farEl" class="sky-layer sky-layer--far">
      <span
        v-for="s in farStars"
        :key="`f${s.id}`"
        data-star
        class="sky-star"
        :style="{ left: s.x + '%', top: s.y + '%', width: s.size + 'px', height: s.size + 'px', marginLeft: -s.size / 2 + 'px', marginTop: -s.size / 2 + 'px', background: `radial-gradient(circle, ${s.color} 0%, ${s.color} 42%, transparent 100%)` }"
      />
    </div>
    <div ref="midEl" class="sky-layer sky-layer--mid">
      <span
        v-for="s in midStars"
        :key="`m${s.id}`"
        data-star
        class="sky-star"
        :style="{ left: s.x + '%', top: s.y + '%', width: s.size + 'px', height: s.size + 'px', marginLeft: -s.size / 2 + 'px', marginTop: -s.size / 2 + 'px', background: `radial-gradient(circle, ${s.color} 0%, ${s.color} 40%, transparent 100%)` }"
      />
    </div>
    <div ref="nearEl" class="sky-layer sky-layer--near">
      <span
        v-for="s in nearStars"
        :key="`n${s.id}`"
        data-star
        class="sky-star sky-star--near"
        :style="{ left: s.x + '%', top: s.y + '%', width: s.size + 'px', height: s.size + 'px', marginLeft: -s.size / 2 + 'px', marginTop: -s.size / 2 + 'px', background: `radial-gradient(circle, ${s.color} 0%, ${s.color} 30%, transparent 100%)` }"
      />
    </div>

    <!-- 流星（5 条：尾迹由 strokeProgress 自己画出来；静止时不可见） -->
    <div ref="meteorEl" class="sky-meteors">
      <div
        v-for="(m, k) in meteorRoots"
        :key="`me${k}`"
        class="sky-meteor"
        :style="{ left: m.x0 + '%', top: m.y0 + '%', transform: `rotate(${m.angle}deg)` }"
      >
        <svg width="180" height="16" viewBox="0 0 180 16" fill="none">
          <line ref="meteorLineEls" x1="4" y1="8" x2="170" y2="8" stroke="url(#meteorGrad)" stroke-width="1.4" stroke-linecap="round" class="sky-meteor-line" />
          <circle cx="171" cy="8" r="1.7" fill="#fff" opacity="0.95" />
        </svg>
      </div>
      <svg width="0" height="0" aria-hidden="true">
        <defs>
          <linearGradient id="meteorGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#ffffff" stop-opacity="0" />
            <stop offset="0.75" stop-color="#dfe9ff" stop-opacity="0.85" />
            <stop offset="1" stop-color="#ffffff" stop-opacity="1" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  </div>
</template>

<style scoped>
.sky {
  position: fixed;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
}
.sky-layer { position: absolute; inset: 0; will-change: transform; }
.sky-star {
  position: absolute;
  display: block;
  border-radius: 50%;
  opacity: 0;
}
/* ★亮星的光晕**不用 box-shadow**（那是逐帧重复栅格税）——由外层渐变自己表达；
   此处只做一点整体提亮，让近景星在深底上"立得住" */
.sky-star--near { filter: brightness(1.18); }
/* 星云与银河带（静态 paint；只做超慢漂移/呼吸/滚动微旋） */
.sky-nebula { position: absolute; inset: -6%; will-change: transform; }
.sky-band {
  position: absolute;
  left: -12%;
  top: 34%;
  width: 124%;
  height: 30%;
  transform: rotate(-11deg);
  background: linear-gradient(180deg, transparent 0%, rgba(124, 92, 255, 0.07) 26%, rgba(178, 202, 255, 0.11) 48%, rgba(124, 92, 255, 0.07) 70%, transparent 100%);
  filter: blur(14px);
}
.sky-blob {
  position: absolute;
  border-radius: 50%;
  filter: blur(26px);
}
.sky-blob--a {
  left: 8%;
  top: -6%;
  width: 46%;
  height: 42%;
  background: radial-gradient(50% 50% at 50% 50%, rgba(124, 92, 255, 0.16), transparent 72%);
}
.sky-blob--b {
  right: 2%;
  top: 20%;
  width: 40%;
  height: 34%;
  background: radial-gradient(50% 50% at 50% 50%, rgba(90, 130, 255, 0.1), transparent 72%);
}
.sky-blob--c {
  left: 30%;
  bottom: -12%;
  width: 52%;
  height: 38%;
  background: radial-gradient(50% 50% at 50% 50%, rgba(255, 138, 92, 0.06), transparent 72%);
}
.sky-meteors { position: absolute; inset: 0; }
.sky-meteor { position: absolute; will-change: transform; }
.sky-meteor-line {
  /* 未画态兜底（引擎写入 dasharray/dashoffset 后接管） */
  stroke-dasharray: 200;
  stroke-dashoffset: 200;
}
</style>
