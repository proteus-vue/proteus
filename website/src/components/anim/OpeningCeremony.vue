<script setup lang="ts">
// website/src/components/anim/OpeningCeremony.vue —— ★★**开幕仪式**：引擎把自己的产品页"打开"
//
// 【它为什么存在（灵魂元素的第二件）】
//   动画引擎的官网，开场不该是"渐显的标题"——应当是**引擎当场证明自己**：
//   徽记**自己落笔成形**（strokeProgress）→ 核心点亮（glowIntensity）→ 标题**从雾里渗开**
//   （maskProgress 软边揭示）→ 标题隐去、暗场退潮，**徽记飞向 Hero 位置落位**——
//   与页面里那枚本来就在的徽记**重合**（共享元素式交棒：几何=两帧矩形之差 + 宽度比，
//   与内核 `sharedElement` 同一套分解；真机上那一步的几何由内核算，浏览器宿主在这里代算，
//   如实标注）。⇒ 开幕不是一个"被打断的画面"，而是**徽记从仪式里飞回页面**。
//
// 【★衔接的做法（用户反馈"开幕和正文没有丝滑衔接"）】首版是"帷幕整块上抽"——画面切走
//   而正文纹丝不动，观感是两个东西。现在：暗场**淡出**（不是滑动）、徽记**飞行落位**、
//    Hero 徽记在暗场下早已按同一套声明画好并持续呼吸 ⇒ 交棒瞬间两者重合，观感是
//    "开幕收束成页面里的那一点"。
//
// 【何时播 / 何时不播（都不靠记忆，靠机器判据）】
//   · `prefers-reduced-motion` ⇒ 不播（父组件不发车）；
//   · 每次**页面加载**只播一次（模块级标志——刷新可重看，适合分享链接）；
//   · 任意交互（点击/滚轮/按键/触摸）⇒ 立即跳过（跳过键常驻可见）。
import { onMounted, onUnmounted, ref } from 'vue'
import SigilSvg from './SigilSvg.vue'
import { compile, createRunner, settle, motionAllowed, type Runner } from '../../motion/engine-motion'
import { markOpeningPlayed } from '../../motion/opening'

const props = withDefaults(
  defineProps<{
    /** 交棒目标（Hero 徽记的选择器）——飞行的落点由它与本体的两帧矩形之差算出 */
    targetSelector?: string
  }>(),
  { targetSelector: '[data-sigil-target]' },
)

const emit = defineEmits<{ done: [] }>()
// ★策略在 `src/motion/opening.ts`（`<script setup>` 不允许 export——首版因此构建失败）

const sigil = ref<InstanceType<typeof SigilSvg>>()
const rootEl = ref<HTMLElement>()
/** 飞行的载体（包裹 SigilSvg 的普通 div——平移/缩放绑在它身上） */
const wrapEl = ref<HTMLElement>()
const backdropEl = ref<HTMLElement>()
const titleEl = ref<HTMLElement>()
const subEl = ref<HTMLElement>()
let runner: Runner | null = null
let doneTimer: ReturnType<typeof setTimeout> | null = null
let finished = false

/** 结束（幂等）：卸帷幕 → 通知父组件 */
function finish(): void {
  if (finished) return
  finished = true
  if (runner) runner.stop()
  if (doneTimer) clearTimeout(doneTimer)
  emit('done')
}

