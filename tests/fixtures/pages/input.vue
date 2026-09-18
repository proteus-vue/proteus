<!-- tests/fixtures/pages/input.vue —— v-model golden fixture：input/textarea -->
<route>
{
  "meta": {
    "title": "输入"
  }
}
</route>
<script setup lang="ts">
import { ref } from 'vue'

const text = ref('')
</script>

<template>
  <div>
    <input v-model="text" placeholder="type" />
    <textarea v-model="text"></textarea>
  </div>
</template>
