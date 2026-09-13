<!-- showcase/subpackages/components/pages/platform-variant.mp.vue —— 平台变体演示（小程序版）
     ★第 2 层：MP 构建时本文件**取代** platform-variant.vue（基准）——整页内容可完全不同。
     Web 构建则不编译本文件（产物只含 Web 版）。这是「同一位置、不同平台不同内容」的最直接形态。 -->
<script setup lang="ts">
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import { PText } from '@proteus-vue/components'
import { computed } from 'vue'
import { PLATFORM_LABEL, PLATFORM_DETAIL } from '../../../shared/platform-info'

// ★MP 限制：导入的模块常量须经 computed 进 data（showcase README 已记录）
const info = computed(() => ({ label: PLATFORM_LABEL, detail: PLATFORM_DETAIL }))
</script>

<template>
  <page-shell title="平台变体解析" subtitle="同一位置，按平台放不同文件（业务代码 / 组件 / 资源 / 路由）">
    <demo-block index="01" title="第 1 层 · 业务代码" desc="import './platform-info' → 构建期解析 platform-info.&lt;platform&gt;.ts；业务侧零平台名">
      <template #demo>
        <view class="row">
          <p-text class="kv">标签：{{ info.label }}</p-text>
          <p-text class="kv">来源：{{ info.detail }}</p-text>
        </view>
      </template>
    </demo-block>

    <demo-block index="02" title="第 2 层 · 页面变体" desc="★本页是小程序版 platform-variant.mp.vue——整页取代共享基准，内容可完全不同">
      <template #demo>
        <view class="row">
          <p-text class="kv mp">当前渲染：小程序专属页（platform-variant.mp.vue）</p-text>
          <p-text class="kv">Web 构建时本文件不参与，改用共享基准</p-text>
        </view>
      </template>
    </demo-block>

    <demo-block index="03" title="第 3 层 · 静态资源" desc="引用 /assets/variant-chip.svg → 构建期解析 variant-chip.mp.svg（绿色版），产物路径统一">
      <template #demo>
        <view class="row">
          <image class="chip" src="/assets/variant-chip.svg" mode="widthFix" />
        </view>
      </template>
    </demo-block>

    <demo-block index="04" title="小程序专属能力" desc="仅小程序：open-type 客服会话（Web 端整块不存在，无需条件编译）">
      <template #demo>
        <p-button open-type="contact">客服会话</p-button>
      </template>
    </demo-block>

    <demo-block index="05" title="第 5 层 · CSS 样式" desc="&lt;style src&gt; 引用 variant-demo.css → 构建期解析 variant-demo.&lt;platform&gt;.css；类名与语义不变">
      <template #demo>
        <view class="row">
          <view class="variant-card">样式来自 variant-demo.&lt;platform&gt;.css</view>
        </view>
      </template>
    </demo-block>

  </page-shell>
</template>

<style src="../../../styles/variant-demo.css" scoped></style>
<style scoped>
.row { display: flex; flex-direction: column; gap: var(--sp-2); align-items: flex-start; }
.kv { display: block; font-size: 13px; color: var(--sp-text-2); }
.mp { color: #07c160; font-weight: 700; }
.chip { width: 120px; height: 40px; display: block; }
</style>
