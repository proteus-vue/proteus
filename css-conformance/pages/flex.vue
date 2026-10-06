<!--
  css-conformance/pages/flex.vue —— CSS 验收 · 弹性布局族（Flexbox）

  【验收对象】flex-direction / flex-wrap / justify-content / align-items / align-self /
    align-content / flex-grow / flex-shrink / flex-basis / flex（简写）/ gap / row-gap / column-gap
    —— 覆盖 G-61 已实现的 flex 全族。
  【判据（Web 为基准）】每案例稳定 id（`case-*`）——逐端截图按 id 定位、与 Web 基准并排比对。
  【案例即真实业务形态】工具栏横排（space-between）/ 表单单列（column）/ 等分列（flex:1）/ 标签流换行（wrap+gap）。
-->
<template>
  <view class="cc-page">
    <text class="cc-page__title">CSS 验收 · 弹性布局</text>
    <text class="cc-page__sub">Flexbox 族 · Web 基准 · justifyContent / alignItems / flex / gap</text>

    <!-- A：flex-direction row（横向主轴） -->
    <text class="cc-sec">A · flex-direction: row（横向）</text>
    <view class="cc-card">
      <view id="case-flex-row" class="row">
        <view class="box box--a"><text class="box__t">1</text></view>
        <view class="box box--b"><text class="box__t">2</text></view>
        <view class="box box--c"><text class="box__t">3</text></view>
      </view>
    </view>

    <!-- B：flex-direction column（纵向） -->
    <text class="cc-sec">B · flex-direction: column（纵向）</text>
    <view class="cc-card">
      <view id="case-flex-column" class="col">
        <view class="box box--a"><text class="box__t">1</text></view>
        <view class="box box--b"><text class="box__t">2</text></view>
      </view>
    </view>

    <!-- C：justify-content space-between / center -->
    <text class="cc-sec">C · justify-content（主轴分布）</text>
    <view class="cc-card">
      <view id="case-justify-between" class="row row--between">
        <view class="box box--a"><text class="box__t">L</text></view>
        <view class="box box--c"><text class="box__t">R</text></view>
      </view>
      <view id="case-justify-center" class="row row--center">
        <view class="box box--b"><text class="box__t">M</text></view>
      </view>
    </view>

    <!-- D：align-items center（交叉轴居中） -->
    <text class="cc-sec">D · align-items: center（交叉轴居中）</text>
    <view class="cc-card">
      <view id="case-align-center" class="row row--align-center">
        <view class="box box--tall"><text class="box__t">高</text></view>
        <view class="box box--a"><text class="box__t">短</text></view>
      </view>
    </view>

    <!-- E：flex:1 等分列（弹性增长/收缩/基准简写） -->
    <text class="cc-sec">E · flex: 1（等分列 · grow/shrink/basis 简写）</text>
    <view class="cc-card">
      <view id="case-flex-equal" class="row">
        <view class="grow"><text class="box__t">1fr</text></view>
        <view class="grow"><text class="box__t">1fr</text></view>
        <view class="grow"><text class="box__t">1fr</text></view>
      </view>
      <view id="case-flex-basis" class="row row--mt">
        <view class="basis-fixed"><text class="box__t">120px</text></view>
        <view class="grow"><text class="box__t">flex:1</text></view>
      </view>
    </view>

    <!-- F：flex-wrap + gap（标签流） -->
    <text class="cc-sec">F · flex-wrap: wrap + gap（标签流）</text>
    <view class="cc-card">
      <view id="case-flex-wrap" class="wrap">
        <view class="tag"><text class="tag__t">标签一</text></view>
        <view class="tag"><text class="tag__t">标签二</text></view>
        <view class="tag"><text class="tag__t">标签三</text></view>
        <view class="tag"><text class="tag__t">标签四</text></view>
        <view class="tag"><text class="tag__t">标签五</text></view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.row { display: flex; flex-direction: row; }
.col { display: flex; flex-direction: column; }
.row--between { justify-content: space-between; }
.row--center { justify-content: center; }
.row--align-center { align-items: center; }
.row--mt { margin-top: 8px; }

.box {
  width: 44px;
  height: 44px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.box--a { background-color: #5b5bd6; }
.box--b { background-color: #2e7d5b; }
.box--c { background-color: #b8722c; }
.box--tall { height: 64px; background-color: #9a3d52; }
.box__t { font-size: 13px; color: #ffffff; }

/* E：flex 简写（grow/shrink/basis） */
.grow { flex: 1; height: 40px; background-color: #4b78c8; border-radius: 6px; display: flex; align-items: center; justify-content: center; margin-right: 6px; }
.basis-fixed { flex-basis: 120px; flex-grow: 0; flex-shrink: 0; height: 40px; background-color: #7a4bc8; border-radius: 6px; display: flex; align-items: center; justify-content: center; margin-right: 6px; }

/* F：换行 + 间距 */
.wrap { display: flex; flex-direction: row; flex-wrap: wrap; gap: 8px; }
.tag { background-color: var(--cc-brand-soft); border-radius: 6px; padding: 6px 10px; }
.tag__t { font-size: 13px; color: #5b5bd6; }
</style>
