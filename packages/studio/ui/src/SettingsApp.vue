<script setup lang="ts">
// SettingsApp.vue —— 独立设置窗口（决策 #1267 / #1269 / #1270）
//
// 【三件事】
// ① **自己的标题栏**：窗口由 `window::studio_window` 建（titleBarStyle=Overlay + hiddenTitle），
//    系统标题栏不占位、红绿灯浮在内容上 ⇒ 本页顶部那条 44px 就是拖拽区（`data-tauri-drag-region`）。
// ② **按端分组**：Web / Android / iOS / 鸿蒙 / 微信小程序各要不同工具，用二级页签分开，
//    而不是把 7 个输入框平铺（上一版就是那样，用户说"太粗糙"）。
// ③ **点两下就完成**：每组自动列出检测到的候选（带真实版本），点一下即选中；只有一个候选时自动填；
//    找不到才让用户点「浏览…」（原生 NSOpenPanel）。
import { computed, onMounted, ref } from 'vue'
import {
  detectTools,
  getSettings,
  hasBridge,
  listDevices,
  pickTool,
  probeTool,
  saveSettings,
  type DeviceInfo,
  type ToolCandidate,
} from './bridge'
import { pushToast } from './toast'

type Cat = 'env' | 'device' | 'about'
type Msg = { ok: boolean; text: string }

/** 端 → 该端要的工具。key 与 Rust `settings::TOOLS` 一一对应（键名就是 `端.工具`）。 */
const TARGETS: { id: string; label: string; fields: { key: string; label: string }[] }[] = [
  {
    id: 'web',
    label: 'Web',
    fields: [
      { key: 'web.node', label: 'Node 可执行文件' },
      { key: 'web.browser', label: '浏览器（.app）' },
    ],
  },
  {
    id: 'android',
    label: 'Android',
    fields: [
      { key: 'android.studio', label: 'Android Studio（.app）' },
      { key: 'android.adb', label: 'adb 可执行文件' },
    ],
  },
  { id: 'ios', label: 'iOS', fields: [{ key: 'ios.xcode', label: 'Xcode（.app）' }] },
  { id: 'harmony', label: '鸿蒙', fields: [{ key: 'harmony.deveco', label: 'DevEco Studio（.app）' }] },
  { id: 'mp', label: '微信小程序', fields: [{ key: 'mp.devtools', label: '微信开发者工具（.app）' }] },
]

const cat = ref<Cat>('env')
const CATS: { id: Cat; label: string }[] = [
  { id: 'env', label: '开发环境' },
  { id: 'device', label: '设备' },
  { id: 'about', label: '关于' },
]

const target = ref(TARGETS[0].id)
const cur = computed(() => TARGETS.find((t) => t.id === target.value) ?? TARGETS[0])

const paths = ref<Record<string, string>>({})
const cands = ref<Record<string, ToolCandidate[]>>({})
const msgs = ref<Record<string, Msg>>({})
const port = ref(9001)
const busy = ref(false)
const devices = ref<DeviceInfo[]>([])

onMounted(async () => {
  if (!hasBridge()) return
  try {
    const s = await getSettings()
    paths.value = { ...(s.paths ?? {}) }
    port.value = s.ios_port ?? 9001
    devices.value = await listDevices()
    const det = await detectTools()
    cands.value = det.by_key ?? {}
    /* ★只有一个候选 ⇒ 直接填上（零输入可用）。多个候选不自动选：那是替用户做决定。 */
    for (const t of TARGETS) {
      for (const f of t.fields) {
        const list = cands.value[f.key] ?? []
        if (!paths.value[f.key] && list.length === 1) useCandidate(f.key, list[0])
      }
    }
  } catch (e) {
    pushToast(String((e as Error)?.message ?? e), 'err')
  }
})

function useCandidate(key: string, c: ToolCandidate) {
  paths.value[key] = c.path
  msgs.value[key] = c.version
    ? { ok: true, text: c.version }
    : { ok: true, text: '已安装（该工具不提供版本号）' }
}

