// showcase/stores/counter.ts —— 演示用 Pinia store
import { defineStore } from 'pinia'

export const useCounterStore = defineStore('counter', {
  state: () => ({ count: 0, history: [] as number[] }),
  getters: {
    double: (s) => s.count * 2,
    steps: (s) => s.history.length,
    // ★提供文本 getter 而非在模板里 `history.join(...)`——WXML 表达式不支持函数调用（S38）
    historyText: (s) => (s.history.length ? s.history.join(', ') : '（空）'),
  },
  actions: {
    inc() { this.count++; this.history.push(this.count) },
    dec() { this.count--; this.history.push(this.count) },
    reset() { this.count = 0; this.history = [] },
  },
})
