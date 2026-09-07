# 功能域 1：全局音乐播放器

> **目标**：验证 Component(appBar) + Lifecycle + Pinia + API(Audio) + Platform 五层联动
> **说服力**：这是全应用最复杂的全局组件，直接验证"透明编译"是否真能跨层协作

---

## 3.1 功能规格

| 页面 | 路径 | 模块 | chunk |
|------|------|------|-------|
| 播放页 | `/player` | player | player |
| 歌词页 | `/player/lyric` | player | player |
| 歌单详情 | `/playlist/:id` | content | content |
| 专辑详情 | `/album/:id` | content | content |

**全局组件**（不归属任何页面）：
- `<player-bar>` — 底部播放控制条（appBar 实现，**常驻不销毁**）
- `<mini-player>` — 小窗模式（半屏拖拽）

## 3.2 跨层连线（核心验收）

```
┌─────────────────────────────────────────────────────────┐
│ 用户点击「播放」                                          │
└──────────────┬──────────────────────────────────────────┘
               ▼
   [Component] <player-bar @play="onPlay">
               │
               ▼
   [Pinia] playerStore.play(track)
               │  ├─ state.trackId
               │  ├─ state.isPlaying
               │  └─ state.position
               ▼
   [API] audio.play({ trackId, url })
               │  ├─ Platform capability: audio
               │  └─ Security: signedUrl (token 鉴权)
               ▼
   [Platform] wx.getBackgroundAudioManager / Web Audio API
               │
               ▼
   [Lifecycle] onShow → 恢复播放 / onHide → 暂停
               │
               ▼
   [DevTools] TraceBus: player.action → api.call → capability.invoke
```

**编译产物验证**：
```bash
# 编译后查看产物
dist/mp/app-bar/player-bar.{wxml,wxss,js,json}  # ← appBar 全局层
dist/mp/pages/player/player.wxml

# 关键：player-bar 必须不在任何 page 的 WXML 里，而在 app-bar 目录
grep -r "player-bar" dist/mp/pages/  # 应该无输出
grep "appBar" dist/mp/app.json        # 应该有 "appBar": {}
```

## 3.3 状态设计（Pinia M7 分片）

```ts
// stores/player.ts
export const usePlayerStore = defineStore('player', () => {
  const trackId = ref<string | null>(null)
  const isPlaying = ref(false)
  const position = ref(0)
  const playlist = ref<Track[]>([])

  function play(track: Track) {
    trackId.value = track.id
    isPlaying.value = true
    // ... 触发 API 调用
  }

  return { trackId, isPlaying, position, playlist, play }
}, {
  // ← M7.1 分片：播放状态 eager（首屏立即需要），播放列表 lazy
  persistence: {
    eager: ['trackId', 'isPlaying', 'position'],  // 启动时立即恢复
    lazy: ['playlist'],                            // 用到时再 hydrate
    encrypted: [],                                  // 无敏感字段
    volatile: ['position'],                        // 进度高频变化，不落盘（M7.6）
  },
})
```

**验收点**：
- [ ] 冷启动 100ms 内恢复 `trackId + isPlaying`（eager 生效）
- [ ] `playlist` 在首次打开播放页时才 hydrate（lazy 生效）
- [ ] `position` 不写 storage（volatile 生效，避免 seek 高频写）
- [ ] DevTools 快照：导出 → 杀进程 → 导入 → 进度恢复 ✅

## 3.4 全局播放条（Component appBar）

```ts
// app.ts
import PlayerBar from './global/PlayerBar.vue'

export default defineApp({
  appBar: PlayerBar,  // ← 写一次，所有页面自动拥有

  onShow() {
    // 从后台回来，恢复播放
    const player = usePlayerStore()
    if (player.isPlaying) audio.resume()
  },
  onHide() {
    audio.pause()  // 进后台暂停
  },
})
```

**验收点**：
- [ ] **切页音频不中断**（appBar 实例不重建）
- [ ] 从「首页」→「播放页」→「歌词页」→ 返回，播放条始终在同一实例
- [ ] Skyline DevTools：确认 `app-bar` 渲染层级在所有 page 之上
- [ ] Web 端：`<PlayerBar>` 在 `App.vue` 根节点，SPA 单例 ✅

## 3.5 后台音频（Platform capability）

```ts
// adapters/audio.ts
export const audioCapability: Capability<'audio'> = {
  id: 'audio',
  isSupported: () => true,

  adapters: {
    web: {
      play(track) {
        const ctx = new AudioContext()
        // ... Web Audio API
      },
    },
    skyline: {
      play(track) {
        const bgAudio = wx.getBackgroundAudioManager()
        bgAudio.src = track.url  // ← 后台持续播放
        bgAudio.play()
      },
    },
    app: {
      play(track) {
        // Native 音频模块
      },
    },
  },
}
```

**验收点**：
- [ ] Skyline：锁屏后音频继续播放（后台音频模式）
- [ ] Web：tab 切后台暂停（visibilitychange）
- [ ] App：真机后台播放，通知栏控制
- [ ] 三端 `isSupported()` 探测一致

## 3.6 可观测性验证（DevTools）

```bash
# 启动应用，播放一首歌，切页 3 次，暂停
# 打开 DevTools → Trace 面板

期望看到的时间轴：
─────────────────────────────────────────────────────
Lifecycle  │──onLaunch──│──coreReady──│──interactive──│
Pinia      │            │──playerStore created──│
           │            │                      │──position: 0→12
API        │            │                      │──audio.play(track:123)
Platform   │            │                      │──getBackgroundAudioManager
Component  │──player-bar mounted (appBar)──────│
─────────────────────────────────────────────────────
```

**验收点**：
- [ ] `--trace-transform` 输出 `appBar → app.json + app-bar/` 映射链
- [ ] `--trace-lifecycle` 显示五阶段耗时
- [ ] DevTools 时间轴六泳道齐全（Lifecycle/Router/Pinia/API/Platform/Compiler）
- [ ] 导出 `.proteus-trace.json` 可在另一台机器复现

## 3.7 LLM 执行批次（本功能域）

```
Batch-F1.1: Pinia store + persistence 配置
Batch-F1.2: audio capability + 三端 adapter
Batch-F1.3: PlayerBar 组件 + appBar 注册
Batch-F1.4: Lifecycle onShow/onHide 集成
Batch-F1.5: DevTools trace 验证
```

**依赖**：Pinia M1-M2 ✅ / Component B1 ✅ / Lifecycle B1-B2 ✅ / Platform B1 ✅

---
