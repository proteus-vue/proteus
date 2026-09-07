<!-- examples/pages/dev-host-demo.vue —— ★G-45 B2 调试基座即宿主演示（Install-Once Host：推送/装载即验证/pending 回放/热升级/双层构建缓存） -->
<route>
{
  "webOnly": true
}
</route>
<template>
  <view class="page">
    <view class="hero">
      <text class="hero-title">调试基座即宿主</text>
      <text class="hero-sub">基座是常驻宿主，不是构建产物——装一次，换插件，永不重打（渲染与能力走可插拔后端，不是 WebView 套壳）</text>
    </view>

    <!-- 业务调用模拟 -->
    <view class="card">
      <text class="card-title">① 业务侧（编译器生成的转发桩）</text>
      <view class="btn-row">
        <view class="btn btn-primary" @click="callScan">调用 scanQR()</view>
      </view>
      <text class="meta-line">最近结果：{{ lastResult }}</text>
      <text class="meta-line">pending 队列：{{ metrics.pendingNow }}（峰值 {{ metrics.pendingPeak }}）</text>
    </view>

    <!-- 插件推送 -->
    <view class="card">
      <text class="card-title">② 原生插件推送（dev server push → 装载即验证）</text>
      <view class="btn-row">
        <view class="btn btn-primary" @click="pushGood('1.0.0', 'CODE-123')">push scanner@1.0.0</view>
        <view class="btn btn-primary" @click="pushGood('2.0.0', 'CODE-V2')">push scanner@2.0.0（热升级）</view>
      </view>
      <view class="btn-row">
        <view class="btn btn-danger" @click="pushBadSign">push 坏签名（应拒绝）</view>
        <view class="btn btn-danger" @click="pushBadShape">push 坏 shape（应拒绝+降级）</view>
      </view>
      <text class="meta-line" v-if="lastReport">
        装载报告：{{ lastReport.id }}@{{ lastReport.version }} →
        {{ lastReport.ok ? '✅ 注册成功' : '❌ ' + lastReport.reason }}
        <template v-if="lastReport.ok">（回放 {{ lastReport.replayed }} 笔 pending）</template>
      </text>
    </view>

    <!-- 双层构建缓存 -->
    <view class="card">
      <text class="card-title">③ 双层构建缓存（基座 cacheKey 与业务规模无关）</text>
      <view class="btn-row">
        <view class="btn" @click="addPages">业务再写 30 页</view>
      </view>
      <text class="meta-line">当前页面数：{{ pages }} · base 构建 {{ buildCounts.base }} 次（首建后恒 skip）· js 增量 {{ buildCounts.js }} 次 · 插件重建 {{ buildCounts.plugin }} 次</text>
    </view>

    <!-- 指标面板 -->
    <view class="card">
      <text class="card-title">④ DevHost 指标（G-45.5 全链可观测）</text>
      <view class="metric-grid">
        <view class="metric"><text class="metric-num">{{ metrics.loadedModules }}</text><text class="metric-label">装载</text></view>
        <view class="metric"><text class="metric-num">{{ metrics.upgrades }}</text><text class="metric-label">热升级</text></view>
        <view class="metric"><text class="metric-num">{{ metrics.rejectedModules }}</text><text class="metric-label">拒绝</text></view>
        <view class="metric"><text class="metric-num">{{ metrics.fallbacks }}</text><text class="metric-label">降级</text></view>
        <view class="metric"><text class="metric-num">{{ metrics.replayedTotal }}</text><text class="metric-label">回放</text></view>
        <view class="metric"><text class="metric-num">{{ metrics.baseRebuildCount }}</text><text class="metric-label">基座重打</text></view>
      </view>
    </view>

    <!-- 事件日志 -->
    <view class="card">
      <text class="card-title">⑤ 事件链（loaded / upgraded / rejected / fallback / replay）</text>
      <view class="log-line" v-for="(l, i) in logs" :key="i">
        <text class="log-time">{{ l.t }}</text>
        <text class="log-msg">{{ l.msg }}</text>
      </view>
      <text class="meta-line" v-if="logs.length === 0">（暂无事件——点上面的按钮开始）</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import {
  createDevHost,
  BuildCache,
  planBuild,
  checkResultShape,
  type LoadReport,
} from '@proteus-vue/dev-host'

// DevHost 实例非响应式，页面用 ref 镜像其状态
const host = createDevHost()
host.registerFallback('takePhoto', async () => ({ path: null, degraded: true, reason: 'backend-not-loaded' }))

const metrics = ref(host.getMetrics())
const lastResult = ref('—')
const lastReport = ref<LoadReport | null>(null)
const logs = ref<{ t: string; msg: string }[]>([])
const pages = ref(20)
const cache = new BuildCache()
const buildCounts = ref({ base: 0, js: 0, plugin: 0 })

