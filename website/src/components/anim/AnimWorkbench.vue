<script setup lang="ts">
// website/src/components/anim/AnimWorkbench.vue —— ★★**亲手试工作台**（灵魂元素的第三件）
//
// 【为什么是"灵魂"而不是"又一个 demo 播放器"】
//   别的动画引擎官网给你看**他们的**动画。这里给你的是**引擎本身**：
//   你选属性 / 选曲线 / 拖时长 → 页面**当场调用引擎的编译链**（`compileAnimations`，
//   与真机同一份代码、同一套校验）→ 同一批指令同时喂给**三个宿主**（Web / iOS / Android 标签的
//   三个舞台）→ 旁边实时显示**编译产物**（条数 / 曲线 / 是否合成属性 / 逐条 from→to）。
//   ⇒ 观众验证的不是"效果好看"，而是「一份声明 → N 条通道 → 任意宿主」这句主张本身。
//
// 【★彩蛋：编译期拦截是可以被"亲手撞出来"的】
//   属性列表里放了一个 `width`（布局属性）——按下去，**引擎当场拒绝**并给出真实报错与修法
//   （这正是真机上同一条门禁：布局属性会毁掉"平台渲染线程零参与"的红利）。
//   没有比"让访客自己撞一次门禁"更诚实的证明了。
//
// 【诚实口径】三个舞台是**同一台浏览器里的同一份实现**（Web 宿主）；iOS/Android 两个标签
//   表示"同一批指令在另外两种宿主上由各自平台交换"（真机读数与录屏见上方证据区）。
//   ——不假装这里有真机；它们的价值是展示**声明与宿主解耦**这件事。
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { compileAnimations, parseCubicBezier } from '@proteus-vue/animation'
import type { AnimDecl, CompiledBatch, CurveId, CurveName } from '@proteus-vue/animation'
import { createRunner, durationOf, motionAllowed, settle, type Runner } from '../../motion/engine-motion'

/* ── 可选项（封闭集里挑出来最好演示的几个） ── */
const PROPS = [
  { id: 'translateY', label: 'translateY', axis: 'y' },
  { id: 'scale', label: 'scale', axis: 's' },
  { id: 'rotate', label: 'rotate', axis: 'r' },
  { id: 'rotateY', label: 'rotateY', axis: 'ry' },
  { id: 'opacity', label: 'opacity', axis: 'o' },
  { id: 'skewX', label: 'skewX', axis: 'k' },
  { id: 'clip', label: 'clip', axis: 'c' },
  { id: 'color', label: 'color', axis: 'col' },
] as const
type PropId = (typeof PROPS)[number]['id']

const CURVES = [
  { name: 'linear', id: 0 },
  { name: 'easeOut', id: 1 },
  { name: 'easeIn', id: 2 },
  { name: 'easeInOut', id: 3 },
  { name: 'springApprox', id: 4 },
] as const satisfies ReadonlyArray<{ name: CurveName; id: CurveId }>

const prop = ref<PropId>('translateY')
const curveIdx = ref(1)
const custom = ref({ x1: 0.34, y1: 1.56, x2: 0.64, y2: 1 })
const useCustom = ref(false)
const durMs = ref(620)
const loop = ref(false)

/** 每片舞台的起始参数（同一批声明，三个宿主只是 nodeId 不同——这正是"解耦"的演示） */
const HOSTS = [
  { id: 1, name: 'Web', sub: 'CSS 合成层' },
  { id: 2, name: 'iOS', sub: 'CAKeyframeAnimation' },
  { id: 3, name: 'Android', sub: 'RenderNode / 自绘' },
] as const

const stageEls = ref<HTMLElement[]>([])
const tiles = ref<HTMLElement[]>([])
let runner: Runner | null = null

/** 尝试编译：成功返回批（含 composited 判定），失败返回引擎原样的报错（**展示真话**） */
function tryCompile(): { ok: true; batch: CompiledBatch; decls: AnimDecl[] } | { ok: false; error: string; hint: string } {
  try {
    const decl = buildDecl()
    const batch = compileAnimations([decl], { nodeId: 1 })
    return { ok: true, batch, decls: [decl] }
  } catch (e) {
    const msg = String((e as Error).message ?? e)
    // 引擎的报错形如：Morpheus 动画声明校验失败：[code] #0 message → hint; 若封闭集...
    const m = /\[([a-z-]+)\]\s*#(\d+)\s*([^→]+)→\s*([^;\n]+)/.exec(msg)
    return { ok: false, error: m ? `${m[3]!.trim()}` : msg.slice(0, 220), hint: m ? m[4]!.trim() : '' }
  }
}

