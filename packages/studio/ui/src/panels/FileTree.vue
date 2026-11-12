<script setup lang="ts">
// ui/src/panels/FileTree.vue —— 左栏目录树（决策 #1247 从 CodePanel.vue 拆出）
//
// 【它负责什么】把扁平路径列表画成树（缩进表达层级）、目录两态图标、文件类型图标、
//   以及**树自己的右键菜单**（折叠/打开/复制路径/刷新）。
// 【它不负责什么】读盘、打开文件的副作用（读文件、建 EditorState、切 Diff）——
//   一律 `emit('open')` 交给 CodePanel，因为只有那里持有 EditorView 与缓冲池。
//
// 【两条从真实缺陷换来的约定】
//   ① **不画折叠箭头**（决策 #1238）：目录图标本身就是开关，闭合与展开是两套形状；
//      去掉 12px 箭头后，同级文件名的左边界才真正对齐。
//   ② **布局必须有几何判据**（决策 #1218 的教训）：文件树宽度/行高变化会被判据 ㉓ 盯住。
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { buildTree, flatten, toggleCollapsed, type TreeNode } from '../fileTree'
import { diagList, diagStale } from '../diag'
import { useWorkspaceState } from '../useWorkspaceState'
import { git } from '../git'
import { openMenu } from '../contextmenu'
import FileIcon from '../icons/FileIcon.vue'
import FolderIcon from '../icons/FolderIcon.vue'
import { fileTypeIcon } from '../fileIcons'
import type { FileOp, FileOpKind } from '../fileOps'
import { fileStat, type FileStat } from '../bridge'
import FileHoverCard from './FileHoverCard.vue'
import SymbolPanel from './SymbolPanel.vue'

const props = defineProps<{
  files: string[]
  cur: string
}>()
const emit = defineEmits<{
  open: [path: string]
  copy: [path: string]
  refresh: []
  /** 新建/重命名/删除：这里只发意图，写盘与二次确认在 `fileOps.ts` */
  ops: [op: FileOp]
}>()

const ws = useWorkspaceState()
/* ★文件树上的改动徽标（决策 #1404）：`git_status` 已经是**只读**查询（决策 #1246 的安全边界：
   只跑 status/rev-parse/show，永不 stage/commit），所以这里只是把它显示到树上。
   用 Map 而不是每次 find：树有上千行，render 里线性查会明显卡。 */
const gitMark = computed(() => {
  const m = new Map<string, string>()
  for (const f of git.value?.files ?? []) m.set(f.path, f.status)
  return m
})
const mark = (p: string) => gitMark.value.get(p) ?? ''

/* ★决策 #1492：树行显示**该文件的诊断数**（错误红 / 警告黄）。
   【为什么要它】错误现在只在打开文件后才看得见 —— 用户得"逐个文件点进去"才知道哪里红了。
     树行给出计数，是"从全局看哪儿有问题"的最低成本形态。
   【★为什么 stale 时全部不显示】诊断读的是**磁盘**，编辑器里有未保存改动时它对应旧内容；
     与编辑器里"错位就不画"是同一条规则（diag.ts 的 `diagStale`）。 */
const diagMark = computed(() => {
  const m = new Map<string, { e: number; w: number }>()
  if (diagStale.value) return m
  for (const d of diagList.value) {
    const cur = m.get(d.path) ?? { e: 0, w: 0 }
    if (d.severity === 'warning') cur.w += 1
    else cur.e += 1
    m.set(d.path, cur)
  }
  return m
})

const tree = computed(() => buildTree(props.files))
const rows = computed(() => flatten(tree.value, ws.codeCollapsed))

/* ★文件树过滤（决策 #1406）：仓库上千文件时，靠折叠点进去找太慢。
   过滤时改为**平铺匹配文件**（全路径），不再维护"过滤后的树形"——
   树形过滤要处理"父目录保留但只剩一个子项"的合并规则，复杂度远高于收益。 */
