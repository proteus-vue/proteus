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
//   ③ **不做动画淡出**：淡出期间卡片仍会挡住下一行的点击 —— 这条**仍然成立**，
//      但"离开即消失"已被决策 #1478 改成"离开 220ms 后才消失"（卡片要能被指针够到）。
//      两者不冲突：宽限期只有 220ms，且没有视觉动画。
//
// 【数据是异步的】`file_stat` 是一次 IPC。为了不"先空后跳"，卡片**立刻**用已知信息
//   （文件名/路径）渲染骨架，stat 回来后再填数字——宁可短暂显示"—"，也不让卡片高度抖动。
import { computed, onBeforeUnmount } from 'vue'
import type { FileStat } from '../bridge'
import { placeBeside } from '../popover'
import StudioIcon from '../icons/StudioIcon.vue'

const props = defineProps<{
  /** 悬停项的仓库内相对路径 */
  path: string
  /** stat 结果（未回来时 null） */
  stat: FileStat | null
  /** 悬停行的矩形（锚点） */
  anchor: { top: number; left: number; right: number } | null
  /** Git 仓库级信息（决策 #1477）。★来自**已拉过**的 `git` ref ⇒ 悬停零额外 I/O */
  git: { branch: string; head: string; subject: string; ahead: number; behind: number } | null
  /** 该路径在 git 里的状态码（M/A/D/R/U/?）；空串 = 干净 */
  mark: string
}>()

/** 决策 #1481：`more` = 点箭头要看**完整结构清单**（卡片只给总览，清单交给面板） */
const emit = defineEmits<{ more: [path: string] }>()

/** 决策 #1482：整行触发，不必瞄准 16px 按钮。
 *  悬停停留时长刻意比卡片出现的 250ms 更长（380ms）——否则鼠标扫过这一行
 *  就会误弹出下一个面板，那是噪音。 */
const MORE_DWELL = 380
let moreTimer: ReturnType<typeof setTimeout> | null = null
function armMore() {
  disarmMore()
  moreTimer = setTimeout(() => emit('more', props.path), MORE_DWELL)
}
function disarmMore() {
  if (moreTimer) {
    clearTimeout(moreTimer)
    moreTimer = null
  }
}
onBeforeUnmount(disarmMore)

/** 卡片宽度：与文件树 240px 量级匹配，但不跟着树宽变（避免窄树里折行） */
const W = 272
/** 高度估算值：只用于"底部放不下就上移"，误差靠 max-height + 滚动兜底 */
const EST_H = 140

