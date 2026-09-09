<!-- examples/pages/svg-spike.vue —— ★G-62 地基 spike v2（2026-09-09 修正版）
     目的：验证 Skyline 下 <canvas type="2d"> 能否拿 node + getContext('2d')。
     ★v2 修正：IDE 版本记录错误已纠正（实际 2.02.2609072 Nightly，非 36.6.0——后者是 Electron 版本）。
       本版做**多通道并行探测**，每通道独立超时自证，结果落 data（排除单一通道/上下文的偶然失败）。
     @proteus-api-check-ignore：spike 性质，刻意直用 wx.* -->
<template>
  <view class="spike">
    <text class="spike-title">canvas node 通道探测 v2</text>
    <text class="spike-sub">{{ status }}</text>
    <canvas id="spike-canvas" type="2d" width="240" height="120" class="spike-canvas" />
    <button class="spike-btn" @click="runSpike">跑探测</button>
    <text class="spike-result">{{ resultText }}</text>
    <text class="spike-sub">离屏 canvas 绘制 → image 显示（F 通道）</text>
    <image v-if="offUri" class="spike-canvas" :src="offUri" mode="aspectFit" />
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const status = ref('待探测')
const resultText = ref('')
const offUri = ref('')

/** 单通道探测（独立超时自证——避免"回调不回来"与"回调返回 null"混淆） */
function probeChannel(name: string, run: (done: (r: string) => void) => void): Promise<string> {
  return new Promise((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        resolve(name + ': TIMEOUT（回调未触发）')
      }
    }, 4000)
    try {
      run((r: string) => {
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

async function runSpike(): Promise<void> {
  status.value = '探测中…（每通道 4s 超时）'
  const results: string[] = []
  const page = getCurrentPages()[getCurrentPages().length - 1] as any

  function describeNode(r: unknown): string {
    const res = r as any
    if (!res) return 'NULL'
    if (!res.node) return 'NO_NODE_FIELD'
    const node = res.node
    let ctxInfo = ''
    try {
      const ctx = node.getContext ? node.getContext('2d') : null
      ctxInfo = ctx ? 'ctx=OK(fillRect:' + typeof ctx.fillRect + ')' : 'ctx=null'
    } catch (e) {
      ctxInfo = 'ctxThrow:' + String(e).slice(0, 30)
    }
    return 'node.tagName=' + node.tagName + ' ' + ctxInfo
  }

  results.push(await probeChannel('A page.createSelectorQuery().node()', function (done) {
    page.createSelectorQuery().select('#spike-canvas').node(function (r: unknown) { done(describeNode(r)) }).exec()
  }))
  results.push(await probeChannel('B page...fields({node:true})', function (done) {
    page.createSelectorQuery().select('#spike-canvas').fields({ node: true, size: true }, function (r: unknown) { done(describeNode(r)) }).exec()
  }))
  results.push(await probeChannel('C wx.createSelectorQuery().node()', function (done) {
    wx.createSelectorQuery().select('#spike-canvas').node(function (r: unknown) { done(describeNode(r)) }).exec()
  }))
  results.push(await probeChannel('D boundingClientRect（对照）', function (done) {
    page.createSelectorQuery().select('#spike-canvas').boundingClientRect(function (r: unknown) {
      const rr = r as { width?: number } | null
      done(rr ? 'rect=' + rr.width + 'px' : 'NULL')
    }).exec()
  }))
  results.push(await probeChannel('E wx.createOffscreenCanvas({type:2d})', function (done) {
    const w = wx as any
    if (typeof w.createOffscreenCanvas !== 'function') return done('API 不存在')
    const c = w.createOffscreenCanvas({ type: '2d', width: 100, height: 100 })
    const ctx = c.getContext ? c.getContext('2d') : null
    done(ctx ? 'ctx=OK(fillRect:' + typeof ctx.fillRect + ')' : 'ctx=null')
  }))

  // F. 离屏 canvas 绘制 → toDataURL → image 显示（决定 canvas 路线是否可行）
  try {
    const w = wx as any
    const c = w.createOffscreenCanvas({ type: '2d', width: 240, height: 120 })
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#9b59b6'
    ctx.fillRect(0, 0, 240, 120)
    ctx.strokeStyle = '#f1c40f'
    ctx.lineWidth = 8
    ctx.beginPath()
    ctx.moveTo(20, 100)
    ctx.lineTo(120, 20)
    ctx.lineTo(220, 100)
    ctx.stroke()
    offUri.value = c.toDataURL()
    results.push('F offscreen draw→toDataURL→image: ' + (offUri.value ? 'URI ' + offUri.value.length + ' chars' : 'EMPTY'))
  } catch (e) {
    results.push('F offscreen draw: THROW ' + String(e).slice(0, 60))
  }

  resultText.value = results.join('\n')
  status.value = '探测完成'
  console.log('[svg-spike-v2]', resultText.value)
}
</script>

<style scoped>
.spike {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px 8px;
  gap: 8px;
}
.spike-title {
  font-size: 16px;
  font-weight: 700;
}
.spike-sub {
  font-size: 12px;
  color: #666;
}
.spike-canvas {
  width: 240px;
  height: 120px;
  background: #f0f0f0;
  border: 1px solid #ddd;
}
.spike-btn {
  margin-top: 4px;
}
.spike-result {
  font-size: 11px;
  color: #333;
  white-space: pre-wrap;
  padding: 8px;
  background: #f7f8fa;
  width: 100%;
  box-sizing: border-box;
}
</style>
