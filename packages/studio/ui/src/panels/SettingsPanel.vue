<script setup lang="ts">
// SettingsPanel.vue —— 开发环境路径设置（决策 #1266）
//
// 【为什么必须有】Xcode 可以装在任意磁盘：本机就在 `/Volumes/data1/work/office-applications/Xcode.app`。
//   任何"按默认路径猜"的代码在真实机器上都会翻车（我第一次探 iOS 设备就是这么翻的：
//   `xcode-select -p` 指到 CommandLineTools、`/Applications/Xcode*.app` 不存在 ⇒ 结论成了"没有 Xcode"）。
// 【设计】输入框 + 「检测」+「保存」：
//   · 检测 = 真的跑一次（`xcodebuild -version` / `adb version`），把**输出**摆给你看，不是"看起来对不对"；
//   · 保存 = 写盘并**立即生效**（下一次 spawn 就用新值），不需要重启应用；
//   · 留空 = 走系统默认（`xcode-select` / PATH），不是"必须填"。
import { onMounted, ref } from 'vue'
import PanelShell from './PanelShell.vue'
import { getSettings, hasBridge, probeTool, saveSettings } from '../bridge'
import { pushToast } from '../toast'

const xcode = ref('')
const adb = ref('')
const port = ref(9001)
const xcodeMsg = ref<{ ok: boolean; text: string } | null>(null)
const adbMsg = ref<{ ok: boolean; text: string } | null>(null)
const busy = ref(false)

onMounted(async () => {
  if (!hasBridge()) return
  try {
    const s = await getSettings()
    xcode.value = s.xcode ?? ''
    adb.value = s.adb ?? ''
    port.value = s.ios_port ?? 9001
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
    pushToast('设置已保存（立即生效，不需要重启）', 'info')
  } catch (e) {
    pushToast(String((e as Error)?.message ?? e), 'err')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <PanelShell title="开发环境">
    <div class="setgrid">
      <label for="setXcode">Xcode 路径</label>
      <div class="setrow">
        <input
          id="setXcode"
          v-model="xcode"
          spellcheck="false"
          placeholder="/Volumes/data1/…/Xcode.app（留空 = 系统 xcode-select）"
        />
        <button class="setbtn" id="probeXcode" :disabled="busy" @click="check('xcode')">检测</button>
      </div>
      <p v-if="xcodeMsg" class="setmsg" :class="xcodeMsg.ok ? 'okmsg' : 'errmsg'" id="xcodeMsg">
        {{ xcodeMsg.text }}
      </p>

      <label for="setAdb">adb 路径</label>
      <div class="setrow">
        <input id="setAdb" v-model="adb" spellcheck="false" placeholder="留空 = 走 PATH（/opt/homebrew/bin 等）" />
        <button class="setbtn" id="probeAdb" :disabled="busy" @click="check('adb')">检测</button>
      </div>
      <p v-if="adbMsg" class="setmsg" :class="adbMsg.ok ? 'okmsg' : 'errmsg'" id="adbMsg">
        {{ adbMsg.text }}
      </p>

      <label for="setPort">iOS 推流端口</label>
      <div class="setrow">
        <input id="setPort" v-model.number="port" type="number" min="1024" max="65535" />
        <button class="setbtn" id="setSave" :disabled="busy" @click="save">保存</button>
      </div>
    </div>
    <template #note>
      <span>
        路径不猜默认值——Xcode 可以装在任意磁盘。<code>检测</code> 会真的跑一次命令并显示输出；
        留空则用系统默认（<code>xcode-select</code> / PATH）。
      </span>
    </template>
  </PanelShell>
</template>

<!-- 样式进全局 styles.css（.setgrid/.setrow/.setbtn/.setmsg）：与 .kv 同理，避免每个面板各写一套 -->
