#!/usr/bin/env node
// scripts/gen-component-demo-pages.mjs —— ★组件详情页批量生成（showcase）
//
// 背景（2026-09-24）：showcase 组件详情页 26/73，其中 API 表**逐页手写**——与组件源码是
//   两份事实，源码改了页面不会红（静默漂移）。本脚本把两组数据分开取源：
//     · **演示**（demo/buttons/state）——页面的价值所在，逐组件手写（无法机械化：要选有代表性的用法）
//     · **API 表**（Props / Events / 插槽 / 兼容进度）——**从官网内容 SSOT 解析**
//       （`website/content/components/<tag>.md`，而该 md 本身由 `gen-content.mjs` 从
//       `packages/components/<tag>/index.vue` 的 defineProps/defineEmits/JSDoc 生成）
//   ⇒ 一条链：组件源码 → 官网 md → 本脚本 → showcase 页面。组件改了，`check:content` 与
//     `check:component-demo` 两道门禁都会红，页面不可能再「悄悄过时」。
//
// ★诚实边界：只为**已存在源码、且 API 可从官网内容解析**的组件生成；解析失败即报错退出，
//   不产出空壳 API 表（宁缺勿假）。
//
// 用法：node scripts/gen-component-demo-pages.mjs [--check]
//   --check：只校验已生成的页与数据表一致（漂移 exit 1），供 CI 使用。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CONTENT_DIR = path.join(ROOT, 'website', 'content', 'components')
const OUT_DIR = path.join(ROOT, 'showcase', 'subpackages', 'components', 'pages')
const check = process.argv.includes('--check')

// ───────────────────────── ① 官网内容解析（API 表的数据源） ─────────────────────────

/** 按 `|` 切分 markdown 表格行，**跳过行内代码里的 `|`**（如 `{a: string \| null}`） */
function splitRow(line) {
  const cells = []
  let cur = ''
  let inCode = false
  for (const ch of line.trim()) {
    if (ch === '`') {
      inCode = !inCode
      cur += ch
    } else if (ch === '|' && !inCode) {
      cells.push(cur)
      cur = ''
    } else cur += ch
  }
  cells.push(cur)
  let out = cells.map((c) => c.trim())
  if (out[0] === '') out = out.slice(1)
  if (out[out.length - 1] === '') out = out.slice(-1) === '' ? out.slice(0, -1) : out
  return out
}

/** 表格分隔行（|---|:--:|）判定 */
const isSeparator = (cells) => cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c.replace(/\s/g, '')))

/** 反引号包裹 → 裸文本；\| → | ；去 markdown 链接 */
function cleanCell(s) {
  return s
    .replace(/\\\|/g, '|')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .trim()
}

/**
 * 抽取 `## <section>` 下的全部表格行（返回 [[cell,...], ...]，含表头）。
 * ★并列多个表格时全部拼接——回显区/多表 section 不丢数据。
 */
function extractSectionTables(md, section) {
  const lines = md.split('\n')
  const start = lines.findIndex((l) => l.trim() === `## ${section}`)
  if (start < 0) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) {
      end = i
      break
    }
  }
  const rows = []
  for (const line of lines.slice(start + 1, end)) {
    if (!line.trim().startsWith('|')) continue
    const cells = splitRow(line)
    if (cells.length === 0) continue
    rows.push(cells)
  }
  if (rows.length === 0) return null
  // 去表头 + 分隔行
  const body = rows.filter((c) => !isSeparator(c))
  return body.length > 1 ? body.slice(1) : []
}

/** 读组件在官网内容里的标题（`title: p-xxx` + 一句话描述） */
function parseFrontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---/)
  const out = {}
  if (!m) return out
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([a-zA-Z]+):\s*(.*)$/)
    if (kv) out[kv[1]] = kv[2].trim()
  }
  return out
}