function buildDecl(): AnimDecl {
  // ★声明面用**曲线名**（`curve: 'easeOut'`）；编号只用于读数展示——两者不能互换
  const curve: CurveName = CURVES[curveIdx.value]!.name
  const bez = useCustom.value
    ? parseCubicBezier(`cubic-bezier(${custom.value.x1},${custom.value.y1},${custom.value.x2},${custom.value.y2})`)
    : undefined
  // ★`curveBezier` 与 `curve` **互斥**（引擎校验：两处都描述缓动必须唯一——实测报
  //   `[conflicting-easing]`）。⇒ 用贝塞尔时**不写** curve（这个细节本身就是引擎的诚实之处）
  const base = {
    durationMs: durMs.value,
    ...(bez ? { curveBezier: bez } : { curve }),
    ...(loop.value ? { repeat: 'infinite' as const, direction: 'alternate' as const } : {}),
  }
  switch (prop.value) {
    case 'translateY': return { kind: 'translateY', from: -46, to: 0, ...base }
    case 'scale': return { kind: 'scale', from: 0.6, to: 1, ...base }
    case 'rotate': return { kind: 'rotate', from: -120, to: 0, ...base }
    case 'rotateY': return { kind: 'rotateY', from: -105, to: 0, ...base }
    case 'opacity': return { kind: 'opacity', from: 0, to: 1, ...base }
    case 'skewX': return { kind: 'skewX', from: -16, to: 0, ...base }
    case 'clip': return { kind: 'clip', from: [0, 0, 0.72, 0], to: [0, 0, 0, 0], ...base }
    case 'color': return { kind: 'color', from: '#7c5cff', to: '#ff8a5c', ...base }
  }
}

/** 编译结果（响应式；含错误分支） */
const result = computed(() => tryCompile())

/** 编译失败时的报错文本（模板不能写 TS 断言——抽出 computed） */
const compileError = computed(() => {
  const r = result.value
  return r.ok ? '' : r.error
})

/** 编译产物的可读摘要（观众看的是引擎真实吐出的东西） */
const summary = computed(() => {
  const r = result.value
  if (!r.ok) return null
  const a = r.batch.anims[0]
  return {
    count: r.batch.anims.length,
    kinds: [...new Set(r.batch.anims.map((x) => x.kind))].join(', '),
    composited: r.batch.composited,
    nonComposited: r.batch.nonComposited.join(', ') || '—',
    first: a ? `kind ${a.kind} · ${a.from} → ${a.to} · ${a.durMs}ms · curve ${a.curve}` : '',
    perHost: HOSTS.map((h) => r.batch.anims.map((x) => ({ ...x, nodeId: h.id }))),
  }
})

/** 播放：同一批指令 × 三个宿主（**一个 runner、三个槽位**——与真机"一批多节点"同构） */
function play(): void {
  const r = result.value
  if (!r.ok) return
  const slots = new Map<number, HTMLElement>()
  HOSTS.forEach((h, i) => {
    const el = tiles.value[i]
    if (el) slots.set(h.id, el)
  })
  const anims = HOSTS.flatMap((h) => r.batch.anims.map((x) => ({ ...x, nodeId: h.id })))
  // 换宿主/换参数都可能改变批 ⇒ 重新建 runner（stop 旧的，防两条时间线打架）
  runner?.stop()
  if (!motionAllowed()) {
    settle(anims, slots, { clipKinds: new Map(HOSTS.map((h) => [h.id, 'inset' as const])) })
    return
  }
  runner = createRunner(anims, slots, {
    clipKinds: new Map(HOSTS.map((h) => [h.id, 'inset' as const])),
    perspectives: new Map(HOSTS.map((h) => [h.id, 700])),
    durationMs: durationOf(anims, 800),
  })
  runner.play()
}

/** 撞门禁（彩蛋）：把一个布局属性塞进编译链——引擎会拒绝，错误现场展示 */
const gateHit = ref<{ error: string; hint: string } | null>(null)
function provokeGate(): void {
  try {
    compileAnimations([{ kind: 'width', from: 100, to: 300, durationMs: 400 } as unknown as AnimDecl], { nodeId: 1 })
    gateHit.value = { error: '（没有报错？——这是缺陷，请上报）', hint: '' }
  } catch (e) {
    const msg = String((e as Error).message ?? e)
    const m = /\[([a-z-]+)\]\s*#(\d+)\s*([^→]+)→\s*([^;\n]+)/.exec(msg)
    gateHit.value = {
      error: m ? `${m[3]!.trim()}` : msg.slice(0, 240),
      hint: m ? m[4]!.trim() : '',
    }
  }
}

