<!-- pages/devtools-open-api-demo.vue —— ★开放 API 演示：第三方自己的 devtools 面板（零包依赖，只说话音 WS 协议）
     文档：docs/proteus-devtools-plan/15-open-api.md
     核心：第三方面板只需一个 WebSocket + 几行 JSON 即可接入应用全部 devtools 数据——
     本页即示范「不依赖 @proteus-vue/devtools 包」的原生协议客户端。
     等价包级 API（业务侧更省事）：createDevtoolsWsSource('ws://host/proteus-panel') + onEvent/appInfo()/deviceInfo()/sendCommand()
     ★MP 产物安全：本页遵循框架 script-setup 子集（无泛型/类型标注/interface）——小程序端无 window.WebSocket，优雅降级提示 -->
<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
// ★纯类型导入（编译器剥离；MP 安全）——ref 泛型在 MP 编译降级为非响应式（本页 MP 只展示降级提示，不依赖响应式）
import type { EventRec } from '../open-api-types'

const status = ref('connecting') // connecting / connected / closed
const events = ref<EventRec[]>([])
const counters = ref<Record<string, number>>({})
const appInfoText = ref('')
const deviceText = ref('')
const log = ref<string[]>([])
const methodInput = ref('Proteus.restoreStores')
const paramsInput = ref('{"stores":[]}')

// ★MP 安全：无类型标注（编译器只剥方法参数类型/方法体 as）——顶层 let 整段不进 data/methods（编译器丢弃）；
//   ws 显式标注满足 tsc strict（丢弃后 MP 产物无 :）；pending 用 ref 对象（MP 方法体内裸标识符无法解析）
let ws: WebSocket | null = null
let seq = 0
let recId = 0
const pending = ref<Record<number, string>>({})

/** 发送 CDP 风格命令（id 自增；label 用于响应回显） */
function send(method: string, params?: Record<string, unknown>, label?: string): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    log.value.push('⚠ WS 未连接')
    return
  }
  const id = ++seq
  if (label) pending.value[id] = label
  ws.send(JSON.stringify({ id, method, params }))
}

function queryAppInfo(): void {
  send('Proteus.appInfo', undefined, 'appInfo')
}
function queryDeviceInfo(): void {
  send('Proteus.deviceInfo', undefined, 'deviceInfo')
}
function runCommand(): void {
  let params
  try {
    params = paramsInput.value.trim() ? JSON.parse(paramsInput.value) : undefined
  } catch {
    log.value.push('⚠ params JSON 非法')
    return
  }
  send(methodInput.value.trim(), params, methodInput.value.trim())
}

/** 模板用（WXML 表达式不支持 Object.keys——方法调用才可） */
function hasAnyEvent(): boolean {
  return Object.keys(counters.value).length > 0
}

onMounted(() => {
  // ★仅 Web 端演示（小程序逻辑层无 window.WebSocket；业务侧远程查看请用官方面板 /proteus-devtools）
  if (typeof WebSocket !== 'function') {
    status.value = 'closed'
    log.value.push('当前环境无 WebSocket（本演示仅 Web 端；小程序端可用官方面板）')
    return
  }
  const proto = typeof location !== 'undefined' && location.protocol === 'https:' ? 'wss' : 'ws'
  const host = typeof location !== 'undefined' ? location.host : 'localhost:5173'
  ws = new WebSocket(proto + '://' + host + '/proteus-panel')
  ws.onopen = () => {
    status.value = 'connected'
    log.value.push('已连接 relay（/proteus-panel），发送 Proteus.enable（应用缓冲回放 + 实时事件流）')
    send('Proteus.enable', undefined, 'enable')
    queryAppInfo()
    queryDeviceInfo()
  }
  ws.onmessage = (ev) => {
    const msg = JSON.parse(String(ev.data))
    // 命令响应（enable/appInfo/deviceInfo/restoreStores…）按 id 匹配回显
    if (msg.id !== undefined && pending.value[msg.id] !== undefined) {
      const label = pending.value[msg.id]
      delete pending.value[msg.id]
      const text = msg.result === undefined ? '(无 result)' : JSON.stringify(msg.result).slice(0, 140)
      log.value.push(label + ' → ' + text)
      if (label === 'appInfo') appInfoText.value = JSON.stringify(msg.result, null, 2)
      if (label === 'deviceInfo') deviceText.value = JSON.stringify(msg.result, null, 2)
      return
    }
    // 事件流：Proteus.event → 自绘迷你时间线（不依赖官方面板，展示开放接入）
    if (msg.method === 'Proteus.event' && msg.params) {
      const p = msg.params
      recId += 1
      events.value.push({
        id: recId,
        source: String(p.source ?? '?'),
        phase: String(p.phase ?? 'point'),
        name: String(p.name ?? '?'),
        timestamp: Number(p.timestamp ?? Date.now()),
      })
      if (events.value.length > 60) events.value.shift()
      const countersObj = counters.value
      countersObj[p.source] = (countersObj[p.source] || 0) + 1
    }
  }
  ws.onclose = () => {
    status.value = 'closed'
  }
  ws.onerror = () => {
    status.value = 'closed'
  }
})
onUnmounted(() => {
  if (ws) ws.close()
  ws = null
})
</script>

