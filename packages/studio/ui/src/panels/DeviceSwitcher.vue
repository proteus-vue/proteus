<script setup lang="ts">
// DeviceSwitcher.vue —— 设备管理：列表 + 切换（决策 #1265）
//
// 【为什么加在画布边上】"现在投的是哪台"是看画面时最先要确认的事，藏在设置里等于没有。
// 【为什么点一下会黑一下】切设备 = 换串号 + **重启采集会话**（`screenrecord` 的 `-s`/`--size`
//   都只在会话开始时生效）。这是诚实的代价：几百毫秒黑屏，换来"真的切过去了"。
import { computed, onMounted, ref } from 'vue'
import PanelShell from './PanelShell.vue'
import { listDevices, selectDevice, hasBridge, type DeviceInfo } from '../bridge'
import { pushToast } from '../toast'

const devices = ref<DeviceInfo[]>([])
const busy = ref<string | null>(null)

/** 按平台分组（决策 #1274）：Android 与 iOS 的"接法"完全不同，混在一个列表里会误导 */
const PLATFORMS: { id: string; label: string }[] = [
  { id: 'android', label: 'Android' },
  { id: 'ios', label: 'iOS' },
]
const groups = computed(() =>
  PLATFORMS
    // ★字段名要对齐模板：模板用 `g.platform`，这里必须**产出 platform**（`{...p}` 只会带 id/label）
    .map((p) => ({ platform: p.id, label: p.label, items: devices.value.filter((d) => d.platform === p.id) }))
    .filter((g) => g.items.length),
)

async function refresh() {
  if (!hasBridge()) return
  try {
    devices.value = await listDevices()
  } catch (e) {
    pushToast(String((e as Error)?.message ?? e), 'err')
  }
}

async function pick(d: DeviceInfo) {
  if (d.current || busy.value || d.state !== 'device') return
  busy.value = d.serial
  try {
    const info = await selectDevice(d.serial)
    await refresh()
    /* iOS 此刻还没有尺寸（要等第一帧的 SPS）⇒ 提示"等推流"，不要显示 0×0 */
    pushToast(
      info.width > 0
        ? `已切到 ${d.model} · ${info.width}×${info.height} · ${info.mbps} Mbps`
        : `已切到 ${d.model}：等手机端开始直播（ProteusHost）`,
      'info',
    )
  } catch (e) {
    // ★失败**不改**当前项：乐观更新会让界面说谎（和画质档位同一条纪律）
    pushToast(String((e as Error)?.message ?? e), 'err')
  } finally {
    busy.value = null
  }
}

/** 串号太长：保留头尾，中间省略（同 IDE 的路径省略语汇） */
function shortSerial(s: string) {
  return s.length > 16 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s
}

onMounted(refresh)
</script>

<template>
  <PanelShell title="设备">
    <div class="devlist" id="devList">
      <template v-for="g in groups" :key="g.platform">
        <div class="devgroup" :data-group="g.platform">{{ g.label }}</div>
        <button
          v-for="d in g.items"
          :key="d.serial"
        class="devrow"
        :class="{ on: d.current, dead: d.state !== 'device' }"
          :data-dev="d.serial"
          :data-platform="d.platform"
          :title="`${d.model} · ${d.serial} · ${d.state}${d.size ? ' · ' + d.size : ''}${d.note ? '\n' + d.note : ''}`"
          :aria-pressed="d.current"
          @click="pick(d)"
        >
          <span class="dot" :class="{ off: d.state !== 'device' }" />
          <span class="dmodel">{{ d.model }}</span>
          <span class="dmeta">{{ d.size ?? d.state }} · {{ shortSerial(d.serial) }}</span>
        </button>
      </template>
      <div v-if="!devices.length" class="dnone">没有检测到设备（插上 USB 并允许「USB 调试」）</div>
      <!-- iOS 一台都没列到 ⇒ 大概率是 xcrun 找不到 Xcode（它是**静默失败**的），把线索说出来 -->
      <div v-else-if="!groups.some((g) => g.platform === 'ios')" class="dnone">
        iOS：没列出设备 —— 检查「设置 → 开发环境 → iOS」的 Xcode 路径，以及手机是否已信任此电脑
      </div>
      <button class="drefresh" id="devRefresh" @click="refresh">刷新设备列表</button>
    </div>
    <template #note>
      <span>切换设备会重启采集会话（画面黑一下）。机型/尺寸按串号缓存，不会串台。</span>
    </template>
  </PanelShell>
</template>

<!-- 样式在全局 styles.css（.devlist/.devrow）：与 .kv 同理，避免每个面板各写一套 -->
