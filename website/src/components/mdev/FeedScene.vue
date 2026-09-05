<script setup lang="ts">
// mdev 场景 ②：能力信息流（真实 DOM——flex/grid 柔性容器在小屏自然换行）
const items = ['Semantic core', 'Pluggable backends', 'Transparent compile', 'Zero native glue']
</script>

<template>
  <p-view class="sc-feed">
    <p-heading :level="2">Capabilities</p-heading>
    <p-grid :min-col-width="150" :gap="8">
      <p-view v-for="(it, i) in items" :key="i" class="tile">
        <p-text class="idx">{{ i + 1 }}</p-text>
        <p-text class="txt">{{ it }}</p-text>
      </p-view>
    </p-grid>
  </p-view>
</template>

<style scoped>
.sc-feed { padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.idx { font-size: 11px; color: var(--brand); font-weight: 700; }
.txt { font-size: 12.5px; line-height: 1.35; }
.tile { padding: 8px 10px; border: 1px solid #dde1f0; border-radius: 10px; }
</style>