function log(msg: string) {
  logs.value = [{ t: new Date().toLocaleTimeString(), msg }, ...logs.value].slice(0, 10)
}

host.on('module:loaded', (p) => log(`✅ 装载 ${String(p.id)}@${String(p.version)}（能力：${String(p.capabilities)}）`))
host.on('module:upgraded', (p) => log(`⬆️ 热升级 ${String(p.id)}：${String(p.from)} → ${String(p.to)}（JS 零重启）`))
host.on('module:rejected', (p) => log(`❌ 拒绝 ${String(p.id)}：${String(p.reason)}（门禁链生效）`))
host.on('fallback', (p) => log(`🛟 降级 ${String(p.capability)}（降级不崩溃）`))
host.on('stub:replay', (p) => log(`↩️ 回放 ${String(p.capability)}.${String(p.method)}（等待 ${String(p.waitedMs)}ms）`))

function refresh() {
  metrics.value = host.getMetrics()
}

function callScan() {
  const stub = host.createStub('scanQR', 'scanQR')
  stub.call({ format: 'qr' }).then((r) => {
    lastResult.value = JSON.stringify(r)
    refresh()
  })
  refresh()
}

async function pushGood(version: string, text: string) {
  const report = await host.loadModule({
    manifest: { id: 'scanner', version, capabilities: ['scanQR'], signature: 'sig-demo' },
    conformance: [checkResultShape('scanQR', 'scanQR', [{ format: 'qr' }], { text: 'string' })],
    factory: () => ({ scanQR: async () => ({ text }) }),
  })
  lastReport.value = report
  refresh()
}

async function pushBadSign() {
  const report = await host.loadModule({
    manifest: { id: 'evil', version: '1.0.0', capabilities: ['scanQR'], signature: 'hacked' },
    conformance: [checkResultShape('scanQR', 'scanQR', [{ format: 'qr' }], { text: 'string' })],
    factory: () => ({ scanQR: async () => ({ text: 'x' }) }),
  })
  lastReport.value = report
  refresh()
}

async function pushBadShape() {
  const report = await host.loadModule({
    manifest: { id: 'badcam', version: '1.0.0', capabilities: ['takePhoto'], signature: 'sig-demo' },
    conformance: [checkResultShape('takePhoto', 'takePhoto', [], { path: 'string' })],
    factory: () => ({ takePhoto: async () => ({ code: 7 }) }),
  })
  lastReport.value = report
  refresh()
}

function addPages() {
  pages.value += 30
  const plan = planBuild(cache, {
    frameworkVersion: 'v1.0',
    abi: 'arm64',
    jsHash: `src-pages-${pages.value}`,
    pluginVersions: { scanner: '2.0.0' },
  })
  buildCounts.value = { ...cache.buildCounts }
  log(`🏗 构建计划：pages=${pages.value} → base ${plan.base.action} / js ${plan.js.action} / 插件 ${plan.plugins[0]?.action ?? '-'}`)
  refresh()
}
</script>

<style>
.page { padding: 20px 16px 48px; }
.hero { padding: 20px 0 16px; display: flex; flex-direction: column; }
.hero-title { font-size: 24px; font-weight: 700; }
.hero-sub { font-size: 13px; opacity: 0.65; margin-top: 6px; line-height: 1.6; }
.card { border: 1px solid rgba(128,128,128,0.25); border-radius: 12px; padding: 14px; margin-bottom: 14px; }
.card-title { font-size: 15px; font-weight: 600; margin-bottom: 10px; display: block; }
.btn-row { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
.btn { font-size: 13px; padding: 8px 12px; border-radius: 8px; border: 1px solid rgba(128,128,128,0.35); }
.btn-primary { background: rgba(59,130,246,0.12); border-color: rgba(59,130,246,0.45); }
.btn-danger { background: rgba(239,68,68,0.1); border-color: rgba(239,68,68,0.4); }
.meta-line { font-size: 12px; opacity: 0.75; display: block; margin-top: 4px; }
.metric-grid { display: flex; flex-wrap: wrap; gap: 10px; }
.metric { min-width: 72px; padding: 8px 10px; border-radius: 10px; background: rgba(128,128,128,0.08); display: flex; flex-direction: column; align-items: center; }
.metric-num { font-size: 20px; font-weight: 700; }
.metric-label { font-size: 11px; opacity: 0.65; margin-top: 2px; }
.log-line { display: flex; gap: 8px; padding: 4px 0; border-bottom: 1px dashed rgba(128,128,128,0.15); }
.log-time { font-size: 11px; opacity: 0.5; flex-shrink: 0; }
.log-msg { font-size: 12px; }
</style>
