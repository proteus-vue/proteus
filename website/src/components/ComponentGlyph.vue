<script setup lang="ts">
// website/src/components/ComponentGlyph.vue —— 组件总览画廊的字形库（73 个手绘 SVG 微缩示意）
// 设计语言对齐站点深色主题：中性面 + 单一品牌强调（--brand 紫）；每个字形 3~8 个图元，
// 抓组件的「可识别形态」而非细节（参考 TDesign 组件概览的插画卡片思路）。
// 全部静态 SVG（构建期编译、零运行时 JS），视图框统一 0 0 120 80。
defineProps<{ tag: string }>()
</script>

<template>
  <svg class="glyph" viewBox="0 0 120 80" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <!-- ═══ 布局（17） ═══ -->
    <g v-if="tag === 'p-adaptive'">
      <rect x="12" y="16" width="62" height="46" rx="4" class="gs" />
      <rect x="20" y="26" width="46" height="6" rx="3" class="gf" />
      <rect x="20" y="38" width="34" height="6" rx="3" class="gf" />
      <rect x="86" y="24" width="24" height="38" rx="3" class="gb" />
      <rect x="92" y="32" width="12" height="4" rx="2" class="gw" />
    </g>
    <g v-else-if="tag === 'p-aspect'">
      <rect x="18" y="20" width="84" height="44" rx="4" class="gs" />
      <path d="M30 20v8M30 28h8M90 64v-8M90 56h-8" class="gb2" />
      <rect x="42" y="36" width="36" height="12" rx="3" class="gf" />
    </g>
    <g v-else-if="tag === 'p-box'">
      <rect x="24" y="16" width="72" height="48" rx="5" class="gs" />
      <rect x="34" y="26" width="52" height="28" rx="3" class="gf" />
    </g>
    <g v-else-if="tag === 'p-divider'">
      <rect x="24" y="18" width="52" height="7" rx="3.5" class="gf" />
      <rect x="24" y="30" width="72" height="2.5" rx="1.25" class="gb" />
      <rect x="24" y="44" width="62" height="7" rx="3.5" class="gf" />
      <rect x="24" y="56" width="40" height="7" rx="3.5" class="gf" />
    </g>
    <g v-else-if="tag === 'p-fit'">
      <rect x="20" y="14" width="80" height="52" rx="5" class="gs" />
      <rect x="28" y="22" width="30" height="36" rx="3" class="gb" />
      <rect x="64" y="22" width="28" height="16" rx="3" class="gf" />
      <rect x="64" y="42" width="28" height="16" rx="3" class="gf" />
    </g>
    <g v-else-if="tag === 'p-grid'">
      <rect x="24" y="18" width="21" height="18" rx="3" class="gf" />
      <rect x="50" y="18" width="21" height="18" rx="3" class="gb" />
      <rect x="76" y="18" width="21" height="18" rx="3" class="gf" />
      <rect x="24" y="42" width="21" height="18" rx="3" class="gf" />
      <rect x="50" y="42" width="21" height="18" rx="3" class="gf" />
      <rect x="76" y="42" width="21" height="18" rx="3" class="gf" />
    </g>
    <g v-else-if="tag === 'p-inline'">
      <line x1="20" y1="56" x2="100" y2="56" class="gl" />
      <rect x="22" y="36" width="20" height="20" rx="3" class="gf" />
      <rect x="48" y="42" width="14" height="14" rx="3" class="gb" />
      <rect x="68" y="30" width="30" height="26" rx="3" class="gf" />
    </g>
    <g v-else-if="tag === 'p-masonry'">
      <rect x="24" y="16" width="20" height="26" rx="3" class="gf" />
      <rect x="24" y="46" width="20" height="18" rx="3" class="gf" />
      <rect x="50" y="16" width="20" height="16" rx="3" class="gb" />
      <rect x="50" y="36" width="20" height="28" rx="3" class="gf" />
      <rect x="76" y="16" width="20" height="34" rx="3" class="gf" />
      <rect x="76" y="54" width="20" height="10" rx="3" class="gf" />
    </g>
    <g v-else-if="tag === 'p-safe'">
      <rect x="36" y="10" width="48" height="60" rx="7" class="gs" />
      <rect x="36" y="10" width="48" height="12" rx="7" class="gf" />
      <rect x="44" y="28" width="32" height="34" rx="3" class="gbs" />
      <path d="M44 32h32" class="gdash" />
    </g>
    <g v-else-if="tag === 'p-scroll'">
      <rect x="28" y="12" width="64" height="56" rx="5" class="gs" />
      <rect x="38" y="22" width="40" height="6" rx="3" class="gf" />
      <rect x="38" y="34" width="32" height="6" rx="3" class="gf" />
      <rect x="38" y="46" width="36" height="6" rx="3" class="gf" />
      <rect x="86" y="18" width="4" height="44" rx="2" class="gf" />
      <rect x="86" y="30" width="4" height="16" rx="2" class="gb" />
    </g>
    <g v-else-if="tag === 'p-scroll-view'">
      <rect x="20" y="16" width="80" height="48" rx="5" class="gs" />
      <rect x="30" y="26" width="22" height="28" rx="3" class="gf" />
      <rect x="56" y="26" width="22" height="28" rx="3" class="gf" />
      <rect x="82" y="26" width="10" height="28" rx="3" class="gf" />
      <rect x="30" y="70" width="60" height="4" rx="2" class="gf" />
      <rect x="30" y="70" width="34" height="4" rx="2" class="gb" />
    </g>
    <g v-else-if="tag === 'p-sidebar'">
      <rect x="14" y="14" width="28" height="52" rx="4" class="gf" />
      <rect x="20" y="22" width="16" height="5" rx="2.5" class="gb" />
      <rect x="20" y="33" width="16" height="5" rx="2.5" class="gt" />
      <rect x="20" y="44" width="16" height="5" rx="2.5" class="gt" />
      <rect x="50" y="14" width="56" height="52" rx="4" class="gs" />
    </g>
    <g v-else-if="tag === 'p-spacer'">
      <rect x="14" y="24" width="34" height="32" rx="4" class="gf" />
      <rect x="72" y="24" width="34" height="32" rx="4" class="gf" />
      <path d="M52 40h16M64 34l6 6-6 6" class="gb2" />
    </g>
    <g v-else-if="tag === 'p-stack'">
      <rect x="26" y="16" width="68" height="12" rx="4" class="gb" />
      <rect x="26" y="34" width="68" height="12" rx="4" class="gf" />
      <rect x="26" y="52" width="68" height="12" rx="4" class="gf" />
    </g>
    <g v-else-if="tag === 'p-view'">
      <rect x="20" y="14" width="80" height="52" rx="5" class="gs" />
      <rect x="36" y="28" width="48" height="24" rx="3" class="gbs" />
    </g>
    <g v-else-if="tag === 'p-virtual-list'">
      <rect x="30" y="10" width="60" height="60" rx="4" class="gs" />
      <rect x="36" y="14" width="48" height="6" rx="3" class="gf" opacity="0.35" />
      <rect x="36" y="24" width="48" height="6" rx="3" class="gb" />
      <rect x="36" y="34" width="48" height="6" rx="3" class="gb" />
      <rect x="36" y="44" width="48" height="6" rx="3" class="gb" />
      <rect x="36" y="54" width="48" height="6" rx="3" class="gf" opacity="0.35" />
      <rect x="36" y="64" width="48" height="3" rx="1.5" class="gf" opacity="0.2" />
    </g>
    <g v-else-if="tag === 'p-zone'">
      <rect x="18" y="16" width="84" height="48" rx="5" class="gs" />
      <rect x="26" y="24" width="30" height="32" rx="3" class="gb" />
      <rect x="62" y="24" width="32" height="14" rx="3" class="gf" />
      <rect x="62" y="42" width="32" height="14" rx="3" class="gf" opacity="0.5" />
    </g>

    <!-- ═══ 内容与表单（29） ═══ -->
    <g v-else-if="tag === 'p-avatar'">
      <circle cx="60" cy="40" r="24" class="gs" />
      <circle cx="60" cy="33" r="9" class="gb" />
      <path d="M42 56c3-8 10-12 18-12s15 4 18 12" class="gb" />
    </g>
    <g v-else-if="tag === 'p-button'">
      <rect x="26" y="16" width="68" height="20" rx="6" class="gb" />
      <rect x="38" y="23" width="44" height="6" rx="3" class="gw" opacity="0.55" />
      <rect x="26" y="44" width="68" height="20" rx="6" class="gsw" />
      <rect x="38" y="51" width="44" height="6" rx="3" class="gf" />
    </g>
    <g v-else-if="tag === 'p-camera'">
      <rect x="22" y="22" width="76" height="42" rx="7" class="gs" />
      <rect x="34" y="16" width="18" height="10" rx="3" class="gf" />
      <circle cx="60" cy="43" r="13" class="gf" />
      <circle cx="60" cy="43" r="6.5" class="gb" />
      <circle cx="86" cy="31" r="3" class="gb" />
    </g>
    <g v-else-if="tag === 'p-canvas'">
      <rect x="22" y="14" width="76" height="52" rx="5" class="gs" />
      <path d="M32 52c10-22 18 6 28-10s14-2 20-14" class="gb2" />
      <circle cx="32" cy="52" r="3" class="gb" />
      <circle cx="88" cy="28" r="3" class="gb" />
    </g>
    <g v-else-if="tag === 'p-checkbox'">
      <rect x="28" y="24" width="22" height="22" rx="5" class="gb" />
      <path d="M34 35l4 4 8-9" class="gw" />
      <rect x="62" y="24" width="22" height="22" rx="5" class="gsw" />
      <rect x="28" y="54" width="34" height="5" rx="2.5" class="gf" />
      <rect x="62" y="54" width="34" height="5" rx="2.5" class="gf" />
    </g>
    <g v-else-if="tag === 'p-form'">
      <rect x="24" y="14" width="20" height="5" rx="2.5" class="gt" />
      <rect x="24" y="22" width="72" height="12" rx="3" class="gsw" />
      <rect x="24" y="40" width="20" height="5" rx="2.5" class="gt" />
      <rect x="24" y="48" width="72" height="12" rx="3" class="gsw" />
      <rect x="24" y="64" width="40" height="4" rx="2" class="gerr" />
    </g>
    <g v-else-if="tag === 'p-heading'">
      <text x="22" y="48" class="gtxt">Aa</text>
      <rect x="62" y="24" width="36" height="8" rx="4" class="gf" />
      <rect x="62" y="38" width="36" height="6" rx="3" class="gf" opacity="0.6" />
      <rect x="62" y="50" width="24" height="6" rx="3" class="gf" opacity="0.35" />
    </g>
    <g v-else-if="tag === 'p-icon'">
      <rect x="20" y="26" width="22" height="22" rx="5" class="gf" />
      <path d="M31 32l2.2 4.4 4.8.7-3.5 3.4.8 4.8-4.3-2.3-4.3 2.3.8-4.8-3.5-3.4 4.8-.7z" class="gt" />
      <rect x="49" y="26" width="22" height="22" rx="5" class="gb" />
      <path d="M60 45v-8a5 5 0 0 1 0-10" class="gw" transform="translate(0,3)" />
      <rect x="78" y="26" width="22" height="22" rx="5" class="gf" />
      <circle cx="89" cy="37" r="7" class="gt" />
      <path d="M89 33v4l3 2" class="gt" />
    </g>
    <g v-else-if="tag === 'p-image'">
      <rect x="20" y="16" width="80" height="48" rx="5" class="gs" />
      <circle cx="40" cy="30" r="5" class="gb" />
      <path d="M28 56l16-16 12 10 10-8 14 14" class="gf" />
      <path d="M28 56l16-16 12 10 10-8 14 14v0H28z" class="gf" />
    </g>
    <g v-else-if="tag === 'p-input'">
      <rect x="20" y="30" width="80" height="22" rx="5" class="gsw" />
      <rect x="28" y="38" width="28" height="6" rx="3" class="gt" />
      <rect x="62" y="35" width="2.5" height="12" rx="1.25" class="gb" />
    </g>
    <g v-else-if="tag === 'p-label'">
      <rect x="20" y="30" width="62" height="20" rx="5" class="gsw" />
      <rect x="20" y="30" width="34" height="20" rx="5" class="gbs" />
      <rect x="28" y="37" width="18" height="6" rx="3" class="gb" />
      <rect x="88" y="36" width="14" height="8" rx="2" class="gf" />
    </g>
    <g v-else-if="tag === 'p-list-view'">
      <circle cx="30" cy="24" r="6" class="gb" />
      <rect x="44" y="21" width="48" height="6" rx="3" class="gf" />
      <circle cx="30" cy="42" r="6" class="gf" />
      <rect x="44" y="39" width="40" height="6" rx="3" class="gf" />
      <circle cx="30" cy="60" r="6" class="gf" />
      <rect x="44" y="57" width="44" height="6" rx="3" class="gf" />
    </g>
    <g v-else-if="tag === 'p-loading'">
      <circle cx="60" cy="40" r="20" class="gcir" />
      <path d="M60 20a20 20 0 0 1 20 20" class="garc" />
      <circle cx="60" cy="40" r="4" class="gb" />
    </g>
    <g v-else-if="tag === 'p-map'">
      <path d="M20 22l26-6v48l-26 6z" class="gf" />
      <path d="M46 16l28 8v44l-28-8z" class="gslight" />
      <path d="M74 24l26-6v48l-26 6z" class="gf" />
      <path d="M60 26c-7 0-12 5-12 12 0 8 12 20 12 20s12-12 12-20c0-7-5-12-12-12z" class="gb" />
      <circle cx="60" cy="38" r="4" class="gw" />
    </g>
    <g v-else-if="tag === 'p-media'">
      <rect x="20" y="18" width="80" height="44" rx="5" class="gs" />
      <path d="M52 32l16 8-16 8z" class="gb" />
      <rect x="28" y="66" width="50" height="4" rx="2" class="gf" />
      <rect x="28" y="66" width="30" height="4" rx="2" class="gb" />
      <circle cx="82" cy="68" r="3" class="gb" />
    </g>
    <g v-else-if="tag === 'p-nav-bar'">
      <rect x="16" y="26" width="88" height="26" rx="5" class="gs" />
      <path d="M30 39l-5 0 5-5M25 39l5 5" class="gt" />
      <rect x="48" y="36" width="24" height="6" rx="3" class="gf" />
      <circle cx="88" cy="39" r="2" class="gt" />
      <circle cx="94" cy="39" r="2" class="gt" />
    </g>
    <g v-else-if="tag === 'p-picker'">
      <rect x="30" y="14" width="60" height="52" rx="5" class="gs" />
      <rect x="30" y="34" width="60" height="12" class="gbs" />
      <rect x="42" y="22" width="8" height="5" rx="2.5" class="gt" />
      <rect x="42" y="37" width="8" height="6" rx="3" class="gb" />
      <rect x="42" y="52" width="8" height="5" rx="2.5" class="gt" />
      <rect x="56" y="22" width="8" height="5" rx="2.5" class="gt" />
      <rect x="56" y="37" width="8" height="6" rx="3" class="gb" />
      <rect x="56" y="52" width="8" height="5" rx="2.5" class="gt" />
      <rect x="70" y="22" width="8" height="5" rx="2.5" class="gt" />
      <rect x="70" y="37" width="8" height="6" rx="3" class="gb" />
      <rect x="70" y="52" width="8" height="5" rx="2.5" class="gt" />
    </g>
    <g v-else-if="tag === 'p-progress'">
      <rect x="22" y="34" width="76" height="10" rx="5" class="gf" />
      <rect x="22" y="34" width="46" height="10" rx="5" class="gb" />
      <text x="70" y="60" class="gtxt2">60%</text>
    </g>
    <g v-else-if="tag === 'p-radio'">
      <circle cx="38" cy="34" r="11" class="gbr" />
      <circle cx="38" cy="34" r="5" class="gb" />
      <circle cx="80" cy="34" r="11" class="gsw" />
      <rect x="28" y="56" width="32" height="5" rx="2.5" class="gf" />
      <rect x="70" y="56" width="32" height="5" rx="2.5" class="gf" />
    </g>
    <g v-else-if="tag === 'p-rich-text'">
      <rect x="22" y="16" width="52" height="8" rx="4" class="gf" />
      <rect x="22" y="30" width="76" height="5" rx="2.5" class="gt" />
      <rect x="22" y="41" width="66" height="5" rx="2.5" class="gt" transform="skewX(-8)" />
      <rect x="30" y="52" width="52" height="5" rx="2.5" class="gb2" style="text-decoration: underline" />
      <rect x="22" y="63" width="40" height="5" rx="2.5" class="gt" />
    </g>
    <g v-else-if="tag === 'p-scale'">
      <text x="24" y="52" class="gtxt3">A</text>
      <text x="58" y="58" class="gtxt4 gb2-f">A</text>
    </g>
    <g v-else-if="tag === 'p-select'">
      <rect x="24" y="14" width="72" height="18" rx="5" class="gsw" />
      <rect x="32" y="20" width="30" height="6" rx="3" class="gt" />
      <path d="M82 20l5 5 5-5" class="gt" />
      <rect x="24" y="38" width="72" height="34" rx="5" class="gs" />
      <rect x="32" y="44" width="40" height="5" rx="2.5" class="gb" />
      <rect x="32" y="54" width="34" height="5" rx="2.5" class="gt" />
      <rect x="32" y="64" width="38" height="5" rx="2.5" class="gt" />
    </g>
    <g v-else-if="tag === 'p-selection'">
      <rect x="20" y="20" width="38" height="40" rx="5" class="gbs" />
      <path d="M30 40l6 6 12-13" class="gb2" />
      <rect x="66" y="20" width="38" height="40" rx="5" class="gsw" />
    </g>
    <g v-else-if="tag === 'p-skeleton'">
      <circle cx="34" cy="28" r="10" class="gf" />
      <rect x="52" y="22" width="44" height="12" rx="4" class="gf" />
      <rect x="22" y="48" width="76" height="8" rx="4" class="gf" opacity="0.6" />
      <rect x="22" y="62" width="56" height="8" rx="4" class="gf" opacity="0.35" />
    </g>
    <g v-else-if="tag === 'p-slider'">
      <rect x="20" y="38" width="80" height="6" rx="3" class="gf" />
      <rect x="20" y="38" width="46" height="6" rx="3" class="gb" />
      <circle cx="66" cy="41" r="8" class="gwk" />
      <circle cx="66" cy="41" r="4" class="gb" />
    </g>
    <g v-else-if="tag === 'p-svg'">
      <path d="M22 58C34 18 52 62 66 34s22-12 32-16" class="gb2" />
      <rect x="19" y="55" width="6" height="6" rx="1.5" class="gb" />
      <rect x="63" y="31" width="6" height="6" rx="1.5" class="gb" />
      <rect x="95" y="15" width="6" height="6" rx="1.5" class="gf" />
    </g>
    <g v-else-if="tag === 'p-switch'">
      <rect x="32" y="26" width="40" height="22" rx="11" class="gb" />
      <circle cx="61" cy="37" r="8" class="gw" />
      <rect x="80" y="30" width="26" height="4" rx="2" class="gf" />
      <rect x="80" y="40" width="18" height="4" rx="2" class="gf" />
    </g>
    <g v-else-if="tag === 'p-text'">
      <rect x="24" y="18" width="72" height="7" rx="3.5" class="gf" />
      <rect x="24" y="31" width="60" height="6" rx="3" class="gf" opacity="0.75" />
      <rect x="24" y="43" width="68" height="6" rx="3" class="gf" opacity="0.55" />
      <rect x="24" y="55" width="42" height="6" rx="3" class="gf" opacity="0.4" />
    </g>
    <g v-else-if="tag === 'p-textarea'">
      <rect x="20" y="14" width="80" height="52" rx="5" class="gsw" />
      <rect x="28" y="22" width="52" height="6" rx="3" class="gt" />
      <rect x="28" y="34" width="64" height="6" rx="3" class="gt" />
      <rect x="28" y="46" width="20" height="6" rx="3" class="gb" />
      <rect x="50" y="46" width="2.5" height="6" class="gb" />
    </g>

    <!-- ═══ 页面外壳（17） ═══ -->
    <g v-else-if="tag === 'p-action-sheet'">
      <rect x="34" y="8" width="52" height="64" rx="6" class="gs" opacity="0.45" />
      <path d="M30 34h60v28a6 6 0 0 1-6 6H36a6 6 0 0 1-6-6z" class="gpanel" />
      <rect x="42" y="42" width="36" height="5" rx="2.5" class="gb" />
      <rect x="42" y="52" width="30" height="5" rx="2.5" class="gt" />
      <rect x="42" y="62" width="36" height="0" class="gl" />
      <path d="M36 60h48" class="gl" />
      <rect x="42" y="63" width="30" height="4" rx="2" class="gt" />
    </g>
    <g v-else-if="tag === 'p-ad'">
      <rect x="18" y="26" width="84" height="30" rx="5" class="gsw" />
      <rect x="26" y="34" width="22" height="14" rx="3" class="gf" />
      <rect x="54" y="34" width="30" height="5" rx="2.5" class="gt" />
      <rect x="54" y="43" width="22" height="5" rx="2.5" class="gt" opacity="0.6" />
      <rect x="88" y="31" width="10" height="8" rx="2" class="gb" />
    </g>
    <g v-else-if="tag === 'p-drawer'">
      <rect x="16" y="14" width="88" height="52" rx="5" class="gs" />
      <path d="M20 14h34v52H20a4 4 0 0 1-4-4z" class="gpanel" />
      <rect x="26" y="24" width="20" height="5" rx="2.5" class="gb" />
      <rect x="26" y="36" width="20" height="5" rx="2.5" class="gt" />
      <rect x="26" y="48" width="20" height="5" rx="2.5" class="gt" />
    </g>
    <g v-else-if="tag === 'p-keyboard-accessory'">
      <rect x="20" y="20" width="80" height="12" rx="4" class="gb" />
      <circle cx="34" cy="26" r="3" class="gw" />
      <circle cx="60" cy="26" r="3" class="gw" opacity="0.7" />
      <circle cx="86" cy="26" r="3" class="gw" opacity="0.7" />
      <rect x="20" y="38" width="80" height="26" rx="4" class="gf" opacity="0.7" />
      <rect x="26" y="44" width="14" height="6" rx="2" class="gslight" />
      <rect x="44" y="44" width="14" height="6" rx="2" class="gslight" />
      <rect x="62" y="44" width="14" height="6" rx="2" class="gslight" />
      <rect x="26" y="54" width="32" height="6" rx="2" class="gslight" />
      <rect x="62" y="54" width="32" height="6" rx="2" class="gslight" />
    </g>
    <g v-else-if="tag === 'p-mask'">
      <rect x="20" y="14" width="80" height="52" rx="5" class="gs" opacity="0.5" />
      <rect x="20" y="14" width="80" height="52" rx="5" class="gdim" />
      <rect x="36" y="30" width="48" height="22" rx="4" class="gpanel" />
      <rect x="44" y="37" width="32" height="5" rx="2.5" class="gt" />
      <rect x="44" y="45" width="20" height="4" rx="2" class="gt" opacity="0.6" />
    </g>
    <g v-else-if="tag === 'p-modal'">
      <rect x="24" y="18" width="72" height="44" rx="6" class="gpanel" />
      <rect x="24" y="18" width="72" height="14" rx="6" class="gf" />
      <rect x="34" y="40" width="40" height="5" rx="2.5" class="gt" />
      <rect x="34" y="50" width="24" height="10" rx="4" class="gsw" />
      <rect x="64" y="50" width="24" height="10" rx="4" class="gb" />
    </g>
    <g v-else-if="tag === 'p-nav'">
      <path d="M28 40l8-6M28 40l8 6" class="gt" />
      <rect x="46" y="34" width="12" height="10" rx="2" class="gb" />
      <rect x="62" y="34" width="12" height="10" rx="2" class="gf" />
      <rect x="78" y="34" width="12" height="10" rx="2" class="gf" />
      <rect x="94" y="34" width="4" height="10" rx="2" class="gf" opacity="0.5" />
    </g>
    <g v-else-if="tag === 'p-page'">
      <rect x="24" y="10" width="72" height="60" rx="5" class="gs" />
      <rect x="24" y="10" width="72" height="12" rx="5" class="gf" />
      <rect x="32" y="30" width="56" height="6" rx="3" class="gt" />
      <rect x="32" y="42" width="40" height="6" rx="3" class="gt" opacity="0.6" />
      <rect x="24" y="60" width="72" height="10" rx="5" class="gf" opacity="0.6" />
    </g>
    <g v-else-if="tag === 'p-page-container'">
      <rect x="34" y="8" width="52" height="64" rx="6" class="gs" opacity="0.45" />
      <path d="M30 38h60v22a6 6 0 0 1-6 6H36a6 6 0 0 1-6-6z" class="gpanel" />
      <rect x="52" y="42" width="16" height="4" rx="2" class="gt" opacity="0.7" />
      <rect x="42" y="52" width="36" height="5" rx="2.5" class="gb" />
      <rect x="42" y="61" width="26" height="4" rx="2" class="gt" />
    </g>
    <g v-else-if="tag === 'p-popover'">
      <rect x="46" y="46" width="28" height="16" rx="4" class="gsw" />
      <path d="M60 46v-6" class="gl" />
      <rect x="30" y="14" width="60" height="26" rx="5" class="gb" />
      <rect x="40" y="22" width="40" height="5" rx="2.5" class="gw" opacity="0.85" />
      <rect x="40" y="31" width="28" height="4" rx="2" class="gw" opacity="0.5" />
      <path d="M56 40l4 6 4-6z" class="gb" />
    </g>
    <g v-else-if="tag === 'p-popup'">
      <rect x="20" y="14" width="80" height="52" rx="5" class="gs" opacity="0.4" />
      <rect x="20" y="14" width="80" height="52" rx="5" class="gdim" />
      <rect x="38" y="28" width="44" height="26" rx="5" class="gpanel" />
      <rect x="46" y="35" width="28" height="5" rx="2.5" class="gb" />
      <rect x="46" y="44" width="20" height="4" rx="2" class="gt" />
    </g>
    <g v-else-if="tag === 'p-segment'">
      <rect x="22" y="30" width="76" height="22" rx="6" class="gf" />
      <rect x="26" y="34" width="22" height="14" rx="4" class="gb" />
      <rect x="52" y="39" width="14" height="4" rx="2" class="gt" />
      <rect x="72" y="39" width="14" height="4" rx="2" class="gt" />
    </g>
    <g v-else-if="tag === 'p-split'">
      <rect x="16" y="16" width="42" height="48" rx="4" class="gsw" />
      <rect x="66" y="16" width="38" height="48" rx="4" class="gs" />
      <line x1="60" y1="16" x2="60" y2="64" class="gb2" />
      <circle cx="60" cy="32" r="2" class="gb" />
      <circle cx="60" cy="40" r="2" class="gb" />
      <circle cx="60" cy="48" r="2" class="gb" />
    </g>
    <g v-else-if="tag === 'p-tabbar'">
      <rect x="18" y="10" width="84" height="40" rx="5" class="gs" opacity="0.35" />
      <rect x="18" y="52" width="84" height="18" rx="5" class="gpanel" />
      <path d="M34 58v6M31 61h6" class="gb2" />
      <circle cx="60" cy="60" r="4" class="gt" />
      <rect x="78" y="58" width="8" height="5" rx="2.5" class="gt" />
      <rect x="30" y="66" width="8" height="3" rx="1.5" class="gb" />
    </g>
    <g v-else-if="tag === 'p-toast'">
      <rect x="34" y="8" width="52" height="64" rx="6" class="gs" opacity="0.4" />
      <rect x="26" y="22" width="68" height="18" rx="9" class="gpanel" />
      <circle cx="38" cy="31" r="5" class="gb" />
      <path d="M36 31l1.5 1.5 3-3" class="gw" />
      <rect x="48" y="29" width="34" height="4" rx="2" class="gt" />
    </g>
    <g v-else-if="tag === 'p-toolbar'">
      <rect x="16" y="30" width="88" height="22" rx="5" class="gpanel" />
      <rect x="24" y="36" width="14" height="10" rx="3" class="gb" />
      <rect x="44" y="36" width="14" height="10" rx="3" class="gf" />
      <rect x="64" y="36" width="14" height="10" rx="3" class="gf" />
      <rect x="84" y="36" width="12" height="10" rx="3" class="gf" />
    </g>
    <g v-else-if="tag === 'p-webview'">
      <rect x="16" y="14" width="88" height="52" rx="5" class="gs" />
      <rect x="24" y="21" width="52" height="9" rx="4.5" class="gf" />
      <circle cx="92" cy="25.5" r="2.5" class="gb" />
      <rect x="24" y="38" width="72" height="5" rx="2.5" class="gt" />
      <rect x="24" y="49" width="56" height="5" rx="2.5" class="gt" opacity="0.6" />
    </g>

    <!-- ═══ 手势（2） ═══ -->
    <g v-else-if="tag === 'p-draggable'">
      <rect x="38" y="26" width="34" height="30" rx="6" class="gbs" />
      <path d="M55 16v-6M55 10l-4 4M55 10l4 4M55 66v6M55 72l-4-4M55 72l4-4M30 41h-8M22 41l4-4M22 41l4 4M90 41h8M98 41l-4-4M98 41l-4 4" class="gb2" />
      <circle cx="55" cy="41" r="5" class="gb" />
    </g>
    <g v-else-if="tag === 'p-scrollable'">
      <rect x="30" y="10" width="60" height="60" rx="5" class="gs" />
      <rect x="38" y="20" width="44" height="6" rx="3" class="gf" />
      <rect x="38" y="32" width="36" height="6" rx="3" class="gf" />
      <path d="M52 52l8 8 8-8" class="gb2" />
      <rect x="84" y="18" width="4" height="24" rx="2" class="gb" />
    </g>

    <!-- ═══ 工程（5） ═══ -->
    <g v-else-if="tag === 'p-animate'">
      <circle cx="30" cy="40" r="10" class="gf" opacity="0.25" />
      <circle cx="52" cy="40" r="10" class="gbs" />
      <circle cx="76" cy="40" r="10" class="gb" />
      <path d="M92 30c4 6 4 14 0 20" class="gb2" />
    </g>
    <g v-else-if="tag === 'p-error-boundary'">
      <path d="M60 18l18 32H42z" class="gwarn" />
      <rect x="58.5" y="28" width="3" height="11" rx="1.5" class="gw" />
      <circle cx="60" cy="43" r="1.8" class="gw" />
      <path d="M28 58a34 20 0 0 0 64 0" class="gb2" />
      <path d="M92 52l2 7-7 1" class="gb2" />
    </g>
    <g v-else-if="tag === 'p-router-link'">
      <rect x="18" y="28" width="30" height="24" rx="5" class="gf" />
      <rect x="74" y="28" width="30" height="24" rx="5" class="gb" />
      <path d="M52 40h16M62 34l6 6-6 6" class="gb2" />
    </g>
    <g v-else-if="tag === 'p-share-element'">
      <rect x="14" y="18" width="34" height="44" rx="4" class="gs" />
      <circle cx="31" cy="40" r="9" class="gf" />
      <rect x="72" y="18" width="34" height="44" rx="4" class="gs" />
      <circle cx="89" cy="40" r="9" class="gbs" />
      <path d="M48 40h20M62 34l6 6-6 6" class="gb2" />
    </g>
    <g v-else-if="tag === 'p-transition'">
      <rect x="24" y="26" width="22" height="22" rx="4" class="gb" />
      <rect x="52" y="26" width="22" height="22" rx="4" class="gb" opacity="0.45" />
      <rect x="80" y="26" width="22" height="22" rx="4" class="gb" opacity="0.15" />
      <path d="M35 56v6M63 56v6M91 56v6" class="gl" />
    </g>

    <!-- ═══ 能力入口（3） ═══ -->
    <g v-else-if="tag === 'p-location'">
      <circle cx="60" cy="38" r="18" class="gbs" />
      <circle cx="60" cy="38" r="10" class="gbs" />
      <path d="M60 24c-6 0-10 4-10 10 0 7 10 17 10 17s10-10 10-17c0-6-4-10-10-10z" class="gb" />
      <circle cx="60" cy="34" r="3.5" class="gw" />
    </g>
    <g v-else-if="tag === 'p-pick-photo'">
      <rect x="20" y="16" width="66" height="48" rx="5" class="gs" />
      <circle cx="38" cy="30" r="4.5" class="gb" />
      <path d="M26 56l14-14 11 9 9-7 13 12" class="gf" />
      <circle cx="86" cy="54" r="11" class="gb" />
      <path d="M81 54l3.5 3.5 7-7" class="gw" />
    </g>
    <g v-else-if="tag === 'p-scan-qr'">
      <path d="M24 34V28a6 6 0 0 1 6-6h6M86 22h6a6 6 0 0 1 6 6v6M98 48v6a6 6 0 0 1-6 6h-6M36 60h-6a6 6 0 0 1-6-6v-6" class="gb2" />
      <rect x="40" y="30" width="10" height="10" rx="2" class="gf" />
      <rect x="70" y="30" width="10" height="10" rx="2" class="gf" />
      <rect x="40" y="44" width="10" height="10" rx="2" class="gf" />
      <rect x="70" y="44" width="10" height="10" rx="2" class="gf" />
      <rect x="56" y="30" width="8" height="24" rx="1" class="gb" opacity="0.85" />
    </g>

    <!-- 回退：未知 tag（不应发生——索引与字形同步维护） -->
    <g v-else>
      <rect x="30" y="22" width="60" height="36" rx="5" class="gs" />
      <rect x="40" y="34" width="40" height="6" rx="3" class="gf" />
    </g>
  </svg>
