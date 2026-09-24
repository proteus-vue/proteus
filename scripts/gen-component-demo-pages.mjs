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
  // ★2026-09-24 修复：此处原写 `out.slice(-1) === '' ? …` —— `slice(-1)` 返回**数组**，
  //   与字符串比较恒为 false → 尾部空单元从未被移除 → `isSeparator` 判定失败 →
  //   markdown 的 `|---|` 分隔行被当成数据行进入 API 表（实测渲染出 `["---","---","---"]`）。
  if (out.length > 0 && out[out.length - 1] === '') out = out.slice(0, -1)
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
  // ─────────────────── 批次 5（2026-09-24）：Fluid 布局 + 外壳基础（10 页） ───────────────────
  {
    file: 'p-aspect',
    title: 'p-aspect 纵横比容器',
    subtitle: '布局原语 · Fluid System S2 · 双端同源码',
    state: ``,
    codes: [
      ['ratio', `<!-- 16:9（默认）与 1:1 -->\n<p-aspect :ratio="16 / 9"><p-text>16 : 9</p-text></p-aspect>\n<p-aspect :ratio="1"><p-text>1 : 1</p-text></p-aspect>`],
      ['maxw', `<!-- 限制最大宽度 + 1:1 -->\n<p-aspect :ratio="1" :max-width="120"><p-text>1 : 1（≤120px）</p-text></p-aspect>`],
    ],
    demos: [
      {
        title: '宽高比（ratio）',
        desc: '只声明宽/高比，高度由宽度推导；★Web 走原生 CSS aspect-ratio，Skyline 不支持时降级为 padding-top hack（内容驱动盒高）',
        code: 0,
        demo: `<p-aspect class="box" :ratio="16 / 9"><p-text>16 : 9</p-text></p-aspect>
          <p-aspect class="box" :ratio="1"><p-text>1 : 1</p-text></p-aspect>`,
      },
      {
        title: '限制最大宽度（maxWidth）',
        desc: 'maxWidth 给盒宽设上限（0 = 不限）——与 ratio 组合可做定宽比例的媒体位',
        code: 1,
        demo: `<p-aspect class="box" :ratio="1" :max-width="120"><p-text>1 : 1（≤120px）</p-text></p-aspect>`,
        hasOutput: true,
        output: '★降级可观察：Skyline 无 CSS aspect-ratio → padding-top hack（源码 #500 显式 content-box，否则高度恒 0）',
      },
    ],
    styles: `.box { background: #eef2ff; border: 1px solid #d6ddff; border-radius: var(--sp-radius-sm); margin-bottom: var(--sp-2); }
.box > :deep(*) { display: flex; align-items: center; justify-content: center; }`,
  },
  {
    file: 'p-fit',
    title: 'p-fit 内在尺寸',
    subtitle: '布局原语 · Fluid System B3 · 双端同源码',
    state: ``,
    codes: [['fit', `<!-- 宽度由内容决定，但不超过容器 maxRatio（默认 0.8 = 80%） -->\n<p-fit><p-text>短</p-text></p-fit>\n<p-fit :max-ratio="0.8"><p-text>很长很长…</p-text></p-fit>`]],
    demos: [
      {
        title: '内容驱动宽度 + 上限（maxRatio）',
        desc: '宽度 fit-content（随内容），maxRatio 防止动态内容撑爆容器——★第二行的长文本被 80% 上限截断换行',
        code: 0,
        demo: `<p-fit class="fit-box"><p-text>短内容</p-text></p-fit>
          <p-fit class="fit-box"><p-text>很长很长很长很长很长很长很长很长很长的文本内容，用来观察 80% 上限生效</p-text></p-fit>`,
        hasOutput: true,
        output: '★Skyline 无 fit-content → width 走 auto（内容驱动天然），maxWidth 上限仍生效',
      },
    ],
    styles: `.fit-box { background: #fff7ed; border: 1px solid #fed7aa; border-radius: var(--sp-radius-sm); padding: var(--sp-2); margin-bottom: var(--sp-2); }`,
  },
  {
    file: 'p-inline',
    title: 'p-inline 行内容器',
    subtitle: '布局原语 · layout.inline · 双端同源码',
    state: ``,
    codes: [
      ['wrap', `<!-- 不折行（默认） vs 允许折行 -->\n<p-inline :gap="8"><p-text>一</p-text><p-text>二</p-text></p-inline>\n<p-inline :gap="8" wrap>…</p-inline>`],
      ['align', `<!-- 主轴/交叉轴对齐 -->\n<p-inline :gap="8" justify="space-between" align="center">…</p-inline>`],
    ],
    demos: [
      {
        title: '折行开关（wrap）+ 间距（gap）',
        desc: '行内盒语义（对齐 CSS inline-flex）；wrap 开启后内容超宽自动折行——★对比上下两块',
        code: 0,
        demo: `<p-inline class="row" :gap="6">
            <p-text class="chip">1</p-text><p-text class="chip">2</p-text><p-text class="chip">3</p-text>
            <p-text class="chip">4</p-text><p-text class="chip">5</p-text><p-text class="chip">6</p-text>
            <p-text class="chip">7</p-text><p-text class="chip">8</p-text><p-text class="chip">9</p-text>
          </p-inline>
          <p-inline class="row" :gap="6" wrap>
            <p-text class="chip">1</p-text><p-text class="chip">2</p-text><p-text class="chip">3</p-text>
            <p-text class="chip">4</p-text><p-text class="chip">5</p-text><p-text class="chip">6</p-text>
            <p-text class="chip">7</p-text><p-text class="chip">8</p-text><p-text class="chip">9</p-text>
          </p-inline>`,
      },
      {
        title: '对齐（justify / align）',
        desc: 'justify 主轴对齐（space-between 把两端顶开），align 交叉轴对齐',
        code: 1,
        demo: `<p-inline class="row space" :gap="8" justify="space-between" align="center">
            <p-text class="chip">左</p-text>
            <p-text class="chip">中</p-text>
            <p-text class="chip">右</p-text>
          </p-inline>`,
      },
    ],
    styles: `.row { background: #f7f8fa; border-radius: var(--sp-radius-sm); padding: var(--sp-2); margin-bottom: var(--sp-2); }
.row.space { background: #eef2ff; }
.chip { background: #dbeafe; border-radius: var(--sp-radius-sm); padding: 2px 8px; }`,
  },
  {
    file: 'p-zone',
    title: 'p-zone 容器断点分区',
    subtitle: '布局原语 · Fluid System S1 · 容器级响应式',
    state: ``,
    codes: [['zone', `<!-- 按**容器宽度**（非视口）渲染对应命名槽 -->\n<p-zone>\n  <template #sm><p-text>窄：单列</p-text></template>\n  <template #md><p-text>中：两列</p-text></template>\n  <template #lg><p-text>宽：三列</p-text></template>\n</p-zone>`]],
    demos: [
      {
        title: '容器断点 → 命名槽（sm / md / lg / xl）',
        desc: '按**容器**宽度（不是视口）选槽渲染——四个槽各写不同内容，当前只渲染命中的那一个；★缩窄模拟器视口可观察切换（窄屏命中 sm）',
        code: 0,
        demo: `<p-zone class="zone">
            <template #sm><p-text class="zone-slot">窄容器 → sm 槽（单列）</p-text></template>
            <template #md><p-text class="zone-slot">中容器 → md 槽</p-text></template>
            <template #lg><p-text class="zone-slot">宽容器 → lg 槽</p-text></template>
            <template #xl><p-text class="zone-slot">超宽容器 → xl 槽</p-text></template>
          </p-zone>`,
        hasOutput: true,
        output: '★容器级（非视口级）响应式：Web 走 ResizeObserver，MP 走 SelectorQuery 运行时测量（容器断点在真机同样生效）',
      },
    ],
    styles: `.zone { background: #eef2ff; border: 1px solid #d6ddff; border-radius: var(--sp-radius-sm); padding: var(--sp-3); }
.zone-slot { font-weight: 600; }`,
  },
  {
    file: 'p-scale',
    title: 'p-scale 动态字号 / 密度',
    subtitle: '布局原语 · Fluid System S4 · 无障碍档位',
    state: ``,
    codes: [['level', `<!-- 字号级别 0 小 / 1 标准 / 2 大 / 3 特大 -->\n<p-scale :level="0"><p-text>小号</p-text></p-scale>\n<p-scale :level="3"><p-text>特大</p-text></p-scale>`],
      ['density', `<!-- 密度：compact / regular / comfortable -->\n<p-scale density="compact">…</p-scale>\n<p-scale density="comfortable">…</p-scale>`]],
    demos: [
      {
        title: '字号级别（level 0–3）',
        desc: '容器 font-size = base × 级别倍率 × 全局字号缩放（--proteus-font-scale）；★子项用 em 继承即随缩放',
        code: 0,
        demo: `<p-scale class="scale-row" :level="0"><p-text>级别 0（小）· 子项 em 继承</p-text></p-scale>
          <p-scale class="scale-row" :level="1"><p-text>级别 1（标准·默认）</p-text></p-scale>
          <p-scale class="scale-row" :level="2"><p-text>级别 2（大）</p-text></p-scale>
          <p-scale class="scale-row" :level="3"><p-text>级别 3（特大）</p-text></p-scale>`,
      },
      {
        title: '密度（density）',
        desc: 'compact 紧凑 / regular 常规 / comfortable 宽松（无障碍）——影响行高与 --proteus-density-gap 间距 token',
        code: 1,
        demo: `<p-scale class="scale-row" density="compact"><p-text>紧凑密度</p-text></p-scale>
          <p-scale class="scale-row" density="regular"><p-text>常规密度</p-text></p-scale>
          <p-scale class="scale-row" density="comfortable"><p-text>宽松密度（无障碍）</p-text></p-scale>`,
        hasOutput: true,
        output: '★宿主可注入 --proteus-font-scale 做系统级字号缩放（折叠屏/平板/用户无障碍设置），组件侧零改动',
      },
    ],
    styles: `.scale-row { background: #f7f8fa; border-radius: var(--sp-radius-sm); padding: var(--sp-2); margin-bottom: var(--sp-2); }`,
  },
  {
    file: 'p-label',
    title: 'p-label 表单标签',
    subtitle: 'UI 原语 · ui.label · 对齐小程序 <label>',
    state: `const labelClicks = ref('（暂无）')
function onLabelClick(): void {
  labelClicks.value = '已点击 · ' + Date.now().toString().slice(-4)
}`,
    codes: [['for', `<!-- for 关联控件 id：点标签聚焦/切换该控件 -->\n<p-label for="demo-name">用户名</p-label>\n<p-input id="demo-name" placeholder="点上面的标签会聚焦这里" />`],
      ['block', `<!-- block：整行块级标签 -->\n<p-label :block="true">整行标签</p-label>`]],
    demos: [
      {
        title: '关联控件（for + 控件 id）',
        desc: '★点「用户名」标签 → 下方输入框获得焦点（对齐小程序 <label for> 与 HTML label for 语义）；同时标签自身 emit click',
        code: 0,
        demo: `<p-label for="demo-name" @click="onLabelClick">用户名（点我聚焦输入框）</p-label>
          <p-input id="demo-name" placeholder="点上面的标签会聚焦这里" />`,
        hasOutput: true,
        output: '标签点击：{{ labelClicks }}',
      },
      {
        title: '块级标签（block）',
        desc: 'block=true → 整行块级（默认 inline-flex 与控件同行）',
        code: 1,
        demo: `<p-label :block="true" class="block-label">整行标签（display: block）</p-label>`,
      },
    ],
    styles: `.block-label { background: #f7f8fa; border-radius: var(--sp-radius-sm); padding: var(--sp-2); }`,
  },
  {
    file: 'p-safe',
    title: 'p-safe 安全区避让',
    subtitle: '布局原语 · Fluid System S2 · 双端同源码',
    state: ``,
    codes: [['top', `<!-- 顶部安全区（刘海/状态栏/胶囊） -->\n<p-safe area="top" :fallback="20">\n  <p-text>内容避开顶部安全区</p-text>\n</p-safe>`],
      ['bottom', `<!-- 底部安全区（Home Indicator） -->\n<p-safe area="bottom" :fallback="12">…</p-safe>`]],
    demos: [
      {
        title: '顶部安全区（area="top" + fallback 兜底）',
        desc: '★fallback 是无刘海/桌面环境下的**最小**内边距（max() 包裹）——没有它，env()=0 时该块会塌成 0 高（演示会「看不见」）',
        code: 0,
        demo: `<p-safe class="safe-box" area="top" :fallback="20">
            <p-text>内容避开顶部安全区（fallback 20px）</p-text>
          </p-safe>`,
      },
      {
        title: '底部安全区（area="bottom"）',
        desc: '底部 Home Indicator 避让；★MP 端 env() 整条声明被丢弃 → 组件改走运行时读数（getWindowInfo + 胶囊下沿），真机同样生效',
        code: 1,
        demo: `<p-safe class="safe-box" area="bottom" :fallback="12">
            <p-text>内容避开底部安全区（fallback 12px）</p-text>
          </p-safe>`,
        hasOutput: true,
        output: '★折叠屏 hinge 避让：:fold 开启后 display-mode=fold/span 时左右避开折叠区域（env(fold-*)，把系统能力搬进框架）',
      },
    ],
    styles: `.safe-box { background: #eef2ff; border: 1px solid #d6ddff; border-radius: var(--sp-radius-sm); }`,
  },
  {
    file: 'p-split',
    title: 'p-split 自适应分栏',
    subtitle: '布局原语 · Fluid System S1 · 平板/多窗口核心',
    state: ``,
    codes: [['split', `<!-- 容器宽 ≥ minSplitWidth → 并排；窄于此 → 堆叠 -->\n<p-split :min-split-width="640" :gap="12">\n  <template #aside><p-text>侧栏</p-text></template>\n  <p-text>主区</p-text>\n</p-split>`],
      ['always', `<!-- 小阈值（200）→ 在当前窄容器里也并排，便于观察两种形态 -->\n<p-split :min-split-width="200" :gap="12">…</p-split>`]],
    demos: [
      {
        title: '默认阈值 640 → 当前容器窄，堆叠',
        desc: '★按**容器**宽度（非视口）求解：窄容器堆叠（column），达到阈值并排（row）',
        code: 0,
        demo: `<p-split class="split-box" :min-split-width="640" :gap="10">
            <template #aside><p-text class="side">侧栏（堆叠时在上）</p-text></template>
            <p-text class="main">主区内容</p-text>
          </p-split>`,
      },
      {
        title: '小阈值 200 → 当前容器即并排',
        desc: '把 minSplitWidth 降到 200，同一容器立即切到并排形态（对照上块）',
        code: 1,
        demo: `<p-split class="split-box" :min-split-width="200" :gap="10">
            <template #aside><p-text class="side">侧栏</p-text></template>
            <p-text class="main">主区（并排形态）</p-text>
          </p-split>`,
        hasOutput: true,
        output: '★MP 端同样生效：Skyline 无 ResizeObserver → 走 SelectorQuery 运行时测量（容器响应式不再是 Web 专属）',
      },
    ],
    styles: `.split-box { background: #f7f8fa; border-radius: var(--sp-radius-sm); padding: var(--sp-2); margin-bottom: var(--sp-2); }
.side { background: #dbeafe; border-radius: var(--sp-radius-sm); padding: var(--sp-2); }
.main { background: #fff; border-radius: var(--sp-radius-sm); padding: var(--sp-3); flex: 1; }`,
  },
  {
    file: 'p-mask',
    title: 'p-mask 遮罩',
    subtitle: '页面外壳 · 弹层体系基调 · 双端同源码',
    state: `const maskVisible = ref(false)
function showMask(): void {
  maskVisible.value = true
}
function onMaskClose(): void {
  maskVisible.value = false
}`,
    codes: [['basic', `<!-- visible 受控；close-on-tap 缺省开启（点遮罩 emit close） -->\n<p-mask :visible="maskVisible" :opacity="0.5" @close="onMaskClose" />`]],
    demos: [
      {
        title: '显隐与点击关闭（visible + closeOnTap）',
        desc: '★点按钮显示遮罩 → **点遮罩本体关闭**（closeOnTap 缺省 true，emit close 由父置 visible=false）；遮罩无动画，动画由弹层组件自行编排',
        code: 0,
        demo: `<p-button size="small" @click="showMask">显示遮罩（点遮罩关闭）</p-button>
          <p-mask :visible="maskVisible" :opacity="0.45" @close="onMaskClose" />`,
        hasOutput: true,
        output: '★遮罩是 fixed 全屏（z-index 1000）：显示期间会挡住下层交互——这正是遮罩的目的；关闭由 closeOnTap 的 close 事件驱动',
      },
    ],
    styles: ``,
  },
  {
    file: 'p-toast',
    title: 'p-toast 轻提示',
    subtitle: '页面外壳 · 轻提示 · 双端同源码',
    state: `const toastVisible = ref(false)
const toastPos = ref('center')
function showToast(pos: string): void {
  toastPos.value = pos
  toastVisible.value = true
}
function onToastClose(): void {
  toastVisible.value = false
}`,
    codes: [['basic', `<!-- duration 到点自动 emit close（0 = 不自动关） -->\n<p-toast :visible="toastVisible" text="操作成功" :duration="1500" :position="pos" @close="onToastClose" />`]],
    demos: [
      {
        title: '自动关闭 + 三个位置（center / top / bottom）',
        desc: '★点按钮弹出轻提示，1.5s 后**自动 emit close**（父置 visible=false）；三个位置对照（自带淡入动画）',
        code: 0,
        demo: `<p-view class="btns">
            <p-button size="small" @click="showToast('center')">居中</p-button>
            <p-button size="small" @click="showToast('top')">顶部</p-button>
            <p-button size="small" @click="showToast('bottom')">底部</p-button>
          </p-view>
          <p-toast :visible="toastVisible" text="操作成功（1.5s 自动关闭）" :duration="1500" :position="toastPos" @close="onToastClose" />`,
        hasOutput: true,
        output: '★避开了原生 wx.showToast 的限制：自绘 toast 支持自定义位置与时长，两端视觉一致（组件内定时器在 onUnmounted 清理）',
      },
    ],
    styles: `.btns { display: flex; gap: var(--sp-2); flex-wrap: wrap; }`,
  },
  // ─────────────────── 批次 6（2026-09-24）：弹层族 + 外壳基础（10 页） ───────────────────
  {
    file: 'p-modal',
    title: 'p-modal 弹窗',
    subtitle: '页面外壳 · 形态自适应弹窗 · 双端同源码',
    state: `const modalVisible = ref(false)
const modalLast = ref('（暂无）')
function openModal(): void {
  modalVisible.value = true
}
// ★观察显隐变化用 watch，**不要**再写 @update:visible——v-model:visible 已隐含该绑定，
//   两者同写会产出重复的 bind:update-visible（MP 编译器按平台标准报违规并中止构建）
watch(modalVisible, (v) => {
  modalLast.value = v ? '打开' : '关闭'
})`,
    codes: [['basic', `<!-- v-model:visible 受控 + 标题/关闭按钮/点遮罩关闭 -->\n<p-modal v-model:visible="visible" title="标题">\n  <p-text>内容</p-text>\n</p-modal>`]],
    demos: [
      {
        title: '受控显隐 + 点遮罩关闭（v-model:visible）',
        desc: '★点按钮打开；点遮罩或右上角 × 关闭（maskClosable / closable 缺省开启）；★形态区间自适应：pAdaptive 按**宽度**选 sheet(0–600) / dialog(600–840) / popover(840+)',
        code: 0,
        demo: `<p-button size="small" @click="openModal">打开弹窗</p-button>
          <p-modal v-model:visible="modalVisible" title="形态自适应弹窗">
            <p-text>手机宽度 → sheet 形态（贴底）；平板 → dialog 居中；宽屏 → popover</p-text>
          </p-modal>`,
        hasOutput: true,
        output: '最后操作：{{ modalLast }}（经 watch 观察 v-model 变化）',
      },
    ],
    styles: ``,
  },
  {
    file: 'p-popup',
    title: 'p-popup 弹层',
    subtitle: '页面外壳 · 基础弹层 · 双端同源码',
    state: `const popupVisible = ref(false)
const popupPos = ref('bottom')
function openPopup(pos: string): void {
  popupPos.value = pos
  popupVisible.value = true
}
function onPopupClose(): void {
  popupVisible.value = false
}`,
    codes: [['basic', `<!-- position: bottom / center / top；closeOnMask 点遮罩关闭 -->\n<p-popup :visible="visible" position="bottom" @close="onClose">\n  <p-text>弹层内容</p-text>\n</p-popup>`]],
    demos: [
      {
        title: '三个方位（bottom / center / top）+ 点遮罩关闭',
        desc: '★点按钮从对应方位弹出，自带走位动画（duration 0 = 按位置自动）；点遮罩 emit close 关闭',
        code: 0,
        demo: `<p-view class="btns">
            <p-button size="small" @click="openPopup('bottom')">底部</p-button>
            <p-button size="small" @click="openPopup('center')">居中</p-button>
            <p-button size="small" @click="openPopup('top')">顶部</p-button>
          </p-view>
          <p-popup :visible="popupVisible" :position="popupPos" @close="onPopupClose">
            <p-text>弹层内容（点遮罩关闭）</p-text>
          </p-popup>`,
        hasOutput: true,
        output: '★是 p-mask 的「带面板 + 动画」上位形态：弹层族的基础件，p-modal / p-drawer / p-action-sheet 都可由它组合',
      },
    ],
    styles: `.btns { display: flex; gap: var(--sp-2); flex-wrap: wrap; }`,
  },
  {
    file: 'p-drawer',
    title: 'p-drawer 侧滑抽屉',
    subtitle: '页面外壳 · 侧向抽屉 · 双端同源码',
    state: `const drawerLeft = ref(false)
const drawerRight = ref(false)`,
    codes: [['basic', `<!-- v-model:open 受控；side: left / right；overlay 点遮罩关闭 -->\n<p-drawer v-model="open" side="left" :width="280">\n  <p-text>抽屉内容</p-text>\n</p-drawer>`]],
    demos: [
      {
        title: '左右两侧（side）+ 点遮罩关闭（overlay）',
        desc: '★两个独立抽屉：左侧与右侧分别受控；width 控制展开宽度；overlay 开启时点遮罩 emit update:modelValue(false) 关闭',
        code: 0,
        demo: `<p-view class="btns">
            <p-button size="small" @click="drawerLeft = true">从左侧滑出</p-button>
            <p-button size="small" @click="drawerRight = true">从右侧滑出</p-button>
          </p-view>
          <p-drawer v-model="drawerLeft" side="left" :width="260">
            <p-text>左侧抽屉（点遮罩关闭）</p-text>
          </p-drawer>
          <p-drawer v-model="drawerRight" side="right" :width="260">
            <p-text>右侧抽屉（点遮罩关闭）</p-text>
          </p-drawer>`,
        hasOutput: true,
        output: '★面板内点击用显式 noop 方法承载 .stop（MP 的 catchtap 无值形式不可编译——源码注释记录该约束）',
      },
    ],
    styles: `.btns { display: flex; gap: var(--sp-2); flex-wrap: wrap; }`,
  },
  {
    file: 'p-action-sheet',
    title: 'p-action-sheet 动作面板',
    subtitle: '页面外壳 · 底部动作面板 · 双端同源码',
    state: `const sheetVisible = ref(false)
const sheetLast = ref('（暂无）')
const sheetActions = ref([
  { label: '拍照' },
  { label: '从相册选择' },
  { label: '删除', color: '#e54d42' },
])
function openSheet(): void {
  sheetVisible.value = true
}
function onSheetSelect(v: unknown): void {
  sheetLast.value = '选中：' + String(v)
}
function onSheetCancel(): void {
  sheetLast.value = '取消'
}`,
    codes: [['basic', `<!-- actions: [{label, value?, color?}]；select / cancel 事件 -->\n<p-action-sheet v-model="open" :actions="actions" cancel-text="取消"\n  @select="onSelect" @cancel="onCancel" />`]],
    demos: [
      {
        title: '动作项 + 危险色 + 取消（actions / select / cancel）',
        desc: '★点按钮弹出；点动作项 emit select 并自动关闭，点取消 emit cancel；color 给单项着色（如删除用红）',
        code: 0,
        demo: `<p-button size="small" @click="openSheet">打开动作面板</p-button>
          <p-action-sheet v-model="sheetVisible" :actions="sheetActions" cancel-text="取消"
            @select="onSheetSelect" @cancel="onSheetCancel" />`,
        hasOutput: true,
        output: '{{ sheetLast }}',
      },
    ],
    styles: ``,
  },
  {
    file: 'p-popover',
    title: 'p-popover 气泡浮层',
    subtitle: '页面外壳 · 锚定气泡 · 双端同源码',
    state: `const popoverVisible = ref(false)`,
    codes: [['basic', `<!-- trigger 插槽 = 触发区；placement 定位；默认插槽 = 气泡内容 -->\n<p-popover v-model="open" placement="bottom">\n  <template #trigger><p-button size="small">点我</p-button></template>\n  <p-text>气泡内容</p-text>\n</p-popover>`]],
    demos: [
      {
        title: '触发区 + 四个方位（placement）',
        desc: '★点触发区开合气泡；placement: bottom / top / left / right；点浮层外关闭（overlay 层）',
        code: 0,
        demo: `<p-view class="btns">
            <p-popover v-model="popoverVisible" placement="bottom">
              <template #trigger><p-button size="small">底部气泡</p-button></template>
              <p-text>这是气泡内容（点外部关闭）</p-text>
            </p-popover>
          </p-view>`,
        hasOutput: true,
        output: '★实现要点：用标准 `<teleport to="body">` 逃逸页面层叠（编译器转 Skyline root-portal）——定位用 fixed+坐标，不依赖相对锚定',
      },
    ],
    styles: `.btns { display: flex; gap: var(--sp-2); flex-wrap: wrap; }`,
  },
  {
    file: 'p-nav',
    title: 'p-nav 导航栏',
    subtitle: '页面外壳 · shell.nav · 双端同源码',
    state: ``,
    codes: [['basic', `<!-- title + left/right 插槽；transparent 透明模式 -->\n<p-nav title="页面标题">\n  <template #left><p-text>返回</p-text></template>\n  <template #right><p-text>更多</p-text></template>\n</p-nav>`]],
    demos: [
      {
        title: '标题 + 左右插槽',
        desc: '声明式导航栏：中间标题居中（插槽内容优先于 title），左右各 64px 最小操作区',
        code: 0,
        demo: `<p-nav class="nav-demo" title="声明式导航栏">
            <template #left><p-text class="nav-side">← 返回</p-text></template>
            <template #right><p-text class="nav-side">更多 ›</p-text></template>
          </p-nav>`,
      },
      {
        title: '透明模式（transparent）',
        desc: 'transparent 去掉背景与底边——用于与页面背景融合的场景（如沉浸式头图）',
        code: 0,
        demo: `<p-nav class="nav-demo nav-transparent-demo" title="透明导航栏" transparent>
            <template #left><p-text class="nav-side">← 返回</p-text></template>
          </p-nav>`,
        hasOutput: true,
        output: '★与 p-tabbar 同属 shell 族：页面框架件由组件声明，不依赖平台原生导航配置',
      },
    ],
    styles: `.nav-demo { border: 1px solid #e5e6eb; border-radius: var(--sp-radius-sm); margin-bottom: var(--sp-2); }
.nav-transparent-demo { background: linear-gradient(135deg, #eef2ff, #f7f8fa); border-style: dashed; }
.nav-side { font-size: 13px; color: #4f6bff; }`,
  },
  {
    file: 'p-tabbar',
    title: 'p-tabbar 底部标签栏',
    subtitle: '页面外壳 · shell.tabbar · 双端同源码',
    state: `const tabActive = ref('home')
const tabLast = ref('（暂无）')
const tabTabs = ref([
  { key: 'home', label: '首页' },
  { key: 'find', label: '发现' },
  { key: 'mine', label: '我的' },
])
function onTabSelect(k: unknown): void {
  tabLast.value = String(k)
}`,
    codes: [['basic', `<!-- tabs: [{key,label,icon?}]；active 受控 + select 事件 -->\n<p-tabbar :tabs="tabs" v-model:active="active" @select="onSelect" />`]],
    demos: [
      {
        title: '受控切换（tabs / active / select）',
        desc: '★点标签项切换激活态；select 事件回传 key（v-model:active 同步回写）',
        code: 0,
        demo: `<p-tabbar :tabs="tabTabs" v-model:active="tabActive" @select="onTabSelect" />`,
        hasOutput: true,
        output: '当前：{{ tabActive }} · 最后 select：{{ tabLast }}',
      },
    ],
    styles: ``,
  },
  {
    file: 'p-page',
    title: 'p-page 页面根容器',
    subtitle: '页面外壳 · shell.page · 双端同源码',
    state: ``,
    codes: [['basic', `<!-- 页面根容器：statusBar 顶部避让 / pullRefresh 下拉刷新 -->\n<p-page title="标题" status-bar pull-refresh>\n  <p-text>页面内容</p-text>\n</p-page>`]],
    demos: [
      {
        title: '基础容器 + statusBar 避让',
        desc: '页面根容器（默认无样式，仅提供页面级语义与扩展点）；statusBar 开启顶部状态栏避让',
        code: 0,
        demo: `<p-page class="page-demo" status-bar>
            <p-text>页面内容（statusBar 已开启顶部避让）</p-text>
          </p-page>`,
      },
      {
        title: '下拉刷新开关（pullRefresh）',
        desc: 'pullRefresh 声明式开启下拉刷新（由宿主/页面装配接线；组件只声明意图，不直调平台 API）',
        code: 0,
        demo: `<p-page class="page-demo" pull-refresh>
            <p-text>页面内容（pullRefresh 已声明）</p-text>
          </p-page>`,
        hasOutput: true,
        output: '★页面框架件的分工：p-page 提供根语义，p-nav/p-tabbar 提供栏位，p-safe 提供安全区——三者组合即完整页面骨架',
      },
    ],
    styles: `.page-demo { border: 1px solid #e5e6eb; border-radius: var(--sp-radius-sm); padding: var(--sp-2); margin-bottom: var(--sp-2); }`,
  },
  {
    file: 'p-select',
    title: 'p-select 选择器',
    subtitle: '内容与表单 · ui.select · 双端同源码',
    state: `const selValue = ref('')
const selMultiple = ref<string[]>([])
const selOptions = ref([
  { value: 'vue', label: 'Vue' },
  { value: 'react', label: 'React' },
  { value: 'svelte', label: 'Svelte' },
])
function onSelChange(v: unknown): void {
  selValue.value = String(v)
}
function onMultiChange(v: unknown): void {
  selMultiple.value = Array.isArray(v) ? (v as string[]).map(String) : []
}`,
    codes: [['single', `<!-- 单选（默认）-->\n<p-select :options="options" placeholder="请选择" />`],
      ['multi', `<!-- 多选：modelValue 为数组 -->\n<p-select :options="options" multiple :model-value="[]" />`]],
    demos: [
      {
        title: '单选（options + placeholder）',
        desc: '★点选择器展开选项；选中后回显 label，change 同步 modelValue',
        code: 0,
        demo: `<p-select :options="selOptions" placeholder="请选择一个框架" :model-value="selValue" @update:model-value="onSelChange" />`,
        hasOutput: true,
        output: '当前值：{{ selValue || "（未选择）" }}',
      },
      {
        title: '多选（multiple）',
        desc: 'multiple 开启后 modelValue 为数组，可多选累加',
        code: 1,
        demo: `<p-select :options="selOptions" multiple placeholder="可多选" :model-value="selMultiple" @update:model-value="onMultiChange" />`,
      },
    ],
    styles: ``,
  },
  // ─────────────────── 批次 7（2026-09-24）：工程类 + 剩余布局/外壳（10 页） ───────────────────
  {
    file: 'p-animate',
    title: 'p-animate 动画声明',
    subtitle: '工程 · animation CSS 语义面 · 双端同源码',
    state: ``,
    codes: [['presets', `<!-- 预设动画名：fade / bounce / pulse / shake / zoom-in / spin -->\n<p-animate keyframes="pulse" :duration="1200" loop>\n  <p-text>循环脉冲</p-text>\n</p-animate>`],
      ['delay', `<!-- delay 延迟 + duration 时长 + loop 开关 -->\n<p-animate keyframes="shake" :duration="600" :delay="300" :loop="false">…</p-animate>`]],
    demos: [
      {
        title: '六个预设（fade / bounce / pulse / shake / spin / zoom-in）',
        desc: '预设名 → 全局 @keyframes 类（p-animate-{name}）；★全部在动，用于直观对照',
        code: 0,
        demo: `<p-view class="anim-row">
            <p-animate class="anim-cell" keyframes="fade"><p-text>fade</p-text></p-animate>
            <p-animate class="anim-cell" keyframes="bounce"><p-text>bounce</p-text></p-animate>
            <p-animate class="anim-cell" keyframes="pulse"><p-text>pulse</p-text></p-animate>
            <p-animate class="anim-cell" keyframes="shake"><p-text>shake</p-text></p-animate>
            <p-animate class="anim-cell" keyframes="spin"><p-text>spin</p-text></p-animate>
            <p-animate class="anim-cell" keyframes="zoom-in"><p-text>zoom</p-text></p-animate>
          </p-view>`,
      },
      {
        title: '时长与延迟（duration / delay / loop）',
        desc: 'duration 控制周期（ms），delay 延迟启动，loop=false 只播一次——★不 loop、不 delay 的脉冲会「动一下就停」',
        code: 1,
        demo: `<p-view class="anim-row">
            <p-animate class="anim-cell" keyframes="pulse" :duration="600" loop><p-text>600ms</p-text></p-animate>
            <p-animate class="anim-cell" keyframes="pulse" :duration="2000" loop><p-text>2000ms</p-text></p-animate>
            <p-animate class="anim-cell" keyframes="pulse" :duration="1200" :delay="800" loop><p-text>延迟 800</p-text></p-animate>
          </p-view>`,
        hasOutput: true,
        output: '★动画走 CSS @keyframes（双端一致）：组件只声明语义，不写平台动画 API',
      },
    ],
    styles: `.anim-row { display: flex; flex-wrap: wrap; gap: var(--sp-2); }
.anim-cell { background: #eef2ff; border-radius: var(--sp-radius-sm); padding: var(--sp-3) var(--sp-2); text-align: center; min-width: 64px; }`,
  },
  {
    file: 'p-transition',
    title: 'p-transition 过渡',
    subtitle: '工程 · 进入/离开过渡 · 双端同源码',
    state: `const trVisible = ref(true)
const trName = ref('fade')
function toggleTr(): void {
  trVisible.value = !trVisible.value
}
function setTr(n: string): void {
  trName.value = n
  trVisible.value = true
}`,
    codes: [['basic', `<!-- name: fade / slide-up / slide-down / slide-left / slide-right / zoom -->\n<!-- mode: in / out / both；visible 驱动显隐 -->\n<p-transition name="slide-up" mode="both" :visible="show">\n  <p-text>内容</p-text>\n</p-transition>`]],
    demos: [
      {
        title: '六个预设 + 显隐切换（name / visible）',
        desc: '★点按钮切换显隐（观察过渡），点预设名切换形态；★切「隐藏」时会看到淡出/位移，切「显示」是反向过程',
        code: 0,
        demo: `<p-view class="btns">
            <p-button size="small" @click="toggleTr">{{ trVisible ? '隐藏' : '显示' }}</p-button>
            <p-button size="small" @click="setTr('fade')">fade</p-button>
            <p-button size="small" @click="setTr('slide-up')">slide-up</p-button>
            <p-button size="small" @click="setTr('zoom')">zoom</p-button>
          </p-view>
          <p-transition class="tr-stage" :name="trName" mode="both" :visible="trVisible">
            <p-text>{{ trName }} 过渡内容</p-text>
          </p-transition>`,
        hasOutput: true,
        output: '当前预设：{{ trName }} · 可见：{{ trVisible ? "是" : "否" }}',
      },
    ],
    styles: `.btns { display: flex; gap: var(--sp-2); flex-wrap: wrap; margin-bottom: var(--sp-2); }
.tr-stage { background: #eef2ff; border-radius: var(--sp-radius-sm); padding: var(--sp-4); text-align: center; }`,
  },
  {
    file: 'p-error-boundary',
    // ★页面专用本地组件：错误边界演示需要一个真的会崩溃的子组件
    localComponents: ['crash-probe'],
    title: 'p-error-boundary 错误兜底',
    subtitle: '工程 · 错误边界 · 双端同源码',
    state: `const ebCrash = ref(false)
const ebMounted = ref(true)
function crashNow(): void {
  ebCrash.value = true
}
function resetCrashed(): void {
  // ★错误状态由组件内部持有 → 必须先卸载再挂载才能真正复位。
  //   ★不用 :key（那是「换 key 即重挂载」的 Web 手法）——MP 的 wx:key 只对 wx:for 有意义，
  //     独立使用会被编译器判为悬挂属性并**中止构建**（实测 [InvalidAttribute] wx:key 无 wx:for 悬挂）。
  //   用 v-if 显式卸载 → nextTick 后重新挂载，两端语义一致。
  ebMounted.value = false
  ebCrash.value = false
  void nextTick(() => {
    ebMounted.value = true
  })
}`,
    codes: [['basic', `<!-- 捕获后代组件渲染/生命周期错误 → 显示 fallback 槽（缺省 fallbackText） -->\n<p-error-boundary fallback-text="出错了，请重试">\n  <p-text>正常内容</p-text>\n</p-error-boundary>`],
      ['slot', `<!-- 自定义兜底：fallback 命名槽 -->\n<p-error-boundary>\n  <template #fallback><p-text>自定义兜底 UI</p-text></template>\n  <p-text>正常内容</p-text>\n</p-error-boundary>`]],
    demos: [
      {
        title: '捕获子树错误 → 显示兜底',
        desc: '★点「触发子组件崩溃」会让下方的子组件在渲染期抛错，错误边界捕获后显示兜底文案（而不是整页白屏）；点「重置」重新挂载',
        code: 0,
        demo: `<p-view class="btns">
            <p-button size="small" @click="crashNow">触发子组件崩溃</p-button>
            <p-button size="small" @click="resetCrashed">重置</p-button>
          </p-view>
          <p-error-boundary v-if="ebMounted" fallback-text="⚠ 子树出错了（错误边界已兜底）">
            <crash-probe :crash="ebCrash" />
          </p-error-boundary>`,
        hasOutput: true,
        output: '★错误边界是「隔离故障」的基础件：一棵子树崩了不影响其他区域（onErrorCaptured + return false 阻止继续冒泡）',
      },
    ],
    styles: `.btns { display: flex; gap: var(--sp-2); flex-wrap: wrap; margin-bottom: var(--sp-2); }`,
  },
  {
    file: 'p-scroll',
    title: 'p-scroll 显式滚动容器',
    subtitle: '布局 · layout.scroll · 双端同源码',
    state: ``,
    codes: [['y', `<!-- 纵向滚动（默认）+ 分页/下拉刷新/指示器声明 -->\n<p-scroll axis="y" paging refresh indicator>\n  <p-text>内容</p-text>\n</p-scroll>`],
      ['x', `<!-- 横向滚动：axis="x" -->\n<p-scroll axis="x">…</p-scroll>`]],
    demos: [
      {
        title: '纵向滚动（axis="y"）',
        desc: '★真滚动容器：内容超出即滚动；paging 声明分页、refresh 声明下拉刷新、indicator 控制滚动条——★Skyline 下 CSS overflow 无效（平台限制，见组件注释），需用 p-scroll-view',
        code: 0,
        demo: `<p-scroll class="scroll-box" axis="y" indicator>
            <p-text v-for="i in 12" :key="i" class="scroll-line">第 {{ i }} 行内容（超出容器高度即产生滚动）</p-text>
          </p-scroll>`,
      },
      {
        title: '横向滚动（axis="x"）',
        desc: 'axis="x" 切换主轴——内容超宽即横向滚动',
        code: 1,
        demo: `<p-scroll class="scroll-box-x" axis="x">
            <p-text v-for="i in 8" :key="i" class="scroll-card">{{ i }}</p-text>
          </p-scroll>`,
        hasOutput: true,
        output: '★与 p-scroll-view / p-stack snap 的分工：p-scroll 是「显式滚动容器」，滚动行为需宿主容器有确定高度',
      },
    ],
    styles: `.scroll-box { height: 120px; background: #f7f8fa; border-radius: var(--sp-radius-sm); padding: var(--sp-2); }
.scroll-line { display: block; padding: 6px 0; border-bottom: 1px solid #eceef2; }
.scroll-box-x { background: #f7f8fa; border-radius: var(--sp-radius-sm); padding: var(--sp-2); }
.scroll-card { display: inline-block; min-width: 64px; background: #dbeafe; border-radius: var(--sp-radius-sm); padding: var(--sp-3); text-align: center; margin-right: var(--sp-2); }`,
  },
  {
    file: 'p-scrollable',
    title: 'p-scrollable 可滚动区域',
    subtitle: '手势 · 滚动 + 加载更多 · 双端同源码',
    state: `const scLog = ref('（滚动看看）')
const scLoading = ref(false)
function onLoadMore(): void {
  scLog.value = '触底 → load-more 触发 · ' + Date.now().toString().slice(-4)
  scLoading.value = true
  setTimeout(() => {
    scLoading.value = false
  }, 900)
}`,
    codes: [['basic', `<!-- height 固定滚动区；触底 40px 内 emit load-more -->\n<p-scrollable :height="160" load-more :loading="loading" @load-more="onLoadMore">\n  <p-text>内容</p-text>\n</p-scrollable>`]],
    demos: [
      {
        title: '触底加载更多（loadMore / load-more / loading）',
        desc: '★滚动到底部（触底 40px 内）会 emit load-more 并回显——真滚动触发，不是点击模拟',
        code: 0,
        demo: `<p-scrollable class="sc-box" :height="160" load-more :loading="scLoading" @load-more="onLoadMore">
            <p-text v-for="i in 14" :key="i" class="scroll-line">第 {{ i }} 行（滚到底部触发加载）</p-text>
          </p-scrollable>`,
        hasOutput: true,
        output: '{{ scLog }}（loading 时页脚显示「加载中…」）',
      },
    ],
    styles: `.sc-box { background: #f7f8fa; border-radius: var(--sp-radius-sm); padding: var(--sp-2); }
.scroll-line { display: block; padding: 6px 0; border-bottom: 1px solid #eceef2; }`,
  },
  {
    file: 'p-adaptive',
    title: 'p-adaptive 容器形态自适应',
    subtitle: '布局 · 形态区间声明 · 双端同源码',
    state: ``,
    codes: [['basic', `<!-- modes: 形态区间声明（sheet / dialog / popover 按宽度切换） -->\n<p-adaptive modes="sheet(0, 600) | dialog(600, 840)">\n  <p-text>内容</p-text>\n</p-adaptive>`]],
    demos: [
      {
        title: '形态区间（modes）——同 p-modal 的形态求解',
        desc: '★按**容器宽度**求解形态区间（sheet(0,600) / dialog(600,840) / popover(840+)）；当前窄容器应命中 sheet 形态；★改 modes 可自定义区间',
        code: 0,
        demo: `<p-adaptive class="ad-box" modes="sheet(0, 600) | dialog(600, 840) | popover(840, 9999)">
            <p-text>当前形态由容器宽度决定（窄容器 → sheet）</p-text>
          </p-adaptive>`,
        hasOutput: true,
        output: '★p-modal 的 pAdaptive 属性与之一脉相承：同一套「形态区间声明」语义，弹窗只是它的一个消费者',
      },
    ],
    styles: `.ad-box { background: #eef2ff; border: 1px solid #d6ddff; border-radius: var(--sp-radius-sm); padding: var(--sp-3); }`,
  },
  {
    file: 'p-masonry',
    title: 'p-masonry 瀑布流',
    subtitle: '布局 · layout.masonry · 双端同源码',
    state: ``,
    codes: [['basic', `<!-- 列数 + 间距；子项自动避免跨列断开 -->\n<p-masonry :col-count="2" :gap="12">\n  <p-text>卡片 1</p-text>\n  <p-text>卡片 2</p-text>\n</p-masonry>`]],
    demos: [
      {
        title: '两列瀑布流（colCount / gap）',
        desc: 'CSS columns 实现：子项高度不齐时自动错落填充（break-inside: avoid 防跨列断开）；★子项高度不同才看得出瀑布流效果',
        code: 0,
        demo: `<p-masonry class="ms-box" :col-count="2" :gap="10">
            <p-text class="ms-item" style="height: 60px">卡片 1（矮）</p-text>
            <p-text class="ms-item" style="height: 96px">卡片 2（高）</p-text>
            <p-text class="ms-item" style="height: 72px">卡片 3（中）</p-text>
            <p-text class="ms-item" style="height: 88px">卡片 4（较高）</p-text>
            <p-text class="ms-item" style="height: 56px">卡片 5</p-text>
            <p-text class="ms-item" style="height: 80px">卡片 6</p-text>
          </p-masonry>`,
      },
      {
        title: '三列（colCount=3）',
        desc: '同一批内容换成三列——列数只声明，填充由引擎计算',
        code: 0,
        demo: `<p-masonry class="ms-box" :col-count="3" :gap="8">
            <p-text class="ms-item" style="height: 56px">1</p-text>
            <p-text class="ms-item" style="height: 80px">2</p-text>
            <p-text class="ms-item" style="height: 64px">3</p-text>
            <p-text class="ms-item" style="height: 72px">4</p-text>
            <p-text class="ms-item" style="height: 48px">5</p-text>
            <p-text class="ms-item" style="height: 88px">6</p-text>
          </p-masonry>`,
        hasOutput: true,
        output: '★实现：CSS columns（Web 原生能力）+ --p-masonry-gap 间距 token——不做 JS 布局计算',
      },
    ],
    styles: `.ms-box { background: #f7f8fa; border-radius: var(--sp-radius-sm); padding: var(--sp-2); }
.ms-item { display: block; background: #dbeafe; border-radius: var(--sp-radius-sm); padding: var(--sp-2); margin-bottom: 0; }`,
  },
  {
    file: 'p-svg',
    title: 'p-svg 矢量图形',
    subtitle: 'UI 原语 · ui.svg · Web-first（MP 走 Skia 映射）',
    state: ``,
    codes: [['basic', `<!-- path = SVG path d 数据；颜色随 currentColor -->\n<p-svg path="M12 2 L22 22 L2 22 Z" :size="32" color="#4f6bff" />`]],
    demos: [
      {
        title: '路径渲染 + 尺寸 / 颜色（path / size / color）',
        desc: '★矢量优先（无位图）：path 的 fill 随 currentColor，颜色由 color 控制；size 同时设定宽高',
        code: 0,
        demo: `<p-view class="svg-row">
            <p-svg path="M12 2 L22 22 L2 22 Z" :size="32" color="#4f6bff" />
            <p-svg path="M12 2 A10 10 0 1 1 11.99 2 Z" :size="32" color="#07c160" />
            <p-svg path="M4 6 h16 v12 h-16 Z" :size="32" color="#e54d42" />
            <p-svg path="M12 2 L22 22 L2 22 Z" :size="48" color="#7c5cff" />
          </p-view>`,
        hasOutput: true,
        output: '★诚实边界：p-svg 当前是 **Web-first**（内联 svg 元素）——MP 端矢量映射走 Skia（后续批次）；需要跨端矢量图形时用 p-icon 或 SVG→image 路线',
      },
    ],
    styles: `.svg-row { display: flex; gap: var(--sp-3); align-items: center; background: #f7f8fa; border-radius: var(--sp-radius-sm); padding: var(--sp-3); }`,
  },
  {
    file: 'p-toolbar',
    title: 'p-toolbar 工具栏溢出折叠',
    subtitle: '页面外壳 · 溢出折叠 · 双端同源码',
    state: `const tbLast = ref('（暂无）')
const tbItems = ref([
  { key: 'bold', label: '加粗' },
  { key: 'italic', label: '斜体' },
  { key: 'under', label: '下划线' },
  { key: 'strike', label: '删除线' },
  { key: 'code', label: '代码' },
  { key: 'link', label: '链接' },
  { key: 'image', label: '图片' },
  { key: 'table', label: '表格' },
])
function onTbSelect(v: unknown): void {
  tbLast.value = String(v)
}`,
    codes: [['basic', `<!-- items: [{key,label}]；容器宽度不足时溢出项收进「更多」 -->\n<p-toolbar :items="items" :item-width="80" more-label="更多" @select="onSelect" />`]],
    demos: [
      {
        title: '溢出折叠（items / itemWidth / moreLabel / select）',
        desc: '★点任意项 emit select；容器不够宽时，放不下的项自动收进「更多」并显示数量角标（点「更多」展开）——★缩窄窗口可看到折叠变化',
        code: 0,
        demo: `<p-toolbar :items="tbItems" :item-width="72" more-label="更多" @select="onTbSelect" />`,
        hasOutput: true,
        output: '最后点击：{{ tbLast }}',
      },
    ],
    styles: ``,
  },
  {
    file: 'p-sidebar',
    title: 'p-sidebar 自适应导航栏',
    subtitle: '页面外壳 · 响应式侧栏 · 双端同源码',
    state: ``,
    codes: [['basic', `<!-- 容器宽 ≥ minSidebarWidth → 常驻侧栏；窄于此 → 折叠（点「导航」展开） -->\n<p-sidebar :min-sidebar-width="640" :nav-width="200" toggle-label="导航">\n  <template #nav><p-text>导航项</p-text></template>\n  <p-text>主内容</p-text>\n</p-sidebar>`]],
    demos: [
      {
        title: '响应式侧栏（窄容器 → 折叠态，点切换条展开）',
        desc: '★按**容器宽度**求解：≥ minSidebarWidth 常驻侧栏（side-rail），窄于此折叠为切换条——★点「☰ 导航」展开抽屉式导航（真交互）',
        code: 0,
        demo: `<p-sidebar class="sb-box" :min-sidebar-width="640" :nav-width="180" toggle-label="导航">
            <template #nav>
              <p-text class="sb-nav-item">概览</p-text>
              <p-text class="sb-nav-item">组件</p-text>
              <p-text class="sb-nav-item">能力</p-text>
            </template>
            <p-text>主内容区（侧栏随容器宽度自适应：宽则常驻，窄则折叠为切换条）</p-text>
          </p-sidebar>`,
        hasOutput: true,
        output: '★与 p-split 同族：容器级响应式（Web 用容器查询运行时，MP 用 SelectorQuery 测量）——业务零媒体查询代码',
      },
    ],
    styles: `.sb-box { background: #f7f8fa; border-radius: var(--sp-radius-sm); padding: var(--sp-2); }
.sb-nav-item { display: block; padding: 6px 8px; border-radius: var(--sp-radius-sm); background: #eef2ff; margin-bottom: 6px; }`,
  },
]

