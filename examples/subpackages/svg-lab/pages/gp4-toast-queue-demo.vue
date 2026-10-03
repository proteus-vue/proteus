<!--
  examples/pages/gp4-toast-queue-demo.vue —— ★★★GP4-a（2026-10-03）：**Toast 队列验证页**

  【对照 uni.showToast（本卡的对外证据）】
    · `uni.showToast` = 全局单例：样式固定、类型仅 loading/success/none/error、**无法管理顺序**
      （连续触发行为未定义——通常只有最后一条可见）
    · 本页演示：**排队有序**（连续触发 10 条按序显示）、**位置/色彩语义可选**、
      **时长可选**（0 = 常驻）、**可手动关闭**、**可自定义样式**（CSS 变量）

  【★本页源码**没有**宿主标签】宿主由构建期按需注入（检测到 showToast 用法才注入——
    "源码零每页引入"的兑现；若项目里手动写了宿主标签，自动注入让位、防双宿主重复渲染）。
    ★注释里**不要**写宿主标签的字面量：注入检测是**静态词法**的（含注释）——写了会被当成手动声明。
-->
<script setup lang="ts">
import { ref } from 'vue'
import type { Ref } from 'vue'
import { showToast, hideToast, clearToasts, configureToast, toastStats, subscribeToast } from '@proteus-vue/runtime'

const lastId = ref('（无）')
const shownStat = ref(0)
/** 显示序列（队列推进的页面侧独立记录——e2e 采样漏号时的第二证据链）
 *  ★写法：类型标在**变量声明**上（`const x: Ref<string[]> = ref([])`）——
 *    `ref<T>([...])` 带类型实参的调用在 MP 侧初值无法静态求值（落 undefined，编译器有专门告警）。 */
const burstLog: Ref<string[]> = ref([])

function refreshStat() {
  shownStat.value = toastStats().shown
}

/** 单条（默认样式：居中、灰黑底） */
function single() {
  lastId.value = showToast({ text: '单条提示（默认 center）', duration: 6000 })
  refreshStat()
}

/**
 * ★核心判据：连续触发 10 条 → 队列按序显示。
 * 【为什么每条 300ms】e2e 逐条采样的窗口必须**明显大于** IDE 往返开销（实测每次 evaluate
 *   约 150–250ms）——太短会"跳号采样"，那是**装置限制**而非队列缺陷（本轮实测教训）。
 * 【为什么同时写 burstLog】除 e2e 采样外，页面自己留一份**显示序列**（队列推进的独立证据，
 *   采样漏掉也不影响判据——两条证据链互不依赖）。
 */
function burst10() {
  startBurstLog()
  for (let i = 1; i <= 10; i++) {
    showToast({ text: '排队第 ' + i + ' 条', duration: 300 })
  }
  refreshStat()
}

/** 显示序列（订阅队列——页面侧独立记录；e2e 可读同一条链路的另一份证据） */
function startBurstLog() {
  burstLog.value = []
  subscribeToast((snap) => {
    if (snap.current) {
      const t = snap.current.text
      // ★用 push（**不用数组展开 `[...arr, x]`**——MP 产物对展开支持不稳，本轮实测落成 undefined）
      if (t.indexOf('排队第') === 0 && burstLog.value[burstLog.value.length - 1] !== t) {
        burstLog.value.push(t)
      }
    }
  })
  // 不自动退订（页面销毁即释放；自动退订要 setTimeout 的 this 语义，在 MP 下引风险而收益为零）
}

/** 位置三态（Overlay 层内的锚点） */
function posTop() {
  lastId.value = showToast({ text: '顶部提示', position: 'top', duration: 1500 })
}
function posBottom() {
  lastId.value = showToast({ text: '底部提示', position: 'bottom', duration: 1500 })
}

/** 色彩语义（颜色由宿主 CSS 变量决定——可用 --p-toast-success 等自定义） */
function semantic() {
  showToast({ text: '操作成功', type: 'success', duration: 1200 })
  showToast({ text: '请注意', type: 'warn', duration: 1200 })
  showToast({ text: '出错了', type: 'error', duration: 1200 })
}

/** 常驻（duration=0）+ 手动关闭（对照 uni.showToast 的"必须等它自己消失"） */
function persistent() {
  lastId.value = showToast({ text: '常驻提示（点它或点下方按钮关闭）', duration: 0, dismissible: true })
}

/** 手动关闭最后一条 / 全清 */
function closeLast() {
  hideToast(lastId.value === '（无）' ? undefined : lastId.value)
}
function closeAll() {
  clearToasts()
}

