#!/usr/bin/env node
// scripts/gen-capability-demo-pages.mjs —— ★能力详情页批量生成（showcase）
//
// 背景（2026-09-19）：showcase 能力详情页仅 1/81（camera 样板），而能力是框架的差异化卖点
//   （`CapResult<T>` 契约 + 81 Hook）。范式已在 camera.vue 验证，本脚本把「机械部分」批量化：
//   页面骨架 / API 表 / 兼容进度表由**数据表 + 模板**生成，各能力的演示逻辑按 `demo` 字段定制。
//
// ★诚实边界：只为「Web 端**真有实现**」的能力生成可交互演示页（判据 = packages/api/src/capability.ts
//   的 webBridge 实现清单，已核）；无 Web 实现的能力不生成——避免产出「点了没反应」的假演示。
//
// 用法：node scripts/gen-capability-demo-pages.mjs [--check]
//   --check：只校验已生成的页与数据表一致（漂移 exit 1），供 CI 使用。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(ROOT, 'showcase', 'subpackages', 'capabilities', 'pages')
const check = process.argv.includes('--check')

/**
 * 能力详情页数据表（只收 Web 端真有实现的——判据见文件头「诚实边界」）。
 * `demo` 字段是各页唯一的定制部分（模板只做骨架）。
 */