const q = ref('')
const filteredRows = computed(() => {
  const needle = q.value.trim().toLowerCase()
  if (!needle) return rows.value
  return props.files
    .filter((f) => f.toLowerCase().includes(needle))
    .slice(0, 300)
    .map((f) => ({ node: { path: f, name: f.slice(f.lastIndexOf('/') + 1), dir: false, children: [] } as TreeNode, depth: 0 }))
})

function toggle(dir: string) {
  toggleCollapsed(dir, ws.codeCollapsed)
}

/** 树行图标：目录分展开/折叠；文件按扩展名取类型图标与类型色 */
function nodeIcon(node: { path: string; dir: boolean }): { name: string; color?: string } {
  if (node.dir) return { name: ws.codeCollapsed.includes(node.path) ? 'folder' : 'folderOpen' }
  const t = fileTypeIcon(node.path)
  return t ? { name: t.icon, color: t.color } : { name: 'file' }
}

/* ===== 悬停属性预览（决策 #1474 · 交互化改造 #1478）=====
 *
 * 【四条约定，都被既有缺陷教过】
 *   ① **250ms 才出现**：鼠标扫过整棵树时不该连续弹卡（那是噪音不是信息）。
 *   ② **锚定行矩形，不跟鼠标**（#1421）：跟随鼠标重定位会让卡片在相邻两行间闪跳。
 *   ③ **滚轮即收起**：卡片位置是屏幕坐标，树一滚就错位；收起比"跟着重算"更简单也更稳。
 *   ④ **★离开后延迟 220ms 才消失**（#1478 推翻了原先的"立即消失"）：
 *      行与卡片之间隔着 8px 缝，鼠标穿过去时**先触发行的 mouseleave**。立即消失 ⇒
 *      卡片在你够到它之前就没了，「折叠展开 / 一键复制」这类卡内交互**无从谈起**。
 *      220ms 够穿过 8px，又短到不会在扫树时留残影。
 *      —— 这是"内容越丰富 → 越需要被点到"的直接结果，不是妥协。
 *
 * 【缓存】同一路径只查一次。文件改动后缓存会短暂过期——可接受：悬停只是提示，
 *   真正的内容以打开后的编辑器为准。
 */
const HOVER_DELAY = 250
/** 离开行/卡片后到真正消失的宽限（见约定 ④） */
const HIDE_GRACE = 220
const hoverPath = ref('')
const hoverAnchor = ref<{ top: number; left: number; right: number } | null>(null)
const hoverStat = ref<FileStat | null>(null)
let hoverTimer: ReturnType<typeof setTimeout> | null = null
let hideTimer: ReturnType<typeof setTimeout> | null = null
const statCache = new Map<string, FileStat>()

/**
 * 悬停卡要显示的 Git 信息（决策 #1477）。
 * ★**零额外 I/O**：全部来自 `git` 这个已经拉过的 ref（树加载/手动刷新时拉的），
 *   悬停只是把它读出来。原先的「— 行」那种"额外去查"在这里不存在。
 */
const hoverGit = computed(() => {
  const g = git.value
  if (!g?.isRepo) return null
  return { branch: g.branch, head: g.head, subject: g.subject, ahead: g.ahead, behind: g.behind }
})

function cancelHide() {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
}

/** 立刻收起（滚轮 / Esc / 点了别处）——与 `scheduleHide` 的区别是**不给宽限** */
function clearHover() {
  cancelHide()
  if (hoverTimer) {
    clearTimeout(hoverTimer)
    hoverTimer = null
  }
  hoverPath.value = ''
  hoverAnchor.value = null
  hoverStat.value = null
}

/** 延迟收起（决策 #1478）：离开行或离开卡片后给 220ms 宽限，好让指针走进卡片。
 *  ★决策 #1482：**子面板开着时父面板不自动关**——它是子面板的锚点，
 *    收掉父面板会让第二级浮层变成"凭空出现"，正是用户说的"整套逻辑是分离的"。 */
