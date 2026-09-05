<script setup lang="ts">
// mdev 场景 ③：应用壳（真实 DOM——导航条 + 内容区，窄屏也成立）
</script>

<template>
  <p-view class="sc-shell">
    <p-view class="bar">
      <p-text class="bar-title">◆ Proteus</p-text>
      <p-text class="bar-ghost" />
    </p-view>
    <p-stack class="body" :gap="8">
      <p-heading :level="1">Hello, every target</p-heading>
      <p-text class="para">
        Web renders DOM; Mini Programs compile to WXML; native hosts draw UIKit / Jetpack / ArkUI / Widget trees from the same IR.
      </p-text>
      <p-stack direction="row" :gap="8" wrap>
        <p-button>Start</p-button>
        <p-button>Docs</p-button>
      </p-stack>
    </p-stack>
  </p-view>
</template>

<style scoped>
.sc-shell { display: flex; flex-direction: column; min-height: 100%; }
.bar {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid #dde1f0;
}
.bar-title { font-weight: 700; font-size: 13px; }
.body { padding: 12px 14px; }
.para { font-size: 11.5px; color: #556; line-height: 1.6; }
</style>
