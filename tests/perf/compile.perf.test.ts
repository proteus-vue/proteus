// tests/perf/compile.perf.test.ts
// v0.4 性能基准：编译引擎（compileVueSfc）
// 门禁：宽松时间阈值（正常 ~5ms/次，阈值 500ms 只在极端退化时触发）；报告平均耗时
import { describe, it, expect } from 'vitest'
import { compileVueSfc } from '@proteus-vue/compiler'

// 典型业务页（含 template 指令 / script ref+computed+watch / scoped style）
const TYPICAL_PAGE = `<script setup lang="ts">
import { ref, computed, watch } from 'vue'

const count = ref(0)
const items = ref([{ title: 'a' }, { title: 'b' }])
const double = computed(() => count.value * 2)
const log = ref('')
watch(count, (n, o) => {
  log.value = \`\${o} → \${n}\`
})
function add() {
  count.value++
}
function setN() {
  count.value = 5
}
</script>

<template>
  <div class="home">
    <h1>{{ count }}</h1>
    <p v-for="(item, idx) in items" :key="idx">{{ item.title }}</p>
    <button @click="add">+</button>
    <input v-model="name" placeholder="name" />
    <p :class="[base, { active: count > 3 }]" v-show="count > 0">x</p>
  </div>
</template>

<style scoped>
.home { padding: 24px; }
.home .title { color: red; }
</style>
`

describe('性能基准：编译引擎（v0.4）', () => {
  it('典型页面编译平均耗时（记录基准，宽松阈值防 flaky）', () => {
    // 预热（JIT / 模块初始化）
    compileVueSfc(TYPICAL_PAGE, { filename: 'pages/typical.vue' })
    const N = 20
    const t0 = performance.now()
    for (let i = 0; i < N; i++) {
      compileVueSfc(TYPICAL_PAGE, { filename: 'pages/typical.vue' })
    }
    const avg = (performance.now() - t0) / N
    console.log(`[perf] compileVueSfc 典型页平均 ${avg.toFixed(2)}ms/次（${N} 次）`)
    expect(avg).toBeLessThan(500)
  })
})