const PAGES = [
  {
    file: 'clipboard',
    title: 'useClipboard 剪贴板',
    subtitle: '能力原语 · capability.clipboard · 双端同源码',
    code: 'const read = await useClipboard()\nconst write = await setClipboard("hello")\nif (read.ok) { /* read.data: string */ }',
    demo: `const out = ref('点击按钮读/写剪贴板（浏览器需用户手势 + 权限）')
async function onRead(): Promise<void> {
  const res = await cap.useClipboard()
  out.value = res.ok ? \`✅ 读到：\${res.data || '（空）'}\` : \`⚠ 降级：\${res.error.code}\`
}
async function onWrite(): Promise<void> {
  const res = await cap.setClipboard('Proteus showcase · ' + Date.now())
  out.value = res.ok ? '✅ 已写入剪贴板（可点「读取」验证往返）' : \`⚠ 降级：\${res.error.code}\`
}`,
    buttons: `[['读取剪贴板', 'onRead'], ['写入剪贴板', 'onWrite']]`,
    api: [
      ['useClipboard()', '读取剪贴板文本；返回 Promise<CapResult<string>>', 'CapResult<string>'],
      ['setClipboard(text)', '写入剪贴板文本；返回 Promise<CapResult<void>>', 'CapResult<void>'],
      ['data', '读到的文本（useClipboard 成功时）', 'string'],
      ['error.code', '机器码：clipboard.unsupported（无 Clipboard API）等', 'string'],
    ],
    compat: [
      ['Web SPA', 'navigator.clipboard（需安全上下文 + 用户手势）', '✅'],
      ['微信小程序', 'wx.getClipboardData / wx.setClipboardData', '✅'],
      ['Headless（SSR/测试）', 'mock 桥注入', '✅'],
    ],
  },
  {
    file: 'network',
    title: 'useNetwork 网络',
    subtitle: '能力原语 · capability.network · 双端同源码',
    code: 'const res = await useNetwork()\nif (res.ok) { /* res.data: NetworkType { online, kind } */ }',
    demo: `const out = ref('点击按钮探测当前网络状态')
async function onNetwork(): Promise<void> {
  const res = await cap.useNetwork()
  out.value = res.ok
    ? \`✅ 在线：\${res.data.online} · 类型：\${res.data.kind ?? '未知'}\`
    : \`⚠ 降级：\${res.error.code}\`
}`,
    buttons: `[['探测网络', 'onNetwork']]`,
    api: [
      ['useNetwork()', '当前网络状态；返回 Promise<CapResult<NetworkType>>', 'CapResult<NetworkType>'],
      ['data.online', '是否在线', 'boolean'],
      ['data.kind', "连接类型：'wifi' | '4g' | '5g' | 'ethernet' | …（不可判定时 undefined）", 'string?'],
      ['error.code', '机器码：network.unsupported 等', 'string'],
    ],
    compat: [
      ['Web SPA', 'navigator.onLine + NetworkInformation.effectiveType', '✅'],
      ['微信小程序', 'wx.getNetworkType + onNetworkStatusChange', '✅'],
      ['Headless（SSR/测试）', 'mock 桥注入', '✅'],
    ],
  },
  {
    file: 'device',
    title: 'useDevice 设备信息',
    subtitle: '能力原语 · capability.device · 双端同源码',
    code: 'const res = await useDevice()\nif (res.ok) { /* res.data: CapDeviceInfo */ }',
    demo: `const out = ref('点击按钮读取设备信息')
async function onDevice(): Promise<void> {
  const res = await cap.useDevice()
  // ★过滤空段（浏览器不暴露型号 → 原写法会产出 "web · Web · " 这类尾巴）
  const parts = res.ok ? [res.data.platform, res.data.model, res.data.system].filter(Boolean) : []
  out.value = res.ok ? \`✅ \${parts.join(' · ') || '（平台未提供详细信息）'}\` : \`⚠ 降级：\${res.error.code}\`
}`,
    buttons: `[['读取设备信息', 'onDevice']]`,
    api: [
      ['useDevice()', '设备/系统信息；返回 Promise<CapResult<CapDeviceInfo>>', 'CapResult<CapDeviceInfo>'],
      ['data.platform', '平台标识（web / devtools / ios / android…）', 'string?'],
      ['data.model', '设备型号（浏览器多为空）', 'string?'],
      ['data.system', '系统版本', 'string?'],
      ['error.code', '机器码：device.unsupported 等', 'string'],
    ],
    compat: [
      ['Web SPA', 'navigator.userAgent 解析（型号多为空——浏览器不暴露）', '✅'],
      ['微信小程序', 'wx.getSystemInfo（型号/系统齐备）', '✅'],
      ['Headless（SSR/测试）', 'mock 桥注入', '✅'],
    ],
  },
  {
    file: 'battery',
    title: 'useBattery 电量',
    subtitle: '能力原语 · capability.battery · 双端同源码',
    code: 'const res = await useBattery()\nif (res.ok) { /* res.data: BatteryInfo { level, charging } */ }',
    demo: `const out = ref('点击按钮读取电量（桌面浏览器常无 Battery API → 诚实降级）')
async function onBattery(): Promise<void> {
  const res = await cap.useBattery()
  out.value = res.ok
    ? \`✅ 电量 \${Math.round((res.data.level ?? 0) * 100)}% · 充电中：\${res.data.charging}\`
    : \`⚠ 降级：\${res.error.code}\`
}`,
    buttons: `[['读取电量', 'onBattery']]`,
    api: [
      ['useBattery()', '电量/充电状态；返回 Promise<CapResult<BatteryInfo>>', 'CapResult<BatteryInfo>'],
      ['data.level', '电量 0-1', 'number'],
      ['data.charging', '是否充电中', 'boolean'],
      ['error.code', '机器码：battery.unsupported（浏览器无 getBattery）等', 'string'],
    ],
    compat: [
      ['Web SPA', 'navigator.getBattery（部分浏览器未实现 → Err）', '✅'],
      ['微信小程序', 'wx.getBatteryInfo', '✅'],
      ['Headless（SSR/测试）', 'mock 桥注入', '✅'],
    ],
  },
  {
    file: 'orientation',
    title: 'useOrientation 屏幕方向',
    subtitle: '能力原语 · capability.orientation · 双端同源码',
    code: 'const res = await useOrientation()\nif (res.ok) { /* res.data: OrientationInfo { angle, type } */ }',
    demo: `const out = ref('点击按钮读取屏幕方向')
async function onOrientation(): Promise<void> {
  const res = await cap.useOrientation()
  out.value = res.ok
    ? \`✅ 角度 \${res.data.angle}° · 方向：\${res.data.type ?? '未知'}\`
    : \`⚠ 降级：\${res.error.code}\`
}`,
    buttons: `[['读取方向', 'onOrientation']]`,
    api: [
      ['useOrientation()', '屏幕方向；返回 Promise<CapResult<OrientationInfo>>', 'CapResult<OrientationInfo>'],
      ['data.angle', '旋转角度（0/90/180/270）', 'number'],
      ['data.type', "方向类型：'portrait' | 'landscape' 等", 'string?'],
      ['error.code', '机器码：orientation.unsupported 等', 'string'],
    ],
    compat: [
      ['Web SPA', 'screen.orientation', '✅'],
      ['微信小程序', 'wx.getDeviceInfo + onDeviceOrientationChange', '✅'],
      ['Headless（SSR/测试）', 'mock 桥注入', '✅'],
    ],
  },
  {
    file: 'screen',
    title: 'useScreen 屏幕信息',
    subtitle: '能力原语 · capability.screen · 双端同源码',
    code: 'const res = await useScreen()\nif (res.ok) { /* res.data: ScreenInfo */ }',
    demo: `const out = ref('点击按钮读取屏幕信息')
async function onScreen(): Promise<void> {
  const res = await cap.useScreen()
  out.value = res.ok
    ? \`✅ \${res.data.width}×\${res.data.height} · DPR \${res.data.pixelRatio != null ? res.data.pixelRatio : '不可用'}\`
    : \`⚠ 降级：\${res.error.code}\`
}`,
    buttons: `[['读取屏幕', 'onScreen']]`,
    api: [
      ['useScreen()', '屏幕尺寸/像素比；返回 Promise<CapResult<ScreenInfo>>', 'CapResult<ScreenInfo>'],
      ['data.width / height', '逻辑像素尺寸', 'number'],
      ['data.pixelRatio', '设备像素比（DPR）', 'number?'],
      ['error.code', '机器码：screen.unsupported 等', 'string'],
    ],
    compat: [
      ['Web SPA', 'screen.width/height + devicePixelRatio', '✅'],
      ['微信小程序', 'wx.getWindowInfo', '✅'],
      ['Headless（SSR/测试）', 'mock 桥注入', '✅'],
    ],
  },
  {
    file: 'location',
    title: 'useLocation 定位',
    subtitle: '能力原语 · capability.location · 双端同源码',
    code: 'const res = await useLocation()\nif (res.ok) { /* res.data: Coords */ }\nelse { /* res.error.code === "location.denied" */ }',
    demo: `const out = ref('点击按钮请求定位（浏览器会弹权限申请；拒绝 → 诚实 Err 降级）')
async function onLocation(): Promise<void> {
  const res = await cap.useLocation()
  out.value = res.ok
    ? \`✅ 纬度 \${res.data.latitude?.toFixed(4)} · 经度 \${res.data.longitude?.toFixed(4)}\`
    : \`⚠ 降级：\${res.error.code}\`
}`,
    buttons: `[['请求定位', 'onLocation']]`,
    api: [
      ['useLocation()', '当前位置；返回 Promise<CapResult<Coords>>', 'CapResult<Coords>'],
      ['data.latitude / longitude', '经纬度', 'number'],
      ['data.accuracy', '定位精度（米）', 'number?'],
      ['error.code', '机器码：location.denied（用户拒绝）/ location.unsupported 等', 'string'],
    ],
    compat: [
      ['Web SPA', 'navigator.geolocation（需用户授权）', '✅'],
      ['微信小程序', 'wx.getLocation（需后台声明 + 用户授权）', '✅'],
      ['Headless（SSR/测试）', 'mock 桥注入', '✅'],
    ],
  },
]

