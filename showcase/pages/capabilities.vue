<!-- showcase/pages/capabilities.vue —— 「能力」tab：分组目录（官方演示信息架构）
     按语义域分组列出全部能力 Hook（分组/排序/名称/描述来自官网内容 SSOT，见 data/catalog.ts）；
     已备详情页的能力可点击进入（详情页在 subpackages/capabilities 分包，按需加载）。
     ★分组结构对齐官网（网络与通信 / 设备与系统 / 媒体与扫码 / …）。 -->
<script setup lang="ts">
import { computed } from 'vue'
import PageShell from '../components/page-shell/index.vue'
import CatalogList from '../components/catalog-list/index.vue'
import { CAPABILITY_GROUPS, CATALOG_STATS } from '../data/catalog'

// ★经 computed 进 data（同 components.vue）：导入常量直接 ref 会落为实例属性，模板读不到。
const groups = computed(() => CAPABILITY_GROUPS)
const summary = computed(
  () => `${CATALOG_STATS.capabilityGroups} 个能力域 · 共 ${CATALOG_STATS.capabilityTotal} 个 Hook · 已备详情页 ${CATALOG_STATS.capabilityReady} 个`,
)
</script>

<template>
  <page-shell title="原生能力" subtitle="81 个能力 Hook · 业务零平台分支">
    <catalog-list :groups="groups" :summary="summary" />
  </page-shell>
</template>