onMounted(() => {
  markOpeningPlayed()
  const sv = sigil.value
  if (!sv) {
    finish()
    return
  }
  const arcs = (sv.arcEls ?? []).filter((p): p is SVGPathElement => !!p && typeof p.getTotalLength === 'function')
  const slots = new Map<number, HTMLElement | SVGElement>()
  const lens = new Map<number, number>()
  const anims = []

  // 节点 1..3：三段弧逐段画出（错峰）
  arcs.forEach((p, i) => {
    const nodeId = i + 1
    slots.set(nodeId, p)
    lens.set(nodeId, p.getTotalLength())
    anims.push(...compile([{ kind: 'strokeProgress', from: 0, to: 1, durationMs: 1000, delayMs: i * 260, curve: 'easeInOut' }], nodeId))
  })
  // 节点 4：基座线
  if (sv.baseEl) {
    slots.set(4, sv.baseEl)
    lens.set(4, sv.baseEl.getTotalLength())
    anims.push(...compile([{ kind: 'strokeProgress', from: 0, to: 1, durationMs: 700, delayMs: 420, curve: 'easeOut' }], 4))
  }
  // 节点 5：整枚上光（无限呼吸，画完后接管——与 Hero 印记同一条声明）；节点 7：核心呼吸
  if (sv.svgEl) {
    slots.set(5, sv.svgEl)
    anims.push(...compile([{ kind: 'glowIntensity', from: 0.12, to: 1, durationMs: 2100, delayMs: 1000, repeat: 'infinite', direction: 'alternate', curve: 'easeInOut' }], 5))
  }
  if (sv.coreEl) {
    slots.set(7, sv.coreEl)
    anims.push(...compile([{ kind: 'scale', from: 1, to: 1.12, durationMs: 2100, delayMs: 1000, repeat: 'infinite', direction: 'alternate', curve: 'easeInOut' }], 7))
  }
  // 节点 6：扫描弧旋转（无限）
  if (sv.sweepEl) {
    slots.set(6, sv.sweepEl)
    anims.push(...compile([{ kind: 'rotate', from: 0, to: 360, durationMs: 26000, delayMs: 1000, repeat: 'infinite', curve: 'linear' }], 6))
  }
  // 节点 8/9：标题与副题——软遮罩渗开（引擎写 --mmix，CSS 消费）
  if (titleEl.value) {
    slots.set(8, titleEl.value)
    anims.push(...compile([{ kind: 'maskProgress', from: 0, to: 1, durationMs: 900, delayMs: 1400, curve: 'easeInOut' }], 8))
    // 隐去（为交棒让位）
    anims.push(...compile([{ kind: 'opacity', from: 1, to: 0, durationMs: 300, delayMs: 3200, curve: 'easeIn' }], 8))
  }
  if (subEl.value) {
    slots.set(9, subEl.value)
    anims.push(...compile([{ kind: 'maskProgress', from: 0, to: 1, durationMs: 800, delayMs: 1800, curve: 'easeOut' }], 9))
    anims.push(...compile([{ kind: 'opacity', from: 1, to: 0, durationMs: 300, delayMs: 3200, curve: 'easeIn' }], 9))
  }
  // 节点 10：暗场**淡出**（不是滑动——滑动是"画面切走"，淡出才是"退潮"）
  if (backdropEl.value) {
    slots.set(10, backdropEl.value)
    anims.push(...compile([{ kind: 'opacity', from: 1, to: 0, durationMs: 620, delayMs: 3300, curve: 'easeInOut' }], 10))
  }
  // 节点 11/12/13：**徽记飞向 Hero 落点**（共享元素式交棒）
  //   几何 = 两帧矩形（起/落）之差 + 宽度比——与内核 `sharedElement` 同一套分解
  //   （真机上这一步由内核算；浏览器宿主在这里代算，如实标注）
  if (wrapEl.value) {
    slots.set(11, wrapEl.value)
    const start = wrapEl.value.getBoundingClientRect()
    const target = props.targetSelector ? document.querySelector(props.targetSelector)?.getBoundingClientRect() : null // d2-exempt: 读落点矩形（无框架原语；共享元素几何需目标元素的视口坐标）
    if (target && start.width > 0 && target.width > 0) {
      const dx = target.left + target.width / 2 - (start.left + start.width / 2)
      const dy = target.top + target.height / 2 - (start.top + start.height / 2)
      const sc = target.width / start.width
      anims.push(...compile([{ kind: 'translateX', from: 0, to: dx, durationMs: 900, delayMs: 3300, curve: 'easeInOut' }], 11))
      anims.push(...compile([{ kind: 'translateY', from: 0, to: dy, durationMs: 900, delayMs: 3300, curve: 'easeInOut' }], 11))
      anims.push(...compile([{ kind: 'scale', from: 1, to: sc, durationMs: 900, delayMs: 3300, curve: 'easeInOut' }], 11))
    }
  }

  if (!motionAllowed()) {
    settle(anims, slots, { strokeLens: lens })
    finish()
    return
  }
  runner = createRunner(anims, slots, { strokeLens: lens, durationMs: 4260 })
  runner.play()
  doneTimer = setTimeout(finish, 4280)

  // 任意交互 ⇒ 立即跳过（点击/滚轮/按键/触摸；跳过键亦在其列）
  const skip = (): void => finish()
  rootEl.value?.addEventListener('pointerdown', skip)
  window.addEventListener('keydown', skip) // d2-exempt: 跳过键需要全局按键（无框架原语；仅此一处监听）
  window.addEventListener('wheel', skip, { passive: true }) // d2-exempt: 滚轮跳过（同上）
  onUnmounted(() => {
    rootEl.value?.removeEventListener('pointerdown', skip)
    window.removeEventListener('keydown', skip) // d2-exempt: 与上方登记同因（清理）
    window.removeEventListener('wheel', skip) // d2-exempt: 与上方登记同因（清理）
  })
})
onUnmounted(() => {
  runner?.stop()
  if (doneTimer) clearTimeout(doneTimer)
})
</script>

