<!-- examples/pages/mine.vue —— 我的（第二个 Tab 页：微信 tabBar.list 至少 2 项） -->
<route>
{
  "meta": {
    "title": "我的",
    "isTab": true
  }
}
</route>
<script setup lang="ts">
import { ref } from 'vue'

const nickname = ref('Proteus 用户')
</script>

<template>
  <div class="mine">
    <h2>{{ nickname }}</h2>
    <p>Tab 页（2/2）</p>
  </div>
</template>

<style scoped>
.mine {
  text-align: center;
  padding: 48px 0;
}
</style>