/** 组件一句话描述（`# p-xxx` 后的第一段非空行） */
function parseDesc(md) {
  const lines = md.split('\n')
  const i = lines.findIndex((l) => /^# /.test(l))
  if (i < 0) return ''
  for (let j = i + 1; j < lines.length; j++) {
    const t = lines[j].trim()
    if (!t || t.startsWith('>') || t.startsWith('|') || t.startsWith('#') || t.startsWith('---')) continue
    return t.replace(/^[*_`]+|[*_`]+$/g, '')
  }
  return ''
}

/**
 * 从官网内容解析一个组件的 API 三表 + 兼容进度。
 * 返回 null = 该组件无内容页（调用方报错，不产空壳）。
 */
function loadApi(tag) {
  const file = path.join(CONTENT_DIR, `${tag}.md`)
  if (!fs.existsSync(file)) return null
  const md = fs.readFileSync(file, 'utf-8')
  const props = extractSectionTables(md, 'Props')
  if (props === null) return null // 无 Props 表 = 内容页不完整，拒绝产出
  const events = extractSectionTables(md, 'Events') ?? []
  const slots = extractSectionTables(md, '插槽') ?? []
  const compat = extractSectionTables(md, '兼容进度') ?? []
  const fm = parseFrontmatter(md)
  return {
    title: fm.title || tag,
    desc: parseDesc(md),
    // ★只取前 3 列（属性/说明/类型）——api-table 是三元组契约；官网表第 4/5 列为默认值/必填
    props: props.map((r) => [cleanCell(r[0] ?? ''), cleanCell(r[1] ?? ''), cleanCell(r[2] ?? '')]),
    events: events.map((r) => [cleanCell(r[0] ?? ''), cleanCell(r[1] ?? ''), cleanCell(r[2] ?? '')]),
    slots: slots.map((r) => [cleanCell(r[0] ?? ''), cleanCell(r[1] ?? ''), '—']),
    compat: compat.map((r) => [cleanCell(r[0] ?? ''), cleanCell(r[1] ?? ''), cleanCell(r[2] ?? '')]),
  }
}

// ───────────────────────── ② 页面数据表（演示逐组件手写） ─────────────────────────

/**
 * 页面数据表。`demo` = 演示模板片段（写进 #demo 插槽），`state`/`logic` = script 里的
 * 响应式状态与逻辑，`codes` = 各演示块的代码片段（★放 data 而非模板字面量：含 < > " 会破坏 WXML 解析）。
 * API 三表**不在此处**——由 loadApi() 从官网内容解析（见文件头）。
 */
const PAGES = [
  {
    file: 'p-box',
    title: 'p-box 原子容器',
    subtitle: '布局原语 · layout.box · 双端同源码',
    state: `const inBox = ref('内容自适应（未设比例）')`,
    codes: [
      ['aspect', `<!-- 16:9 比例容器 -->\n<p-box aspect-ratio="16/9">\n  <p-text>16:9</p-text>\n</p-box>`],
      ['clip', `<!-- 裁剪溢出内容 -->\n<p-box overflow="hidden">\n  <p-text>超长内容被裁剪</p-text>\n</p-box>`],
    ],
    demos: [
      {
        title: '宽高比（aspectRatio）',
        desc: 'aspectRatio="16/9" → 固定比例的盒子；★诚实边界：Skyline 无 aspect-ratio → 降级为不约束（内容撑高）',
        code: 0,
        demo: `<p-box class="box-aspect" aspect-ratio="16/9">
            <p-text>16 : 9</p-text>
          </p-box>`,
      },
      {
        title: '溢出裁剪（overflow）',
        desc: 'overflow="hidden" → 超出容器的内容被裁剪（★两端同语义）',
        code: 1,
        demo: `<p-box class="box-clip" overflow="hidden">
            <p-text>{{ inBox }}</p-text>
          </p-box>`,
      },
    ],
    styles: `.box-aspect { background: #eef2ff; border: 1px solid #d6ddff; border-radius: var(--sp-radius-sm); align-items: center; justify-content: center; }
.box-clip { background: #fff7ed; border: 1px solid #fed7aa; border-radius: var(--sp-radius-sm); height: 44px; padding: var(--sp-2); }`,
  },
  {
    file: 'p-spacer',
    title: 'p-spacer 弹性空白',
    subtitle: '布局原语 · layout.spacer · 双端同源码',
    state: `const spacerGrow = ref(1)`,
    codes: [
      ['basic', `<!-- 撑开左右两侧：把中间内容推向另一侧 -->\n<p-stack direction="row">\n  <p-text>左</p-text>\n  <p-spacer />\n  <p-text>右</p-text>\n</p-stack>`],
      ['grow', `<!-- 按比例分配剩余空间（grow=2 : grow=1） -->\n<p-spacer :grow="2" />\n<p-spacer :grow="1" />`],
    ],
    demos: [
      {
        title: '撑开两侧（默认 grow=1）',
        desc: '弹性占用剩余空间（对齐 flex:1）——把后一个元素推到容器另一端',
        code: 0,
        demo: `<p-stack class="row-demo" direction="row">
            <p-text class="chip">左</p-text>
            <p-spacer />
            <p-text class="chip">右（被推到末端）</p-text>
          </p-stack>`,
        hasOutput: true,
        output: '左 / 右 分居两端——中间的 p-spacer 吃掉了全部剩余空间',
      },
      {
        title: '按比例分配（grow）',
        desc: '两个 spacer 的 grow 为 2:1 → 剩余空间按比例切分',
        code: 1,
        demo: `<p-stack class="row-demo" direction="row">
            <p-text class="chip">A</p-text>
            <p-spacer :grow="2" />
            <p-text class="chip">B</p-text>
            <p-spacer :grow="1" />
            <p-text class="chip">C</p-text>
          </p-stack>`,
      },
    ],
    styles: `.row-demo { background: #f7f8fa; border-radius: var(--sp-radius-sm); padding: var(--sp-2); }
.chip { background: #eef2ff; border-radius: var(--sp-radius-sm); padding: 4px 8px; }`,
  },
  {
    file: 'p-heading',
    title: 'p-heading 标题',
    subtitle: 'UI 原语 · ui.heading · 双端同源码',
    state: ``,
    codes: [['levels', `<!-- level 1-6：字号递减 -->\n<p-heading :level="1">一级标题</p-heading>\n<p-heading :level="3">三级标题</p-heading>`]],
    demos: [
      {
        title: '六个级别（level 1-6）',
        desc: '语义级标题（对齐 h1-h6）——★用 class 表达级别而非动态标签（MP 编译器不支持动态标签名）',
        code: 0,
        demo: `<p-stack :gap="6">
            <p-heading :level="1">一级 24px</p-heading>
            <p-heading :level="2">二级 20px</p-heading>
            <p-heading :level="3">三级 17px</p-heading>
            <p-heading :level="4">四级 15px</p-heading>
            <p-heading :level="5">五级 13px</p-heading>
            <p-heading :level="6">六级 12px</p-heading>
          </p-stack>`,
        hasOutput: true,
        output: '★级别越界自动收敛：level 0 → 1、level 9 → 6（源码 Math.min/max 钳制）',
      },
    ],
    styles: ``,
  },
  {
    file: 'p-divider',
    title: 'p-divider 分隔线',
    subtitle: '布局原语 · layout.divider · 双端同源码',
    state: ``,
    codes: [
      ['h', `<!-- 水平分隔线（默认） -->\n<p-divider />\n<!-- 带内缩 -->\n<p-divider :inset="12" />`],
      ['v', `<!-- 垂直分隔线：左右内缩 -->\n<p-divider orientation="vertical" :inset="8" />`],
    ],
    demos: [
      {
        title: '水平分隔（含 inset 内缩）',
        desc: 'inset 为上下外边距——拉开与上下内容的距离',
        code: 0,
        demo: `<p-text>上方内容</p-text>
          <p-divider />
          <p-text>默认分隔（inset 0）</p-text>
          <p-divider :inset="12" />
          <p-text>下方内容（分隔线上下各留 12px）</p-text>`,
      },
      {
        title: '垂直分隔（行内）',
        desc: 'orientation="vertical" → 高度 100%、左右 inset；用于行内元素之间',
        code: 1,
        demo: `<p-stack direction="row" align="center" class="row-demo">
            <p-text>首页</p-text>
            <p-divider orientation="vertical" :inset="8" />
            <p-text>分类</p-text>
            <p-divider orientation="vertical" :inset="8" />
            <p-text>我的</p-text>
          </p-stack>`,
      },
    ],
    styles: `.row-demo { background: #f7f8fa; border-radius: var(--sp-radius-sm); padding: var(--sp-2); }`,
  },
  {
    file: 'p-stack',
    title: 'p-stack 弹性栈',
    subtitle: '布局原语 · layout.stack · 双端同源码',
    state: `const snapMode = ref('none')`,
    codes: [
      ['column', `<!-- 纵向排列 + 间距 -->\n<p-stack direction="column" :gap="8">\n  <p-text>一</p-text>\n  <p-text>二</p-text>\n</p-stack>`],
      ['row', `<!-- 横向 + 自动换行 -->\n<p-stack direction="row" :gap="8" wrap>\n  <p-text>一</p-text><p-text>二</p-text>\n</p-stack>`],
      ['snap', `<!-- 轮播（一维排列 + 吸附）：swiper 的语义消灭形态 -->\n<p-stack direction="row" :gap="8" snap="mandatory">\n  <p-text>卡片 1</p-text>\n  <p-text>卡片 2</p-text>\n</p-stack>`],
    ],
    demos: [
      {
        title: '纵向排列 + 间距',
        desc: 'direction="column"（默认）· gap 控制子项间距',
        code: 0,
        demo: `<p-stack :gap="8">
            <p-text class="chip">第一项</p-text>
            <p-text class="chip">第二项</p-text>
            <p-text class="chip">第三项</p-text>
          </p-stack>`,
      },
      {
        title: '横向 + 自动换行',
        desc: 'direction="row" + wrap → 空间不足自动换行',
        code: 1,
        demo: `<p-stack direction="row" :gap="8" wrap>
            <p-text class="chip">1</p-text>
            <p-text class="chip">2</p-text>
            <p-text class="chip">3</p-text>
            <p-text class="chip">4</p-text>
            <p-text class="chip">5</p-text>
            <p-text class="chip">6</p-text>
            <p-text class="chip">7</p-text>
            <p-text class="chip">8</p-text>
          </p-stack>`,
      },
      {
        title: '吸附与循环（snap / loop）',
        desc: 'snap="mandatory" → 容器转滚动容器 + CSS scroll-snap（轮播）。★诚实边界：MP 端 WXSS 无 scroll-snap → 降级为普通排列并给出可观察提示',
        code: 2,
        demo: `<p-stack class="snap-demo" direction="row" :gap="8" snap="mandatory" :pid="'showcase-stack-snap'">
            <p-text class="card">卡片 1</p-text>
            <p-text class="card">卡片 2</p-text>
            <p-text class="card">卡片 3</p-text>
          </p-stack>`,
        hasOutput: true,
        output: '横向拖动卡片区 → 松手吸附到最近卡片起点（Web）；小程序端为普通排列',
      },
    ],
    styles: `.chip { background: #eef2ff; border-radius: var(--sp-radius-sm); padding: 4px 8px; }
.card { min-width: 140px; background: #eef2ff; border-radius: var(--sp-radius-sm); padding: var(--sp-3); text-align: center; }
.snap-demo { background: #f7f8fa; border-radius: var(--sp-radius-sm); padding: var(--sp-2); }`,
  },
  {
    file: 'p-grid',
    title: 'p-grid 自适应网格',
    subtitle: '布局原语 · layout.grid · Web-only（MP 走语义编译）',
    state: ``,
    codes: [['grid', `<!-- 只声明「每列最小宽度」，列数自动求解 -->\n<p-grid :min-col-width="120" :gap="12">\n  <p-text>1</p-text>\n  <p-text>2</p-text>\n</p-grid>`]],
    demos: [
      {
        title: '自适应列数（minColWidth）',
        desc: 'Web = CSS Grid repeat(auto-fill, minmax(minColWidth, 1fr))——**拖宽窗口看列数变化**；★MP 端已走语义编译（flex 档位 + px basis），本组件是 Web-only',
        code: 0,
        demo: `<p-grid :min-col-width="110" :gap="10">
            <p-text v-for="i in 8" :key="i" class="cell">{{ i }}</p-text>
          </p-grid>`,
        hasOutput: true,
        output: '列数 = floor(容器宽 / minColWidth)——★拖宽/缩窄模拟器视口可看到列数自适应',
      },
    ],
    styles: `.cell { background: #eef2ff; border-radius: var(--sp-radius-sm); padding: var(--sp-3); text-align: center; }`,
  },
  {
    file: 'p-loading',
    title: 'p-loading 加载中',
    subtitle: '业务组件 · 加载态遮罩 · 双端同源码',
    state: `const loadingVisible = ref(false)
/** ★由**页面**控制关闭（组件不自动关闭——这是 p-loading 的设计契约）。
 *  演示按真实用法：显示 1.5s 后由页面收起。★不要做「再点一次关闭」的演示——
 *  遮罩是 fixed 全屏（z-index 1000）会拦截点击，按钮在遮罩后面点不到。 */
function showLoading(): void {
  loadingVisible.value = true
  window.setTimeout(() => {
    loadingVisible.value = false
  }, 1500)
}`,
    codes: [['basic', `<!-- visible 受控；不自动关闭（由页面控制） -->\n<p-loading :visible="loading" text="加载中…" />\n\n// 页面侧：数据就绪后收起\nloading.value = false`]],
    demos: [
      {
        title: '受控显示（visible + text）',
        desc: '★点按钮显示 1.5s 后自动收起（模拟「加载 → 数据就绪 → 页面收起」的真实用法）；组件本身**不自动关闭**',
        code: 0,
        demo: `<p-button size="small" @click="showLoading">显示加载态（1.5s 后收起）</p-button>
          <p-loading :visible="loadingVisible" text="加载中…" />`,
        hasOutput: true,
        output: '★遮罩是 fixed 全屏（阻断交互，这正是加载态的目的）；★加载环用「统一色 border 环 + 随转子元素点」——不用单边异色 border（Skyline 下会渲染成方块，四组对照实验定论）',
      },
    ],
    styles: ``,
  },
  {
    file: 'p-skeleton',
    title: 'p-skeleton 骨架屏',
    subtitle: '业务组件 · 骨架屏 · 双端同源码',
    state: `const skVisible = ref(true)
function toggleSkeleton(): void {
  skVisible.value = !skVisible.value
}`,
    codes: [['basic', `<!-- visible=false → 渲染真实内容（默认插槽） -->\n<p-skeleton :visible="loading" avatar :lines="[90, 70, 80]">\n  <p-text>真实内容</p-text>\n</p-skeleton>`]],
    demos: [
      {
        title: '绑定加载态（visible 切换骨架 / 真实内容）',
        desc: '★点按钮切换：visible=true 显示 shimmer 骨架，false 渲染默认插槽的真实内容——骨架屏的正确用法是「绑定加载态」，不是常驻',
        code: 0,
        demo: `<p-button size="small" @click="toggleSkeleton">{{ skVisible ? '切换到真实内容' : '切换回骨架' }}</p-button>
          <p-skeleton :visible="skVisible" avatar :lines="[90, 70, 80]">
            <p-text>真实内容已就绪（骨架消失）</p-text>
          </p-skeleton>`,
        hasOutput: true,
        output: '★lines 为数组（宽度百分比）——规避 MP `wx:for` 需数组、range 不可用',
      },
    ],
    styles: ``,
  },
  {
    file: 'p-avatar',
    title: 'p-avatar 头像',
    subtitle: 'UI 原语 · ui.avatar · 双端同源码',
    state: ``,
    codes: [
      ['shapes', `<!-- 形状：circle 圆形 / square 圆角方形 -->\n<p-avatar src="/assets/avatar-demo.svg" shape="circle" :size="48" fallback="P" />\n<p-avatar shape="square" :size="48" fallback="方" />`],
      ['fallback', `<!-- 缺图/加载失败 → 显示 fallback 首字符 -->\n<p-avatar fallback="Proteus" :size="48" />\n<p-avatar src="/assets/not-exist.png" fallback="兜底" :size="48" />`],
    ],
    demos: [
      {
        title: '形状与尺寸（shape / size）',
        desc: 'circle 圆形 / square 圆角方形（圆角 = size × 0.2）；size 控制边长',
        code: 0,
        demo: `<p-stack direction="row" :gap="10" align="center">
            <p-avatar src="/assets/avatar-demo.svg" shape="circle" :size="44" fallback="圆" />
            <p-avatar src="/assets/avatar-demo.svg" shape="square" :size="44" fallback="方" />
            <p-avatar shape="circle" :size="36" fallback="小" />
            <p-avatar shape="square" :size="56" fallback="大" />
          </p-stack>`,
      },
      {
        title: '缺图兜底（fallback）',
        desc: '★src 为空 **或图片加载失败** → 显示 fallback 首字符（此前加载失败分支未接模板 → 会显示破图；本批修复并加回归锁）',
        code: 1,
        demo: `<p-stack direction="row" :gap="10" align="center">
            <p-avatar :size="44" fallback="无图" />
            <p-avatar src="/assets/definitely-missing.png" :size="44" fallback="失败" />
          </p-stack>`,
        hasOutput: true,
        output: '左：无 src → 直接兜底；右：图 404 → onError 置 broken → 兜底首字符（非破图）',
      },
    ],
    styles: ``,
  },
  {
    file: 'p-segment',
    title: 'p-segment 分段控制器',
    subtitle: '页面外壳 · shell.segment · 双端同源码',
    state: `const segActive = ref('全部')
const segLast = ref('（暂无）')
const segOptions = ref([
  { label: '全部' },
  { label: '进行中' },
  { label: '已完成' },
])
function onSegSelect(v: unknown): void {
  segLast.value = String(v)
}`,
    codes: [['basic', `<!-- options + v-model:active 受控 -->\n<p-segment :options="options" v-model:active="active" @select="onSelect" />`]],
    demos: [
      {
        title: '受控分段（options + v-model:active + select）',
        desc: '★点选项切换激活态；select 事件回传选中值（载荷两端一致：Web 为裸载荷、MP 为 e.detail）',
        code: 0,
        demo: `<p-segment :options="segOptions" v-model:active="segActive" @select="onSegSelect" />`,
        hasOutput: true,
        output: '当前：{{ segActive }} · 最后 select：{{ segLast }}',
      },
    ],
    styles: ``,
  },
]

// ───────────────────────── ③ 渲染 ─────────────────────────

function renderPage(p) {
  const api = loadApi(p.file)
  if (!api) throw new Error(`无法从官网内容解析 API：${p.file}（website/content/components/${p.file}.md 缺失或无 Props 表）`)
  const imports = new Set(['PText'])
  for (const d of p.demos) for (const m of d.demo.matchAll(/<([a-z]+-[a-z-]+)/g)) {
    imports.add(
      m[1]
        .split('-')
        .map((s) => s[0].toUpperCase() + s.slice(1))
        .join(''),
    )
  }
  const importList = [...imports].sort()
  const codeEntries = p.codes.map(([k, v]) => `  ${k}: ${JSON.stringify(v)},`).join('\n')
  const demoBlocks = p.demos
    .map((d, i) => {
      const idx = String(i + 1).padStart(2, '0')
      const hasOut = Boolean(d.hasOutput)
      const codeKey = p.codes[d.code][0]
      const open = `    <demo-block index="${idx}" title="${d.title}" desc="${d.desc.replace(/"/g, '&quot;')}" :has-output="${hasOut}" :code="codes.${codeKey}">`
      const demoSlot = `      <template #demo>\n        ${d.demo}\n      </template>`
      const outSlot = hasOut ? `\n      <template #output>\n        <p-text class="out">${d.output}</p-text>\n      </template>` : ''
      return `${open}\n${demoSlot}${outSlot}\n    </demo-block>`
    })
    .join('\n\n')

  const stateBlock = p.state ? `\n${p.state}\n` : ''
  const styleBlock = p.styles
    ? `\n<style scoped>\n${p.styles}\n</style>\n`
    : ''

  return `<!-- showcase/subpackages/components/pages/${p.file}.vue —— ${p.title} 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/${p.file}.md ← gen-content.mjs ← packages/components/${p.file}/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { ${importList.join(', ')} } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
${codeEntries}
})
${stateBlock}
const apiRows = ref(${JSON.stringify(api.props, null, 2).replace(/\n/g, '\n')})
const eventRows = ref(${JSON.stringify(api.events, null, 2)})
const slotRows = ref(${JSON.stringify(api.slots.length ? api.slots : [['—', '无插槽', '—']], null, 2)})
const compatRows = ref(${JSON.stringify(api.compat, null, 2)})
</script>

<template>
  <page-shell title="${p.title}" subtitle="${p.subtitle}">
${demoBlocks}

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>
${styleBlock}`
}

let drifted = false
for (const p of PAGES) {
  const out = path.join(OUT_DIR, `${p.file}.vue`)
  const md = renderPage(p)
  if (check) {
    if (!fs.existsSync(out) || fs.readFileSync(out, 'utf-8') !== md) {
      console.error(`DRIFT: showcase/subpackages/components/pages/${p.file}.vue 与数据表不一致——重跑本脚本`)
      drifted = true
    }
  } else {
    fs.writeFileSync(out, md)
  }
}
if (check) {
  console.log(drifted ? '❌ 组件详情页漂移（--check）' : `OK: ${PAGES.length} 个组件详情页与数据表一致`)
  process.exitCode = drifted ? 1 : 0
} else {
  console.log(`generated: ${PAGES.length} 个组件详情页`)
}
