<script setup lang="ts">
// ui/src/panels/FileHoverCard.vue —— 文件树**悬停属性预览**（决策 #1474）
//
// 【为什么要它】文件树里想知道"这是什么、多大、什么时候改的"时，传统 IDE 要
//   "右键 → 属性"或"打开再切回来"。悬停预览把这三步压成零步——这正是它高效的地方。
//
// 【★三个从既有缺陷换来的约定】
//   ① **锚定行，不跟鼠标**（决策 #1421 的教训）：提示框跟随鼠标重定位会导致卡片在
//      相邻两行之间来回闪跳；这里锚定的是行元素的矩形，鼠标在卡片外怎么动都不影响。
//   ② **250ms 才出现**：鼠标扫过整棵树时不该连续弹卡（那是噪音，不是信息）。
//   ③ **不做动画延迟消失**：淡出期间卡片仍会挡住下一行的点击。
//
// 【数据是异步的】`file_stat` 是一次 IPC。为了不"先空后跳"，卡片**立刻**用已知信息
//   （文件名/路径）渲染骨架，stat 回来后再填数字——宁可短暂显示"—"，也不让卡片高度抖动。
import { computed } from 'vue'
import type { FileStat } from '../bridge'
import StudioIcon from '../icons/StudioIcon.vue'

const props = defineProps<{
  /** 悬停项的仓库内相对路径 */
  path: string
  /** stat 结果（未回来时 null） */
  stat: FileStat | null
  /** 悬停行的矩形（锚点） */
  anchor: { top: number; left: number; right: number } | null
}>()

/** 卡片宽度：与文件树 240px 量级匹配，但不跟着树宽变（避免窄树里折行） */
const W = 272
/** 高度估算值：只用于"底部放不下就上移"，误差靠 max-height + 滚动兜底 */
const EST_H = 140

const pos = computed(() => {
  const a = props.anchor
  if (!a) return { left: -9999, top: -9999 }
  const vw = window.innerWidth
  const vh = window.innerHeight
  // 优先贴行右侧；右侧不够就翻到左侧（树通常靠左，翻边是常态而非例外）
  let left = a.right + 8
  if (left + W > vw - 8) left = Math.max(8, a.left - 8 - W)
  const top = Math.max(8, Math.min(a.top, vh - EST_H - 8))
  return { left, top }
})

const name = computed(() => props.path.slice(props.path.lastIndexOf('/') + 1))
const dirPath = computed(() => {
  const i = props.path.lastIndexOf('/')
  return i > 0 ? props.path.slice(0, i) : ''
})
const isDir = computed(() => props.stat?.kind === 'dir')

function humanSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** 相对时间：悬停时想知道的是"新旧"，不是精确到秒的绝对时刻 */
function relTime(us: number): string {
  const diff = Date.now() - us / 1000
  if (diff < 0) return '刚刚'
  const m = Math.floor(diff / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d} 天前`
  return `${Math.floor(d / 30)} 个月前`
}

/** 绝对时间放第二行小字：相对时间够用，但排障时需要确切值 */
function absTime(us: number): string {
  const t = new Date(us / 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}`
}

/** 目录：只报直接子项数（不递归算总量，见 fs_guard::FileStat 的注释） */
const dirSummary = computed(() => {
  const c = props.stat?.children
  if (!c) return null
  const [files, dirs] = c
  const parts: string[] = []
  if (files > 0) parts.push(`${files} 个文件`)
  if (dirs > 0) parts.push(`${dirs} 个目录`)
  return parts.length ? parts.join(' · ') : '空目录'
})

/* ===== 项目识别（决策 #1475）=====
 * 用户原话："项目根目录可能就是项目本身了，或者自动检测是不是一个项目类型"。
 * 判定全部在 Rust（`fs_guard::probe_project`）：前端**不写标记文件名表**——
 * 那种表一旦存在两份，迟早一个认 `.xcodeproj`、一个不认。
 */
const project = computed(() => props.stat?.project ?? null)
const owner = computed(() => props.stat?.owner ?? null)

/** 项目副标题：「Tauri 桌面应用 · v0.1.0」——名字是主角，类型与版本退到小字 */
const projMeta = computed(() => {
  const p = project.value
  if (!p) return ''
  return p.version ? `${p.label} · v${p.version}` : p.label
})

/** 能有几行「构成」：依赖/脚本数（只有 package.json 能算）+ 命中的标记文件 */
const projFacts = computed(() => {
  const p = project.value
  if (!p) return []
  const out: string[] = []
  if (p.deps !== null) out.push(`${p.deps} 依赖`)
  if (p.scripts !== null) out.push(`${p.scripts} 脚本`)
  return out
})
</script>

