<!-- showcase/subpackages/capabilities/pages/css-profile-probe.vue
     ★CSS Profile 支持矩阵探针（2026-09-29）
     目的：为 `docs/Proteus_CSS_Profile规格.md` §2「三端基线对照」提供 Skyline 端**实测数据**
       （该规格把「Skyline CSS 支持矩阵实测」列为 **P1 前置项**：「必须先做，否则 Profile 无基线」）。
     做法：页面内用 `wx.createSelectorQuery`（★实测：Skyline + glass-easel 下**页面上下文可用**，
       返回真实几何）逐条测量存疑特性，用**几何反推**该特性是否被 Skyline 接受。
     诚实边界：Skyline 无 `window.getComputedStyle` → 判得了「生效/未生效」，判不了数值精度；
       精确数值仍需真机视觉验收。
     ★踩坑记录（供后续探针页复用）：
       ① **MP 编译后 ref 值落在 `data` 上**，不在实例属性上——E2E 里读 `p.rows` 恒 undefined；
          正解读 `p.data.rows`。（我最初把这一条**误判为「框架 Hook useElement 失效」并写进仓库**，
          经 A/B 对照证伪：`useElement` 返回 OK:100x20、原生 API 同样 OK:100x20，**框架无缺陷**。）
       ② ★**真正的框架缺陷（本轮已修）**：编译器 `script/ref-write` 的**续行判定只看前一行末字符**，
          导致 **Prettier 风格三元**（`?` / `:` 在**行首**）被截断——
          `out.value = cond\n  ? A\n  : B` → `setData({out: cond})` + **悬空三元**。
          影响面：生成的能力演示页普遍中招（download/fetch/network/vibrate/element-query…），
          MP 端点按钮只显示 `true`，结果文案永不出现。修法见 `packages/compiler/src/script.ts`
          的「行首续行符探测」分支 + `tests/svg-spike-compiler-gaps.test.ts` 的两条新回归锁。
       ③ `automation_evaluate` 的 fn-source 必须是**裸函数**（IIFE 会失败，见 driver 注释）；
       ④ MP 编译管线对**复杂 TS 类型**（interface / 泛型实参）支持有限 → 用朴素写法；
       ⑤ 选择器：页面级原生节点须用 **id 选择器**（类选择器不达）。 -->
<script setup>
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PText, PView, PButton } from '@proteus-vue/components'

// 探针项：id + 特性名 + 是否用「水平位移」判定（transform / relative 用位移，其余用宽高）
//
// ★方法论（2026-09-29 由 DCP-2 实测教训固化）：**「属性被接受」≠「语义生效」**。
//   c-grid 原先只测容器几何（150×40）——但容器有显式宽高时，「真 grid」与「block 退化」
//   几何**完全相同**，该用例等于恒真。故凡「可能被静默忽略」的特性，必须测**能区分语义的观测量**：
//   · grid → 子项是否真分列/换行（而非容器宽高）
//   · 每项语义判定都必须配**同页对照组**（如 flex），以排除「探针本身坏了」
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
  { id: 'c-grid', feature: 'display: grid（容器几何）', shifted: false },
  { id: 'c-inline', feature: 'display: inline-block', shifted: false },
  // ★语义判定组（DCP-2 用）：单看容器几何判不出 grid 是否真生效（容器有显式宽高时，
  //   「真 grid 布局」与「block 退化」几何相同）→ 必须比对**子项位置**。
  { id: 'g-item1', feature: 'grid 子项 1 位置', shifted: true },
  { id: 'g-item2', feature: 'grid 子项 2 位置（应第 2 列）', shifted: true },
  { id: 'g-item3', feature: 'grid 子项 3 位置（应第 2 行）', shifted: true },
  { id: 'f-item1', feature: 'flex 对照·子项 1', shifted: true },
  { id: 'f-item2', feature: 'flex 对照·子项 2', shifted: true },
  { id: 'f-item3', feature: 'flex 对照·子项 3', shifted: true },
]

