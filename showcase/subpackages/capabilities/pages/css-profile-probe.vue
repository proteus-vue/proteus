<!-- showcase/subpackages/capabilities/pages/css-profile-probe.vue
     ★CSS Profile 支持矩阵探针（2026-09-29）
     目的：为 `docs/Proteus_CSS_Profile规格.md` §2「三端基线对照」提供 Skyline 端**实测数据**
       （该规格把「Skyline CSS 支持矩阵实测」列为 **P1 前置项**：「必须先做，否则 Profile 无基线」）。
     做法：页面内用 `wx.createSelectorQuery`（★实测：Skyline + glass-easel 下**页面上下文可用**，
       返回真实几何）逐条测量存疑特性，用**几何反推**该特性是否被 Skyline 接受。
     诚实边界：Skyline 无 `window.getComputedStyle` → 判得了「生效/未生效」，判不了数值精度；
       精确数值仍需真机视觉验收。
     ★踩坑记录（三处，供后续探针页复用）：
       ① 能力 Hook `useElement` 在 MP 端**句柄可创建但测量无返回**（rows 恒空）→ 改用原生 API；
       ② `automation_evaluate` 的 fn-source 必须是**裸函数**（IIFE 会失败，见 driver 注释）；
       ③ MP 编译管线对**复杂 TS 类型**（interface / 泛型实参）支持有限 → 本文件用朴素写法。 -->
<script setup>
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PText, PView, PButton } from '@proteus-vue/components'

// 探针项：id + 特性名 + 是否用「水平位移」判定（transform / relative 用位移，其余用宽高）
const CASES = [
  { id: 'c-basic', feature: 'width / height / background-color', shifted: false },
  { id: 'c-flex', feature: 'display: flex', shifted: false },
  { id: 'c-justify', feature: 'justify-content: space-between', shifted: false },
  { id: 'c-align', feature: 'align-items: center', shifted: false },
  { id: 'c-gap', feature: 'gap', shifted: false },
  { id: 'c-radius', feature: 'border-radius', shifted: false },
  { id: 'c-border', feature: 'border', shifted: false },
  { id: 'c-opacity', feature: 'opacity', shifted: false },
  { id: 'c-transform', feature: 'transform: translateX + scale', shifted: true },
  { id: 'c-overflow', feature: 'overflow: hidden', shifted: false },
  { id: 'c-pos-rel', feature: 'position: relative + left', shifted: true },
  { id: 'c-pos-abs', feature: 'position: absolute', shifted: false },
  { id: 'c-zindex', feature: 'z-index', shifted: false },
  { id: 'c-shadow', feature: 'box-shadow', shifted: false },
  { id: 'c-gradient', feature: 'background-image: linear-gradient', shifted: false },
  { id: 'c-vw', feature: 'width: 50vw', shifted: false },
  { id: 'c-vh', feature: 'height: 10vh', shifted: false },
  { id: 'c-rpx', feature: 'width: 100rpx', shifted: false },
  { id: 'c-pct', feature: 'width: 50%', shifted: false },
  { id: 'c-em', feature: 'width: 5em', shifted: false },
  { id: 'c-rem', feature: 'width: 5rem', shifted: false },
  { id: 'c-fixed', feature: 'position: fixed', shifted: false },
  { id: 'c-sticky', feature: 'position: sticky', shifted: false },
  { id: 'c-grid', feature: 'display: grid', shifted: false },
  { id: 'c-inline', feature: 'display: inline-block', shifted: false },
]

const out = ref('点「跑探针」→ 逐条测量 CSS 特性在 Skyline 端的接受情况')
const rows = ref([])

async function runProbe() {
  const wxApi = globalThis.wx
  if (!wxApi || typeof wxApi.createSelectorQuery !== 'function') {
    out.value = '⚠ 无 wx.createSelectorQuery（非 MP 环境）'
    return
  }
  const rects = await new Promise((resolve) => {
    const q = wxApi.createSelectorQuery()
    for (const c of CASES) q.select('#' + c.id).boundingClientRect()
    q.exec((res) => resolve(res || []))
  })
  const results = []
  CASES.forEach((c, i) => {
    const r = rects[i]
    if (!r) {
      results.push({ feature: c.feature, actual: '未命中', verdict: '未生效' })
      return
    }
    const w = Math.round(r.width || 0)
    const h = Math.round(r.height || 0)
    const x = Math.round(r.left || 0)
    const ok = c.shifted ? x > 20 : w > 0 && h > 0
    results.push({ feature: c.feature, actual: w + 'x' + h + ' @x=' + x, verdict: ok ? '生效' : '未生效' })
  })
  rows.value = results
  const pass = results.filter((r) => r.verdict === '生效').length
  out.value = '探针完成：' + pass + '/' + results.length + ' 项几何判据通过'
  // 写入 driver.probes() 的读取通道（见 packages/test-core/src/driver/mp.ts）
  const g = globalThis
  g.__PROTEUS_PROBES__ = g.__PROTEUS_PROBES__ || {}
  g.__PROTEUS_PROBES__['css-profile'] = { tag: 'css-profile-probe', rows: results }
}
</script>