<template>
  <div class="openapi">
    <h2>Open API 演示 · 第三方自己的 DevTools 面板</h2>
    <p class="sub">
      本页不依赖 <code>@proteus-vue/devtools</code> 包——原生 WebSocket 直连
      <code>/proteus-panel</code>，按 Proteus 开放协议（15-open-api.md）接入应用全部 devtools 数据。
      等价包级 API：<code>createDevtoolsWsSource(url)</code> + <code>onEvent / appInfo() / deviceInfo() / sendCommand()</code>。
    </p>

    <div class="status" :class="'status-' + status">
      连接状态：{{ status }}（relay /proteus-panel）
    </div>

    <div class="row">
      <button class="btn" @click="queryAppInfo">读取 appInfo（路由表）</button>
      <button class="btn" @click="queryDeviceInfo">读取 deviceInfo（环境/能力）</button>
    </div>

    <div class="cmd">
      <div class="row">
        <input v-model="methodInput" class="inp mono" placeholder="命令方法，如 Proteus.restoreStores" />
        <button class="btn" @click="runCommand">下发命令</button>
      </div>
      <input v-model="paramsInput" class="inp mono" placeholder='参数 JSON，如 {"stores":[{"id":"player","state":{"playing":false}}]}' />
      <p class="hint">命令经 relay 转发到应用侧执行（如 restoreStores 时间旅行恢复真实状态）——双向调试通道</p>
    </div>

    <div class="counters">
      <span v-for="(n, src) in counters" :key="src" class="counter" :class="'c-' + src">{{ src }} {{ n }}</span>
      <span v-if="!hasAnyEvent()" class="hint">暂无事件（页面路由/API 操作后出现）</span>
    </div>

    <div class="cols">
      <div class="col">
        <h3>事件流（自绘迷你时间线 · 最新 60 条）</h3>
        <div class="evlist">
          <div v-for="e in events" :key="e.id" class="ev">
            <span class="badge" :class="'b-' + e.source">{{ e.source }}</span>
            <span class="phase" :class="'ph-' + e.phase">{{ e.phase }}</span>
            <span class="name">{{ e.name }}</span>
            <span class="time">{{ e.timestamp }}ms</span>
          </div>
          <p v-if="events.length === 0" class="hint">暂无事件（页面路由/API 操作后出现）</p>
        </div>
      </div>
      <div class="col">
        <h3>协议日志</h3>
        <div class="log">
          <div v-for="(l, i) in log" :key="i" class="logline">{{ l }}</div>
        </div>
        <h3>查询结果</h3>
        <pre class="pre">{{ appInfoText || deviceText || '（点上方按钮查询）' }}</pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.openapi {
  max-width: 860px;
  margin: 0 auto;
  padding: 24px 16px;
  font-size: 13px;
}
.sub {
  color: #666;
  line-height: 1.7;
}
code {
  background: #f2f3f5;
  border-radius: 3px;
  padding: 0 4px;
  font-size: 12px;
}
.status {
  display: inline-block;
  margin: 10px 0;
  padding: 4px 10px;
  border-radius: 4px;
  font-weight: 600;
}
.status-connected {
  background: #e8f7ee;
  color: #07c160;
}
.status-connecting {
  background: #fff7e6;
  color: #d48806;
}
.status-closed {
  background: #ffebe9;
  color: #f14c4c;
}
.row {
  display: flex;
  gap: 8px;
  margin: 8px 0;
}
.btn {
  border: 1px solid #d0d0d0;
  border-radius: 4px;
  background: #fff;
  padding: 5px 12px;
  cursor: pointer;
}
.btn:hover {
  border-color: #07c160;
  color: #07c160;
}
.inp {
  flex: 1;
  border: 1px solid #d0d0d0;
  border-radius: 4px;
  padding: 5px 8px;
}
.mono {
  font-family: 'SF Mono', Consolas, monospace;
  font-size: 12px;
}
.hint {
  color: #999;
  font-size: 12px;
}
.cmd {
  border: 1px dashed #d0d0d0;
  border-radius: 6px;
  padding: 8px 10px;
  margin: 10px 0;
}
.counters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 10px 0;
}
.counter {
  border-radius: 3px;
  padding: 2px 8px;
  font-size: 12px;
  color: #fff;
}
.c-lifecycle { background: #3e5770; }
.c-router { background: #2e7d5b; }
.c-api { background: #1d6fb8; }
.c-store { background: #8a5a17; }
.c-capability { background: #0e7c86; }
.c-compiler { background: #6a3d9a; }
.c-component { background: #9a3d52; }
.c-hmr { background: #3d9a6a; }
.cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
@media (max-width: 720px) {
  .cols {
    grid-template-columns: 1fr;
  }
}
.evlist,
.log {
  border: 1px solid #eee;
  border-radius: 6px;
  max-height: 320px;
  overflow-y: auto;
  padding: 6px 8px;
}
.ev {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0;
  font-size: 12px;
  border-bottom: 1px solid #f5f5f5;
}
.badge {
  border-radius: 3px;
  padding: 0 6px;
  color: #fff;
  font-size: 11px;
}
.b-lifecycle { background: #3e5770; }
.b-router { background: #2e7d5b; }
.b-api { background: #1d6fb8; }
.b-store { background: #8a5a17; }
.b-capability { background: #0e7c86; }
.b-compiler { background: #6a3d9a; }
.b-component { background: #9a3d52; }
.b-hmr { background: #3d9a6a; }
.phase {
  font-size: 11px;
  color: #666;
  width: 44px;
}
.ph-start { color: #07c160; }
.ph-end { color: #1d6fb8; }
.ph-error { color: #f14c4c; }
.name {
  flex: 1;
  word-break: break-all;
}
.time {
  color: #bbb;
  font-size: 11px;
  font-family: 'SF Mono', Consolas, monospace;
}
.logline {
  font-family: 'SF Mono', Consolas, monospace;
  font-size: 11px;
  padding: 1px 0;
  border-bottom: 1px solid #f7f7f7;
  word-break: break-all;
}
.pre {
  background: #f8f9fa;
  border-radius: 6px;
  padding: 8px;
  font-size: 11px;
  max-height: 240px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