function scheduleHide() {
  cancelHide()
  hideTimer = setTimeout(() => {
    if (symbolPath.value) return
    clearHover()
  }, HIDE_GRACE)
}

/** 结构面板（决策 #1481 / 级联规则 #1482）
 *  ★锚点取**卡片自己的矩形**：子面板贴着父面板的右边缘展开，两级像台阶一样向右延伸。
 *  ★不再 `clearHover()`：父面板必须留着（上一版把它关掉了，用户当场指出这是分离感）。 */
const symbolPath = ref('')
const symbolAnchor = ref<{ top: number; left: number; right: number } | null>(null)

function openSymbols(p: string) {
  if (symbolPath.value === p) return // 悬停自动触发会重复调用，幂等
  const el = document.getElementById('fileHoverCard')
  const r = el?.getBoundingClientRect()
  symbolAnchor.value = r ? { top: r.top, left: r.left, right: r.right } : hoverAnchor.value
  symbolPath.value = p
}

/** 关子面板：父面板按正常宽限走（指针若还在卡片上，卡片不会消失） */
function closeSymbols() {
  symbolPath.value = ''
  symbolAnchor.value = null
  scheduleHide()
}

function onHover(e: Event, node: TreeNode) {
  cancelHide()
  if (hoverTimer) clearTimeout(hoverTimer)
  /* 换一行 = 换一个文件，旧的子面板必须跟着收掉（它属于上一个文件） */
  if (symbolPath.value && symbolPath.value !== node.path) {
    symbolPath.value = ''
    symbolAnchor.value = null
  }
  const el = e.currentTarget as HTMLElement | null
  if (!el) return
  const r = el.getBoundingClientRect()
  const anchor = { top: r.top, left: r.left, right: r.right }
  hoverTimer = setTimeout(() => {
    hoverPath.value = node.path
    hoverAnchor.value = anchor
    const cached = statCache.get(node.path)
    hoverStat.value = cached ?? null
    if (cached) return
    fileStat(node.path)
      .then((s) => {
        statCache.set(node.path, s)
        /* 只回填**当前仍在悬停的那一项**：慢查询回来时用户可能已经移到别的行了 */
        if (hoverPath.value === node.path) hoverStat.value = s
      })
      .catch(() => {
        /* 读不到就不显示数字。悬停是**非显式动作**，不该弹错误打扰用户 */
      })
  }, HOVER_DELAY)
}

/* 卡片一旦可交互，就必须给它**明确的退出方式**（决策 #1478）：
   Esc 关、点别处关。否则用户只能靠把鼠标甩到很远来关它——那是"隐藏功能"。 */
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && hoverPath.value) clearHover()
}

function onDocPointerDown(e: Event) {
  if (!hoverPath.value) return
  const t = e.target as Element | null
  /* ★决策 #1482：**整条链路**内的点击都不算"点别处"——卡片和子面板都要排除。
     只排除卡片的话，点结构面板里的 ✕ / 符号条目会先把卡片干掉（门禁 ㊿o 抓到的真缺陷）。 */
  if (t?.closest?.('#fileHoverCard, #symbolPanel')) return
  clearHover()
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  document.addEventListener('pointerdown', onDocPointerDown, true)
})

onBeforeUnmount(() => {
  if (hoverTimer) clearTimeout(hoverTimer)
  if (hideTimer) clearTimeout(hideTimer)
  window.removeEventListener('keydown', onKeydown)
  document.removeEventListener('pointerdown', onDocPointerDown, true)
})