<template>
  <page-shell title="CSS Profile 探针" subtitle="为 CSS Profile 规格提供 Skyline 实测基线">
    <demo-block index="01" title="跑探针" :has-output="true" desc="逐条测量 CSS 特性在 Skyline 端是否被接受（几何反推）" :code="'runProbe()'">
      <template #demo>
        <p-view class="btns">
          <p-button size="small" @click="runProbe">跑探针</p-button>
        </p-view>
        <p-text class="out">{{ out }}</p-text>
        <!-- 探针目标：页面级 raw 原生节点（用 id 选择器——Skyline 下类选择器不达页面级原生节点） -->
        <view id="c-basic" style="width:100px;height:20px;background-color:#6f4ae8" />
        <view id="c-flex" style="display:flex;width:150px;height:20px" />
        <view id="c-justify" style="display:flex;justify-content:space-between;width:150px;height:20px" />
        <view id="c-align" style="display:flex;align-items:center;width:150px;height:20px" />
        <view id="c-gap" style="display:flex;gap:12px;width:150px;height:20px" />
        <view id="c-radius" style="width:100px;height:20px;border-radius:10px;background-color:#6f4ae8" />
        <view id="c-border" style="width:100px;height:20px;border:2px solid #6f4ae8" />
        <view id="c-opacity" style="width:100px;height:20px;opacity:0.4;background-color:#6f4ae8" />
        <view id="c-transform" style="width:100px;height:20px;transform:translateX(30px);background-color:#6f4ae8" />
        <view id="c-overflow" style="width:100px;height:20px;overflow:hidden" />
        <view id="c-pos-rel" style="position:relative;left:30px;width:100px;height:20px" />
        <view id="c-pos-abs" style="position:absolute;width:100px;height:20px;top:10px;left:10px" />
        <view id="c-zindex" style="position:relative;z-index:5;width:100px;height:20px" />
        <view id="c-shadow" style="width:100px;height:20px;box-shadow:0 2px 8px rgba(0,0,0,.4)" />
        <view id="c-gradient" style="width:100px;height:20px;background-image:linear-gradient(90deg,#6f4ae8,#000)" />
        <view id="c-vw" style="width:50vw;height:20px" />
        <view id="c-vh" style="width:50px;height:10vh" />
        <view id="c-rpx" style="width:100rpx;height:20px" />
        <view id="c-pct" style="width:50%;height:20px" />
        <view id="c-em" style="width:5em;height:20px;font-size:10px" />
        <view id="c-rem" style="width:5rem;height:20px" />
        <view id="c-fixed" style="position:fixed;width:80px;height:20px" />
        <view id="c-sticky" style="position:sticky;top:0;width:100px;height:20px" />
        <view id="c-grid" style="display:grid;grid-template-columns:1fr 1fr;width:150px;height:40px" />
        <view id="c-inline" style="display:inline-block;width:80px;height:20px" />
      </template>
    </demo-block>
    <demo-block index="02" title="测量结果" :has-output="false" desc="逐条给出几何实测值与生效判定" :code="'见 rows'">
      <template #demo>
        <view v-for="(r, i) in rows" :key="i" class="row">
          <text class="ft">{{ r.feature }}</text>
          <text class="ac">{{ r.actual }}</text>
          <text class="vd">{{ r.verdict }}</text>
        </view>
      </template>
    </demo-block>
    <api-table title="探针用法" :rows="[['wx.createSelectorQuery()', '页面上下文可用（实测 Skyline 亦可）', 'SelectorQuery'], ['select(id)', '须 id 选择器（类选择器不达页面级原生节点）', 'NodesRef'], ['boundingClientRect()', '读元素几何', 'Promise']]" />
  </page-shell>
</template>

<style scoped>
.btns { display: flex; gap: 8px; margin-bottom: 8px; }
.out { display: block; margin: 8px 0; font-size: 13px; }
.row { display: flex; gap: 8px; padding: 4px 0; font-size: 12px; }
.ft { flex: 1 1 40%; }
.ac { flex: 0 0 25%; color: #666; }
.vd { flex: 0 0 30%; }
</style>
