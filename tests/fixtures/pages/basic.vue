<!-- tests/fixtures/pages/basic.vue —— 基础映射 golden fixture：div/span/img/a + v-if/v-for + @click + :src -->
<route>
{
  "meta": {
    "title": "基础页"
  }
}
</route>
<script setup lang="ts">
import { ref } from 'vue'

const title = ref('Proteus')
const items = ref(['a', 'b'])
const show = ref(true)
const avatar = '/avatar.png'

function handleTap() {
  console.log('tapped')
}
</script>

<template>
  <div class="page">
    <h1>{{ title }}</h1>
    <p v-if="show">visible</p>
    <div v-for="(item, idx) in items" :key="idx" class="row">{{ idx }}.{{ item }}</div>
    <a @click="handleTap">link</a>
    <img :src="avatar" alt="avatar" />
  </div>
</template>

<style scoped>
.page {
  padding: 20px;
}
.row {
  margin: 4px 0;
}
</style>