onMounted(() => play())
onUnmounted(() => runner?.stop())
</script>

<template>
  <div class="wb">
    <!-- 控制台 -->
    <div class="wb-panel">
      <div class="wb-group">
        <span class="wb-label">属性（封闭集）</span>
        <div class="wb-chips">
          <button v-for="p in PROPS" :key="p.id" class="wb-chip" :class="{ on: prop === p.id }" @click="prop = p.id; play()">
            {{ p.label }}
          </button>
        </div>
      </div>

      <div class="wb-group">
        <span class="wb-label">曲线</span>
        <div class="wb-chips">
          <button v-for="(c, i) in CURVES" :key="c.name" class="wb-chip" :class="{ on: !useCustom && curveIdx === i }" @click="useCustom = false; curveIdx = i; play()">
            {{ c.name }}
          </button>
          <button class="wb-chip" :class="{ on: useCustom }" @click="useCustom = true; play()">贝塞尔…</button>
        </div>
        <div v-if="useCustom" class="wb-bez">
          <label v-for="k in (['x1', 'y1', 'x2', 'y2'] as const)" :key="k" class="wb-slide">
            <span class="wb-slide-k">{{ k }}</span>
            <input
              v-model.number="custom[k]"
              type="range"
              :min="k === 'x1' || k === 'x2' ? 0 : -1"
              :max="k === 'x1' || k === 'x2' ? 1 : 2"
              step="0.01"
              class="wb-range"
              @input="play()"
            />
            <span class="wb-slide-v">{{ custom[k].toFixed(2) }}</span>
          </label>
        </div>
      </div>

      <div class="wb-group">
        <span class="wb-label">时长 / 循环</span>
        <div class="wb-inline">
          <input v-model.number="durMs" type="range" min="160" max="2200" step="20" class="wb-range" @input="play()" />
          <span class="wb-slide-v">{{ durMs }}ms</span>
          <button class="wb-chip" :class="{ on: loop }" @click="loop = !loop; play()">循环 yoyo</button>
        </div>
      </div>

      <div class="wb-group">
        <button class="wb-run" @click="play()">重新播放（三个宿主同时）</button>
        <button class="wb-gate" @click="provokeGate()">试试改布局属性（width）</button>
      </div>

      <!-- 彩蛋：编译期拦截的**真实报错**（引擎原样吐出，页面不做美化） -->
      <div v-if="gateHit" class="wb-gatebox">
        <span class="wb-gate-tag">编译期拦截</span>
        <p class="wb-gate-err">{{ gateHit.error }}</p>
        <p v-if="gateHit.hint" class="wb-gate-hint">→ {{ gateHit.hint }}</p>
        <button class="wb-gate-close" @click="gateHit = null">知道了</button>
      </div>
    </div>

    <!-- 三个宿主舞台（同一批指令） -->
    <div class="wb-stages">
      <div v-for="(h, i) in HOSTS" :key="h.id" ref="stageEls" class="wb-host">
        <div class="wb-host-head">
          <span class="wb-host-name">{{ h.name }}</span>
          <span class="wb-host-sub">{{ h.sub }}</span>
        </div>
        <div class="wb-stage">
          <div ref="tiles" class="wb-tile" />
        </div>
      </div>

      <!-- 编译产物读数（引擎真实输出） -->
      <div class="wb-out">
        <template v-if="summary">
          <div class="wb-row"><span class="wb-k">本条声明 →</span><span class="wb-v wb-v--big">{{ summary.count }} 条指令</span></div>
          <div class="wb-row"><span class="wb-k">kind</span><span class="wb-v">{{ summary.kinds }}</span></div>
          <div class="wb-row">
            <span class="wb-k">合成属性</span>
            <span class="wb-v" :class="summary.composited ? 'wb-v--ok' : 'wb-v--no'">{{ summary.composited ? '是（可走平台零参与路径）' : `否（${summary.nonComposited}）` }}</span>
          </div>
          <div class="wb-row"><span class="wb-k">首条产物</span><span class="wb-v wb-v--mono">{{ summary.first }}</span></div>
        </template>
        <template v-else>
          <div class="wb-row"><span class="wb-k">编译失败</span><span class="wb-v wb-v--no">{{ compileError }}</span></div>
        </template>
        <p class="wb-note">
          三个舞台由同一批指令驱动（宿主名对应真机实现：CSS 合成层 / CAKeyframeAnimation /
          RenderNode）——本页只搬了一次声明，三处各自兑现。
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wb { display: flex; flex-direction: column; gap: 20px; }
.wb-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px 22px;
  background: linear-gradient(180deg, rgba(22, 22, 30, 0.92), rgba(15, 15, 21, 0.92));
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
}
.wb-group { display: flex; flex-direction: column; gap: 9px; }
.wb-label { font-family: var(--mono); font-size: 11px; letter-spacing: 0.1em; color: var(--dim); text-transform: uppercase; }
.wb-chips { display: flex; flex-wrap: wrap; gap: 7px; }
.wb-chip {
  padding: 6px 12px;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--muted);
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  cursor: pointer;
}
.wb-chip:hover { border-color: rgba(124, 92, 255, 0.55); color: var(--ink); }
.wb-chip.on { background: rgba(124, 92, 255, 0.16); border-color: var(--brand); color: var(--brand-ink); }
.wb-bez { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 8px 16px; margin-top: 4px; }
.wb-slide { display: flex; align-items: center; gap: 8px; }
.wb-slide-k { font-family: var(--mono); font-size: 11px; color: var(--dim); width: 18px; }
.wb-slide-v { font-family: var(--mono); font-size: 11.5px; color: var(--muted); min-width: 38px; }
.wb-inline { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.wb-range { flex: 1; min-width: 120px; accent-color: var(--brand); }
.wb-run {
  padding: 10px 18px;
  background: linear-gradient(120deg, var(--brand), #6a4bf0);
  border: none;
  border-radius: var(--radius-md);
  color: #fff;
  font-weight: 650;
  font-size: 13.5px;
  cursor: pointer;
  width: fit-content;
}
.wb-gate {
  padding: 9px 16px;
  background: transparent;
  border: 1px dashed rgba(255, 138, 92, 0.5);
  border-radius: var(--radius-md);
  color: var(--accent);
  font-size: 12.5px;
  cursor: pointer;
  width: fit-content;
}
.wb-gatebox {
  border: 1px solid rgba(255, 138, 92, 0.4);
  background: rgba(255, 138, 92, 0.07);
  border-radius: var(--radius-md);
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.wb-gate-tag { font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.12em; color: var(--accent); }
.wb-gate-err { margin: 0; font-size: 13px; color: var(--ink); line-height: 1.7; }
.wb-gate-hint { margin: 0; font-size: 12.5px; color: var(--muted); line-height: 1.7; }
.wb-gate-close { align-self: flex-start; background: transparent; border: none; color: var(--dim); font-size: 12px; cursor: pointer; padding: 0; }
.wb-stages { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; }
.wb-host { border: 1px solid var(--line); border-radius: var(--radius-lg); padding: 12px; background: rgba(16, 16, 22, 0.86); }
.wb-host-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
.wb-host-name { font-family: var(--mono); font-size: 12px; color: var(--brand-ink); }
.wb-host-sub { font-family: var(--mono); font-size: 10px; color: var(--dim); }
.wb-stage { height: 132px; display: flex; align-items: center; justify-content: center; border-radius: var(--radius-md); background: radial-gradient(90% 90% at 50% 30%, rgba(124, 92, 255, 0.12), transparent 70%); }
.wb-tile {
  width: 56px;
  height: 56px;
  border-radius: 14px;
  background: linear-gradient(140deg, var(--brand), #5138c9);
  box-shadow: 0 10px 26px -12px rgba(124, 92, 255, 0.9);
}
.wb-out { border: 1px solid var(--line); border-radius: var(--radius-lg); padding: 14px 16px; background: rgba(13, 13, 19, 0.9); grid-column: 1 / -1; }
.wb-row { display: flex; align-items: baseline; gap: 10px; padding: 3px 0; }
.wb-k { font-family: var(--mono); font-size: 11px; color: var(--dim); flex: none; }
.wb-v { font-size: 12.5px; color: var(--muted); }
.wb-v--big { font-family: var(--mono); font-size: 15px; color: var(--brand-ink); font-weight: 700; }
.wb-v--mono { font-family: var(--mono); font-size: 11.5px; }
.wb-v--ok { color: #6fd08c; }
.wb-v--no { color: var(--accent); }
.wb-note { margin: 10px 0 0; font-size: 11.5px; line-height: 1.75; color: var(--dim); }
</style>
