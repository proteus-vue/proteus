<script setup lang="ts">
// SettingsApp.vue —— **独立设置窗口**（决策 #1267）
//
// 【为什么不是右栏面板】用户的原话："不是这种，是单独的设置窗口面板，类似于 zed、jetbrains 的那种"。
//   右栏那种做法的问题是：设置混在**工作区**里，和读数面板抢位置；而 IDE 的惯例是
//   ⌘, 打开一个**独立窗口**，左侧分类、右侧内容 —— 打开它就"进入设置模式"，关掉就回到工作区。
//
// 【窗口怎么来的】Rust 侧 `open_settings` 新建 `WebviewWindow`，URL 带 `?view=settings`；
//   `main.ts` 按这个参数挂本组件（同一份 dist，不做第二个入口文件）。
//
// 【分类的诚实边界】只有「开发环境」是可写的；「设备」是**只读**（切换设备只在主窗口做，
//   两处都能改状态必然漂移）；「关于」只放**常量事实**（应用标识 / 设置文件位置 / 快捷键），
//   不摆假的运行时版本号。
import { computed, onMounted, ref } from 'vue'
import { getSettings, hasBridge, listDevices, probeTool, saveSettings, type DeviceInfo } from './bridge'
import { pushToast } from './toast'

type Cat = 'env' | 'device' | 'about'
const cat = ref<Cat>('env')
const CATS: { id: Cat; label: string }[] = [
  { id: 'env', label: '开发环境' },
  { id: 'device', label: '设备' },
  { id: 'about', label: '关于' },
]

const xcode = ref('')
const adb = ref('')
const port = ref(9001)
const xcodeMsg = ref<{ ok: boolean; text: string } | null>(null)
const adbMsg = ref<{ ok: boolean; text: string } | null>(null)
const busy = ref(false)
const devices = ref<DeviceInfo[]>([])

const category = computed(() => CATS.find((c) => c.id === cat.value)?.label ?? '')

onMounted(async () => {
  if (!hasBridge()) return
  try {
    const s = await getSettings()
    xcode.value = s.xcode ?? ''
    adb.value = s.adb ?? ''
    port.value = s.ios_port ?? 9001
    devices.value = await listDevices()
  } catch (e) {
    pushToast(String((e as Error)?.message ?? e), 'err')
  }
})

async function check(kind: 'xcode' | 'adb') {
  const p = kind === 'xcode' ? xcode.value : adb.value
  const box = kind === 'xcode' ? xcodeMsg : adbMsg
  busy.value = true
  try {
    const r = await probeTool(kind, p)
    box.value = { ok: r.ok, text: r.detail }
  } catch (e) {
    box.value = { ok: false, text: String((e as Error)?.message ?? e) }
  } finally {
    busy.value = false
  }
}

async function save() {
  busy.value = true
  try {
    await saveSettings({
      xcode: xcode.value.trim() || null,
      adb: adb.value.trim() || null,
      ios_port: Number(port.value) || 9001,
    })
    // ★保存成功才提示"已生效"：写盘失败还报成功，等于骗人
    pushToast('已保存（立即生效）', 'info')
  } catch (e) {
    pushToast(String((e as Error)?.message ?? e), 'err')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="setwin">
    <aside class="setnav" id="setNav">
      <div class="setnav-title">设置</div>
      <button
        v-for="c in CATS"
        :key="c.id"
        class="setnav-item"
        :class="{ on: cat === c.id }"
        :data-cat="c.id"
        :aria-pressed="cat === c.id"
        @click="cat = c.id"
      >
        {{ c.label }}
      </button>
    </aside>

    <main class="setbody">
      <!-- ── 开发环境（唯一可写的一类）────────────────────────────────── -->
      <section v-if="cat === 'env'">
        <h2 class="sethead">开发环境</h2>
        <p class="setlead">
          路径**不猜默认值**——Xcode 可以装在任意磁盘。留空则用系统默认（<code>xcode-select</code> / PATH）。
        </p>

        <div class="setfield">
          <label for="setXcode">Xcode 路径</label>
          <div class="setrow">
            <input
              id="setXcode"
              v-model="xcode"
              spellcheck="false"
              placeholder="/Volumes/…/Xcode.app（本体，不是 Contents/Developer）"
            />
            <button class="setbtn" id="probeXcode" :disabled="busy" @click="check('xcode')">检测</button>
          </div>
          <p v-if="xcodeMsg" class="setmsg" :class="xcodeMsg.ok ? 'okmsg' : 'errmsg'" id="xcodeMsg">
            {{ xcodeMsg.text }}
          </p>
        </div>

        <div class="setfield">
          <label for="setAdb">adb 路径</label>
          <div class="setrow">
            <input id="setAdb" v-model="adb" spellcheck="false" placeholder="留空 = 走 PATH（/opt/homebrew/bin 等）" />
            <button class="setbtn" id="probeAdb" :disabled="busy" @click="check('adb')">检测</button>
          </div>
          <p v-if="adbMsg" class="setmsg" :class="adbMsg.ok ? 'okmsg' : 'errmsg'" id="adbMsg">
            {{ adbMsg.text }}
          </p>
        </div>

        <div class="setfield">
          <label for="setPort">iOS 推流端口</label>
          <div class="setrow narrow">
            <input id="setPort" v-model.number="port" type="number" min="1024" max="65535" />
            <button class="setbtn primary" id="setSave" :disabled="busy" @click="save">保存</button>
          </div>
        </div>
      </section>

      <!-- ── 设备（只读：切换只在主窗口做，两处可写必然漂移）────────────── -->
      <section v-else-if="cat === 'device'">
        <h2 class="sethead">设备</h2>
        <p class="setlead">这里只读。**切换设备在主窗口右栏**——同一个状态有两个写入口，迟早会不一致。</p>
        <div class="settable">
          <div class="settr setth"><span>机型</span><span>尺寸</span><span>状态</span><span>串号</span></div>
          <div v-for="d in devices" :key="d.serial" class="settr" :data-dev="d.serial">
            <span>{{ d.model }}</span>
            <span>{{ d.size ?? '—' }}</span>
            <span :class="{ dead: d.state !== 'device' }">{{ d.current ? '当前' : d.state }}</span>
            <span class="mono">{{ d.serial }}</span>
          </div>
          <div v-if="!devices.length" class="setlead">没有检测到设备。</div>
        </div>
      </section>

      <!-- ── 关于（只写常量事实，不摆假版本号）────────────────────────── -->
      <section v-else>
        <h2 class="sethead">关于</h2>
        <div class="setkv">
          <b>应用</b><span>Proteus Studio（跨端视觉一致性调试器）</span>
          <b>应用标识</b><span class="mono">dev.proteus.studio.shell</span>
          <b>设置位置</b><span class="mono">~/Library/Application Support/dev.proteus.studio.shell/settings.json</span>
          <b>打开设置</b><span><kbd>⌘</kbd> + <kbd>,</kbd></span>
        </div>
      </section>

      <footer class="setfoot">{{ category }} · 改动点「保存」后立即生效，不需要重启</footer>
    </main>
  </div>
</template>