</template>

<style scoped>
.glyph { width: 100%; height: 100%; display: block; }
/* 中性层 */
.gs { stroke: var(--cg-stroke, #3a3a46); stroke-width: 2; fill: none; stroke-linecap: round; stroke-linejoin: round; }
.gsw { stroke: var(--cg-stroke, #3a3a46); stroke-width: 2; fill: var(--cg-panel, #17171d); stroke-linecap: round; }
.gf { fill: #26262f; }
.gslight { fill: #2e2e3a; }
.gcir { stroke: #26262f; stroke-width: 5; fill: none; }
.garc { stroke: var(--brand, #7c5cff); stroke-width: 5; fill: none; stroke-linecap: round; }
.gdash { stroke: var(--brand2, #ab9bff); stroke-width: 1.5; stroke-dasharray: 4 4; fill: none; }
.gl { stroke: #3a3a46; stroke-width: 1.5; fill: none; stroke-linecap: round; }
/* 品牌层 */
.gb { fill: var(--brand, #7c5cff); }
.gb2 { stroke: var(--brand2, #ab9bff); stroke-width: 2.5; fill: none; stroke-linecap: round; stroke-linejoin: round; }
.gbr { stroke: var(--brand, #7c5cff); stroke-width: 2.5; fill: none; }
.gbs { fill: var(--brand-soft, rgba(124, 92, 255, 0.2)); }
.gerr { fill: var(--rec, #ff6b6b); }
.gwarn { fill: var(--warn, #ffb454); }
/* 高光/文字层 */
.gw { stroke: #f4f4f7; stroke-width: 2; fill: none; stroke-linecap: round; stroke-linejoin: round; }
.gwk { fill: #f4f4f7; }
.gt { fill: #55555f; }
.gtxt { fill: var(--brand, #7c5cff); font: 800 30px var(--font-ui, system-ui); }
.gtxt2 { fill: var(--dim, #6a6a78); font: 600 10px var(--font-ui, system-ui); }
.gtxt3 { fill: #55555f; font: 600 20px var(--font-ui, system-ui); }
.gtxt4 { font: 800 34px var(--font-ui, system-ui); }
.gb2-f { fill: var(--brand2, #ab9bff); }
/* 面板感（弹层族） */
.gpanel { fill: #1f1f28; stroke: #34343e; stroke-width: 1.5; }
.gdim { fill: rgba(0, 0, 0, 0.45); }
</style>
