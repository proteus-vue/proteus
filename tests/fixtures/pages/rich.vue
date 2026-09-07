<!-- tests/fixtures/pages/rich.vue —— v-html golden fixture：→ rich-text -->
<route>
{
  "meta": {
    "title": "富文本"
  }
}
</route>
<script setup lang="ts">
import { ref } from 'vue'

const html = ref('<p>hi</p>')
</script>

<template>
  <div v-html="html"></div>
</template>
