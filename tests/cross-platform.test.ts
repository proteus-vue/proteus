// @vitest-environment jsdom
// tests/cross-platform.test.ts
// 跨端矩阵测试（docs/proteus-pinia-plan M6 §4）—— 同一组用例 × web/mp/ssr 工厂
// ★验收硬证明：store 行为跨端一致
import { describe, it, expect } from 'vitest'
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createWebPinia, createMpPinia, createSsrPinia } from '../packages/runtime/src/pinia'
import { usePlayerStore } from '../examples/stores/player'

type CreatePinia = () => ReturnType<typeof createPinia>

const matrix: Array<{ name: string; create: CreatePinia }> = [
  { name: 'web', create: createWebPinia },
  { name: 'mp', create: createMpPinia },
  { name: 'ssr', create: createSsrPinia },
  // app 端待 v0.6（NativeKV 接入后加入矩阵）
]

/** 模拟 install（pinia.use 需 app.use(pinia)） */
function install(pinia: ReturnType<typeof createPinia>): void {
  createApp({}).use(pinia)
}

describe('跨端一致性（同一组用例 × 三端工厂）', () => {
  for (const { name, create } of matrix) {
    it(`${name}: player store 基本操作行为一致`, () => {
      const pinia = create()
      install(pinia)
      const s = usePlayerStore(pinia)
      s.play({ title: 'Song', durationSec: 100 })
      expect(s.current).toEqual({ title: 'Song', durationSec: 100 })
      expect(s.playing).toBe(true)
      expect(s.historyCount).toBe(1)
      s.toggle()
      expect(s.playing).toBe(false)
      s.setVolume(0.5)
      expect(s.volumePercent).toBe(50)
    })
  }
})