/** 渲染单页（骨架固定，差异来自数据表） */
function renderPage(p) {
  const apiRows = p.api.map((r) => `  [${JSON.stringify(r[0])}, ${JSON.stringify(r[1])}, ${JSON.stringify(r[2])}],`).join('\n')
  const compatRows = [...p.compat, ['iOS / Android / 鸿蒙 / Flutter', '端原型映射·能力桥未接线（Err 显式降级）', '🟡']]
    .map((r) => `  [${JSON.stringify(r[0])}, ${JSON.stringify(r[1])}, ${JSON.stringify(r[2])}],`)
    .join('\n')
  const buttons = eval(p.buttons)
  const btnTpl = buttons
    .map(([label, handler]) => `          <p-button size="small" @click="${handler}">${label}</p-button>`)
    .join('\n')
  return `<!-- showcase/subpackages/capabilities/pages/${p.file}.vue —— 能力详情页（${p.title.split(' ')[0]}，官方形态）
     ★由 scripts/gen-capability-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     范式同 camera.vue：能力说明 + 真交互演示 + API 表 + 双端兼容进度。
     ★真交互：按钮真调用能力 Hook，输出区回显 Result<T>（成功/失败 + 错误码）。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PText, PView, PButton } from '@proteus-vue/components'
import { createCapabilityHooks } from '@proteus-vue/api'

// ★每页独立实例（demo 页惯例——不共享全局单例，页面间互不影响）
const cap = createCapabilityHooks()

// ★代码片段放 data（含 < > "。直写 :code 字面量会破坏 WXML 解析）
const codeDemo = ref(${JSON.stringify(p.code)})

${p.demo}

const apiRows = ref([
${apiRows}
])
const compatRows = ref([
${compatRows}
])
</script>

<template>
  <page-shell title="${p.title}" subtitle="${p.subtitle}">
    <demo-block index="01" title="真交互演示" :has-output="true" desc="同一份源码、同一个 Result&lt;T&gt; 契约——按 res.ok 分支，无回调、无 try/catch 义务" :code="codeDemo">
      <template #demo>
        <p-view class="btns">
${btnTpl}
        </p-view>
      </template>
      <template #output>
        <p-text class="out">{{ out }}</p-text>
      </template>
    </demo-block>

    <api-table title="API" :columns="['签名 / 字段', '说明', '类型']" :rows="apiRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<style scoped>
.btns {
  display: flex;
  gap: var(--sp-2);
  flex-wrap: wrap;
}
.out {
  display: block;
  background: #f2fbf5;
  border: 1px solid #d6f0e0;
  border-radius: var(--sp-radius-sm);
  padding: var(--sp-2) var(--sp-3);
  font-size: 12.5px;
  color: #2f7a4d;
  font-weight: 600;
  word-break: break-all;
}
</style>
`
}

let drifted = false
for (const p of PAGES) {
  const out = path.join(OUT_DIR, `${p.file}.vue`)
  const md = renderPage(p)
  if (check) {
    if (!fs.existsSync(out) || fs.readFileSync(out, 'utf-8') !== md) {
      console.error(`DRIFT: showcase/subpackages/capabilities/pages/${p.file}.vue 与数据表不一致——重跑本脚本`)
      drifted = true
    }
  } else {
    fs.writeFileSync(out, md)
  }
}
if (check) {
  console.log(drifted ? '❌ 能力详情页漂移（--check）' : `OK: ${PAGES.length} 个能力详情页与数据表一致`)
  process.exitCode = drifted ? 1 : 0
} else {
  console.log(`generated: ${PAGES.length} 个能力详情页`)
}
