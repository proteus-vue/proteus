<script setup lang="ts">
// IosStreamCard.vue —— 设备面板里的「一键投屏到 iPhone」（决策 #1288）
//
// 【为什么需要这张卡】在此之前，把 iPhone 画面弄进来要在终端敲 5 步，其中 3 步是
//   "只有读过日志的人才知道的命令"。这张卡把整条链压成一个按钮：
//     切采集源（起 nc 监听）→ 编译宿主 → 签名 → 安装 → 启动 → 等首帧
//   后面全交给后端（`ios_stream_start`），这里只负责**把阶段和失败原因显示出来**。
//
// 【职责边界】不重写构建、不做签名：直接调 `hosts/ios/run-selfdraw.sh`。
//   重复实现等于把那些坑（源码快照/续行/签名档）重踩一遍。
//
// 【唯一跳不过的】首次仍需：设备信任 + 开发者团队 + 签名时钥匙串授权（点一次"始终允许"）。
//   所以失败文案要把这些**说清楚**，而不是让用户对着一堆 domain error 发呆。
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { iosStartHost, iosStreamHint, iosStreamStart, iosUninstall, hasBridge, onIosProgress, onIosResult, selectDevice, type DeviceInfo, type IosOutcome } from '../bridge'
import { pushToast } from '../toast'

const props = defineProps<{ devices: DeviceInfo[] }>()

/** 只对**在线**的 iOS 设备投屏（离线的点了没意义） */
const target = computed(() => props.devices.find((d) => d.state === 'device') ?? null)

const running = ref(false)
const stage = ref('')
const lines = ref<string[]>([])
const outcome = ref<IosOutcome | null>(null)
/** 卸载后自动重试一次（团队冲突的标准解法） */
const retryAfterUninstall = ref(false)

let offP: (() => void) | null = null
let offR: (() => void) | null = null

const shown = computed(() => lines.value.slice(-10))

function reset() {
  stage.value = ''
  lines.value = []
  outcome.value = null
}

/** 主流程：切源（起监听）→ 跑流水线 */
async function go() {
  if (!hasBridge()) {
    pushToast('一键投屏要在 Studio 里用（浏览器直开没有 IPC）', 'err')
    return
  }
  const d = target.value
  if (!d) {
    pushToast('这台 iPhone 现在不可用（拔插/信任后再刷新设备列表）', 'err')
    return
  }
  reset()
  running.value = true
  try {
    const hint = await iosStreamHint()
    if (!hint.ip) throw new Error('拿不到本机局域网 IP（Wi-Fi 没连？）')
    /* ★先切采集源：它会把会话切成 `/usr/bin/nc -l <port>`，也就是**先把接收端挂上**。
       顺序反了的话，手机会在没有人监听时白连一次（表现为"点了允许还是黑屏"）。 */
    await selectDevice(d.serial)
    /* ★快路径（决策 #1297）：手机上通常**已经装着**宿主，只需启动它（秒级）；
       只有没装/包坏了才由后端自动回退到完整构建。 */
    await iosStartHost(d.serial, hint.ip, hint.port)
  } catch (e) {
    running.value = false
    pushToast(String((e as Error)?.message ?? e), 'err')
  }
}

/** 强制走完整构建（改了宿主代码 / 包坏了时用） */
async function rebuild() {
  const d = target.value
  if (!d) return
  reset()
  running.value = true
  try {
    const hint = await iosStreamHint()
    if (!hint.ip) throw new Error('拿不到本机局域网 IP（Wi-Fi 没连？）')
    await selectDevice(d.serial)
    await iosStreamStart(d.serial, hint.ip, hint.port)
  } catch (e) {
    running.value = false
    pushToast(String((e as Error)?.message ?? e), 'err')
  }
}

/** 团队冲突时：卸载 → 重装 */
async function doUninstall() {
  const d = target.value
  if (!d) return
  running.value = true
  try {
    const bundle = await iosUninstall(d.serial)
    pushToast(`已卸载设备上的 ${bundle}，正在重装…`, 'ok')
    retryAfterUninstall.value = true
    await go()
  } catch (e) {
    running.value = false
    pushToast(String((e as Error)?.message ?? e), 'err')
  }
}

