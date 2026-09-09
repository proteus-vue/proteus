<!-- examples/pages/svg-canvas-probe.vue —— ★G-62 Canvas 方案调研探针（2026-09-09）
     目的：为「基于 canvas 的高性能 SVG 方案」摸清环境能力边界。
     关键疑问：之前 node() 探测是在 automation evaluate 上下文跑的，可能不代表正常运行时——
       本页在 onMounted（=页面 onReady，正常运行时上下文）复测，这是决定 canvas 路线成立与否的地基。
     探针：
       A. node() @ onMounted（正常上下文）——能否拿到 canvas node + 2d ctx
       B. 离屏 canvas requestAnimationFrame——动画驱动能力
       C. 绘制吞吐（200 arc）
       D. toDataURL 成本（每帧回传成本）
       E. Path2D + isPointInPath——精确命中
       F. setData + image src 往返成本（逐帧换 src 的动画可行性）
     @proteus-api-check-ignore：调研性质，刻意直用 wx.* -->
<template>
  <view class="page">
    <text class="title">Canvas 方案调研探针</text>
    <canvas id="probe-cv" type="2d" width="200" height="200" class="cv" />
    <image class="cv" :src="imgSrc" mode="aspectFit" />
    <button class="btn" @click="runProbe">重跑探针</button>
    <text class="log">{{ log }}</text>
  </view>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

const log = ref('待探测…')
const imgSrc = ref('')

/** 单探针超时自证（区分「回调不回来」与「回调返回 null」） */
function withTimeout(name: string, ms: number, run: (done: (r: string) => void) => void): Promise<string> {
  return new Promise(function (resolve) {
    let settled = false
    const timer = setTimeout(function () {
      if (!settled) {
        settled = true
        resolve(name + ': TIMEOUT')
      }
    }, ms)
    try {
      run(function (r: string) {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(name + ': ' + r)
      })
    } catch (e) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(name + ': THROW ' + String(e).slice(0, 60))
    }
  })
}

/** 绘制吞吐基准：N 个 arc */
function drawBench(ctx: any, n: number): number {
  const t0 = Date.now()
  for (let i = 0; i < n; i++) {
    ctx.beginPath()
    ctx.arc(100, 100, 10 + (i % 50), 0, Math.PI * 2)
    ctx.fillStyle = '#e74c3c'
    ctx.fill()
  }
  return Date.now() - t0
}

async function runProbe(): Promise<void> {
  log.value = '探测中…'
  const out: string[] = []
  const w = wx as any
  const pages = getCurrentPages()
  const page = pages[pages.length - 1] as any

  // A. canvas node（正常运行时上下文）
  out.push(
    await withTimeout('A node()@onMounted', 2500, function (done) {
      page
        .createSelectorQuery()
        .select('#probe-cv')
        .node(function (r: any) {
          if (!r || !r.node) return done('NULL')
          let ctxOk = 'no'
          try {
            ctxOk = r.node.getContext('2d') ? 'yes' : 'null'
          } catch (e) {
            ctxOk = 'throw'
          }
          done('node=' + r.node.tagName + ' ctx=' + ctxOk)
        })
        .exec()
    }),
  )

  // B. 离屏 canvas requestAnimationFrame
  out.push(
    await withTimeout('B offscreen rAF(1s)', 2000, function (done) {
      const c = w.createOffscreenCanvas({ type: '2d', width: 100, height: 100 })
      if (typeof c.requestAnimationFrame !== 'function') return done('no rAF')
      let n = 0
      const t0 = Date.now()
      const loop = function (): void {
        n++
        if (Date.now() - t0 < 1000) c.requestAnimationFrame(loop)
        else done(n + ' frames/s')
      }
      c.requestAnimationFrame(loop)
    }),
  )

  // C. 绘制吞吐 + D. toDataURL 成本
  const off = w.createOffscreenCanvas({ type: '2d', width: 200, height: 200 })
  const octx = off.getContext('2d')
  out.push('C draw200 arcs: ' + drawBench(octx, 200) + 'ms')
  const tD = Date.now()
  for (let i = 0; i < 10; i++) off.toDataURL()
  out.push('D toDataURL x10: ' + (Date.now() - tD) + 'ms')

  // E. Path2D + isPointInPath
  try {
    const p2 = off.createPath2D()
    p2.arc(100, 100, 50, 0, Math.PI * 2)
    out.push('E isPointInPath: in=' + octx.isPointInPath(p2, 100, 100) + ' out=' + octx.isPointInPath(p2, 10, 10))
  } catch (e) {
    out.push('E isPointInPath: THROW ' + String(e).slice(0, 50))
  }

  // F. setData + image src 往返（逐帧换 src 的动画可行性）
  const uri =
    'data:image/svg+xml,' +
    encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#e74c3c"/></svg>')
  await new Promise<void>(function (resolve) {
    const t = Date.now()
    page.setData({ imgSrc: uri }, function () {
      out.push('F setData+src: ' + (Date.now() - t) + 'ms')
      resolve()
    })
  })

  // G. canvas 画文字（补 SVG text 在 Skyline 的短板）
  const g = w.createOffscreenCanvas({ type: '2d', width: 200, height: 60 })
  const gctx = g.getContext('2d')
  gctx.fillStyle = '#fff'
  gctx.fillRect(0, 0, 200, 60)
  gctx.fillStyle = '#e74c3c'
  gctx.font = '24px sans-serif'
  gctx.fillText('Canvas Text 中文', 10, 40)
  const gpx = gctx.getImageData(20, 30, 1, 1).data
  out.push('G canvas fillText: 像素' + (gpx[0] !== 255 || gpx[1] !== 255 ? '有文字✓' : '空白✗') + ' [' + gpx[0] + ',' + gpx[1] + ',' + gpx[2] + ']')

  // H. rAF 驱动 setData 的动画可行性（连续 10 帧，测总耗时）
  const h = w.createOffscreenCanvas({ type: '2d', width: 100, height: 100 })
  const hctx = h.getContext('2d')
  let frames = 0
  const tH = Date.now()
  await new Promise<void>(function (resolve) {
    const step = function (): void {
      hctx.clearRect(0, 0, 100, 100)
      hctx.fillStyle = '#e74c3c'
      hctx.fillRect(frames * 8, 20, 20, 20)
      page.setData({ imgSrc: h.toDataURL() }, function () {
        frames++
        if (frames < 10) h.requestAnimationFrame(step)
        else resolve()
      })
    }
    h.requestAnimationFrame(step)
  })
  const hMs = Date.now() - tH
  out.push('H rAF+setData 10帧: ' + hMs + 'ms (' + Math.round(1000 / (hMs / 10)) + 'fps)')

  log.value = out.join('\n')
  console.log('[canvas-probe]', log.value)
}

onMounted(() => {
  // onMounted → 页面 onReady（正常运行时上下文）——自动跑一次（箭头函数保 this）
  runProbe()
})
</script>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 8px;
  gap: 8px;
}
.title {
  font-size: 15px;
  font-weight: 700;
}
.cv {
  width: 120px;
  height: 120px;
  border: 1px solid #ddd;
  background: #fafafa;
}
.btn {
  margin-top: 4px;
}
.log {
  font-size: 11px;
  color: #333;
  white-space: pre-wrap;
  padding: 8px;
  background: #f7f8fa;
  width: 100%;
  box-sizing: border-box;
}
</style>
