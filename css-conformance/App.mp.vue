<!--
  css-conformance/App.mp.vue —— 小程序端 App 壳（Global 层声明处）

  【为什么留空】Global 层内容不参与 CSS 验收（本工程只验页面渲染）——
  声明一个空壳保持与 Web 端**同形**（`<app-root>` 一处声明，两端落地机制不同）。
-->
<script setup lang="ts">
// 本验收项目无全局层逻辑
</script>

<template>
  <app-root>
    <global-layer />
  </app-root>
</template>