<template>
  <div
    class="fv-card"
    id="fileHoverCard"
    role="tooltip"
    :style="{ left: `${pos.left}px`, top: `${pos.top}px`, width: `${W}px` }"
  >
    <div class="fv-head">
      <div class="fv-name" :title="name">{{ name }}</div>
      <div v-if="dirPath" class="fv-dir" :title="dirPath">{{ dirPath }}</div>
    </div>

    <div class="fv-body">
      <!-- 目录：子项数 + 修改时间 -->
      <template v-if="isDir">
        <!-- 项目卡（决策 #1475）：目录自带项目标记时，先答"这是什么项目"，再答"里面有几个东西" -->
        <template v-if="project">
          <div class="fv-row proj">
            <StudioIcon name="box" :size="13" />
            <span class="fv-k">项目</span>
            <span class="fv-v">
              {{ project.name || '(未命名)' }}
              <span class="fv-sub">{{ projMeta }}</span>
            </span>
          </div>
          <div v-if="projFacts.length || project.markers.length" class="fv-row">
            <StudioIcon name="settings" :size="13" />
            <span class="fv-k">构成</span>
            <span class="fv-v">
              {{ projFacts.join(' · ') || '—' }}
              <span class="fv-sub">{{ project.markers.join(' · ') }}</span>
            </span>
          </div>
        </template>
        <!-- 自己不是项目：告诉它属于谁。★仓库根在文件树上没有单独一行，
             这是**唯一**能露出根信息的地方（ROOTS 只列三个子目录）。 -->
        <div v-else-if="owner" class="fv-row">
          <StudioIcon name="box" :size="13" />
          <span class="fv-k">所属</span>
          <span class="fv-v">
            {{ owner.name || '(仓库根)' }}
            <span class="fv-sub">{{ owner.label }} · 上 {{ owner.distance }} 层</span>
          </span>
        </div>
        <div class="fv-row">
          <StudioIcon name="folderOpen" :size="13" />
          <span class="fv-k">内容</span>
          <span class="fv-v">{{ dirSummary ?? '读取中…' }}</span>
        </div>
        <div class="fv-row">
          <StudioIcon name="clock" :size="13" />
          <span class="fv-k">修改于</span>
          <span class="fv-v">
            {{ stat ? relTime(stat.mtime_us) : '…' }}
            <span v-if="stat" class="fv-sub">{{ absTime(stat.mtime_us) }}</span>
          </span>
        </div>
      </template>

      <!-- 文件：行数+大小 / 修改时间 / 类型；敏感文件单独一行 -->
      <template v-else>
        <div class="fv-row">
          <StudioIcon name="rows" :size="13" />
          <span class="fv-k">规模</span>
          <span class="fv-v">
            <template v-if="stat">
              {{ stat.lines === null ? '— 行' : `${stat.lines} 行` }}
              <span class="fv-sub">{{ humanSize(stat.size) }}</span>
            </template>
            <template v-else>读取中…</template>
          </span>
        </div>
        <div class="fv-row">
          <StudioIcon name="clock" :size="13" />
          <span class="fv-k">修改于</span>
          <span class="fv-v">
            {{ stat ? relTime(stat.mtime_us) : '…' }}
            <span v-if="stat" class="fv-sub">{{ absTime(stat.mtime_us) }}</span>
          </span>
        </div>
        <div class="fv-row">
          <StudioIcon name="file" :size="13" />
          <span class="fv-k">类型</span>
          <span class="fv-v">{{ stat ? (stat.ext || '无扩展名') : '…' }}</span>
        </div>
        <div v-if="stat?.sensitive" class="fv-row danger">
          <StudioIcon name="alert" :size="13" />
          <span class="fv-k">敏感</span>
          <span class="fv-v">凭据/密钥类文件</span>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* 固定定位 + 高 z-index：卡片要盖住树、标签栏与状态栏 */
.fv-card {
  position: fixed;
  z-index: 60;
  max-height: 70vh;
  overflow: auto;
  padding: var(--sp2) 0 0;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  background: var(--bg-elevated);
  box-shadow: 0 10px 28px rgb(0 0 0 / 32%);
  pointer-events: none; /* ★不吃鼠标：卡片贴边时不能挡住相邻行的 hover */
}
.fv-head {
  padding: 0 var(--sp3) var(--sp2);
  border-bottom: 1px solid var(--border-subtle);
}
.fv-name {
  overflow: hidden;
  color: var(--fg);
  font: 600 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fv-dir {
  overflow: hidden;
  margin-top: 2px;
  color: var(--fg-subtle);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fv-body {
  padding: var(--sp2) var(--sp3) var(--sp3);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.fv-row {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--fg-muted);
  font-size: 11px;
  line-height: 1.5;
}
.fv-row svg {
  flex: none;
  opacity: 0.7;
}
/* 项目名是这一屏的主语，比其它行重一档（决策 #1475） */
.fv-row.proj .fv-v {
  font-weight: 600;
}
.fv-k {
  flex: none;
  width: 40px;
  color: var(--fg-subtle);
}
.fv-v {
  min-width: 0;
  overflow: hidden;
  color: var(--fg);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fv-sub {
  margin-left: 5px;
  color: var(--fg-subtle);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}
.fv-row.danger,
.fv-row.danger .fv-v {
  /* 与 styles.css 的 .errmsg 同款：--danger 没在变量表里，必须带 fallback */
  color: var(--danger, #e5484d);
}
.fv-row.danger svg {
  opacity: 1;
}
</style>