// ★模板里不得出现函数调用样式（WXML S38）→ 把代码片段/表格提到 script 常量
const codeRun = 'runProbe()'
const codeRows = '见 rows'
const apiRows = [
  ['wx.createSelectorQuery', '页面上下文可用（实测 Skyline 亦可）', 'SelectorQuery'],
  ['select(id)', '须 id 选择器（类选择器不达页面级原生节点）', 'NodesRef'],
  ['boundingClientRect', '读元素几何', 'Promise'],
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

  // ★DCP-2 语义判定：grid 是否**真按两列布局**（而非 block 退化）
  //   判据（来自浏览器真值——Web 端 `grid-template-columns:1fr 1fr` 且 3 个 20px 子项）：
  //     · grid 子项 2 的 x ≈ 子项 1 的 x + 75（列宽 = 150/2），且与子项 1 **同行**
  //     · grid 子项 3 换到第 2 行（y > 第 1 行）
  //     · flex 对照组三个子项应**依次横排**（x 递增 20）——这是 Skyline 确认支持的基线
  const byId = {}
  CASES.forEach((c, i) => { byId[c.id] = rects[i] })
  const gi1 = byId['g-item1'], gi2 = byId['g-item2'], gi3 = byId['g-item3']
  const fi1 = byId['f-item1'], fi2 = byId['f-item2'], fi3 = byId['f-item3']

  let gridVerdict = '无法判定（子项几何未取到）'
  if (gi1 && gi2 && gi3) {
    const gx1 = gi1.left, gx2 = gi2.left, gy1 = gi1.top, gy3 = gi3.top
    const twoColumns = gx2 - gx1 > 40 && Math.abs(gi1.top - gi2.top) < 2
    const wrapped = gy3 - gy1 > 10
    gridVerdict = twoColumns && wrapped
      ? '✅ 真 grid（子项 2 在第 2 列同行 · 子项 3 换行）'
      : twoColumns
        ? '⚠️ 部分（分列生效但换行存疑）'
        : '❌ 未按 grid 布局（退化为 block——子项 2 未到第 2 列）'
    rows.value = results.concat([{
      feature: '★grid 语义判定（DCP-2 判据）',
      actual: `g1.x=${Math.round(gx1)} g2.x=${Math.round(gx2)} g1.y=${Math.round(gy1)} g3.y=${Math.round(gy3)}`,
      verdict: gridVerdict,
    }])
  }
  if (fi1 && fi2 && fi3) {
    const flexOk = fi2.left - fi1.left > 10 && fi3.left - fi2.left > 10 && Math.abs(fi1.top - fi2.top) < 2
    rows.value = rows.value.concat([{
      feature: 'flex 对照组（基线）',
      actual: `x=${Math.round(fi1.left)},${Math.round(fi2.left)},${Math.round(fi3.left)}`,
      verdict: flexOk ? '✅ 横排（基线确认）' : '❌ 异常（探针环境有问题）',
    }])
  }

  // ★计数口径修正：分子与分母必须同一集合（此前分子遍历 rows.value（含追加行）、
  //   分母用 results.length → 出现「32/31」这种自相矛盾的读数）
  const pass = results.filter((r) => r.verdict === '生效').length
  const semantic = rows.value.length - results.length
  out.value = '探针完成：几何 ' + pass + '/' + results.length + ' 项通过'
    + (semantic > 0 ? ' · 语义判定 ' + semantic + ' 项（见下表 ★ 行）' : '')
    + '；grid 语义：' + gridVerdict
  // 写入 driver.probes() 的读取通道（见 packages/test-core/src/driver/mp.ts）
  const g = globalThis
  g.__PROTEUS_PROBES__ = g.__PROTEUS_PROBES__ || {}
  g.__PROTEUS_PROBES__['css-profile'] = { tag: 'css-profile-probe', rows: results }
}
</script>

<template>
  <page-shell title="CSS Profile 探针" subtitle="为 CSS Profile 规格提供 Skyline 实测基线">
    <demo-block index="01" title="跑探针" :has-output="true" desc="逐条测量 CSS 特性在 Skyline 端是否被接受（几何反推）" :code="codeRun">
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
        <!-- ★LY001-ALLOW: 本页是测量装置（CSS Profile 探针）——这条 z-index 就是**被测对象**
             本身（页面目的即实测 Skyline 是否接受该特性，见页头注释与 docs/Proteus_CSS_Profile规格.md），
             不是页面层级用法。例外纪律同 check:host-rounding 的 I2-ALLOW：有名有姓、窗口有界。 -->
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
        <view id="c-grid" style="display:grid;grid-template-columns:1fr 1fr;width:150px;height:40px">
          <view id="g-item1" style="width:20px;height:16px;background-color:#6f4ae8" />
          <view id="g-item2" style="width:20px;height:16px;background-color:#e84a6f" />
          <view id="g-item3" style="width:20px;height:16px;background-color:#4ae89c" />
        </view>
        <view id="c-inline" style="display:inline-block;width:80px;height:20px" />
        <!-- ★flex 对照组：同样三个 20px 子项放进 display:flex 容器 -->
        <view id="c-flexctrl" style="display:flex;width:150px;height:40px">
          <view id="f-item1" style="width:20px;height:16px" />
          <view id="f-item2" style="width:20px;height:16px" />
          <view id="f-item3" style="width:20px;height:16px" />
        </view>
      </template>
    </demo-block>
    <demo-block index="02" title="测量结果" :has-output="false" desc="逐条给出几何实测值与生效判定" :code="codeRows">
      <template #demo>
        <view v-for="(r, i) in rows" :key="i" class="row">
          <text class="ft">{{ r.feature }}</text>
          <text class="ac">{{ r.actual }}</text>
          <text class="vd">{{ r.verdict }}</text>
        </view>
      </template>
    </demo-block>
    <api-table title="探针用法" :rows="apiRows" />
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
