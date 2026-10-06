<!--
  css-conformance/pages/index.vue —— CSS 验收 · 首页（逐特性索引）

  【为什么有它（用户 2026-10-09 指出）】此前本项目**没有首页导航**——每次只能用脚本
  `--es screen <名>` 打开某页，导致"桌面点开复审某一页"做不到，会漏掉其他端（修一端漏其余）。
  本页 = 可点索引：列出全部特性页，点进任意页逐端复审。

  【四端形态（B1 统一运行期）】
   · Web/MP：原生 Vue DOM/小程序渲染——`:style` / 自定义组件原生可用。
   · App（自绘）：经**统一运行期**（buildAppRuntimeContent 产 tpl/table/events/handlers →
     createScreenRuntime 实例化 + 手势派发）——`@tap="$nav('<页名>')"` 编译成 nav 动作，
     运行期交共享 `router.push` 导航（与 Web/MP 同形）。
   ★目标一律**静态字符串**（`$nav('text')`）——动态目标（`v-for` 里 `$nav(item.name)`）为后续批次
     （编译期会诊断）；故此处逐条平铺（列表写法保持直白、可静态校验）。
-->
<script setup lang="ts">
// ★R3 验证：响应式数据回写（点击 count++ → 订阅 → 增量 applyOps → 文本刷新）
import { ref } from 'vue'
// ★★★四端统一导航（2026-10-08 修复「Web/MP 点击无反应」）：`$nav('页名')` 是 App 运行期的
//   导航一等动作；Web/MP 需要同名实现——本函数提供之：
//     · Web：script setup 顶层绑定 → 模板 n.$nav 解析到它；
//     · MP：`script/function-to-methods` 把顶层函数编成页方法 → this.$nav 解析到它；
//     · App：编译器把 @tap="$nav('x')" 编译成 nav 动作（**不看函数体**）→ 本函数对 App 无害。
import { router } from '../router'
function $nav(name: string): void {
  router.push({ name } as never)
}
const count = ref(0)
</script>

<template>
  <view class="cc-page">
    <text class="cc-page__title">CSS 验收 · 索引</text>
    <text class="cc-page__sub">逐特性页 · 点进任意页复审（Web/MP/App 一致）</text>

    <view class="ix-list">
      <view id="case-count" class="ix-item ix-item--count" @tap="count++"><text class="ix-item__t">点击计数（响应式）</text><text class="ix-item__d">{{ count }}</text></view>
      <view class="ix-item" @tap="$nav('text')"><text class="ix-item__t">文本换行</text><text class="ix-item__d">white-space 族</text></view>
      <view class="ix-item" @tap="$nav('word-break')"><text class="ix-item__t">断词</text><text class="ix-item__d">word-break</text></view>
      <view class="ix-item" @tap="$nav('line-clamp')"><text class="ix-item__t">多行截断</text><text class="ix-item__d">-webkit-line-clamp</text></view>
      <view class="ix-item" @tap="$nav('text-shadow')"><text class="ix-item__t">文本阴影</text><text class="ix-item__d">text-shadow</text></view>
      <view class="ix-item" @tap="$nav('border')"><text class="ix-item__t">边框</text><text class="ix-item__d">border 族</text></view>
      <view class="ix-item" @tap="$nav('border-style')"><text class="ix-item__t">边框线型</text><text class="ix-item__d">dashed / dotted</text></view>
      <view class="ix-item" @tap="$nav('outline')"><text class="ix-item__t">轮廓</text><text class="ix-item__d">outline 族</text></view>
      <view class="ix-item" @tap="$nav('overflow')"><text class="ix-item__t">溢出</text><text class="ix-item__d">overflow</text></view>
      <view class="ix-item" @tap="$nav('overflow-page')"><text class="ix-item__t">溢出（页面）</text><text class="ix-item__d">overflow 页面级</text></view>
      <view class="ix-item" @tap="$nav('grid-auto')"><text class="ix-item__t">网格轨迹</text><text class="ix-item__d">grid-auto / minmax</text></view>
      <view class="ix-item" @tap="$nav('grid-auto-flow')"><text class="ix-item__t">网格流</text><text class="ix-item__d">grid-auto-flow</text></view>
      <view class="ix-item" @tap="$nav('grid-template-areas')"><text class="ix-item__t">网格区域</text><text class="ix-item__d">grid-template-areas</text></view>
      <view class="ix-item" @tap="$nav('justify-self')"><text class="ix-item__t">网格自对齐</text><text class="ix-item__d">justify-self</text></view>
      <view class="ix-item" @tap="$nav('place-items')"><text class="ix-item__t">网格对齐</text><text class="ix-item__d">place-items</text></view>
      <view class="ix-item" @tap="$nav('math-functions')"><text class="ix-item__t">数学函数</text><text class="ix-item__d">min / max / clamp</text></view>
      <view class="ix-item" @tap="$nav('background-position')"><text class="ix-item__t">背景定位</text><text class="ix-item__d">background size/position</text></view>
      <view class="ix-item" @tap="$nav('safe-area')"><text class="ix-item__t">安全区</text><text class="ix-item__d">--pf-inset-*</text></view>
      <view class="ix-item" @tap="$nav('vw-vh')"><text class="ix-item__t">视口单位</text><text class="ix-item__d">vw / vh</text></view>
      <view class="ix-item" @tap="$nav('flex')"><text class="ix-item__t">弹性布局</text><text class="ix-item__d">flex 族</text></view>
      <view class="ix-item" @tap="$nav('box-model')"><text class="ix-item__t">盒模型</text><text class="ix-item__d">宽高 / margin / padding / box-sizing</text></view>
      <view class="ix-item" @tap="$nav('position')"><text class="ix-item__t">定位</text><text class="ix-item__d">position / inset / z-index</text></view>
      <view class="ix-item" @tap="$nav('background')"><text class="ix-item__t">背景</text><text class="ix-item__d">color / image / size / repeat</text></view>
      <view class="ix-item" @tap="$nav('font')"><text class="ix-item__t">文本样式</text><text class="ix-item__d">字号 / 字重 / 行高 / 对齐</text></view>
      <view class="ix-item" @tap="$nav('effects')"><text class="ix-item__t">视觉效果</text><text class="ix-item__d">shadow / transform / aspect-ratio</text></view>
      <view class="ix-item" @tap="$nav('animation')"><text class="ix-item__t">动画 / 过渡</text><text class="ix-item__d">@keyframes / transition</text></view>
      <view class="ix-item" @tap="$nav('grid-tracks')"><text class="ix-item__t">网格轨道</text><text class="ix-item__d">template-columns / span</text></view>
      <view class="ix-item" @tap="$nav('at-rules')"><text class="ix-item__t">条件规则</text><text class="ix-item__d">@media / @supports / @layer</text></view>
      <view class="ix-item" @tap="$nav('units')"><text class="ix-item__t">单位</text><text class="ix-item__d">px / em / rem / pt</text></view>
      <view class="ix-item" @tap="$nav('misc')"><text class="ix-item__t">杂项</text><text class="ix-item__d">pointer-events / mask / filter</text></view>
    </view>
  </view>
</template>

<style scoped>
.ix-list { display: flex; flex-direction: column; }
.ix-item {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  background: var(--cc-surface);
  border-radius: 10px;
  padding: 12px 14px;
  margin-bottom: 8px;
}
.ix-item--count { background: var(--cc-brand-soft); }
.ix-item__t { font-size: 15px; font-weight: 600; color: var(--cc-text); }
.ix-item__d { font-size: 12px; color: var(--cc-text-3); }
</style>
