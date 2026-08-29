// examples/stores/counter.ts —— Web 端 Pinia store（v0.4）
// 原生 Pinia（examples/main.ts 已 createPinia）；MP 端 Pinia 依赖跨模块编译（MVP 限制），
// MP 过渡方案见 src/runtime/store（框架级 store 桥）
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useCounterStore = defineStore('counter', () => {
  const count = ref(0)
  const double = computed(() => count.value * 2)

  function inc() {
    count.value++
  }

  function reset() {
    count.value = 0
  }

  return { count, double, inc, reset }
})