async function check(key: string) {
  busy.value = true
  try {
    const r = await probeTool(key, paths.value[key] ?? '')
    msgs.value[key] = { ok: r.ok, text: r.detail }
  } catch (e) {
    msgs.value[key] = { ok: false, text: String((e as Error)?.message ?? e) }
  } finally {
    busy.value = false
  }
}

async function browse(key: string) {
  busy.value = true
  try {
    const p = await pickTool(key)
    if (!p) return // 取消：**什么都不改**
    paths.value[key] = p
    await check(key)
  } catch (e) {
    pushToast(String((e as Error)?.message ?? e), 'err')
  } finally {
    busy.value = false
  }
}

async function save() {
  busy.value = true
  try {
    await saveSettings({ paths: paths.value, ios_port: Number(port.value) || 9001 })
    pushToast('已保存（立即生效）', 'info')
  } catch (e) {
    pushToast(String((e as Error)?.message ?? e), 'err')
  } finally {
    busy.value = false
  }
}

/** 路径太长只显示后两段 */
function shortPath(p: string) {
  return p.split('/').filter(Boolean).slice(-2).join('/')
}

const category = computed(() => CATS.find((c) => c.id === cat.value)?.label ?? '')
</script>

<template>
  <div class="setwin">
    <!-- ★沉浸式标题栏（决策 #1269）：系统标题栏已隐藏，这条由我们自己画；
         左内边距 84px 给红绿灯让位，`deep` 让整条（含子元素）都能拖窗口。 -->
    <header class="settitle" data-tauri-drag-region="deep">
      <span class="settitle-text">设置</span>
    </header>

    <div class="setmain">
      <aside class="setnav" id="setNav">
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
        <!-- ── 开发环境：先选端，再看该端的工具 ────────────────────────── -->
        <section v-if="cat === 'env'">
          <h2 class="sethead">开发环境</h2>
          <p class="setlead">
            每端要的工具不同，这里按端分开。一般<b>不用手输</b>：下面自动列出本机找到的，
            点一下即可；只有一个候选时会自动填好；找不到再点「浏览…」。
          </p>

          <div class="settabs" id="targetTabs">
            <button
              v-for="t in TARGETS"
              :key="t.id"
              class="settab"
              :class="{ on: target === t.id }"
              :data-target="t.id"
              :aria-pressed="target === t.id"
              @click="target = t.id"
            >
              {{ t.label }}
            </button>
          </div>

          <div v-for="f in cur.fields" :key="f.key" class="setfield">
            <label>{{ f.label }}</label>

            <div class="setcands" :id="`cands-${f.key}`">
              <button
                v-for="c in cands[f.key] ?? []"
                :key="c.path"
                class="setcand"
                :class="{ on: paths[f.key] === c.path }"
                :data-cand="c.path"
                :title="c.path"
                @click="useCandidate(f.key, c)"
              >
                <span class="cpath">{{ shortPath(c.path) }}</span>
                <span class="cver">{{ c.version ?? '已安装' }}</span>
              </button>
              <p v-if="!(cands[f.key] ?? []).length" class="setlead">本机没检测到 —— 点下面的「浏览…」选一个</p>
            </div>

            <div class="setrow three">
              <input :id="`set-${f.key}`" v-model="paths[f.key]" spellcheck="false" placeholder="留空 = 用系统默认" />
              <button class="setbtn" :id="`browse-${f.key}`" :disabled="busy" @click="browse(f.key)">浏览…</button>
              <button class="setbtn" :id="`probe-${f.key}`" :disabled="busy" @click="check(f.key)">检测</button>
            </div>
            <p v-if="msgs[f.key]" class="setmsg" :class="msgs[f.key]!.ok ? 'okmsg' : 'errmsg'" :id="`msg-${f.key}`">
              {{ msgs[f.key]!.text }}
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

        <!-- ── 设备（只读：切换只在主窗口做）──────────────────────────── -->
        <section v-else-if="cat === 'device'">
          <h2 class="sethead">设备</h2>
          <p class="setlead">这里只读。<b>切换设备在主窗口右栏</b>——同一状态两个写入口，迟早不一致。</p>
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

        <!-- ── 关于（只放常量事实）────────────────────────────────────── -->
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
  </div>
</template>