function onNodeMenu(e: MouseEvent, node: TreeNode) {
  const collapsed = ws.codeCollapsed.includes(node.path)
  openMenu(
    e,
    [
      node.dir
        ? { id: 'toggle', label: collapsed ? '展开目录' : '折叠目录' }
        : { id: 'open', label: '打开' },
      { id: 's0', label: '', sep: true },
      /* 决策 #1460：写操作不在这里做，只把「命中节点 + 鼠标锚点」上抛 */
      { id: 'createFile', label: '新建文件…' },
      { id: 'createDir', label: '新建文件夹…' },
      { id: 's1', label: '', sep: true },
      { id: 'rename', label: '重命名…' },
      { id: 'delete', label: '删除…', danger: true },
      { id: 's2', label: '', sep: true },
      { id: 'copyPath', label: '复制相对路径' },
      { id: 'refresh', label: '刷新文件树' },
    ],
    (id) => {
      if (id === 'toggle') toggle(node.path)
      else if (id === 'open') emit('open', node.path)
      else if (id === 'copyPath') emit('copy', node.path)
      else if (id === 'refresh') emit('refresh')
      else if (id === 'createFile' || id === 'createDir' || id === 'rename' || id === 'delete') {
        emit('ops', { kind: id as FileOpKind, path: node.path, dir: node.dir, x: e.clientX, y: e.clientY })
      }
    },
  )
}
</script>

<template>
  <div class="ffilter">
    <input
      id="fileFilter"
      v-model="q"
      placeholder="过滤文件（按路径）"
      spellcheck="false"
      @keydown.esc.prevent="q = ''"
    />
    <span v-if="q" class="fcount">{{ filteredRows.length }}</span>
  </div>
  <nav class="files" id="codeFiles" @scroll.passive="clearHover">
    <button
      v-for="r in filteredRows"
      :key="r.node.path"
      :class="{ on: r.node.path === cur, dir: r.node.dir, peek: hoverPath === r.node.path }"
      :style="{ paddingLeft: `${8 + r.depth * 14}px` }"
      :data-dir="r.node.dir ? r.node.path : undefined"
      :data-file="r.node.dir ? undefined : r.node.path"
      :aria-expanded="r.node.dir ? !ws.codeCollapsed.includes(r.node.path) : undefined"
      :data-icon="nodeIcon(r.node).name"
      @click="r.node.dir ? toggle(r.node.path) : emit('open', r.node.path)"
      @mouseenter="onHover($event, r.node)"
      @mouseleave="scheduleHide"
      @focus="onHover($event, r.node)"
      @blur="scheduleHide"
      @contextmenu.prevent.stop="onNodeMenu($event, r.node)"
    >
      <FolderIcon v-if="r.node.dir" :open="!ws.codeCollapsed.includes(r.node.path)" :size="16" class="ico" />
      <FileIcon v-else :path="r.node.path" :size="16" class="ico" />
      <span class="name" :title="q ? r.node.path : undefined">{{ q ? r.node.path : r.node.name }}</span>
      <!-- 诊断徽标（决策 #1492）：只在有计数时占位，宽度稳定不跳 -->
      <span
        v-if="!r.node.dir && (diagMark.get(r.node.path)?.e ?? 0) > 0"
        class="dg err"
        :title="`${diagMark.get(r.node.path)!.e} 个错误`"
        >{{ diagMark.get(r.node.path)!.e }}</span
      >
      <span
        v-if="!r.node.dir && (diagMark.get(r.node.path)?.w ?? 0) > 0"
        class="dg warn"
        :title="`${diagMark.get(r.node.path)!.w} 个警告`"
        >{{ diagMark.get(r.node.path)!.w }}</span
      >
      <span v-if="!r.node.dir && mark(r.node.path)" class="gst" :data-s="mark(r.node.path)">{{
        mark(r.node.path)
      }}</span>
    </button>
  </nav>

  <!-- 悬停预览卡：Teleport 到 body —— 布局里若有 transform/filter，`position: fixed` 会
       退化成相对该祖先定位（卡片错位到树里）。挂到 body 下才真正相对视口。
       ★卡片**接收鼠标**（决策 #1478）：指针进卡就取消收起，出去才重新计时——
         这是"卡内可交互"（折叠展开 / 一键复制）的前提。 -->
  <Teleport to="body">
    <FileHoverCard
      v-if="hoverPath"
      :path="hoverPath"
      :stat="hoverStat"
      :anchor="hoverAnchor"
      :git="hoverGit"
      :mark="mark(hoverPath)"
      :active="!!symbolPath && symbolPath === hoverPath"
      @mouseenter="cancelHide"
      @mouseleave="scheduleHide"
      @more="openSymbols"
    />
  </Teleport>

  <!-- 结构大纲面板（决策 #1481 · 级联定位 #1482）：锚点是卡片自身的矩形 -->
  <SymbolPanel
    v-if="symbolPath"
    :path="symbolPath"
    :anchor="symbolAnchor"
    @close="closeSymbols"
  />
