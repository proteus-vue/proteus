// @vitest-environment jsdom
// tests/stores-player.test.ts
// player store 纯逻辑测试（docs/proteus-pinia-plan M6 §2.3）—— 直接用原生 createPinia，不依赖平台
// ★证明：store 源码无平台代码，适配层完全收敛在 @proteus/runtime 工厂之外
import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePlayerStore } from '../examples/stores/player'

beforeEach(() => {
  setActivePinia(createPinia()) // ← 原生 createPinia（模拟无适配层的独立测试）
})

describe('player store 纯逻辑', () => {
  it('play() 设置当前曲目 + 播放 + 记录历史', () => {
    const s = usePlayerStore()
    expect(s.playing).toBe(false)
    s.play({ title: 'Song A', durationSec: 120 })
    expect(s.current).toEqual({ title: 'Song A', durationSec: 120 })
    expect(s.playing).toBe(true)
    expect(s.historyCount).toBe(1)
  })

  it('重复播放同曲目不重复记录历史', () => {
    const s = usePlayerStore()
    s.play({ title: 'A', durationSec: 1 })
    s.play({ title: 'A', durationSec: 1 })
    expect(s.historyCount).toBe(1)
  })

  it('toggle() 无当前曲目不改变状态', () => {
    const s = usePlayerStore()
    s.toggle()
    expect(s.playing).toBe(false)
  })

  it('setVolume 夹取到 [0, 1]', () => {
    const s = usePlayerStore()
    s.setVolume(1.5)
    expect(s.volume).toBe(1)
    s.setVolume(-1)
    expect(s.volume).toBe(0)
    s.setVolume(0.5)
    expect(s.volumePercent).toBe(50)
  })
})
