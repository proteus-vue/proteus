<!-- examples/pages/pinia-demo.vue —— Pinia 状态管理演示页（pinia-plan M3：四端同一份 stores/player.ts）
     Web 端：createWebPinia() 工厂（平台标记 + LocalStorage 持久化）
     MP 端：⚠ 页面绑定桥（Pinia → setData）待 M6 迁移文档覆盖；store 逻辑层可用（Pinia 纯 JS） -->
<script setup lang="ts">
import { usePlayerStore } from '../stores/player'

const store = usePlayerStore()
</script>

<template>
  <div class="pinia-demo">
    <h2>Pinia 状态管理（player store）</h2>
    <p class="sub">同一份 stores/player.ts 四端一致：播放/暂停 + 音量 + 历史（volume/history 持久化）</p>
    <p class="now" data-testid="pinia-now">当前：{{ store.current ? store.current.title : '未播放' }}（{{ store.playing ? '播放中' : '已暂停' }}）</p>
    <p class="count" data-testid="pinia-volume">音量：{{ store.volumePercent }}%（历史 {{ store.historyCount }} 首）</p>
    <button class="btn" data-testid="pinia-play" @click="store.play({ title: 'Proteus Theme', durationSec: 120 })">▶ 播放</button>
    <button class="btn" data-testid="pinia-toggle" @click="store.toggle()">⏯ 暂停/继续</button>
    <button class="btn" data-testid="pinia-vol-down" @click="store.setVolume(store.volume - 0.1)">音量 -</button>
    <button class="btn" data-testid="pinia-vol-up" @click="store.setVolume(store.volume + 0.1)">音量 +</button>
  </div>
</template>

<style scoped>
.pinia-demo {
  padding: 24px;
  text-align: center;
}
.sub {
  color: #888;
  font-size: 13px;
}
.now {
  font-size: 16px;
  font-weight: 600;
  margin: 12px 0;
}
.count {
  margin: 8px 0;
}
.btn {
  margin: 0 6px;
}
</style>