<template>
  <!-- ★Teleport 到 body（**实测抓出的层级缺陷**）：本页的 `<main>` 是 flex 子项且带 `z-index:1`
       ⇒ 它自成 stacking context ⇒ 无论内部 z-index 多大，都盖不住同级的 sticky 导航
       （实测：帷幕下方露出导航栏）。Teleport 到 body 后与导航同级，z-index 才真正生效。 -->
  <Teleport to="body">
    <div ref="rootEl" class="op" role="presentation">
      <!-- 暗场（节点 10：交接时**淡出退潮**——不是滑动切走） -->
      <div ref="backdropEl" class="op-backdrop" />
      <div class="op-stage">
        <!-- 徽记（飞行的载体 = 这层包裹：平移/缩放绑它；与 Hero/HUD 共用 SigilSvg 视觉语言） -->
        <div ref="wrapEl" class="op-sigilwrap">
          <SigilSvg ref="sigil" :size="220" />
        </div>
        <div class="op-title-wrap">
          <h1 ref="titleEl" class="op-title">Morpheus</h1>
          <p ref="subEl" class="op-sub">声明式动画引擎 · 一份声明 → 任意宿主</p>
        </div>
      </div>
      <button class="op-skip" type="button" @click="finish">跳过 ›</button>
    </div>
  </Teleport>
</template>

<style scoped>
.op {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: flex;
  align-items: center;
  justify-content: center;
}
/* 暗场（独立层：只有它淡出——徽记/标题在它之上继续飞行/隐去） */
.op-backdrop {
  position: absolute;
  inset: 0;
  background: radial-gradient(80% 60% at 50% 42%, #14131f 0%, #0a0a10 62%, #06060a 100%);
}
.op-stage {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 26px;
}
.op-sigilwrap { will-change: transform; }
/* 标题/副题：**软遮罩**由 maskProgress 驱动（引擎写 --mmix，这里只消费——
   与两端宿主"零揭示数学"同一条纪律） */
.op-title {
  margin: 0;
  font-size: 44px;
  letter-spacing: -0.02em;
  font-weight: 800;
  color: var(--ink);
  --pct: calc(var(--mmix, 0) * 100%);
  mask-image: linear-gradient(180deg, #000 calc(var(--pct) - 22%), transparent var(--pct));
  -webkit-mask-image: linear-gradient(180deg, #000 calc(var(--pct) - 22%), transparent var(--pct));
}
.op-sub {
  margin: 10px 0 0;
  font-family: var(--mono);
  font-size: 13px;
  letter-spacing: 0.14em;
  color: var(--dim);
  --pct: calc(var(--mmix, 0) * 100%);
  mask-image: linear-gradient(180deg, #000 calc(var(--pct) - 26%), transparent var(--pct));
  -webkit-mask-image: linear-gradient(180deg, #000 calc(var(--pct) - 26%), transparent var(--pct));
}
.op-title-wrap { text-align: center; }
.op-skip {
  position: absolute;
  right: 24px;
  bottom: 24px;
  padding: 8px 14px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  color: var(--muted);
  font-family: var(--mono);
  font-size: 12px;
  cursor: pointer;
}
.op-skip:hover { border-color: var(--brand); color: var(--ink); }
</style>