const pos = computed(() => {
  const a = props.anchor
  if (!a) return { left: -9999, top: -9999 }
  /* ★位置规则统一走 `placeBeside`（决策 #1482）：卡片与结构面板共用同一套"紧挨触发入口"
     的模型。以前这里是手写的一份，结构面板又固定在右上角——两份规则必然分离。 */
  return placeBeside(a, { w: W, h: EST_H })
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

/* ===== 文件角色 + 结构摘要（决策 #1476）=====
 * 「鼠标一扫就知道这文件的大概」：角色回答"要不要打开它"，结构回答"打开会看到什么"。
 * ★普通源码没有 brief（Rust 侧就不生成）——绝大多数文件都是源码，每张卡都写"源码"是噪音。
 */
const brief = computed(() => props.stat?.brief ?? null)

/* ===== Git（决策 #1477）=====
 * 用户："git 分支提交信息感觉也可以放上去吧？这个应该没有任何 I/O 消耗"。
 * ★前半句对、后半句要修正：**悬停本身确实零 I/O**——数据来自 `git` 这个 ref，
 *   树加载/手动刷新时拉过一次。但 `git status` 的输出里**没有提交标题**，
 *   标题要单独一次 `git log -1`。那一次被挪到**刷新时**，不是每次悬停。
 */
const gitInfo = computed(() => props.git)

/** 追踪信息：短哈希 + 领先/落后。没有 HEAD（unborn）就只有分支名 */
const track = computed(() => {
  const g = gitInfo.value
  if (!g) return ''
  const bits: string[] = []
  if (g.head) bits.push(g.head)
  if (g.ahead > 0) bits.push(`↑${g.ahead}`)
  if (g.behind > 0) bits.push(`↓${g.behind}`)
  return bits.join(' · ')
})

/** 状态码 → 人话。与文件树上那个 M/A/D 徽标是同一个来源（`git.files`） */
const markLabel = computed(() => {
  switch (props.mark) {
    case 'M':
      return '已修改'
    case 'A':
      return '新增'
    case 'D':
      return '已删除'
    case 'R':
      return '重命名'
    case 'U':
      return '有冲突'
    case '?':
      return '未跟踪'
    default:
      return ''
  }
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

      <!-- 文件：角色 / 结构 / 行数+大小 / 修改时间 / 类型；敏感文件单独一行 -->
      <template v-else>
        <!-- 角色：只在不普通时出现（测试/入口/配置/文档/生成物）。
             ★普通源码的 label 是空串（决策 #1479）——那时只显示下面的「结构」行。 -->
        <div v-if="brief?.label" class="fv-row">
          <StudioIcon name="tag" :size="13" />
          <span class="fv-k">角色</span>
          <span class="fv-v">{{ brief.label }}</span>
        </div>
        <!-- 结构：短统计渲染成小标签（决策 #1480）——原先统计与符号挤在一行被截断，
             用户反馈"实用性不大"：数字看不到全貌、符号只露半截。 -->
        <div v-if="brief?.chips?.length" class="fv-row">
          <StudioIcon name="rows" :size="13" />
          <span class="fv-k">结构</span>
          <span class="fv-v chips">
            <span v-for="c in brief.chips" :key="c" class="chip">{{ c }}</span>
          </span>
        </div>
        <!-- 符号名单独一行、**允许换行**（monospace 淡色），不再被 ellipsis 吃掉 -->
        <div
          v-if="brief?.names?.length"
          class="fv-row more"
          role="button"
          tabindex="0"
          :title="`点击或悬停 ${MORE_DWELL}ms 打开结构面板`"
          @click="emit('more', path)"
          @keydown.enter.prevent="emit('more', path)"
          @mouseenter="armMore"
          @mouseleave="disarmMore"
        >
          <span class="fv-k" />
          <span class="fv-v names">
            {{ brief.names.join(' · ') }}
            <span v-if="brief.names_total > brief.names.length" class="fv-sub"
              >+{{ brief.names_total - brief.names.length }}</span
            >
          </span>
          <!-- ★决策 #1482：箭头只是"这里还有下一级"的视觉提示，整行都能点/能悬停，
               不再强迫用户去瞄准一个 16px 的按钮。 -->
          <button
            class="fv-more"
            title="打开结构面板（完整清单）"
            aria-label="打开结构面板"
            @click.stop="emit('more', path)"
          >
            ›
          </button>
        </div>
        <!-- 句子型事实（`.md` 标题骨架）：它不是一个"标签"，所以单独成行 -->
        <div v-if="brief?.facts?.length" class="fv-row">
          <StudioIcon name="rows" :size="13" />
          <span class="fv-k">骨架</span>
          <span class="fv-v">{{ brief.facts.join(' · ') }}</span>
        </div>
        <div class="fv-row">
          <StudioIcon name="rows" :size="13" />
          <span class="fv-k">规模</span>
          <span class="fv-v">
            <template v-if="stat">
              <!-- ★决策 #1476：不再用「—」——那个占位符会被读成"1 行"。
                   超过 8MB 明确说"未统计"，宁可承认没数，也不给一个可被误解的符号。 -->
              {{ stat.lines === null ? '未统计' : `${stat.lines} 行` }}
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

      <!-- Git（决策 #1477）：放在最后 —— 分支/提交是**仓库级**信息，
           对"这是什么文件"只是背景，不该压住角色与规模。
           ★文件与目录都显示：分支对"看这个目录"同样有意义。 -->
      <div v-if="gitInfo" class="fv-row">
        <StudioIcon name="branch" :size="13" />
        <span class="fv-k">分支</span>
        <span class="fv-v">
          {{ gitInfo.branch || '(游离 HEAD)' }}
          <span v-if="track" class="fv-sub">{{ track }}</span>
        </span>
      </div>
      <div v-if="gitInfo?.subject" class="fv-row">
        <StudioIcon name="record" :size="13" />
        <span class="fv-k">提交</span>
        <span class="fv-v">
          {{ gitInfo.subject }}
          <span class="fv-sub">{{ gitInfo.head }}</span>
        </span>
      </div>
      <div v-if="markLabel" class="fv-row">
        <StudioIcon name="record" :size="13" />
        <span class="fv-k">变更</span>
        <span class="fv-v">{{ markLabel }}</span>
      </div>
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
  /* ★决策 #1478：卡片**吃鼠标**了。原来 `pointer-events: none` 是为了"不吃鼠标也不挡相邻行"，
     但那也意味着卡内永远不可能有按钮。现在改为可交互 + FileTree 侧 220ms 宽限：
     指针离开行/卡片后延迟收起，既不闪退也不会一直挂着。
     ★代价如实说：窗口窄、卡片翻到左侧时会盖住行；靠"移开即收 + Esc + 点别处"退出。 */
  pointer-events: auto;
  cursor: default;
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
/* 结构小标签（决策 #1480）：横排；放不下就换行，但**每个标签自己不断行** */
.fv-v.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  overflow: visible;
  white-space: normal;
}
.chip {
  padding: 0 5px;
  border-radius: 4px;
  background: var(--bg-overlay);
  color: var(--fg-muted);
  font-size: 10px;
  line-height: 1.6;
  font-variant-numeric: tabular-nums;
}
/* 符号名：**允许换行**（等宽淡色），不再被 ellipsis 吃掉半截（#1480） */
.fv-v.names {
  overflow: visible;
  color: var(--fg-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10.5px;
  line-height: 1.45;
  white-space: normal;
  word-break: break-word;
}
/* 箭头入口（决策 #1481）：卡片里唯一的按钮，右侧贴边，小到不抢注意力 */
.fv-more {
  flex: none;
  width: 16px;
  height: 16px;
  margin-left: 2px;
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  background: transparent;
  color: var(--fg-subtle);
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
}
.fv-more:hover {
  border-color: var(--accent);
  background: var(--bg-overlay);
  color: var(--fg);
}
/* ★决策 #1482：符号行**整行都是触发区**（把手/箭头只是提示）。
   之前只有 16px 的按钮能点，用户说"太固化"——命中面积太小本身就是缺陷。 */
.fv-row.more {
  margin: 0 calc(-1 * var(--sp3));
  padding: 0 var(--sp3);
  border-radius: 5px;
  cursor: pointer;
}
.fv-row.more:hover {
  background: var(--bg-overlay);
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
