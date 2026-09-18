// examples/stores/player.ts —— 音乐播放器 store（pinia-plan M3 验收：同一份源码四端一致）
// ★铁律：本文件禁止任何平台判断（if window / if wx / getPlatform 分支）——平台差异收敛在
//   @proteus-vue/runtime 的 createXxxPinia 工厂（platforms/pinia.ts）与 shared/storage
// 持久化：persisted() 轻量方案——只存 volume/history（playing 是瞬时态，不持久化）
import { defineStore } from 'pinia'
import { persisted } from '@proteus-vue/runtime'

export interface Track {
  title: string
  durationSec: number
}

export const usePlayerStore = defineStore('player', {
  state: () => ({
    playing: false,
    current: null as Track | null,
    volume: 0.8,
    history: [] as string[], // 播放历史（标题列表）
  }),
  getters: {
    volumePercent: (s) => Math.round(s.volume * 100),
    historyCount: (s) => s.history.length,
  },
  actions: {
    play(track: Track) {
      this.current = track
      this.playing = true
      if (this.history.indexOf(track.title) === -1) this.history.push(track.title)
    },
    toggle() {
      if (this.current) this.playing = !this.playing
    },
    setVolume(v: number) {
      this.volume = Math.max(0, Math.min(1, v))
    },
  },
  // pinia-plan：持久化声明（volume/history 跨端恢复；playing/current 瞬时态不存）
  persistence: persisted({
    pick: ['volume', 'history'],
    key: 'player-state',
  }),
})
