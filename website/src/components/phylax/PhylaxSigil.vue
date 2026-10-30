<!-- website/src/components/phylax/PhylaxSigil.vue —— ★★★Phylax（请求治理层）的**品牌徽记**
     ★#1396b（用户 2026-10-30 第四次反馈：「还是文字为主，没有产品品牌上的元素」）

     【它是什么】产品线里的每个引擎有自己的徽记，且**几何各不相同**（这是"品牌元素"的根本）：
       · Kairos（动画）= 圆形叠层：光晕盘 + 光带环 + 旋转刻度 + 轨道节点 + 扫描弧 + 分层核心
       · Phylax（请求治理）= **六边形守卫框 + 纵向主轴 + 三闸节点 + 底部三态分岔**
     ★刻意不复用 Kairos 的圆形语言：请求治理的隐喻是"关口",不是"轨道"。
       六边形 = 堡垒/关卡的几何；纵向轴 = 请求的行进方向；底部三条支路 = 三态分岔。

     【★徽记本身在演示产品】一个脉冲光点沿纵轴下行，穿过三个闸口节点，在分岔处
       依次落向三条支路之一（ok / bad / warn 三色端点错峰呼吸）。
       ⇒ 这是本层的核心动作被画进了徽记里，而不是一个静态 logo。
       ★与 Animation 页"由引擎真包驱动徽记"的差别要如实说：本徽记是 **CSS/SVG 动画**，
         不是用 `@proteus-vue/animation` 编译的（那需要额外的声明与 runner）。
         它证明的是"视觉表达"，不是"引擎能力"。不夸大成后者。

     【★无障碍】`prefers-reduced-motion` 下所有动画停止并直接给终态（徽记仍然完整可辨）。
     【★CSE lint】模板里不得用模板字符串拼类名（E-CSS-004）—— 本组件无动态类名。 -->
<script setup lang="ts">
withDefaults(defineProps<{
  /** 渲染尺寸（px，正方形视口内的实际高度按比例） */
  size?: number
  /** 是否播放动画（缺省 true；reduced-motion 由 CSS 兜住） */
  animated?: boolean
}>(), { size: 168, animated: true })
</script>

<template>
  <svg
    class="sigil"
    :class="{ 'sigil--static': !animated }"
    :width="size"
    :height="size * 1.1"
    :viewBox="`0 0 200 220`"
    fill="none"
    aria-hidden="true"
  >
    <defs>
      <!-- 外框描边：从品牌紫到暗紫（营造"金属关口"的厚度） -->
      <linearGradient id="pxSigilShell" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#ab9bff" stop-opacity="0.95" />
        <stop offset="55%" stop-color="#7c5cff" stop-opacity="0.55" />
        <stop offset="100%" stop-color="#4a35a8" stop-opacity="0.35" />
      </linearGradient>
      <!-- 纵向轴：上亮下暗（请求进入时最亮，越往下越接近"决定"） -->
      <linearGradient id="pxSigilAxis" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#ab9bff" stop-opacity="0.9" />
        <stop offset="72%" stop-color="#7c5cff" stop-opacity="0.4" />
        <stop offset="100%" stop-color="#7c5cff" stop-opacity="0.12" />
      </linearGradient>
      <!-- 中心光晕（品牌紫，低透明度，只做"发光底"，不是实心块） -->
      <radialGradient id="pxSigilAura" cx="50%" cy="46%" r="52%">
        <stop offset="0%" stop-color="#7c5cff" stop-opacity="0.24" />
        <stop offset="55%" stop-color="#7c5cff" stop-opacity="0.07" />
        <stop offset="100%" stop-color="#7c5cff" stop-opacity="0" />
      </radialGradient>
      <!-- 三态端点：各一条渐变（从暗到亮，让端点像"点亮"而非平面圆点） -->
      <radialGradient id="pxSigilOk" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#3ddc97" stop-opacity="0.95" />
        <stop offset="100%" stop-color="#3ddc97" stop-opacity="0.15" />
      </radialGradient>
      <radialGradient id="pxSigilBad" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#ff6b6b" stop-opacity="0.95" />
        <stop offset="100%" stop-color="#ff6b6b" stop-opacity="0.15" />
      </radialGradient>
      <radialGradient id="pxSigilWarn" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#ffb454" stop-opacity="0.95" />
        <stop offset="100%" stop-color="#ffb454" stop-opacity="0.15" />
      </radialGradient>
      <!-- 脉冲光点的辉光 -->
      <radialGradient id="pxSigilSpark" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#ffffff" stop-opacity="1" />
        <stop offset="35%" stop-color="#ab9bff" stop-opacity="0.9" />
        <stop offset="100%" stop-color="#7c5cff" stop-opacity="0" />
      </radialGradient>
    </defs>

    <!-- ① 底部光晕（品牌底色，先铺后画） -->
    <ellipse cx="100" cy="104" rx="92" ry="96" fill="url(#pxSigilAura)" />

    <!-- ② 六边形守卫框（外 + 内，双线营造厚度） -->
    <path
      class="sigil-shell"
      d="M100 8 L172 50 L172 134 L100 176 L28 134 L28 50 Z"
      stroke="url(#pxSigilShell)"
      stroke-width="1.6"
      stroke-linejoin="round"
    />
    <path
      class="sigil-shell-inner"
      d="M100 22 L160 57 L160 127 L100 162 L40 127 L40 57 Z"
      stroke="#7c5cff"
      stroke-opacity="0.18"
      stroke-width="0.8"
      stroke-linejoin="round"
      stroke-dasharray="3 5"
    />

    <!-- ③ 纵向主轴（请求行进的路） -->
    <path class="sigil-axis" d="M100 34 L100 128" stroke="url(#pxSigilAxis)" stroke-width="1.4" />

    <!-- ④ 三个闸口节点（每道闸 = 一个环；环心留空，让轴穿过去） -->
    <g class="sigil-gates">
      <circle cx="100" cy="52" r="7" class="sigil-gate" />
      <circle cx="100" cy="76" r="7" class="sigil-gate" />
      <circle cx="100" cy="100" r="7" class="sigil-gate" />
    </g>

    <!-- ⑤ 分岔：轴在 y=128 处裂成三条（这是"三态"在徽记里的表达） -->
    <g class="sigil-fork">
      <path d="M100 128 C100 142, 56 140, 56 156" class="sigil-lane sigil-lane--ok" />
      <path d="M100 128 L100 156" class="sigil-lane sigil-lane--bad" />
      <path d="M100 128 C100 142, 144 140, 144 156" class="sigil-lane sigil-lane--warn" />
    </g>

    <!-- ⑥ 三态端点（错峰呼吸 —— 依次"点亮"表示三条路子都可能走到） -->
    <g class="sigil-tips">
      <circle cx="56" cy="162" r="5.5" fill="url(#pxSigilOk)" class="sigil-tip sigil-tip--ok" />
      <circle cx="100" cy="162" r="5.5" fill="url(#pxSigilBad)" class="sigil-tip sigil-tip--bad" />
      <circle cx="144" cy="162" r="5.5" fill="url(#pxSigilWarn)" class="sigil-tip sigil-tip--warn" />
    </g>

    <!-- ⑦ 核心：闸口的"眼睛"（呼吸 —— 徽记的心跳） -->
    <circle cx="100" cy="76" r="3" class="sigil-core" fill="#ab9bff" />

    <!-- ⑧ 脉冲光点：沿轴下行 → 到分岔 → 消失（循环 = 一个请求走完全程） -->
    <g class="sigil-travel">
      <circle cx="100" cy="34" r="9" fill="url(#pxSigilSpark)" />
    </g>
  </svg>