/** ★先清空再洪水（给 e2e 一个**干净起点**——否则残留的等待区会让"丢弃条数"不可预期） */
function clearThenFlood() {
  clearToasts()
  flood()
}

/** 队列上限与丢弃策略（防刷屏——任务卡硬要求） */
function flood() {
  // 上限降到 3（等待区）后连发 8 条 → 丢弃可观测（toastStats().dropped）
  configureToast({ maxSize: 3, policy: 'drop-oldest' })
  for (let i = 1; i <= 8; i++) {
    // ★洪水条目 600ms：既验证"上限 3 → 丢弃"，也让 e2e 有机会读到（400ms 会被 IDE 往返吃掉）
    showToast({ text: '洪水 ' + i, duration: 600 })
  }
  refreshStat()
}
function restoreConfig() {
  configureToast({ maxSize: 10, policy: 'drop-oldest' })
  // ★时长偏长（3000）：e2e 读取有 IDE 往返开销（~200ms/次）——短条目会被"读到之前已关"误判
  showToast({ text: '配置已恢复（上限 10）', duration: 3000 })
}
</script>

<template>
  <view class="gp4">
    <text class="gp4-title">GP4-a · Toast 队列</text>
    <text class="gp4-sub">对照 uni.showToast：可排队 / 可自定义位置与色彩 / 可手动关闭 / 有上限与丢弃策略</text>

    <view class="gp4-block">
      <text class="gp4-label">① 排队（核心判据）</text>
      <button id="gp4-burst" class="gp4-btn" @tap="burst10">连续触发 10 条（按序显示）</button>
      <button id="gp4-single" class="gp4-btn gp4-btn--ghost" @tap="single">单条（默认）</button>
    </view>

    <view class="gp4-block">
      <text class="gp4-label">② 位置（Overlay 层内锚点）</text>
      <button id="gp4-top" class="gp4-btn gp4-btn--ghost" @tap="posTop">顶部</button>
      <button id="gp4-bottom" class="gp4-btn gp4-btn--ghost" @tap="posBottom">底部</button>
    </view>

    <view class="gp4-block">
      <text class="gp4-label">③ 色彩语义（可经 CSS 变量换色）</text>
      <button id="gp4-semantic" class="gp4-btn gp4-btn--ghost" @tap="semantic">success / warn / error</button>
    </view>

    <view class="gp4-block">
      <text class="gp4-label">④ 常驻与手动关闭（duration=0）</text>
      <button id="gp4-persist" class="gp4-btn gp4-btn--ghost" @tap="persistent">常驻提示</button>
      <button id="gp4-close-last" class="gp4-btn gp4-btn--ghost" @tap="closeLast">关闭最后一条</button>
      <button id="gp4-close-all" class="gp4-btn gp4-btn--ghost" @tap="closeAll">全部清空</button>
    </view>

    <view class="gp4-block">
      <text class="gp4-label">⑤ 上限与丢弃策略（防刷屏）</text>
      <button id="gp4-clear-then-flood" class="gp4-btn gp4-btn--ghost" @tap="clearThenFlood">先清空再连发 8 条（上限 3）</button>
      <button id="gp4-restore" class="gp4-btn gp4-btn--ghost" @tap="restoreConfig">恢复配置</button>
    </view>

    <view class="gp4-block">
      <text class="gp4-label">读数（e2e 断言面）</text>
      <text id="gp4-readout" class="gp4-readout">lastId={{ lastId }} · shown={{ shownStat }}</text>
      <text id="gp4-burstlog" class="gp4-readout">显示序列={{ burstLog }}</text>
    </view>
  </view>
</template>

<style scoped>
.gp4 {
  display: flex;
  flex-direction: column;
  padding: 24rpx;
}
.gp4-title {
  font-size: 32rpx;
  font-weight: 700;
  margin-bottom: 8rpx;
}
.gp4-sub {
  font-size: 24rpx;
  color: #666;
  margin-bottom: 24rpx;
}
.gp4-block {
  display: flex;
  flex-direction: column;
  margin-bottom: 28rpx;
}
.gp4-label {
  font-size: 24rpx;
  color: #999;
  margin-bottom: 10rpx;
}
.gp4-btn {
  margin-bottom: 12rpx;
}
.gp4-btn--ghost {
  background-color: #f2f3f5;
  color: #333;
}
.gp4-readout {
  font-size: 24rpx;
  color: #07c160;
}
</style>
