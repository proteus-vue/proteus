<!-- showcase/subpackages/components/pages/platform-variant.vue —— 平台变体解析演示（默认/基准版）
     ★第 2 层（组件/页面）：本文件为**共享基准**，若存在 platform-variant.mp.vue 会被构建期优先选中。
     本基准可作 Web 版（无 platform-variant.web.vue 时）。 -->
<script setup lang="ts">
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import { PText, PView } from '@proteus-vue/components'
import { computed } from 'vue'

// ★第 1 层（业务代码）：import 写法不变——存在 platform-info.&lt;platform&gt;.ts 时构建期自动解析变体
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

    <demo-block index="02" title="第 2 层 · 页面变体" desc="本页为共享基准；platform-variant.mp.vue 存在时，MP 构建整页换成小程序版">
      <template #demo>
        <p-text class="kv">当前渲染：共享基准（默认）</p-text>
      </template>
    </demo-block>

    <demo-block index="03" title="第 3 层 · 静态资源" desc="引用 /assets/variant-chip.svg → 构建期解析 variant-chip.&lt;platform&gt;.svg，产物路径统一">
      <template #demo>
        <view class="row">
          <image class="chip" src="/assets/variant-chip.svg" mode="widthFix" />
        </view>
      </template>
    </demo-block>

    <demo-block index="04" title="第 5 层 · CSS 样式" desc="&lt;style src&gt; 引用 variant-demo.css → 构建期解析 variant-demo.&lt;platform&gt;.css；类名与语义不变">
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
.chip { width: 120px; height: 40px; display: block; }
</style>
