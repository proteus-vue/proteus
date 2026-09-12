<!-- showcase/pages/components.vue —— 「组件」tab：分组目录（官方演示信息架构）
     按语义域分组列出全部组件（分组/排序/名称/描述来自官网内容 SSOT，见 data/catalog.ts）；
     已备详情页的组件可点击进入（详情页在 subpackages/components 分包，按需加载）。
     ★分组结构对齐官网（布局 / 内容与表单 / 页面外壳 / 工程 / 手势 / 能力入口）。 -->
<script setup lang="ts">
import { computed } from 'vue'
import PageShell from '../components/page-shell/index.vue'
import CatalogList from '../components/catalog-list/index.vue'
import { COMPONENT_GROUPS, CATALOG_STATS } from '../data/catalog'

// ★经 computed 进 data：导入的模块常量无法静态求值 → 直接 ref(常量) 会落为实例属性（模板读不到）。
//   computed 由编译器在 onLoad 求值并 setData（同 summary）——跨端可用的桥。
const groups = computed(() => COMPONENT_GROUPS)
const summary = computed(
  () => `${CATALOG_STATS.componentGroups} 个语义域 · 共 ${CATALOG_STATS.componentTotal} 个组件 · 已备详情页 ${CATALOG_STATS.componentReady} 个`,
)
</script>

<template>
  <page-shell title="组件库" subtitle="79 个语义组件 · 一套源码双端同渲染">
    <catalog-list :groups="groups" :summary="summary" />
  </page-shell>
</template>
