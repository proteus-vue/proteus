<!-- examples/pages/svg-spike.vue —— ★G-62 SVG→Skyline 地基 spike（2026-09-09）
     目的：验证 Skyline 下 <canvas type="2d"> 能否拿 node + getContext('2d') + 真绘制。
     这是 SVG 专项方案的地基假设——不成立则整个 lowering 方案要改。
     验证路径（对齐 p-popover 血泪经验）：
       ① canvas 必须显式 type="2d"（否则 selectorQuery.node() 拿不到）
       ② 必须用 scope.createSelectorQuery()（wx.createSelectorQuery().in(scope) 在 Skyline 查不到组件内元素）
       ③ 拿到 ctx 后真画一条线，用截图确认视觉产出
     @proteus-api-check-ignore：本页刻意直用 wx.* 验证平台能力（spike 性质，非业务代码） -->
<template>
  <view class="spike">
    <text class="spike-title">SVG→Skyline 地基 spike</text>
    <text class="spike-sub">{{ status }}</text>

    <!-- ★关键：type="2d" 显式声明 + 固定 id（Skyline 查询需要） -->
    <canvas id="spike-canvas" type="2d" width="240" height="120" class="spike-canvas" />

    <button class="spike-btn" @click="runSpike">跑一遍验证</button>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const status = ref('待验证——点按钮')

type AnyCtx = {
  fillStyle?: string
  strokeStyle?: string
  lineWidth?: number
  fillRect?: (x: number, y: number, w: number, h: number) => void
  beginPath?: () => void
  moveTo?: (x: number, y: number) => void
  lineTo?: (x: number, y: number) => void
  stroke?: () => void
}

/** 地基层 1：拿 canvas node + 2d ctx */
function probeCanvas(): Promise<{ ok: boolean; detail: string; ctx?: AnyCtx }> {
  return new Promise((resolve) => {
    const pages = getCurrentPages()
    const page = pages[pages.length - 1]
    // ★正确通道：页面实例自带 createSelectorQuery（wx.createSelectorQuery().in(page) 在 Skyline 不可靠）
    const q = typeof page.createSelectorQuery === 'function' ? page.createSelectorQuery() : wx.createSelectorQuery()
    q.select('#spike-canvas')
      .node((res) => {
        if (!res || !res.node) return resolve({ ok: false, detail: 'node() 返回 null——canvas 节点拿不到' })
        const node = res.node
        if (typeof node.getContext !== 'function') return resolve({ ok: false, detail: 'node.tagName=' + node.tagName + ' 无 getContext' })
        let ctx: AnyCtx | null = null
        try {
          ctx = node.getContext('2d') as AnyCtx
        } catch (e) {
          return resolve({ ok: false, detail: 'getContext(2d) 抛错：' + String(e).slice(0, 80) })
        }
        if (!ctx) return resolve({ ok: false, detail: 'getContext(2d) 返回 null' })
        resolve({ ok: true, detail: 'node.tagName=' + node.tagName + '，ctx 可用（fillRect=' + typeof ctx.fillRect + '）', ctx })
      })
      .exec()
  })
}

/** 地基层 2：真绘制（画红矩形 + 一条线，截图可验证） */
function drawSmokeTest(ctx: AnyCtx): boolean {
  try {
    if (typeof ctx.fillRect !== 'function') return false
    ctx.fillStyle = '#e74c3c'
    ctx.fillRect(0, 0, 120, 60)
    if (typeof ctx.beginPath === 'function') {
      ctx.strokeStyle = '#2ecc71'
      ctx.lineWidth = 4
      ctx.beginPath()
      if (ctx.moveTo) ctx.moveTo(0, 0)
      if (ctx.lineTo) ctx.lineTo(240, 120)
      if (ctx.stroke) ctx.stroke()
    }
    return true
  } catch {
    return false
  }
}

async function runSpike(): Promise<void> {
  status.value = '验证中…'
  const probe = await probeCanvas()
  if (!probe.ok) {
    status.value = `✗ 地基层 1 失败：${probe.detail}`
    return
  }
  const drew = drawSmokeTest(probe.ctx as AnyCtx)
  let msg = ''
  if (drew) {
    msg = '✓ 地基成立：' + probe.detail + '，已绘制（红块+绿线，看画布）'
  } else {
    msg = '△ 拿到 ctx 但绘制失败：' + probe.detail
  }
  status.value = msg
  console.log('[svg-spike]', msg)
}
</script>

<style scoped>
.spike {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px 0;
  gap: 12px;
}
.spike-title {
  font-size: 18px;
  font-weight: 700;
}
.spike-sub {
  font-size: 13px;
  color: #666;
  padding: 0 24px;
  text-align: center;
}
.spike-canvas {
  width: 240px;
  height: 120px;
  background: #f0f0f0;
  border: 1px solid #ddd;
}
.spike-btn {
  margin-top: 8px;
}
</style>