// ───────────────────────── ③ 渲染 ─────────────────────────

function renderPage(p) {
  const api = loadApi(p.file)
  if (!api) throw new Error(`无法从官网内容解析 API：${p.file}（website/content/components/${p.file}.md 缺失或无 Props 表）`)
  // ★生成期硬校验（2026-09-24 补）：API 表里不得出现「分隔行泄漏」或空行——
  //   此前 splitRow 的尾部空单元缺陷让 `|---|` 混进数据（渲染成 ["---","---","---"]），
  //   静默进了两个批次。宁可在生成时炸，也不要产出脏表（本仓「反静默」纪律）。
  for (const [name, table] of Object.entries({ Props: api.props, Events: api.events, 插槽: api.slots, 兼容进度: api.compat })) {
    for (const row of table) {
      const joined = row.join('')
      if (/^[-:\s|]*$/.test(joined) || row.some((c) => c === '')) {
        throw new Error(
          `API 表校验失败（${p.file} · ${name}）：疑似分隔行泄漏或空单元格 → ${JSON.stringify(row)}\n` +
            '  请检查 website/content/components/' + p.file + '.md 的表格格式与解析器（scripts/gen-component-demo-pages.mjs）',
        )
      }
    }
  }
  const imports = new Set(['PText'])
  // ★页面专用本地组件（如错误边界演示的 crash-probe）：从相对路径导入，**不属于** @proteus-vue/components。
  //   故先把它们的 PascalCase 名从扫描结果里排除（在扫描**之后**删，否则会被重新加回）。
  const localNames = (p.localComponents ?? []).map((n) => n.split('-').map((s) => s[0].toUpperCase() + s.slice(1)).join(''))
  for (const d of p.demos) for (const m of d.demo.matchAll(/<([a-z]+-[a-z-]+)/g)) {
    imports.add(
      m[1]
        .split('-')
        .map((s) => s[0].toUpperCase() + s.slice(1))
        .join(''),
    )
  }
  for (const n of localNames) imports.delete(n)
  const importList = [...imports].sort()
  const codeEntries = p.codes.map(([k, v]) => `  ${k}: ${JSON.stringify(v)},`).join('\n')
  const demoBlocks = p.demos
    .map((d, i) => {
      const idx = String(i + 1).padStart(2, '0')
      const hasOut = Boolean(d.hasOutput)
      const codeKey = p.codes[d.code][0]
      // ★属性值必须转义双引号：title/desc 里出现 `area="top"` 这类字面量时，
      //   直接拼进 title="…" 会让 Vue 解析器报「Attribute name cannot contain U+0022」
      //   （实测：p-safe 的 title 含 area="top" → Web 构建失败）→ 统一走 escAttr。
      const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      const open = `    <demo-block index="${idx}" title="${escAttr(d.title)}" desc="${escAttr(d.desc)}" :has-output="${hasOut}" :code="codes.${codeKey}">`
      const demoSlot = `      <template #demo>\n        ${d.demo}\n      </template>`
      // ★output 文本直接进模板插值 → 其中的 `<` 会被 Vue SFC 解析器当成真标签
      //   （实测：写 `<teleport to="body">` 字面量导致 "Element is missing end tag"、构建失败）
      //   → 统一转义尖括号（模板里按文本显示，语义不变）。
      const outText = String(d.output ?? '').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      const outSlot = hasOut ? `\n      <template #output>\n        <p-text class="out">${outText}</p-text>\n      </template>` : ''
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
import { ${[
        'ref',
        /\bwatch\(/.test(p.state ?? '') ? 'watch' : null,
        /\bnextTick\(/.test(p.state ?? '') ? 'nextTick' : null,
      ]
        .filter(Boolean)
        .join(', ')} } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
${(p.localComponents ?? []).map((n) => `import ${n.split('-').map((s) => s[0].toUpperCase() + s.slice(1)).join('')} from '../../../components/${n}/index.vue'`).join('\n')}${(p.localComponents ?? []).length ? '\n' : ''}import { ${importList.join(', ')} } from '@proteus-vue/components'

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