</template>

<style scoped>
.sigil { display: block; overflow: visible; }

/* ── 外框：极缓慢的描边呼吸（不抢内容注意力） ── */
.sigil-shell { animation: pxShellBreath 5.6s ease-in-out infinite; }

/* ── 闸口节点：三环错峰亮起（表示"一道一道检"） ── */
.sigil-gate {
  fill: rgba(11, 11, 15, 0.9);
  stroke: #7c5cff;
  stroke-width: 1.2;
  stroke-opacity: 0.55;
  animation: pxGatePulse 5.6s ease-in-out infinite;
}
.sigil-gate:nth-of-type(1) { animation-delay: 0s; }
.sigil-gate:nth-of-type(2) { animation-delay: 0.42s; }
.sigil-gate:nth-of-type(3) { animation-delay: 0.84s; }

/* ── 三条支路 ── */
.sigil-lane { fill: none; stroke-width: 1.2; stroke-linecap: round; }
.sigil-lane--ok { stroke: rgba(61, 220, 151, 0.5); }
.sigil-lane--bad { stroke: rgba(255, 107, 107, 0.45); }
.sigil-lane--warn { stroke: rgba(255, 180, 84, 0.45); }

/* ── 三态端点错峰呼吸 ── */
.sigil-tip { animation: pxTipBreath 5.6s ease-in-out infinite; transform-origin: center; }
.sigil-tip--ok { animation-delay: 0s; }
.sigil-tip--bad { animation-delay: 0.55s; }
.sigil-tip--warn { animation-delay: 1.1s; }

/* ── 核心心跳 ── */
.sigil-core { animation: pxCoreBeat 2.8s ease-in-out infinite; transform-origin: 100px 76px; }

/* ── 脉冲光点：沿纵轴从入口走到分岔（一次 5.6s，与上面的节奏统一） ── */
.sigil-travel { animation: pxTravel 5.6s cubic-bezier(0.45, 0, 0.55, 1) infinite; }

@keyframes pxShellBreath {
  0%, 100% { stroke-opacity: 1; }
  50% { stroke-opacity: 0.72; }
}
@keyframes pxGatePulse {
  0%, 100% { stroke-opacity: 0.4; }
  18% { stroke-opacity: 1; stroke: #ab9bff; }
  40% { stroke-opacity: 0.4; stroke: #7c5cff; }
}
@keyframes pxTipBreath {
  0%, 100% { opacity: 0.55; transform: scale(1); }
  22% { opacity: 1; transform: scale(1.22); }
  48% { opacity: 0.55; transform: scale(1); }
}
@keyframes pxCoreBeat {
  0%, 100% { opacity: 0.6; transform: scale(1); }
  14% { opacity: 1; transform: scale(1.5); }
  40% { opacity: 0.6; transform: scale(1); }
}
/* 光点：从 y=34（入口）下移到 y=128（分岔点），中途渐显渐隐 */
@keyframes pxTravel {
  0% { transform: translateY(0); opacity: 0; }
  10% { opacity: 0.95; }
  72% { opacity: 0.95; }
  88% { opacity: 0; transform: translateY(94px); }
  100% { opacity: 0; transform: translateY(0); }
}

/* ★无障碍：reduced-motion 下全部停住，徽记仍完整可辨（不隐藏任何部件） */
@media (prefers-reduced-motion: reduce) {
  .sigil-shell,
  .sigil-gate,
  .sigil-tip,
  .sigil-core,
  .sigil-travel { animation: none; }
  .sigil-travel { opacity: 0; }
}
/* 静音模式（父级显式关掉动画时同样给终态） */
.sigil--static .sigil-shell,
.sigil--static .sigil-gate,
.sigil--static .sigil-tip,
.sigil--static .sigil-core,
.sigil--static .sigil-travel { animation: none; }
.sigil--static .sigil-travel { opacity: 0; }
</style>