</template>

<style scoped>
/* 目录树（次级侧栏）：行高 24px，落在 4px 网格上 */
.files {
  width: 100%;
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--sp1) 0;
}
.ffilter {
  position: relative;
  display: flex;
  align-items: center;
  padding: var(--sp1) var(--sp2) 2px;
}
.ffilter input {
  flex: 1;
  min-width: 0;
  height: 20px;
  padding: 0 5px;
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  background: var(--bg-canvas);
  color: var(--fg);
  font: inherit;
  font-size: 11px;
  outline: none;
}
.ffilter input:focus { border-color: var(--accent); }
.fcount { margin-left: 5px; font-size: 10px; color: var(--fg-subtle); }

.gst {
  margin-left: auto;
  padding-left: 6px;
  font-size: 10px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  opacity: .95;
}
.gst[data-s='M'] { color: #e0b341; }
.gst[data-s='A'] { color: #4ade80; }
.gst[data-s='D'] { color: #f87171; }
.gst[data-s='R'] { color: #60a5fa; }
.gst[data-s='U'] { color: #c084fc; }
.gst[data-s='?'] { color: var(--fg-subtle); }

/* 诊断徽标（决策 #1492）：极简 —— 无底色方块，只有数字 + 语义色，紧贴名字右侧 */
.dg {
  flex: none;
  min-width: 12px;
  height: 14px;
  padding: 0 3px;
  border-radius: 3px;
  font-size: 9px;
  font-variant-numeric: tabular-nums;
  line-height: 14px;
  text-align: center;
}
.dg.err {
  color: var(--bad);
  background: color-mix(in srgb, var(--bad) 16%, transparent);
}
.dg.warn {
  color: var(--warn, #d29922);
  background: color-mix(in srgb, var(--warn, #d29922) 16%, transparent);
}
.files button {
  display: flex;
  align-items: center;
  gap: var(--sp1);
  width: 100%;
  /* ★决策 #1485：与大纲面板同一档（标准 24px）—— 两处列表的 hover 背景块必须等高 */
  height: var(--row-h, 24px);
  padding-right: var(--sp2);
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--fg-muted);
  font: var(--fs-xs) / 24px ui-monospace, SFMono-Regular, Menlo, monospace;
  text-align: left;
  cursor: pointer;
  transition:
    background var(--dur) var(--ease),
    color var(--dur) var(--ease);
}
.files button:hover {
  background: var(--bg-overlay);
  color: var(--fg);
}
/* ★决策 #1480：卡片打开期间，被预览的那一行要保持高亮。
   原因：指针移进卡片后行就不再 `:hover`，原来的高亮一消失，用户会瞬间失去
   "我正在看哪一条"的锚点——尤其卡片内容变多、视线离开树之后更容易迷路。 */
.files button.peek {
  background: var(--bg-overlay);
  color: var(--fg);
}
.files button.on {
  background: var(--bg-elevated);
  color: var(--fg);
  /* 选中态：左侧 2px 强调条（与活动栏同一套语汇，不靠"变亮"单维度区分） */
  box-shadow: inset 2px 0 0 var(--accent);
}
.files button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.files button.dir {
  color: var(--fg);
}
.ico {
  flex: none;
  opacity: 0.8;
}
.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