onMounted(() => {
  offP = onIosProgress((p) => {
    if (p.stage) stage.value = p.stage
    lines.value.push(p.line)
    if (lines.value.length > 300) lines.value.splice(0, lines.value.length - 300)
  })
  offR = onIosResult((o) => {
    running.value = false
    outcome.value = o
    if (o.ok) {
      pushToast('iPhone 已开始推流，等首帧即可', 'ok')
      retryAfterUninstall.value = false
    }
  })
})

onBeforeUnmount(() => {
  offP?.()
  offR?.()
})
</script>

<template>
  <div class="ioscard" id="iosCard">
    <button class="iosgo" id="iosStreamGo" :disabled="running || !target" @click="go">
      {{ running ? '正在启动…' : '投屏到这台 iPhone' }}
    </button>
    <div v-if="!target" class="iosoff">这台 iPhone 当前离线，插线并点「信任」后刷新设备列表</div>
    <!-- 次路径：确实需要重新编译/安装时才用（默认秒级启动已装宿主） -->
    <button v-if="target && !running" class="iosrebuild" id="iosRebuild" @click="rebuild">
      重新构建并安装（约 40 秒）
    </button>

    <!-- 进度：阶段标题 + 最近几行日志（够定位，不刷屏） -->
    <div v-if="stage || lines.length" class="iosprog" id="iosProgress">
      <div v-if="stage" class="iosstage" id="iosStage">{{ stage }}</div>
      <pre class="ioslog" id="iosLog">{{ shown.join('\n') }}</pre>
    </div>

    <!-- 结果：后端已把已知失败翻译成人话，这里只补一个"该点哪个按钮" -->
    <div v-if="outcome && !outcome.ok" class="iosfail" id="iosFail">
      <div class="ioshint" id="iosHint">{{ outcome.hint || '这次没成功，看上面的日志尾部' }}</div>
      <div class="iosacts">
        <button v-if="outcome.action === 'uninstall'" id="iosUninstall" class="iosact" @click="doUninstall">
          卸载旧应用并重装
        </button>
        <button v-else-if="outcome.action === 'rebuild'" id="iosRetry" class="iosact" @click="go">重新构建</button>
        <button v-else-if="outcome.action === 'signing'" id="iosRetrySign" class="iosact" @click="go">重试签名</button>
      </div>
    </div>
    <div v-else-if="outcome?.ok" class="iosok" id="iosOk">已安装并启动 · 等手机端画面</div>
  </div>
</template>

<style scoped>
.ioscard {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 6px 0 10px;
  padding: 8px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-md);
  background: var(--bg-surface);
}
.iosgo {
  height: 28px;
  border: 1px solid var(--accent);
  border-radius: var(--r-sm);
  background: var(--accent-weak, var(--bg-elevated));
  color: var(--fg);
  font-size: var(--fs-sm);
  cursor: pointer;
}
.iosgo:disabled {
  opacity: 0.55;
  cursor: default;
}
.iosrebuild {
  height: 22px;
  padding: 0 8px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-pill);
  background: transparent;
  color: var(--fg-subtle);
  font-size: var(--fs-2xs);
  cursor: pointer;
}
.iosoff {
  font-size: var(--fs-2xs);
  color: var(--fg-subtle);
}
.iosstage {
  font-size: var(--fs-2xs);
  color: var(--accent);
}
.ioslog {
  max-height: 120px;
  overflow: auto;
  margin: 2px 0 0;
  padding: 6px;
  border-radius: var(--r-sm);
  background: var(--bg-canvas);
  color: var(--fg-muted);
  font: var(--fs-2xs) / 1.45 ui-monospace, Menlo, monospace;
  white-space: pre-wrap;
  word-break: break-all;
}
.iosfail {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ioshint {
  font-size: var(--fs-2xs);
  line-height: 1.5;
  color: var(--bad);
}
.iosacts {
  display: flex;
  gap: 6px;
}
.iosact {
  height: 24px;
  padding: 0 10px;
  border: 1px solid var(--bad);
  border-radius: var(--r-pill);
  background: transparent;
  color: var(--bad);
  font-size: var(--fs-2xs);
  cursor: pointer;
}
.iosok {
  font-size: var(--fs-2xs);
  color: var(--ok);
}
</style>
