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
  // ─────────────────── 批次 8（2026-09-24）：表单族 + 虚拟列表 + 能力入口（8 页，收官） ───────────────────
  {
    file: 'p-form',
    title: 'p-form 表单容器',
    subtitle: '内容与表单 · ui.form · 双端同源码',
    state: `const formModel = ref({ name: '', age: '' })
const formErrors = ref<Record<string, string>>({})
const formMsg = ref('（尚未提交）')
// ★规则放**页面**（不放 rules prop）：rules 是函数表，MP 端 WXML 数据无法承载函数——
//   表单校验留在这层既双端可用，也让「校验失败长什么样」立即可见。
function validateForm(): Record<string, string> {
  const errs: Record<string, string> = {}
  if (!String(formModel.value.name).trim()) errs.name = '请输入用户名'
  const age = String(formModel.value.age)
  if (!age) errs.age = '请输入年龄'
  else if (!/^\\d+$/.test(age)) errs.age = '年龄必须是数字'
  else if (Number(age) < 18) errs.age = '年龄需满 18 岁'
  return errs
}
function onSubmit(): void {
  const errs = validateForm()
  formErrors.value = errs
  formMsg.value = Object.keys(errs).length ? '校验未通过（见各字段下方红色提示）' : '校验通过 → submit 事件已触发'
}`,
    codes: [['basic', `<!-- form 提供表单语义 + submit 事件；字段与校验由页面组织 -->\n<p-form :model="model" layout="vertical" @submit="onSubmit">\n  <p-label for="f-name">用户名</p-label>\n  <p-input id="f-name" v-model="model.name" />\n  <p-button form-type="submit">提交</p-button>\n</p-form>`]],
    demos: [
      {
        title: '提交触发校验（submit + 字段错误回显）',
        desc: '★点「提交」触发校验：故意留空 → 各字段下方出现红色错误提示；填对后再点 → 提交通过（这是表单容器的真实职责：聚合校验时机与 submit 事件）',
        code: 0,
        demo: `<p-form layout="vertical" @submit="onSubmit">
            <p-view class="fd">
              <p-label for="f-name">用户名</p-label>
              <p-input id="f-name" :model-value="formModel.name" placeholder="留空试试" @update:model-value="(v: unknown) => { formModel.name = String(v ?? '') }" />
              <p-text v-if="formErrors.name" class="fe">{{ formErrors.name }}</p-text>
            </p-view>
            <p-view class="fd">
              <p-label for="f-age">年龄</p-label>
              <p-input id="f-age" :model-value="formModel.age" placeholder="试试 17 或 abc" @update:model-value="(v: unknown) => { formModel.age = String(v ?? '') }" />
              <p-text v-if="formErrors.age" class="fe">{{ formErrors.age }}</p-text>
            </p-view>
            <p-button size="small" form-type="submit">提交</p-button>
          </p-form>`,
        hasOutput: true,
        output: '{{ formMsg }}',
      },
    ],
    styles: `.fd { margin-bottom: var(--sp-3); }
.fe { display: block; color: #e54d42; font-size: 12px; margin-top: 4px; }`,
  },
  {
    file: 'p-selection',
    title: 'p-selection 局部文本选区',
    subtitle: '内容与表单 · ui.selection · 双端同源码',
    state: `const selDetail = ref('（用鼠标/手指划选上方文本试试）')
function onSelectionChange(d: unknown): void {
  const p = d as { isCollapsed?: boolean; selectedString?: string; firstOffset?: number; lastOffset?: number }
  selDetail.value = p?.isCollapsed
    ? '选区已折叠（未选中内容）'
    : \`选中 "\${p?.selectedString ?? ''}"（偏移 \${p?.firstOffset ?? 0}→\${p?.lastOffset ?? 0}）\`
}`,
    codes: [['basic', `<!-- 选区变化 emit selectionchange（载荷对齐小程序 event.detail） -->\n<p-selection @selectionchange="onSel">\n  <p-text>可划选的文本内容…</p-text>\n</p-selection>`]],
    demos: [
      {
        title: '划选文本 → selectionchange 载荷',
        desc: '★用鼠标拖拽划选下方文本：选中内容与偏移量会实时回显（载荷 isCollapsed / selectedString / firstOffset / lastOffset 对齐小程序同名事件）',
        code: 0,
        demo: `<p-selection class="sel-box" @selectionchange="onSelectionChange">
            <p-text>这是一段可以划选的文本内容。选中其中几个字，下方会实时显示选中的字符串与起止偏移——选区语义与小程序 selectionchange 事件对齐。</p-text>
          </p-selection>`,
        hasOutput: true,
        output: '{{ selDetail }}',
      },
    ],
    styles: `.sel-box { background: #f7f8fa; border-radius: var(--sp-radius-sm); padding: var(--sp-3); user-select: text; }`,
  },
  {
    file: 'p-keyboard-accessory',
    title: 'p-keyboard-accessory 键盘上方工具栏',
    subtitle: '页面外壳 · 键盘附属栏 · 双端同源码',
    state: `const kaVisible = ref(false)
function toggleKa(): void {
  kaVisible.value = !kaVisible.value
}`,
    codes: [['basic', `<!-- visible 缺省 undefined → 自动感知键盘高度；显式传值则可手动控制 -->\n<p-keyboard-accessory :visible="visible" :max-height="200">\n  <p-text>工具栏内容</p-text>\n</p-keyboard-accessory>`]],
    demos: [
      {
        title: '显式控制显隐（visible 受控）',
        desc: '★visible 不传 → 组件自动感知键盘高度（真机聚焦输入框时出现）；传布尔值 → 由页面控制。演示用**显式模式**展示样式与显隐（真实键盘检测需真机聚焦输入框）',
        code: 0,
        demo: `<p-button size="small" @click="toggleKa">{{ kaVisible ? '隐藏工具栏' : '显示工具栏' }}</p-button>
          <p-keyboard-accessory class="ka-box" :visible="kaVisible" :max-height="200">
            <p-text>工具栏（键盘上方固定，maxHeight 200px）</p-text>
          </p-keyboard-accessory>`,
        hasOutput: true,
        output: '★自动模式：内部经 visualViewport 判定「视口高度 < 基准高度 × 0.6」视为键盘弹起——真机上聚焦输入框即触发，无需业务代码',
      },
    ],
    styles: `.ka-box { background: #eef2ff; border: 1px solid #d6ddff; border-radius: var(--sp-radius-sm); padding: var(--sp-2); margin-top: var(--sp-2); }`,
  },
  {
    file: 'p-list-view',
    title: 'p-list-view 虚拟长列表',
    subtitle: '内容与表单 · 虚拟化长列表 · 双端同源码',
    state: `// ★500 条数据，但**只渲染可视窗口内那几行**（虚拟化）——渲染行数由 DOM 实测按钮/门禁验证
const lvItems = ref(Array.from({ length: 500 }, (_, i) => ({ title: '第 ' + (i + 1) + ' 行 · 固定行高 44px' })))
const lvCount = ref('点按钮实测 DOM 里真实渲染了多少行')
function countRendered(): void {
  // ★Web 端数真实 DOM 行数；MP 端无 document → 由真机断言覆盖（不假装测到）
  if (typeof document === 'undefined') {
    lvCount.value = '（MP 端请在真机断言中查看渲染行数）'
    return
  }
  // ★必须**限定在本页第一个列表内**数：页面上还有 virtual=false 的对照列表（500 行），
  //   全局 querySelectorAll('.plv-row') 会把两者相加（实测报出 507），得出误导性结论。
  const firstList = document.querySelectorAll('.p-list-view')[0]
  const n = firstList ? firstList.querySelectorAll('.plv-row').length : 0
  lvCount.value = \`数据 \${lvItems.value.length} 条 · 本列表 DOM 实际渲染 \${n} 行（虚拟化只渲染可视窗口）\`
}`,
    codes: [['basic', `<!-- items + itemHeight + height：只渲染可视窗口（含 bufferSize 行缓冲） -->\n<p-list-view :items="items" :item-height="44" :height="220" :buffer-size="2" />`],
      ['full', `<!-- virtual=false → 小列表可选全量渲染（省去切片与占位开销） -->\n<p-list-view :items="items" :virtual="false" :height="220" />`]],
    demos: [
      {
        title: '500 条数据 → 只渲染可视窗口（virtual 缺省开）',
        desc: '★滚动这个 500 行的列表：DOM 里始终只有可视区那几行（+2 行缓冲），滚动时靠占位块撑高——点按钮**实测**当前 DOM 行数',
        code: 0,
        demo: `<p-button size="small" @click="countRendered">数一数 DOM 实际渲染行数</p-button>
          <p-list-view class="lv-box" :items="lvItems" :item-height="44" :height="220" :buffer-size="2" />`,
        hasOutput: true,
        output: '{{ lvCount }}',
      },
      {
        title: '关掉虚拟化对照（virtual=false）',
        desc: 'virtual=false → 500 行全部进 DOM；★上下两块对比同样滚动，DOM 行数差异即虚拟化的实际效果',
        code: 1,
        demo: `<p-list-view class="lv-box" :items="lvItems" :virtual="false" :item-height="44" :height="220" />`,
      },
    ],
    styles: `.lv-box { border: 1px solid #e5e6eb; border-radius: var(--sp-radius-sm); margin-top: var(--sp-2); }`,
  },
  {
    file: 'p-virtual-list',
    title: 'p-virtual-list 虚拟化长列表（语义别名）',
    subtitle: '布局 · layout.virtual-list · 转发 p-list-view 单实现',
    state: `const vlItems = ref(Array.from({ length: 500 }, (_, i) => ({ title: '第 ' + (i + 1) + ' 行（p-virtual-list）' })))
const vlLog = ref('滚动列表看看（窗口跨行时才更新）')
function onVlScroll(): void {
  vlLog.value = '滚动事件 ' + Date.now().toString().slice(-4)
}`,
    codes: [['basic', `<!-- 与 p-list-view 同一实现（薄转发层，API 表面 items/itemHeight/height） -->\n<p-virtual-list :items="items" :item-height="44" :height="220" />`]],
    demos: [
      {
        title: '与 p-list-view 同机制（语义命名版）',
        desc: '★G-32 语义命名为 p-virtual-list；旧标签 virtual-list 兼容保留。它与 p-list-view 是**同一实现**（转发层），不存在第二套虚拟化代码',
        code: 0,
        demo: `<p-virtual-list class="vl-box" :items="vlItems" :item-height="44" :height="200" :buffer-size="2" />`,
        hasOutput: true,
        output: '★诚实说明：本页与 p-list-view 共用实现——页面价值在记录「两个标签同一个实现」这件事，避免后人误以为有两套虚拟化',
      },
    ],
    styles: `.vl-box { border: 1px solid #e5e6eb; border-radius: var(--sp-radius-sm); }`,
  },
  {
    file: 'p-location',
    title: 'p-location 定位能力入口',
    subtitle: '能力入口 · capability.location · 双端同源码',
    state: `const locMsg = ref('点按钮触发定位（浏览器会弹权限申请；拒绝 → 显式降级，不是静默失败）')
function onLocate(data: unknown): void {
  const c = data as { latitude?: number; longitude?: number; accuracy?: number }
  locMsg.value = \`✅ 定位成功：纬度 \${c?.latitude?.toFixed(4)} · 经度 \${c?.longitude?.toFixed(4)} · 精度 \${c?.accuracy?.toFixed(0)}m\`
}
function onLocateError(msg: unknown): void {
  locMsg.value = \`⚠ 降级（error 事件）：\${String(msg)}\`
}`,
    codes: [['basic', `<!-- 声明式入口：点击触发 useLocation()；成功 emit locate，失败 emit error -->\n<p-location label="获取当前位置" @locate="onLocate" @error="onLocateError" />`]],
    demos: [
      {
        title: '点击触发定位（locate / error 双事件）',
        desc: '★点按钮真调 `useLocation()`：允许授权 → locate 事件带经纬度；拒绝/不支持 → error 事件带机器码（**两条路径都是显式事件**，不会静默无反应）',
        code: 0,
        demo: `<p-location class="cap-entry" label="获取当前位置" @locate="onLocate" @error="onLocateError" />`,
        hasOutput: true,
        output: '{{ locMsg }}',
      },
    ],
    styles: `.cap-entry { background: #eef2ff; border-radius: var(--sp-radius-sm); padding: var(--sp-3); margin-bottom: var(--sp-2); }`,
  },
  {
    file: 'p-scan-qr',
    title: 'p-scan-qr 扫码能力入口',
    subtitle: '能力入口 · capability.scan-qr · 双端同源码',
    state: `const qrMsg = ref('点按钮触发扫码——Web 端能力不可用时会走显式降级（这正是要看的行为）')
function onScan(data: unknown): void {
  qrMsg.value = \`✅ 扫码成功：\${String(data)}\`
}
function onScanError(msg: unknown): void {
  qrMsg.value = \`⚠ 降级（error 事件）：\${String(msg)}｜Web 端无标准扫码 API → 框架给显式错误码，不是「点了没反应」\`
}`,
    codes: [['basic', `<!-- 成功 emit scan，失败 emit error（能力缺失是 error 路径，不是静默） -->\n<p-scan-qr label="扫一扫" @scan="onScan" @error="onScanError" />`]],
    demos: [
      {
        title: '点击触发扫码（Web 端展示显式降级路径）',
        desc: '★点按钮：Web 端 `webBridge` 无扫码实现 → 触发 **error 事件**并带机器码（真机小程序端走 `wx.scanCode` 成功路径）。★这个演示的意义正是「能力缺失时框架的行为必须可观测」',
        code: 0,
        demo: `<p-scan-qr class="cap-entry" label="扫一扫" @scan="onScan" @error="onScanError" />`,
        hasOutput: true,
        output: '{{ qrMsg }}',
      },
    ],
    styles: `.cap-entry { background: #fff7ed; border-radius: var(--sp-radius-sm); padding: var(--sp-3); margin-bottom: var(--sp-2); }`,
  },
  {
    file: 'p-pick-photo',
    title: 'p-pick-photo 选图能力入口',
    subtitle: '能力入口 · capability.album · 双端同源码',
    state: `const pickMsg = ref('点按钮从本地选一张图片（Web 走系统文件选择器；取消 → 显式降级）')
function onPick(data: unknown): void {
  const files = Array.isArray(data) ? data : []
  const first = files[0] as { path?: string; size?: number } | undefined
  pickMsg.value = \`✅ 已选 \${files.length} 张：\${first?.path?.slice(0, 60) ?? ''}\${first?.size ? ' · ' + Math.round(first.size / 1024) + 'KB' : ''}\`
}
function onPickError(msg: unknown): void {
  pickMsg.value = \`⚠ 降级（error 事件）：\${String(msg)}\`
}`,
    codes: [['basic', `<!-- 成功 emit pick（MediaFile[]），失败/取消 emit error -->\n<p-pick-photo label="选择图片" @pick="onPick" @error="onPickError" />`]],
    demos: [
      {
        title: '点击选图（Web 走 <input type=file>，取消/失败走 error）',
        desc: '★点按钮打开系统文件选择器：选中 → pick 事件带文件信息；取消 → **error 事件**（显式，不是静默）。★Web 端能力真实可用（`getAlbum.pick` 已实现），小程序端走 `wx.chooseMedia`',
        code: 0,
        demo: `<p-pick-photo class="cap-entry" label="选择图片" @pick="onPick" @error="onPickError" />`,
        hasOutput: true,
        output: '{{ pickMsg }}',
      },
    ],
    styles: `.cap-entry { background: #f2fbf5; border-radius: var(--sp-radius-sm); padding: var(--sp-3); margin-bottom: var(--sp-2); }`,
  },

// ───────────────────────── ②b 手写页迁移（2026-09-26）：26 个早期手写页（批次 1~3）并入 SSOT 生成 ─────────────────────────
  {
    file: 'p-ad',
    title: "p-ad 广告位",
    subtitle: "页面外壳 · 广告容器（Web 占位 / MP 原生）",
    codes: [
      ['banner', '<p-ad unit-id="adunit-xxxx" ad-type="banner" />'],
      ['video', '<p-ad unit-id="adunit-xxxx" ad-type="video" :ad-intervals="30" />'],
      ['theme', '<p-ad unit-id="adunit-xxxx" ad-theme="black" />'],
      ['slot', '<p-ad><p-view>自建广告内容</p-view></p-ad>'],
    ],
    demos: [
      {
        title: "Banner 广告",
        desc: "unit-id 为必填；Web 端显示占位（无广告联盟标准）",
        code: 0,
        demo: `<p-ad unit-id="adunit-demo-banner" ad-type="banner" />`,
      },
      {
        title: "视频广告与刷新间隔",
        desc: "ad-type=video；ad-intervals ≥30 秒自动刷新",
        code: 1,
        demo: `<p-ad unit-id="adunit-demo-video" ad-type="video" :ad-intervals="30" />`,
      },
      {
        title: "主题",
        desc: "ad-theme=black 深色主题（★官方 ad-theme）",
        code: 2,
        demo: `<p-ad unit-id="adunit-demo-theme" ad-theme="black" />`,
      },
      {
        title: "自建广告（插槽）",
        desc: "Web 端可用默认插槽替换占位，接入宿主自建广告桥",
        code: 3,
        demo: `<p-ad>
  <p-view class="custom-ad"><p-text>自建广告位（插槽内容）</p-text></p-view>
</p-ad>`,
        hasOutput: true,
        output: `插槽生效：占位文案被替换为自建内容`,
      },
    ],
    styles: `.custom-ad { padding: var(--sp-4); background: linear-gradient(135deg, #f0ecff, #e6f7ff); border-radius: 6px; text-align: center; }
.out { display: block; font-size: 12.5px; color: #2f7a4d; }`,
  },
  {
    file: 'p-button',
    title: "p-button 按钮",
    subtitle: "触发操作的按钮 · 双端同源码",
    state: `// 演示状态
const count = ref(0)
const loading = ref(false)
const lastEvent = ref('（暂无）')
const throttleCount = ref(0)
// ★主题皮肤（编译器通道）：theme 值 → 组件根节点单类变体，样式定义在组件自身 scoped wxss
const THEME_KEYS = ['', 'brand', 'success', 'danger', 'ghost']
const dynTheme = ref('brand')
const themeIdx = ref(1)
function cycleTheme() {
  themeIdx.value = (themeIdx.value + 1) % THEME_KEYS.length
  dynTheme.value = THEME_KEYS[themeIdx.value]
}
// ★平台宏演示：这些宏在构建期被替换为字面量 → 反映当前构建目标。
// ★模板里用宏必须**经 setup 绑定**（2026-09-24 类型检查暴露）：Vue 模板只解析 setup 返回值，
//   裸全局宏在模板里会被当作「组件实例属性」查询 → vue-tsc 报
//   「Property '__MP__' does not exist」（脚本区用同一宏却正常）。
//   故先读到具名常量，模板引用具名常量（宏替换仍由编译器完成）。
const mpMacro: boolean = __MP__
const webMacro: boolean = __WEB__
const targetMacro: string = __TARGET__
const isMpBuild = mpMacro
// open-type 双端事件回显
const openTypeLog = ref('（点击上面按钮）')
function onOpenTypeContact() {
  openTypeLog.value = 'contact 触发 ✓（MP 原生 / Web 降级同名）'
}
function onOpenTypeShare() {
  openTypeLog.value = 'share 触发 ✓（Web-only 降级；MP 走原生分享面板）'
}
function onContact(e: unknown) {
  lastEvent.value = 'contact 事件（开放能力）'
}
function onWebOnlyClick() {
  lastEvent.value = 'Web-only 按钮点击'
}

// 演示 1：基础点击
function onBasicClick() {
  count.value++
  lastEvent.value = \`click @ \${Date.now() % 100000}\`
}
// 演示 2：加载态（点击后 1.2s 恢复）
function onLoadingClick() {
  loading.value = true
  lastEvent.value = 'loading 开始'
  setTimeout(() => {
    loading.value = false
    lastEvent.value = 'loading 结束'
  }, 1200)
}
// 演示 4：节流（throttle=800ms 内重复点击被忽略）
function onThrottledClick() {
  throttleCount.value++
}`,
    codes: [
      ['basic', '<p-button @click="onBasicClick">点击我</p-button>'],
      ['disabled', '<p-button :disabled="true">禁用按钮</p-button>'],
      ['loading', '<p-button :loading="loading" @click="submit">提交</p-button>'],
      ['throttle', '<p-button :throttle="800" @click="onClick">连点试试</p-button>'],
      ['attrs', '<p-button size="mini">mini</p-button><p-button type="primary">primary</p-button><p-button type="warn">warn</p-button><p-button :plain="true">镂空</p-button>'],
      ['themes', '<p-button theme="brand">品牌</p-button><p-button theme="success">成功</p-button><p-button theme="danger">危险</p-button><p-button theme="ghost">幽灵</p-button>'],
      ['themeDynamic', '<p-button :theme="dynTheme" @click="cycleTheme">切换主题</p-button>'],
      ['macro', '<p-button v-if="mpMacro" open-type="contact">客服</p-button>\n<view v-if="__TARGET__ === \'web\'">仅 Web</view>'],
      ['openType', '<p-button open-type="contact" @contact="onContact">客服</p-button>\n<p-button open-type="share" @share="onShare">分享</p-button>'],
    ],
    demos: [
      {
        title: "基础用法",
        desc: "默认按钮，点击触发 click 事件",
        code: 0,
        demo: `<p-button @click="onBasicClick">点击我</p-button>`,
        hasOutput: true,
        output: `结果：点击次数 {{ count }}`,
      },
      {
        title: "禁用态",
        desc: "disabled 禁用交互；MP 端透传原生 disabled",
        code: 1,
        demo: `<view class="row">
  <p-button>可用按钮</p-button>
  <p-button :disabled="true">禁用按钮</p-button>
</view>`,
      },
      {
        title: "加载态",
        desc: "loading 期间自动禁用点击（透传 MP 原生 loading）",
        code: 2,
        demo: `<p-button :loading="loading" @click="onLoadingClick">提交</p-button>`,
        hasOutput: true,
        output: `结果：状态 {{ loading ? '加载中…' : '就绪' }}`,
      },
      {
        title: "点击节流",
        desc: "throttle=800ms：间隔内的重复点击被忽略（防连点重复提交）",
        code: 3,
        demo: `<p-button :throttle="800" @click="onThrottledClick">连点试试</p-button>`,
        hasOutput: true,
        output: `结果：生效 {{ throttleCount }} 次 · 快速连点计数明显少于点击次数即节流生效`,
      },
      {
        title: "事件回显",
        desc: "click 事件的实时回显（弹起气泡 + 组合事件语义）",
        demo: `<p-button @click="onBasicClick">触发事件</p-button>`,
        hasOutput: true,
        output: `结果：最后事件 {{ lastEvent }}`,
      },
      {
        title: "官方属性对齐",
        desc: "size / type / plain —— 对齐小程序原生 button 视觉变体",
        code: 4,
        demo: `<view class="row">
  <p-button size="mini">mini</p-button>
  <p-button type="primary">primary</p-button>
  <p-button type="warn">warn</p-button>
  <p-button :plain="true">镂空</p-button>
</view>`,
      },
      {
        title: "主题皮肤（编译器通道）",
        desc: "theme 属性 → 编译期落成组件根节点单类变体，样式在组件自身 scoped wxss 内定义（不跨组件边界 → 绕过小程序样式隔离）",
        code: 5,
        demo: `<view class="row">
  <p-button theme="brand">品牌</p-button>
  <p-button theme="success">成功</p-button>
  <p-button theme="danger">危险</p-button>
  <p-button theme="ghost">幽灵</p-button>
</view>`,
      },
      {
        title: "主题动态切换",
        desc: "theme 支持运行时变量（:theme 绑定）——点击循环切换，无需刷新页面",
        code: 6,
        demo: `<view class="row">
  <p-button :theme="dynTheme" @click="cycleTheme">切换主题</p-button>
</view>`,
        hasOutput: true,
        output: `当前主题：{{ dynTheme || '（框架缺省）' }}`,
      },
      {
        title: "平台条件显隐（编译期宏）",
        desc: "标准 v-if + 构建期宏 __MP__/__WEB__/__TARGET__——编译期静态裁剪，死分支不进产物（替代 uni-app 的 #ifdef，零新语法）",
        code: 7,
        demo: `<view class="row">
  <!-- ★仅小程序：open-type 开放能力（Web 无对等，编译期整块消除） -->
  <p-button v-if="mpMacro" open-type="contact" @contact="onContact">客服会话（仅小程序）</p-button>
  <p-button v-if="webMacro" @click="onWebOnlyClick">Web 端占位</p-button>
  <view v-if="targetMacro === 'web'" class="macro-note">当前构建目标：Web</view>
  <view v-else class="macro-note">当前构建目标：小程序</view>
</view>`,
      },
      {
        title: "open-type 双端事件契约",
        desc: "同一 @contact 两端都触发：MP 原生开放能力；Web 无对等 → 发同名降级事件（事件名与 MP 对齐，无需条件编译）",
        code: 8,
        demo: `<view class="row">
  <p-button open-type="contact" @contact="onOpenTypeContact">客服会话（@contact）</p-button>
  <p-button open-type="share" @share="onOpenTypeShare">分享（@share，Web 降级）</p-button>
</view>`,
        hasOutput: true,
        output: `结果：{{ openTypeLog }}`,
      },
    ],
    styles: `/* ★align-items:center（2026-09-13）：裸 flex 默认 align-items:stretch 会把矮按钮（mini）**拉伸**到
   与最高按钮同高——Web 端实测 mini 被拉到 37px，而小程序端保持自然高 32px → 用户看到「两端尺寸差别大」。
   显式 center 让各按钮保持自身高度（两端一致）。 */
.row { display: flex; flex-direction: row; align-items: center; gap: var(--sp-3); flex-wrap: wrap; }
.out {
  display: block;
  background: #f2fbf5;
  border: 1px solid #d6f0e0;
  border-radius: var(--sp-radius-sm);
  padding: var(--sp-2) var(--sp-3);
  font-size: 12.5px;
  color: #2f7a4d;
  font-weight: 600;
}
.macro-note {
  display: block;
  font-size: 12px;
  color: var(--sp-text-3);
  padding: var(--sp-2) 0;
}`,
  },
  {
    file: 'p-camera',
    title: "p-camera 相机",
    subtitle: "内容基元 · 相机预览与拍照（Web 需授权）",
    state: `const state = ref('等待相机事件…')
function onReady() { state.value = 'ready：Web 相机已启动' }
function onInitDone() { state.value = 'initdone：MP 相机初始化完成' }
function onError(e: unknown) { state.value = 'error：' + JSON.stringify(e) }`,
    codes: [
      ['base', '<p-camera @initdone="onInitDone" />'],
      ['front', '<p-camera device-position="front" flash="on" />'],
      ['res', '<p-camera resolution="high" frame-size="large" />'],
      ['scan', '<p-camera mode="scanCode" @scancode="onScanCode" />'],
    ],
    demos: [
      {
        title: "相机预览",
        desc: "MP 原生 <camera>；Web getUserMedia（未授权时显示明确提示）",
        code: 0,
        demo: `<p-camera @ready="onReady" @initdone="onInitDone" @error="onError" />`,
        hasOutput: true,
        output: `{{ state }}`,
      },
      {
        title: "朝向与闪光灯",
        desc: "device-position=front 前置；flash=on 强制闪光",
        code: 1,
        demo: `<p-camera device-position="front" flash="on" />`,
      },
      {
        title: "分辨率与帧尺寸",
        desc: "resolution / frame-size（★仅初始化生效，不可动态修改）",
        code: 2,
        demo: `<p-camera resolution="high" frame-size="large" />`,
      },
      {
        title: "扫码模式",
        desc: "mode=scanCode：MP 端原生扫码；Web 端无对等能力（诚实降级为普通预览）",
        code: 3,
        demo: `<p-camera mode="scanCode" @error="onError" />`,
      },
    ],
    styles: `.out { display: block; font-size: 12.5px; color: #2f7a4d; }`,
  },
  {
    file: 'p-canvas',
    title: "p-canvas 画布",
    subtitle: "内容基元 · 2d / webgl 上下文 + 高清倍率",
    state: `const info = ref('canvas-id 已生成；改用 canvas-id 属性可自定义句柄标识')`,
    codes: [
      ['base', '<p-canvas :width="240" :height="140" />'],
      ['id', '<p-canvas canvas-id="main-canvas" :width="240" :height="140" />'],
      ['scroll', '<p-canvas :disable-scroll="true" />'],
      ['dpr', '<p-canvas :resolution="2" :width="120" :height="80" />'],
    ],
    demos: [
      {
        title: "基础画布",
        desc: "engine 缺省 2d；canvas-id 由组件自动生成保证唯一",
        code: 0,
        demo: `<p-canvas :width="240" :height="140" />`,
      },
      {
        title: "自定义 canvas-id",
        desc: "canvas-id 是绘制上下文的句柄标识（指定后无需再传 type）",
        code: 1,
        demo: `<p-canvas canvas-id="main-canvas" :width="240" :height="140" />`,
        hasOutput: true,
        output: `{{ info }}`,
      },
      {
        title: "禁止画布内滚动",
        desc: "disable-scroll：画布中的手势不触发页面滚动/下拉刷新",
        code: 2,
        demo: `<p-canvas :disable-scroll="true" :width="240" :height="140" />`,
      },
      {
        title: "高清倍率",
        desc: "resolution=2 → 内部分辨率翻倍（CSS 尺寸不变，渲染更清晰）",
        code: 3,
        demo: `<p-canvas :resolution="2" :width="120" :height="80" />`,
      },
    ],
    styles: `.out { display: block; font-size: 12.5px; color: #2f7a4d; }`,
  },
  {
    file: 'p-checkbox',
    title: "p-checkbox 多选",
    subtitle: "复选框 · 自绘小方框双端一致",
    state: `const on = ref(true)
const onColor = ref(true)
const lastEvent = ref('（暂无）')

// ★事件契约：change 载荷 { detail: { value: 选中态, name: 群选标识 } }
// ★跨端事件载荷读法（框架约定）：组件 emit 裸载荷 → Web 端 handler 直接收到载荷，
//   MP 端收到的事件对象 \`e.detail\` 才是载荷 → \`e?.detail ?? e\` 两端通吃。
function payload(e: unknown): { value?: unknown; name?: string } {
  const p = e as { detail?: { value?: unknown; name?: string } }
  return (p?.detail ?? p) as { value?: unknown; name?: string }
}
function onChange(e: unknown) {
  const d = payload(e)
  lastEvent.value = \`\${d?.name || '单个'} → \${d?.value}\`
}

// 群选：value 作标识，选中态各自 v-model
const fruits = ref([
  { id: 'apple', name: '苹果' },
  { id: 'banana', name: '香蕉' },
  { id: 'cherry', name: '樱桃' },
])
// ★MP 约束：ref 不带类型实参（初值须可静态求值）；类型用「字面量 as 断言」（断言在字面量上，编译期剥离后仍是字面量）
// ★类型（2026-09-24 类型检查暴露）：模板用 picked[f.id] 索引 → 需索引签名，
//   否则 TS7053「不能用作索引类型」（此前页面不在类型检查范围内的漏网项）
const picked = ref<Record<string, boolean>>({ apple: true, banana: false, cherry: false })
const pickedCount = computed(() => Object.values(picked.value).filter(Boolean).length)
function onGroupChange(e: unknown) {
  // ★跨端读法：e?.detail ?? e（Web 直接收载荷、MP 收 e.detail）
  const raw = e as { detail?: { name?: string; value?: unknown }; name?: string; value?: unknown }
  const d = (raw?.detail ?? raw) as { name?: string; value?: unknown }
  // ★整体替换写法：ref 无类型实参、初值可静态求值；拼新对象 → 编译器走 setData 路径。
  //   （ref 对象「嵌套字段写」亦受框架支持，见 registry 的 script/ref-nested-write；
  //    注释内不写具体代码形态，避免被编译器规则误匹配。）
  if (d?.name) picked.value = { ...picked.value, [d.name]: Boolean(d.value) }
}`,
    codes: [
      ['basic', '<p-checkbox v-model="on" @change="onChange">同意协议</p-checkbox>'],
      ['indeterminate', '<p-checkbox :model-value="false" :indeterminate="true">半选</p-checkbox>'],
      ['disabled', '<p-checkbox :model-value="true" disabled>禁用（已选）</p-checkbox>'],
      ['color', '<p-checkbox v-model="on" color="#7c5cff">品牌紫</p-checkbox>'],
      ['group', '<p-checkbox v-for="f in fruits" :key="f.id" :value="f.id" :model-value="picked[f.id]" @change="onGroupChange">{{ f.name }}</p-checkbox>'],
    ],
    demos: [
      {
        title: "基础用法（受控 v-model）",
        desc: "v-model 受控；切换触发 change（载荷含选中态与标识）",
        code: 0,
        demo: `<view class="row">
  <p-checkbox v-model="on" value="agree" @change="onChange">同意协议</p-checkbox>
</view>`,
        hasOutput: true,
        output: `状态：{{ on ? '已勾选' : '未勾选' }} · 最后事件：{{ lastEvent }}`,
      },
      {
        title: "半选态",
        desc: "indeterminate 表达「部分选中」（★框架扩展；常用于全选组）",
        code: 1,
        demo: `<view class="row">
  <p-checkbox :model-value="false" :indeterminate="true">半选</p-checkbox>
  <p-checkbox :model-value="true">全选</p-checkbox>
  <p-checkbox :model-value="false">未选</p-checkbox>
</view>`,
      },
      {
        title: "禁用态",
        desc: "disabled 不可交互 + 淡化（★两端状态视觉统一）",
        code: 2,
        demo: `<view class="row">
  <p-checkbox :model-value="true" disabled>禁用（已选）</p-checkbox>
  <p-checkbox :model-value="false" disabled>禁用（未选）</p-checkbox>
</view>`,
      },
      {
        title: "自定义颜色",
        desc: "color 设定选中色（★官方 color 属性；缺省微信绿）",
        code: 3,
        demo: `<view class="row">
  <p-checkbox v-model="onColor" color="#7c5cff">品牌紫</p-checkbox>
</view>`,
      },
      {
        title: "群选（value 标识）",
        desc: "多个 checkbox 用 value 区分标识；change 携带 name 回传选中项",
        code: 4,
        demo: `<view class="row">
  <p-checkbox
    v-for="f in fruits"
    :key="f.id"
    :model-value="picked[f.id]"
    :value="f.id"
    @change="onGroupChange"
  >{{ f.name }}</p-checkbox>
</view>`,
        hasOutput: true,
        output: `已选 {{ pickedCount }} / {{ fruits.length }} 项`,
      },
    ],
    styles: `.row { display: flex; flex-direction: row; align-items: center; gap: var(--sp-4); flex-wrap: wrap; }
.out {
  display: block;
  background: #f2fbf5;
  border: 1px solid #d6f0e0;
  border-radius: var(--sp-radius-sm);
  padding: var(--sp-2) var(--sp-3);
  font-size: 12.5px;
  color: #2f7a4d;
  font-weight: 600;
}`,
  },
  {
    file: 'p-draggable',
    title: "p-draggable 可拖拽",
    subtitle: "手势原语 · 容器内拖动（MP movable-view / Web Pointer）",
    state: `const pos1 = ref('x: 0, y: 0')
const pos2 = ref('x: 0, y: 0')
const pos3 = ref('x: 0, y: 0')

function onChange1(e: unknown) { const d = e as { x?: number; y?: number }; pos1.value = 'x: ' + (d?.x ?? 0) + ', y: ' + (d?.y ?? 0) }
function onChange2(e: unknown) { const d = e as { x?: number; y?: number }; pos2.value = 'x: ' + (d?.x ?? 0) + ', y: ' + (d?.y ?? 0) }
function onChange3(e: unknown) { const d = e as { x?: number; y?: number }; pos3.value = 'x: ' + (d?.x ?? 0) + ', y: ' + (d?.y ?? 0) }`,
    codes: [
      ['base', '<p-draggable direction="all" @change="onChange">拖动我</p-draggable>'],
      ['snap', '<p-draggable direction="all" :snap-to-grid="24" ghost @change="onChange">网格吸附</p-draggable>'],
      ['axis', '<p-draggable direction="horizontal" @change="onChange">仅横向</p-draggable>'],
      ['inertia', '<p-draggable direction="all" inertia :damping="20" :friction="2" out-of-bounds />'],
    ],
    demos: [
      {
        title: "自由拖动",
        desc: "direction=all 容器内自由移动；change 回显实时坐标",
        code: 0,
        demo: `<p-view class="stage">
  <p-draggable direction="all" @change="onChange1">
    <p-view class="chip"><p-text>拖动我</p-text></p-view>
  </p-draggable>
</p-view>`,
        hasOutput: true,
        output: `{{ pos1 }}`,
      },
      {
        title: "网格吸附 + 拖影",
        desc: "snap-to-grid=24 吸附到 24px 网格；ghost 拖动时半透明",
        code: 1,
        demo: `<p-view class="stage">
  <p-draggable direction="all" :snap-to-grid="24" ghost @change="onChange2">
    <p-view class="chip chip--alt"><p-text>吸附 24px</p-text></p-view>
  </p-draggable>
</p-view>`,
        hasOutput: true,
        output: `{{ pos2 }}`,
      },
      {
        title: "轴向约束 / 禁用",
        desc: "direction=horizontal 仅横向；disabled 完全禁止拖动",
        code: 2,
        demo: `<p-view class="stage stage--short">
  <p-draggable direction="horizontal" @change="onChange3">
    <p-view class="chip"><p-text>仅横向</p-text></p-view>
  </p-draggable>
  <p-draggable direction="all" disabled>
    <p-view class="chip chip--off"><p-text>已禁用</p-text></p-view>
  </p-draggable>
</p-view>`,
        hasOutput: true,
        output: `{{ pos3 }}`,
      },
      {
        title: "惯性 / 阻尼 / 越界",
        desc: "inertia + damping + friction + out-of-bounds（官方物理族）",
        code: 3,
        demo: `<p-view class="stage">
  <p-draggable direction="all" inertia :damping="20" :friction="2" out-of-bounds>
    <p-view class="chip chip--alt"><p-text>惯性拖动</p-text></p-view>
  </p-draggable>
</p-view>`,
      },
    ],
    styles: `.stage { position: relative; height: 160px; border: 1px dashed var(--p-border, #d8d8dc); border-radius: var(--sp-radius-sm); background: #fafafc; padding: var(--sp-3); overflow: hidden; }
.stage--short { display: flex; flex-direction: column; gap: var(--sp-3); height: auto; }
.chip { display: inline-block; padding: var(--sp-2) var(--sp-3); background: #7c5cff; color: #fff; border-radius: 999px; font-size: 13px; }
.chip--alt { background: #22b573; }
.chip--off { background: #c8c9cc; }
.out { display: block; font-size: 12.5px; color: #2f7a4d; }`,
  },
  {
    file: 'p-icon',
    title: "p-icon 图标",
    subtitle: "内容基元 · 内置矢量字形，零资源",
    codes: [
      ['types', '<p-icon type="success" /><p-icon type="info" /><p-icon type="warn" /><p-icon type="waiting" />'],
      ['size', '<p-icon name="star" :size="24" color="#ffc300" />'],
      ['spin', '<p-icon name="waiting" :spin="true" />'],
    ],
    demos: [
      {
        title: "官方 type 取值",
        desc: "对齐官方 <icon> 的 type 语义（success/info/warn/waiting…）",
        code: 0,
        demo: `<view class="row">
  <p-icon type="success" />
  <p-icon type="success_no_circle" />
  <p-icon type="info" />
  <p-icon type="warn" />
  <p-icon type="waiting" />
  <p-icon type="cancel" />
  <p-icon type="download" />
  <p-icon type="clear" />
</view>`,
      },
      {
        title: "尺寸与颜色",
        desc: "size 控制字号与盒尺寸；color 同 CSS color",
        code: 1,
        demo: `<view class="row">
  <p-icon name="star" :size="16" color="#ffc300" />
  <p-icon name="star" :size="24" color="#ffc300" />
  <p-icon name="heart" :size="24" color="#ef4d4d" />
  <p-icon name="search" :size="24" color="#1a7af8" />
</view>`,
      },
      {
        title: "旋转与常用名",
        desc: "spin 旋转（加载态）；name 走框架字形表",
        code: 2,
        demo: `<view class="row">
  <p-icon name="back" :size="20" />
  <p-icon name="more" :size="20" />
  <p-icon name="home" :size="20" />
  <p-icon name="user" :size="20" />
  <p-icon name="waiting" :size="20" :spin="true" />
</view>`,
      },
    ],
    styles: `.row { display: flex; flex-direction: row; align-items: center; gap: var(--sp-4); flex-wrap: wrap; }`,
  },
  {
    file: 'p-image',
    title: "p-image 图片",
    subtitle: "内容基元 · 三种裁剪模式 + 懒加载 + 渐显",
    state: `// ★内联 SVG 必须 **base64** data-URI：Skyline <image> 只完整渲染 base64 编码的 SVG
//   （URL-encoded 形态真机渲染为**灰色方块**——见 docs/skyline-pitfalls.md / svg-lower.ts 地基实证）。
// ★★字面量必须**直接内联进 ref()**：\`ref(SOME_CONST)\`（标识符初值）编译器**静态求值不出** → data.img1 = undefined
//   → MP 端图片 src 为空（真机不显示），而 Web 正常（编译期 inject 保留变量）。见 S33 / S57。
const img1 = ref('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMDAiIGhlaWdodD0iMjAwIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjN2M1Y2ZmIi8+PGNpcmNsZSBjeD0iMTAwIiBjeT0iMTAwIiByPSI1MiIgZmlsbD0iI2ZmZmZmZiIgb3BhY2l0eT0iMC45Ii8+PC9zdmc+')
const img2 = ref('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMDAiIGhlaWdodD0iMTAwIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjMjJiNTczIi8+PHBhdGggZD0iTTEwMCAyMiBMMTUwIDc4IEw1MCA3OCBaIiBmaWxsPSIjZmZmZmZmIiBvcGFjaXR5PSIwLjkyIi8+PC9zdmc+')
const loaded = ref('等待图片 load 事件…')
function onLoad() {
  loaded.value = '✅ load 事件已触发（图片载入完成）'
}`,
    codes: [
      ['fill', '<p-image src="…" mode="aspectFill" />'],
      ['lazy', '<p-image src="…" lazy-load fade-in @load="onLoad" />'],
      ['menu', '<p-image src="…" show-menu-by-longpress />'],
    ],
    demos: [
      {
        title: "裁剪模式（mode）",
        desc: "aspectFill=覆盖 / widthFix=宽满自适应 / scaleToFill=拉伸填充",
        code: 0,
        demo: `<view class="row">
  <view class="frame"><p-image :src="img1" mode="aspectFill" /></view>
  <view class="frame frame--wide"><p-image :src="img2" mode="widthFix" /></view>
  <view class="frame"><p-image :src="img1" mode="scaleToFill" /></view>
</view>`,
      },
      {
        title: "懒加载与渐显",
        desc: "lazy-load 进入范围才加载；fade-in 加载完成淡入（★官方 lazy-load / fade-in）",
        code: 1,
        demo: `<view class="frame"><p-image :src="img1" lazy-load fade-in @load="onLoad" /></view>`,
        hasOutput: true,
        output: `{{ loaded }}`,
      },
      {
        title: "长按菜单",
        desc: "show-menu-by-longpress 长按显示菜单（★官方 show-menu-by-longpress）",
        code: 2,
        demo: `<view class="frame"><p-image :src="img1" show-menu-by-longpress /></view>`,
      },
    ],
    styles: `.row { display: flex; flex-direction: row; align-items: flex-start; gap: var(--sp-3); flex-wrap: wrap; }
.frame { width: 100px; height: 100px; overflow: hidden; border-radius: var(--sp-radius-sm); background: #f2f2f4; }
.frame--wide { width: 200px; height: auto; }
.out { display: block; font-size: 12.5px; color: #2f7a4d; }`,
  },
  {
    file: 'p-input',
    title: "p-input 输入框",
    subtitle: "文本输入 · 受控组件（value + input 回写）",
    state: `const lastInput = ref('')
const text = ref('')
const numVal = ref('')
const pwdVal = ref('')
const limited = ref('')
const lastEvent = ref('（暂无）')

// ★事件载荷契约：p-input emit **{ value }**（无 detail 包裹——见 examples 的正确接法）。
//   此前误按 MP 原生 e.detail.value 取值 → 恒 undefined → 「输入后结果不变化」（真机+Web 复现）。
function pickValue(e: unknown): string {
  const p = e as { value?: string; detail?: { value?: string } }
  return String(p?.value ?? p?.detail?.value ?? '')
}
function onInput(e: unknown) {
  const v = pickValue(e)
  lastInput.value = v
  text.value = v
}
function onNumInput(e: unknown) { numVal.value = pickValue(e) }
function onPwdInput(e: unknown) { pwdVal.value = pickValue(e) }
function onLimitedInput(e: unknown) { limited.value = pickValue(e) }
function evt(name: string) {
  lastEvent.value = name + ' @ ' + (Date.now() % 100000)
}`,
    codes: [
      ['basic', '<p-input placeholder="请输入" @input="onInput" />'],
      ['controlled', '<p-input :value="text" @input="onInput" />'],
      ['types', '<p-input type="number" /><p-input type="password" />'],
      ['maxlength', '<p-input :maxlength="10" />'],
      ['focus', '<p-input :focus="true" />'],
      ['disabled', '<p-input :disabled="true" value="禁用内容" />'],
    ],
    demos: [
      {
        title: "基础用法",
        desc: "受控输入：@input 事件回传 { value }",
        code: 0,
        demo: `<p-input placeholder="请输入内容" @input="onInput" />`,
        hasOutput: true,
        output: `结果：实时输入 {{ lastInput || '（空）' }}`,
      },
      {
        title: "受控绑定",
        desc: "value 受控 + @input 回写（v-model 的双端等价写法）",
        code: 1,
        demo: `<p-input :value="text" placeholder="输入后同步到下方" @input="onInput" />`,
        hasOutput: true,
        output: `结果：同步值 {{ text || '（空）' }} · 长度 {{ text.length }}`,
      },
      {
        title: "输入类型",
        desc: "type=number 数字键盘 / type=password 密码遮蔽",
        code: 2,
        demo: `<view class="col">
  <p-input type="number" placeholder="数字键盘" @input="onNumInput" />
  <p-input type="password" placeholder="密码输入" @input="onPwdInput" />
</view>`,
        hasOutput: true,
        output: `结果：number={{ numVal || '空' }} · password={{ pwdVal ? '已输入' + pwdVal.length + '位' : '空' }}`,
      },
      {
        title: "字数限制",
        desc: "maxlength=10 限制最大输入长度",
        code: 3,
        demo: `<p-input :maxlength="10" placeholder="最多 10 字" @input="onLimitedInput" />`,
        hasOutput: true,
        output: `结果：已输入 {{ limited.length }} / 10`,
      },
      {
        title: "自动聚焦",
        desc: "focus=true 时进入页面即获取焦点（调起键盘）",
        code: 4,
        demo: `<p-input :focus="true" placeholder="进入即聚焦" />`,
      },
      {
        title: "禁用态",
        desc: "disabled 不可编辑",
        code: 5,
        demo: `<p-input :disabled="true" value="禁用内容" />`,
      },
      {
        title: "事件回显",
        desc: "focus / blur / confirm 事件实时回显",
        demo: `<p-input placeholder="聚焦 / 失焦 / 回车试试" @focus="evt('focus')" @blur="evt('blur')" @confirm="evt('confirm')" />`,
        hasOutput: true,
        output: `结果：最后事件 {{ lastEvent }}`,
      },
    ],
    styles: `.col { display: flex; flex-direction: column; gap: var(--sp-3); }
.out {
  display: block;
  background: #f2fbf5;
  border: 1px solid #d6f0e0;
  border-radius: var(--sp-radius-sm);
  padding: var(--sp-2) var(--sp-3);
  font-size: 12.5px;
  color: #2f7a4d;
  font-weight: 600;
}`,
  },
  {
    file: 'p-map',
    title: "p-map 地图",
    subtitle: "页面外壳 · 地图容器（MP 原生 / Web 宿主槽位）",
    state: `const near = ref('等待 markertap / regionchange 事件…')
function onMarkerTap(e: unknown) { near.value = 'markertap: ' + JSON.stringify(e) }
function onRegionChange(e: unknown) { const d = e as { type?: string }; near.value = 'regionchange: type=' + (d?.type ?? 'unknown') }

// ★字面量直接内联进 ref()（编译器静态求值：标识符初值 → data undefined，见 S33/S57）
const marker = ref([{ id: 1, latitude: 39.908823, longitude: 116.39747, title: '天安门' }])
const line = ref([{ points: [{ latitude: 39.908823, longitude: 116.39747 }, { latitude: 39.918823, longitude: 116.40747 }], color: '#7c5cff', width: 4 }])`,
    codes: [
      ['base', '<p-map :latitude="39.90" :longitude="116.39" :scale="16" />'],
      ['marker', '<p-map :markers="marker" @markertap="onMarkerTap" />'],
      ['scale', '<p-map :min-scale="5" :max-scale="18" />'],
      ['view', '<p-map :rotate="30" :skew="20" show-compass show-scale />'],
      ['enable', '<p-map enable-satellite enable-traffic :enable-rotate="false" />'],
    ],
    demos: [
      {
        title: "基础地图",
        desc: "latitude / longitude / scale 定位与缩放",
        code: 0,
        demo: `<p-map :latitude="39.908823" :longitude="116.39747" :scale="16" :height="220" />`,
      },
      {
        title: "标记点与事件",
        desc: "markers 标注；点击标记/拖动视野经事件回显（Web 端需宿主接 SDK 才有交互）",
        code: 1,
        demo: `<p-map :markers="marker" :height="220" @markertap="onMarkerTap" @regionchange="onRegionChange" />`,
        hasOutput: true,
        output: `{{ near }}`,
      },
      {
        title: "缩放范围与路线",
        desc: "min-scale / max-scale 约束缩放；polyline 绘制路线",
        code: 2,
        demo: `<p-map :min-scale="5" :max-scale="18" :polyline="line" :height="220" />`,
      },
      {
        title: "视角与指南针",
        desc: "rotate / skew 视角倾斜 + 指南针与比例尺",
        code: 3,
        demo: `<p-map :rotate="30" :skew="20" show-compass show-scale :height="220" />`,
      },
      {
        title: "图层开关",
        desc: "卫星图 / 路况 / POI / 建筑物等图层启用族",
        code: 4,
        demo: `<p-view class="wrap">
  <p-map enable-satellite :enable-poi="false" :height="200" />
</p-view>`,
      },
    ],
    styles: `.wrap { display: block; }
.out { display: block; font-size: 12.5px; color: #2f7a4d; }`,
  },
  {
    file: 'p-media',
    title: "p-media 媒体",
    subtitle: "内容基元 · image / video / audio / live 统一入口",
    state: `// ★字面量直接内联进 ref()（编译器静态求值：标识符初值 → data undefined，见 S33/S57）
const cover = ref('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMjAiIGhlaWdodD0iMTgwIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjMjIyMjI2Ii8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZpbGw9IiNmZmYiIGZvbnQtc2l6ZT0iMTYiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuMzVlbSI+5bCB6Z2iPC90ZXh0Pjwvc3ZnPg==')
const state = ref('等待播放事件…')
function onPlay() { state.value = '▶ play 事件（播放中）' }
function onPause() { state.value = '⏸ pause 事件（已暂停）' }
function onEnded() { state.value = '⏹ ended 事件（播放结束）' }`,
    codes: [
      ['image', '<p-media kind="image" src="…" />'],
      ['video', '<p-media kind="video" src="…" :poster="cover" controls object-fit="contain" />'],
      ['ctrl', '<p-media kind="video" :show-center-play-btn="false" :show-fullscreen-btn="false" />'],
      ['live', '<p-media kind="live" src="…" is-live />'],
    ],
    demos: [
      {
        title: "图片",
        desc: "kind=image 走图片分支（等价 p-image 的宽满自适应）",
        code: 0,
        demo: `<p-view class="frame"><p-media kind="image" :src="cover" /></p-view>`,
      },
      {
        title: "视频与播放事件",
        desc: "controls/object-fit/poster 透传；播放状态经事件回显（★浏览器自动播放策略可能需先点击）",
        code: 1,
        demo: `<p-view class="frame"><p-media kind="video" :src="''" :poster="cover" controls object-fit="contain" @play="onPlay" @pause="onPause" @ended="onEnded" /></p-view>`,
        hasOutput: true,
        output: `{{ state }}`,
      },
      {
        title: "控件显隐族",
        desc: "show-center-play-btn / show-fullscreen-btn 等控制原生控件显示",
        code: 2,
        demo: `<p-view class="frame"><p-media kind="video" :src="''" :poster="cover" :show-center-play-btn="false" :show-fullscreen-btn="false" /></p-view>`,
      },
      {
        title: "直播源",
        desc: "kind=live + is-live（★官方 is-live；MP 端原生 video 承接）",
        code: 3,
        demo: `<p-view class="frame"><p-media kind="live" :src="''" :poster="cover" :is-live="true" /></p-view>`,
      },
    ],
    styles: `.frame { width: 320px; max-width: 100%; border-radius: var(--sp-radius-sm); overflow: hidden; }
.out { display: block; font-size: 12.5px; color: #2f7a4d; }`,
  },
  {
    file: 'p-nav-bar',
    title: "p-nav-bar 导航栏",
    subtitle: "页面外壳 · 对齐官方 navigation-bar",
    state: `const lastEvent = ref('（点击返回观察 back 事件）')
function onBack() {
  lastEvent.value = 'back 事件触发（页面决定导航，组件不直接调路由）'
}`,
    codes: [
      ['base', '<p-nav-bar title="页面标题" />'],
      ['back', '<p-nav-bar title="详情页" back @back="onBack" />'],
      ['slots', '<p-nav-bar title="插槽"><template #right><p-icon name="more" /></template></p-nav-bar>'],
      ['loading', '<p-nav-bar title="加载中" loading />'],
      ['color', '<p-nav-bar title="深色导航" background-color="#1a1a1e" front-color="#ffffff" />'],
    ],
    demos: [
      {
        title: "基础与返回",
        desc: "title 标题；back 显示返回（仅 emit）",
        code: 1,
        demo: `<view class="col">
  <p-nav-bar title="基础标题" />
  <p-nav-bar title="详情页" back @back="onBack" />
</view>`,
        hasOutput: true,
        output: `{{ lastEvent }}`,
      },
      {
        title: "右侧插槽",
        desc: "left/right 插槽承载操作区",
        code: 2,
        demo: `<p-nav-bar title="带操作">
  <template #right><p-text class="act">更多</p-text></template>
</p-nav-bar>`,
      },
      {
        title: "loading 指示",
        desc: "loading 在标题区显示加载指示（★官方 loading）",
        code: 3,
        demo: `<p-nav-bar title="加载中" loading />`,
      },
      {
        title: "配色（front-color / background-color）",
        desc: "深色导航条；换色动画（★官方 front-color / background-color）",
        code: 4,
        demo: `<p-nav-bar title="深色导航" background-color="#1a1a1e" front-color="#ffffff" back />`,
      },
    ],
    styles: `.col { display: flex; flex-direction: column; gap: var(--sp-3); }
.act { color: #1a7af8; }
.out { display: block; font-size: 12.5px; color: #2f7a4d; }`,
  },
  {
    file: 'p-page-container',
    title: "p-page-container 页面容器",
    subtitle: "页面外壳 · 底部/顶部/居中弹出层",
    state: `const show = ref(false)
const showTop = ref(false)
const showCenter = ref(false)
const showNoOverlay = ref(false)
const showSlide = ref(false)
const lastEvent = ref('（未触发 close）')
function onClose() {
  lastEvent.value = 'close 事件触发'
}`,
    codes: [
      ['base', '<p-page-container v-model:show="show" @close="onClose"><p-view>内容</p-view></p-page-container>'],
      ['top', '<p-page-container v-model:show="showTop" position="top">…</p-page-container>'],
      ['center', '<p-page-container v-model:show="showCenter" position="center">…</p-page-container>'],
      ['overlay', '<p-page-container v-model:show="showNoOverlay" :overlay="false">…</p-page-container>'],
      ['slide', '<p-page-container v-model:show="showSlide" close-on-slide-down>…</p-page-container>'],
    ],
    demos: [
      {
        title: "基础弹出（底部）",
        desc: "v-model:show 控制；点击遮罩关闭（update:show 回写）",
        code: 0,
        demo: `<p-button @click="show = true">打开底部容器</p-button>`,
        hasOutput: true,
        output: `{{ lastEvent }}`,
      },
      {
        title: "位置（position）",
        desc: "top 从顶部弹出 / center 居中弹出（★官方 position）",
        code: 1,
        demo: `<view class="row">
  <p-button size="mini" @click="showTop = true">顶部（top）</p-button>
  <p-button size="mini" @click="showCenter = true">居中（center）</p-button>
</view>`,
      },
      {
        title: "无遮罩 / 下滑关闭",
        desc: "overlay=false 无遮罩；close-on-slide-down 下滑关闭（触摸手势）",
        code: 3,
        demo: `<view class="row">
  <p-button size="mini" @click="showNoOverlay = true">无遮罩</p-button>
  <p-button size="mini" @click="showSlide = true">下滑关闭</p-button>
</view>`,
      },
    ],
    extraTemplate: `<p-page-container v-model:show="show" @close="onClose">
  <p-view class="panel"><p-text>底部弹出层内容（bottom）——点遮罩关闭</p-text></p-view>
</p-page-container>
<p-page-container v-model:show="showTop" position="top" @close="onClose">
  <p-view class="panel"><p-text>顶部弹出层内容（top，从上滑入）</p-text></p-view>
</p-page-container>
<p-page-container v-model:show="showCenter" position="center" @close="onClose">
  <p-view class="panel"><p-text>居中弹出层内容（center）</p-text></p-view>
</p-page-container>
<p-page-container v-model:show="showNoOverlay" :overlay="false" @close="onClose">
  <p-view class="panel"><p-text>无遮罩弹出层（overlay=false）</p-text></p-view>
</p-page-container>
<p-page-container v-model:show="showSlide" close-on-slide-down @close="onClose">
  <p-view class="panel"><p-text>下滑关闭（下滑 40px 关闭）</p-text></p-view>
</p-page-container>
`,
    styles: `.row { display: flex; flex-direction: row; gap: var(--sp-3); }
.panel { padding: var(--sp-4); }
.out { display: block; font-size: 12.5px; color: #2f7a4d; }`,
  },
  {
    file: 'p-picker',
    title: "p-picker 选择器",
    subtitle: "滚轮选择 · weui 标准双端一致",
    state: `// 单列
const cities = ref(['北京', '上海', '广州', '深圳', '杭州'])
const idx = ref(0)
// 多列（各列静态数据；联动由开发者据 columnchange 改 range 驱动）
const multi = ref([
  ['2026', '2027', '2028'],
  ['01', '02', '03'],
])
const multiIdx = ref([0, 0])
const lastEvent = ref('（暂无）')
// ★模板内不可调用函数（WXML 表达式限制，S38）→ 用 computed 派生展示串
const multiIdxText = computed(() => multiIdx.value.join(', '))

function pick(e: unknown): { value?: unknown; column?: number } {
  const p = e as { detail?: { value?: unknown; column?: number }; value?: unknown; column?: number }
  return (p?.detail ?? p) as { value?: unknown; column?: number }
}
function onChange(e: unknown) {
  const v = pick(e).value
  if (typeof v === 'number') {
    idx.value = v
    lastEvent.value = \`选中「\${cities.value[v]}」（索引 \${v}）\`
  } else if (Array.isArray(v)) {
    multiIdx.value = v as number[]
    lastEvent.value = \`多列索引 [\${(v as number[]).join(', ')}]\`
  }
}
function onColumnChange(e: unknown) {
  const d = pick(e)
  lastEvent.value = \`列 \${d.column} → 索引 \${d.value}\`
}`,
    codes: [
      ['basic', '<p-picker mode="selector" :range="cities" :value="idx" @change="onChange">\n  <p-text>{{ cities[idx] }}</p-text>\n</p-picker>'],
      ['multi', '<p-picker mode="multiSelector" :range="multi" :value="multiIdx" @change="onMultiChange" />'],
      ['disabled', '<p-picker mode="selector" :range="cities" disabled><p-text>禁用</p-text></p-picker>'],
      ['header', '<p-picker mode="selector" :range="cities" header-text="选择城市">…</p-picker>'],
      ['buttons', '<p-picker mode="selector" :range="cities" button-mode="double"><p-text>双按钮</p-text></p-picker>\n<p-picker mode="selector" :range="cities" :show-buttons="false"><p-text>无按钮</p-text></p-picker>'],
    ],
    demos: [
      {
        title: "单列选择（selector）",
        desc: "range 一维数组；点击触发区打开滚轮（两端同款 weui 半屏弹层）",
        code: 0,
        demo: `<p-picker mode="selector" :range="cities" :value="idx" header-text="选择城市" @change="onChange">
  <p-text class="field">{{ cities[idx] }}</p-text>
</p-picker>`,
        hasOutput: true,
        output: `当前：{{ cities[idx] }} · 最后事件：{{ lastEvent }}`,
      },
      {
        title: "多列选择（multiSelector）",
        desc: "range 二维数组（各列一个数组）；columnchange 用于联动改 range",
        code: 1,
        demo: `<p-picker mode="multiSelector" :range="multi" :value="multiIdx" header-text="选择年月" @change="onChange" @columnchange="onColumnChange">
  <p-text class="field">{{ multi[0][multiIdx[0]] }} - {{ multi[1][multiIdx[1]] }}</p-text>
</p-picker>`,
        hasOutput: true,
        output: `当前：[{{ multiIdxText }}] · 最后事件：{{ lastEvent }}`,
      },
      {
        title: "标题（header-text）",
        desc: "★官方 header-text：两端均为弹层居中标题",
        code: 3,
        demo: `<p-picker mode="selector" :range="cities" :value="idx" header-text="选择城市">
  <p-text class="field">点击选择（标题：选择城市）</p-text>
</p-picker>`,
      },
      {
        title: "禁用态",
        desc: "disabled 不可交互 + 淡化（★官方对齐）",
        code: 2,
        demo: `<p-picker mode="selector" :range="cities" disabled>
  <p-text class="field">禁用（不可打开）</p-text>
</p-picker>`,
      },
      {
        title: "底部按钮（可配置）",
        desc: "★button-mode 控制单/双按钮；show-buttons=false 无底部按钮（滚动即实时生效，关闭即结束）",
        code: 4,
        demo: `<view class="picker-row">
  <p-picker mode="selector" :range="cities" header-text="双按钮" button-mode="double" @change="onChange">
    <p-text class="field">双按钮（取消 + 确定）</p-text>
  </p-picker>
  <p-picker mode="selector" :range="cities" header-text="无按钮" :show-buttons="false" @change="onChange">
    <p-text class="field">无底部按钮（滚动即生效）</p-text>
  </p-picker>
</view>`,
      },
    ],
    styles: `.picker-row {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.field {
  display: block;
  min-height: 48px;
  line-height: 48px;
  padding: 0 16px;
  border: 1px solid #d1d1d1;
  border-radius: 4px;
  background: #fff;
  box-sizing: border-box;
  font-size: 17px;
  color: rgba(0, 0, 0, 0.9);
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
}`,
  },
  {
    file: 'p-progress',
    title: "p-progress 进度条",
    subtitle: "进度展示 · 线性 / 环形双端一致",
    state: `const dyn = ref(20)
function range() {
  dyn.value = (dyn.value + 30) % 130
}`,
    codes: [
      ['line', '<p-progress :percent="40" />'],
      ['status', '<p-progress :percent="100" status="success" /><p-progress :percent="60" status="exception" />'],
      ['circle', '<p-progress :percent="70" type="circle" />'],
      ['stroke', '<p-progress :percent="50" :stroke-width="12" :rounded="true" />'],
      ['color', '<p-progress :percent="60" color="#7c5cff" track-color="#eee" />'],
      ['active', '<p-progress :percent="40" active />'],
      ['duration', '<p-progress :percent="dyn" :duration="1200" />'],
      ['info', '<p-progress :percent="80" :show-info="false" /><p-progress :percent="80" :font-size="18" />'],
    ],
    demos: [
      {
        title: "线性（基础）",
        desc: "percent 控制进度；默认显示右侧百分比",
        code: 0,
        demo: `<p-progress :percent="40" />`,
      },
      {
        title: "状态（status）",
        desc: "active 进行中（默认蓝）/ success 成功（绿）/ exception 异常（红）",
        code: 1,
        demo: `<view class="col">
  <p-progress :percent="60" status="active" />
  <p-progress :percent="100" status="success" />
  <p-progress :percent="60" status="exception" />
</view>`,
      },
      {
        title: "环形（type=circle）",
        desc: "conic-gradient 绘制环形进度（纯 CSS，两端可用）",
        code: 2,
        demo: `<view class="row">
  <p-progress :percent="70" type="circle" />
  <p-progress :percent="100" type="circle" status="success" />
</view>`,
      },
      {
        title: "粗细与圆角",
        desc: "stroke-width 条高；rounded 圆角（★官方 border-radius）",
        code: 3,
        demo: `<view class="col">
  <p-progress :percent="50" :stroke-width="12" />
  <p-progress :percent="50" :stroke-width="12" :rounded="false" />
</view>`,
      },
      {
        title: "自定义颜色",
        desc: "color 进度色 · track-color 轨道底色（★官方 color）",
        code: 4,
        demo: `<p-progress :percent="60" color="#7c5cff" track-color="#eee" />`,
      },
      {
        title: "条纹动画与过渡时长",
        desc: "active 条纹滚动；duration 控制过渡时长（★官方 active / duration）",
        code: 5,
        demo: `<view class="col">
  <p-progress :percent="dyn" active :duration="600" />
  <p-button size="mini" @click="range">推进 30</p-button>
</view>`,
        hasOutput: true,
        output: `当前 percent：{{ dyn }}（点击推进，观察过渡 + 条纹）`,
      },
      {
        title: "信息与字号（show-info / font-size）",
        desc: "show-info=false 隐藏文案；font-size 调整百分比字号（★官方 show-info / font-size）",
        code: 7,
        demo: `<view class="col">
  <p-progress :percent="80" :show-info="false" />
  <p-progress :percent="80" :font-size="18" />
</view>`,
      },
    ],
    styles: `.col { display: flex; flex-direction: column; gap: var(--sp-4); }
.row { display: flex; flex-direction: row; align-items: center; gap: var(--sp-4); }
.out {
  display: block;
  background: #f2fbf5;
  border: 1px solid #d6f0e0;
  border-radius: var(--sp-radius-sm);
  padding: var(--sp-2) var(--sp-3);
  font-size: 12.5px;
  color: #2f7a4d;
  font-weight: 600;
}`,
  },
  {
    file: 'p-radio',
    title: "p-radio 单选",
    subtitle: "单选框 · 自绘圆形双端一致",
    state: `const plan = ref('x')
const brand = ref('p')
const lastEvent = ref('（暂无）')

// ★跨端读法：组件 emit 裸载荷 → Web 直接是载荷、MP 是 e.detail（\`e?.detail ?? e\` 通吃）
function onChange(e: unknown) {
  const p = e as { detail?: { value?: unknown }; value?: unknown }
  const d = (p?.detail ?? p) as { value?: unknown }
  lastEvent.value = \`选中 \${d?.value}\`
}`,
    codes: [
      ['basic', '<p-radio v-model="plan" value="x">方案 X</p-radio>\n<p-radio v-model="plan" value="y">方案 Y</p-radio>'],
      ['disabled', '<p-radio model-value="a" value="a" disabled>禁用（选中）</p-radio>'],
      ['color', '<p-radio v-model="brand" value="p" color="#7c5cff">品牌紫</p-radio>'],
    ],
    demos: [
      {
        title: "基础用法（单选组）",
        desc: "同组 radio 共享 v-model；value 为组内标识，选中即命中",
        code: 0,
        demo: `<view class="row">
  <p-radio v-model="plan" value="x" name="plan" @change="onChange">方案 X</p-radio>
  <p-radio v-model="plan" value="y" name="plan" @change="onChange">方案 Y</p-radio>
</view>`,
        hasOutput: true,
        output: `当前选中：{{ plan }} · 最后事件：{{ lastEvent }}`,
      },
      {
        title: "禁用态",
        desc: "disabled 不可交互 + 淡化（★两端状态视觉统一）",
        code: 1,
        demo: `<view class="row">
  <p-radio :model-value="'a'" value="a" disabled>禁用（选中）</p-radio>
  <p-radio :model-value="'a'" value="b" disabled>禁用（未选）</p-radio>
</view>`,
      },
      {
        title: "自定义颜色",
        desc: "color 设定选中色（★官方 color 属性；缺省微信绿）",
        code: 2,
        demo: `<view class="row">
  <p-radio v-model="brand" value="p" color="#7c5cff">品牌紫</p-radio>
</view>`,
      },
    ],
    styles: `.row { display: flex; flex-direction: row; align-items: center; gap: var(--sp-4); flex-wrap: wrap; }
.out {
  display: block;
  background: #f2fbf5;
  border: 1px solid #d6f0e0;
  border-radius: var(--sp-radius-sm);
  padding: var(--sp-2) var(--sp-3);
  font-size: 12.5px;
  color: #2f7a4d;
  font-weight: 600;
}`,
  },
  {
    file: 'p-rich-text',
    title: "p-rich-text 富文本",
    subtitle: "内容基元 · HTML / 节点数组渲染",
    state: `// ★字面量必须直接内联进 ref()（编译器静态求值：标识符初值 → data 为 undefined，见 S33/S57）
const html = ref('<p style="margin:0 0 8px">这是<strong>富文本</strong>：支持 <em>斜体</em>、<span style="color:#7c5cff">着色</span>。</p><ul style="margin:0;padding-left:20px"><li>列表项 A</li><li>列表项 B</li></ul>')
// ★类型（2026-09-24 类型检查暴露）：nodes 的 type/children[].type 需为**字面量**联合
//   （p-rich-text 契约是 'text' | 'node'），as const 收窄，否则被推断为 string 而类型不符
const nodes = ref<Array<Record<string, unknown>>>([
  { type: 'node', name: 'h3', attrs: { style: 'margin:0 0 6px;font-size:15px' }, children: [{ type: 'text', text: '节点数组形态' }] },
  { type: 'node', name: 'p', attrs: { style: 'margin:0;color:#666' }, children: [{ type: 'text', text: 'structured nodes（官方 nodes 数组）' }] },
])
const spaces = ref('连续空格（默认压缩）:  1  2  3\\n启用 space=nbsp:  1  2  3')`,
    codes: [
      ['html', '<p-rich-text nodes="<p>HTML 字符串</p>" />'],
      ['nodes', '<p-rich-text :nodes="nodes" />'],
      ['space', '<p-rich-text :nodes="text" space="nbsp" user-select />'],
    ],
    demos: [
      {
        title: "HTML 字符串",
        desc: "nodes 传入 HTML 字符串（MP 原生 rich-text / Web v-html）",
        code: 0,
        demo: `<view class="box"><p-rich-text :nodes="html" /></view>`,
      },
      {
        title: "节点数组",
        desc: "structured nodes（type/name/attrs/children）——跨端同数据结构",
        code: 1,
        demo: `<view class="box"><p-rich-text :nodes="nodes" /></view>`,
      },
      {
        title: "空格与可选",
        desc: "space 控制连续空格呈现；user-select 使文本可选中",
        code: 2,
        demo: `<view class="box">
  <p-rich-text :nodes="spaces" space="nbsp" user-select />
</view>`,
        hasOutput: true,
        output: `space=nbsp 下连续空格保留；user-select 后可拖选文本`,
      },
    ],
    styles: `.box { padding: var(--sp-3); border: 1px solid var(--p-border, #e5e5e5); border-radius: var(--sp-radius-sm); background: #fff; }
.out { display: block; font-size: 12.5px; color: #2f7a4d; }`,
  },
  {
    file: 'p-router-link',
    title: "p-router-link 声明式导航",
    subtitle: "工程原语 · 语义导航链接（对齐官方 navigator）",
    state: `const lastEvent = ref('（点击链接观察 navigate 载荷）')
function onNavigate(payload: Record<string, unknown>) {
  const mode = payload.switchTab ? 'switchTab' : payload.replace ? 'replace' : 'push'
  lastEvent.value = \`navigate → \${mode}(\${JSON.stringify(payload.to || payload.path)}) · open-type=\${payload.openType}\`
}`,
    codes: [
      ['base', '<p-router-link to="home" @navigate="onNavigate">首页</p-router-link>'],
      ['replace', '<p-router-link to="home" replace @navigate="onNavigate">replace 进入</p-router-link>'],
      ['tab', '<p-router-link to="mine" switch-tab @navigate="onNavigate">switchTab</p-router-link>'],
      ['official', '<p-router-link url="/pages/home" open-type="redirect" @navigate="onNavigate">官方 url 写法</p-router-link>'],
    ],
    demos: [
      {
        title: "框架语义（to）",
        desc: "to 为路由名/路径；点击 emit('navigate', payload)",
        code: 0,
        demo: `<view class="row">
  <p-router-link class="link" to="home" @navigate="onNavigate">首页</p-router-link>
  <p-router-link class="link" to="user" @navigate="onNavigate">个人中心</p-router-link>
</view>`,
        hasOutput: true,
        output: `{{ lastEvent }}`,
      },
      {
        title: "replace / switchTab",
        desc: "replace 替换当前页；switch-tab 切 Tab",
        code: 1,
        demo: `<view class="row">
  <p-router-link class="link" to="home" replace @navigate="onNavigate">replace</p-router-link>
  <p-router-link class="link" to="mine" switch-tab @navigate="onNavigate">switchTab</p-router-link>
</view>`,
      },
      {
        title: "官方 url 写法",
        desc: "不传 to 时回退官方 url；open-type 决定跳转方式",
        code: 3,
        demo: `<p-router-link class="link" url="/pages/home" open-type="redirect" @navigate="onNavigate">官方 url + redirect</p-router-link>`,
      },
    ],
    styles: `.row { display: flex; flex-direction: row; align-items: center; gap: var(--sp-3); flex-wrap: wrap; }
.link { color: #1a7af8; padding: var(--sp-1) var(--sp-2); }
.out { display: block; font-size: 12.5px; color: #2f7a4d; word-break: break-all; }`,
  },
  {
    file: 'p-scroll-view',
    title: "p-scroll-view 滚动容器",
    subtitle: "布局基元 · Skyline 页面滚动的唯一入口",
    state: `const items = ref(Array.from({ length: 20 }, (_, i) => \`列表项 \${i + 1}\`))
const hItems = ref(Array.from({ length: 8 }, (_, i) => \`横向 \${i + 1}\`))
const scrollTop = ref(0)
const lastEvent = ref('（滚动容器观察事件）')
const lowerCount = ref(0)

// ★scroll-top 是**受控**属性：只有值**变化**时才驱动滚动（同官方语义——设同一值不重复滚动）。
//   故 onScroll 回写当前滚动位置（手动滚动 → scrollTop 跟随），这样「回到顶部」才产生 0 的**变化**。
//   ★★但**编程滚动期间必须停止回写**：否则滚动途中的中间值（480/460…）被回写成新 prop →
//     scroll-view 又被拉回中间值 → 表现为「只往上滚一点、回不到顶」（真机实测）。
//     用 **pending 目标值**（不用定时器——避免与编译器 ref/断言规则打架，S49/S33）：
//     编程滚动设 \`pending = 目标\`；onScroll 到达目标即清除 pending，此后恢复回写。
const pendingScroll = ref(99999)

function commandScroll(v: number) {
  pendingScroll.value = v
  scrollTop.value = v
}
function jump(v: number) {
  commandScroll(v)
  lastEvent.value = \`scroll-top 设为 \${v}\`
}
function reset() {
  commandScroll(0)
  lowerCount.value = 0
  lastEvent.value = '已重置滚动位置（回到顶部）'
}
function onScroll(e: any) {
  const d = e?.detail ?? e ?? {}
  const top = Math.round(d.scrollTop ?? 0)
  const commanding = pendingScroll.value < 99999
  const arrived = Math.abs(top - pendingScroll.value) <= 1
  // 编程滚动中：到达目标才解除；期间不回写（避免与滚动动画抢控制权 → 「回不到顶」）
  if (commanding && arrived) pendingScroll.value = 99999
  const shouldSync = !commanding && scrollTop.value !== top
  if (shouldSync) scrollTop.value = top
  lastEvent.value = \`scroll：top=\${top} left=\${Math.round(d.scrollLeft ?? 0)}\`
}
function onLower() {
  lowerCount.value++
  lastEvent.value = \`scrolltolower 第 \${lowerCount.value} 次（lower-threshold 触发）\`
}`,
    codes: [
      ['y', '<p-scroll-view scroll-y style="height:200px">…</p-scroll-view>'],
      ['x', '<p-scroll-view scroll-x class="hscroll"><view v-for="…" class="hchip">…</view></p-scroll-view>'],
      ['pos', '<p-scroll-view :scroll-top="scrollTop" :scroll-with-animation="true" @scroll="onScroll">…</p-scroll-view>'],
      ['threshold', '<p-scroll-view :lower-threshold="30" @scrolltolower="onLower">…</p-scroll-view>'],
    ],
    demos: [
      {
        title: "纵向滚动",
        desc: "scroll-y 纵向滚动；@scroll 回显位置",
        code: 0,
        demo: `<p-scroll-view class="scroll-y" scroll-y @scroll="onScroll" @scrolltolower="onLower">
  <p-text v-for="it in items" :key="it" class="item">{{ it }}</p-text>
</p-scroll-view>`,
        hasOutput: true,
        output: `{{ lastEvent }}`,
      },
      {
        title: "横向滚动",
        desc: "scroll-x + enable-flex（Skyline 下 scroll-view 内横向排列需 enable-flex + flex row；子项用原生 view）",
        code: 1,
        demo: `<!-- ★横向子项用**原生 <view>**（不是自定义组件）——Skyline 下自定义组件宿主在 flex 容器里不可靠；
     容器加内层 flex row wrapper（scroll-view 自身是滚动宿主，横向内容放其内层 view） -->
<p-scroll-view class="scroll-x" scroll-x :scroll-y="false" enable-flex>
  <view class="scroll-x__inner">
    <view v-for="it in hItems" :key="it" class="chip">{{ it }}</view>
  </view>
</p-scroll-view>`,
      },
      {
        title: "滚动位置控制",
        desc: "scroll-top 受控：值变化时驱动滚动（同官方语义）",
        code: 2,
        demo: `<view class="col">
  <p-scroll-view class="scroll-y" scroll-y :scroll-top="scrollTop" :scroll-with-animation="true" @scroll="onScroll">
    <p-text v-for="it in items" :key="it" class="item">{{ it }}</p-text>
  </p-scroll-view>
  <view class="row">
    <p-button size="mini" @click="jump(200)">滚到 200</p-button>
    <p-button size="mini" @click="reset">回到顶部</p-button>
  </view>
</view>`,
        hasOutput: true,
        output: `{{ lastEvent }}`,
      },
      {
        title: "触底阈值",
        desc: "lower-threshold 控制触底触发距离；@scrolltolower 回显",
        code: 3,
        demo: `<p-scroll-view class="scroll-y" scroll-y :lower-threshold="30" @scrolltolower="onLower">
  <p-text v-for="it in items" :key="it" class="item">{{ it }}</p-text>
</p-scroll-view>`,
        hasOutput: true,
        output: `scrolltolower 触发次数：{{ lowerCount }}`,
      },
    ],
    styles: `.col { display: flex; flex-direction: column; gap: var(--sp-3); }
.row { display: flex; flex-direction: row; gap: var(--sp-3); }
.scroll-y { height: 180px; border: 1px solid var(--p-border, #e5e5e5); border-radius: var(--sp-radius-sm); background: #fff; }
/* ★横向滚动：容器**不设 flex**（scroll-view 是滚动宿主）；内层 wrapper 用 flex row 不换行承载子项；
   ★不用后代/复合选择器做布局（Skyline 剔除）——各元素单类各自声明。 */
/* ★横向 scroll-view 必须有**确定高度**（同竖向需确定宽度）：Skyline 下 scroll-view 无固定高会塌成一条线
   → 内容被裁、「看不到」（真机实测：加 height 前是细线，加后正常）。chips 40 + margin 16 = 56 */
.scroll-x { width: 100%; height: 56px; border: 1px solid var(--p-border, #e5e5e5); border-radius: var(--sp-radius-sm); background: #fff; overflow: hidden; }
.scroll-x__inner { display: inline-flex; flex-direction: row; white-space: nowrap; }
.item { display: block; padding: var(--sp-2) var(--sp-3); border-bottom: 1px solid #f0f0f2; }
.chip { flex: none; display: flex; align-items: center; padding: var(--sp-2) var(--sp-4); margin: var(--sp-2); background: #eef2ff; border-radius: var(--sp-radius-sm); white-space: nowrap; }
.out { display: block; font-size: 12.5px; color: #2f7a4d; }`,
  },
  {
    file: 'p-share-element',
    title: "p-share-element 共享元素转场",
    subtitle: "工程 · 对齐官方 share-element",
    state: `const lastEvent = ref('（切换开关观察属性生效）')
const animate = ref(true)
const duration = ref(300)`,
    codes: [
      ['base', '<p-share-element shuttle-key="cover"><p-image src="cover.png" /></p-share-element>'],
      ['animate', '<p-share-element shuttle-key="cover" :animate="false">…</p-share-element>'],
      ['duration', '<p-share-element shuttle-key="cover" :duration="600" easing-function="ease-in-out">…</p-share-element>'],
      ['shuttle', '<p-share-element shuttle-key="cover" shuttle-on-push="cover" shuttle-on-pop="detail">…</p-share-element>'],
    ],
    demos: [
      {
        title: "基础（shuttle-key 配对）",
        desc: "两页中 shuttle-key 相同的元素由宿主做跨页飞行动画",
        code: 0,
        demo: `<view class="col">
  <p-share-element shuttle-key="cover" class="shuttle">
    <p-text class="body">封面（shuttle-key=&quot;cover&quot;）</p-text>
  </p-share-element>
  <p-text class="hint">↑ Web 端为普通容器；真机（Skyline/原生）可见飞行动画</p-text>
</view>`,
      },
      {
        title: "animate 开关",
        desc: "animate=false → 仅位置对齐、无过渡",
        code: 1,
        demo: `<view class="col">
  <p-button size="small" @tap="(animate = !animate, lastEvent = 'animate = ' + animate)">切换 animate（当前 {{ animate }}）</p-button>
  <p-share-element shuttle-key="cover" :animate="animate" class="shuttle">
    <p-text class="body">animate={{ animate }}</p-text>
  </p-share-element>
</view>`,
        hasOutput: true,
        output: `{{ lastEvent }}`,
      },
      {
        title: "时长与缓动",
        desc: "duration / easing-function 控制飞行节奏",
        code: 2,
        demo: `<view class="col">
  <p-button size="small" @tap="(duration = duration === 300 ? 600 : 300, lastEvent = 'duration = ' + duration + 'ms')">切换时长（当前 {{ duration }}ms）</p-button>
  <p-share-element shuttle-key="cover" :duration="duration" easing-function="ease-in-out" class="shuttle">
    <p-text class="body">{{ duration }}ms · ease-in-out</p-text>
  </p-share-element>
</view>`,
        hasOutput: true,
        output: `{{ lastEvent }}`,
      },
      {
        title: "方向控制（shuttle-on-push / shuttle-on-pop）",
        desc: "分别指定 push 与 pop 阶段的飞跃物",
        code: 3,
        demo: `<p-share-element shuttle-key="cover" shuttle-on-push="cover" shuttle-on-pop="detail" class="shuttle">
  <p-text class="body">push→cover · pop→detail</p-text>
</p-share-element>`,
      },
    ],
    styles: `.col { display: flex; flex-direction: column; gap: var(--sp-3); }
.shuttle {
  padding: 10px 12px;
  border: 1px dashed #c9ccd6;
  border-radius: 8px;
  background: #fafbfe;
}
.body { font-size: 13px; color: #1c1b22; }
.hint { font-size: 11.5px; color: #8a8fa0; }
.out { display: block; font-size: 12.5px; color: #2f7a4d; }`,
  },
  {
    file: 'p-slider',
    title: "p-slider 滑块",
    subtitle: "滑动输入 · 中性标签双端同源码",
    state: `const val = ref(40)
const val10 = ref(30)
const valColor = ref(60)
const valBlock = ref(50)
const lastEvent = ref('（暂无）')

// ★事件契约：change/changing 载荷 { value }（跨端读法 e?.detail ?? e）
function onChange(e: unknown) {
  const p = e as { detail?: { value?: unknown }; value?: unknown }
  const v = Number((p?.detail ?? p)?.value)
  if (Number.isFinite(v)) {
    lastEvent.value = \`change → \${v}\`
  }
}
function onChanging(e: unknown) {
  const p = e as { detail?: { value?: unknown }; value?: unknown }
  const v = Number((p?.detail ?? p)?.value)
  if (Number.isFinite(v)) {
    lastEvent.value = \`changing → \${v}\`
  }
}`,
    codes: [
      ['basic', '<p-slider v-model="val" :min="0" :max="100" :step="1" @change="onChange" />'],
      ['step', '<p-slider v-model="val10" :min="0" :max="100" :step="10" />'],
      ['color', '<p-slider v-model="val" active-color="#7c5cff" color="#e5e5e5" block-color="#7c5cff" />'],
      ['block', '<p-slider v-model="val" :block-size="16" block-color="#07c160" />'],
      ['showValue', '<p-slider v-model="val" show-value />'],
      ['disabled', '<p-slider :model-value="40" disabled />'],
    ],
    demos: [
      {
        title: "基础用法（min/max/step + v-model）",
        desc: "拖动改变取值；完成拖动触发 change",
        code: 0,
        demo: `<p-slider v-model="val" :min="0" :max="100" :step="1" @change="onChange" @changing="onChanging" />`,
        hasOutput: true,
        output: `当前值：{{ val }} · 最后事件：{{ lastEvent }}`,
      },
      {
        title: "步长（step）",
        desc: "step=10 → 取值按 10 递增（用于档位选择）",
        code: 1,
        demo: `<p-slider v-model="val10" :min="0" :max="100" :step="10" @change="onChange" />`,
        hasOutput: true,
        output: `当前值：{{ val10 }}（档位 {{ val10 / 10 }} 级）`,
      },
      {
        title: "颜色（激活色 / 背景条 / 滑块）",
        desc: "active-color 已选轨道 · color 未选背景条 · block-color 滑块（★官方三色属性）",
        code: 2,
        demo: `<p-slider v-model="valColor" active-color="#7c5cff" color="#e5e5e5" block-color="#7c5cff" />`,
        hasOutput: true,
        output: `当前值：{{ valColor }}`,
      },
      {
        title: "滑块尺寸（block-size）",
        desc: "block-size 12–28：小滑块适合精细调节（★官方 block-size）",
        code: 3,
        demo: `<p-slider v-model="valBlock" :block-size="16" block-color="#07c160" />`,
        hasOutput: true,
        output: `当前值：{{ valBlock }}（滑块 16px）`,
      },
      {
        title: "显示当前值（show-value）",
        desc: "show-value 在滑块旁显示数值（★官方 show-value）",
        code: 4,
        demo: `<p-slider v-model="val" show-value />`,
        hasOutput: true,
        output: `当前值：{{ val }}`,
      },
      {
        title: "禁用态",
        desc: "disabled 不可交互 + 整体淡化（★官方对齐）",
        code: 5,
        demo: `<p-slider :model-value="40" disabled show-value />`,
      },
    ],
    styles: `.out {
  display: block;
  background: #f2fbf5;
  border: 1px solid #d6f0e0;
  border-radius: var(--sp-radius-sm);
  padding: var(--sp-2) var(--sp-3);
  font-size: 12.5px;
  color: #2f7a4d;
  font-weight: 600;
}`,
  },
  {
    file: 'p-switch',
    title: "p-switch 开关",
    subtitle: "开关选择器 · 中性标签双端同源码",
    state: `const on = ref(true)
const onDisabled = ref(false)
const onRound = ref(true)
const onSquare = ref(true)
const onColor = ref(true)
const onLoading = ref(true)
const lastEvent = ref('（暂无）')

// ★事件契约：change 载荷 { detail: { value } }（与 MP 原生 bind:change 一致）
// ★跨端读法：组件 emit 裸载荷 → Web 直接是载荷、MP 是 e.detail（\`e?.detail ?? e\` 通吃）
function onChange(e: unknown) {
  const p = e as { detail?: { value?: unknown }; value?: unknown }
  const v = Boolean((p?.detail ?? p)?.value)
  lastEvent.value = \`change → \${v}\`
}`,
    codes: [
      ['basic', '<p-switch v-model="on" @change="onChange" />'],
      ['disabled', '<p-switch :model-value="true" disabled />'],
      ['shapes', '<p-switch shape="round" /><p-switch shape="square" />'],
      ['color', '<p-switch v-model="on" color="#7c5cff" />'],
      ['loading', '<p-switch v-model="on" loading />'],
    ],
    demos: [
      {
        title: "基础用法（受控 v-model）",
        desc: "v-model 受控；切换触发 change（载荷与 MP 原生一致）",
        code: 0,
        demo: `<view class="row">
  <p-switch v-model="on" @change="onChange" />
</view>`,
        hasOutput: true,
        output: `状态：{{ on ? '开' : '关' }} · 最后事件：{{ lastEvent }}`,
      },
      {
        title: "禁用态",
        desc: "disabled 不可交互 + 整体淡化（★两端状态视觉统一；基础库 disabled opacity .3）",
        code: 1,
        demo: `<view class="row">
  <p-switch :model-value="false" disabled />
  <p-switch :model-value="true" disabled />
</view>`,
      },
      {
        title: "形态（shape）",
        desc: "round 圆角开关 / square 方角开关——★都是开关，仅圆角不同（不沿用官方 type=checkbox 的复选框形态：平台历史包袱，与 p-checkbox 语义重复）",
        code: 2,
        demo: `<view class="row">
  <p-switch v-model="onRound" shape="round" />
  <p-switch v-model="onSquare" shape="square" />
</view>`,
      },
      {
        title: "自定义颜色",
        desc: "color 设定打开态轨道色（★官方 color 属性；缺省微信绿）",
        code: 3,
        demo: `<view class="row">
  <p-switch v-model="onColor" color="#7c5cff" />
</view>`,
      },
      {
        title: "加载态",
        desc: "loading 期间禁切换 + 旋转指示器（★与禁用态可分辨；框架扩展，两端一致）",
        code: 4,
        demo: `<view class="row">
  <p-switch v-model="onLoading" loading @change="onChange" />
</view>`,
      },
    ],
    styles: `.row { display: flex; flex-direction: row; align-items: center; gap: var(--sp-4); flex-wrap: wrap; }
.out {
  display: block;
  background: #f2fbf5;
  border: 1px solid #d6f0e0;
  border-radius: var(--sp-radius-sm);
  padding: var(--sp-2) var(--sp-3);
  font-size: 12.5px;
  color: #2f7a4d;
  font-weight: 600;
}`,
  },
  {
    file: 'p-text',
    title: "p-text 文本",
    subtitle: "内容基元 · 可选 / 溢出 / 空格处理",
    state: `const long = ref('这是一段足够长的示例文本，用于演示 overflow=ellipsis 与 max-lines 两种溢出处理方式的差异，请观察行尾表现。')`,
    codes: [
      ['base', '<p-text>普通文本</p-text>'],
      ['select', '<p-text user-select>这段文本可以选中复制</p-text>'],
      ['ellipsis', '<p-text overflow="ellipsis" style="width:200px">很长的文本会被裁剪为省略号…</p-text>'],
      ['clamp', '<p-text :max-lines="2" style="width:240px">多行文本最多显示两行，超出部分被裁剪…</p-text>'],
      ['space', '<p-text space="emsp">用 emsp 显示连续空格</p-text>'],
      ['gesture', '<p-text select-on-gesture>允许通过手势选择文本</p-text>'],
    ],
    demos: [
      {
        title: "可选文本（user-select）",
        desc: "user-select 使文本可被选中复制（官方 user-select）",
        code: 1,
        demo: `<p-text class="para" user-select>这段文本可以被选中并复制（user-select）。</p-text>`,
      },
      {
        title: "溢出处理",
        desc: "overflow=ellipsis 单行省略号；max-lines 多行钳制",
        code: 2,
        demo: `<view class="col">
  <p-text class="clip1" overflow="ellipsis">{{ long }}</p-text>
  <p-text class="clip2" :max-lines="2">{{ long }}</p-text>
</view>`,
      },
      {
        title: "连续空格与手势选择",
        desc: "space=emsp/ensp/nbsp 显示连续空格；select-on-gesture 手势选择",
        code: 4,
        demo: `<view class="col">
  <p-text space="emsp">A   B（emsp 连续空格）</p-text>
  <p-text select-on-gesture>允许通过手势选择文本（select-on-gesture）</p-text>
</view>`,
      },
    ],
    styles: `.col { display: flex; flex-direction: column; gap: var(--sp-3); }
.para { display: block; line-height: 1.6; }
.clip1 { display: block; width: 200px; }
.clip2 { display: block; width: 240px; line-height: 1.6; }`,
  },
  {
    file: 'p-textarea',
    title: "p-textarea 多行文本域",
    subtitle: "多行输入 · 双端同源码",
    state: `const val = ref('')
const txt = ref('禁用状态下的文本内容')
const lastEvent = ref('（暂无）')

// ★事件契约：input/confirm 载荷 { value }（跨端读法 e?.detail ?? e）
function readValue(e: unknown): string {
  const p = e as { detail?: { value?: unknown }; value?: unknown }
  const v = (p?.detail ?? p)?.value
  return typeof v === 'string' ? v : ''
}
function onInput(e: unknown) {
  val.value = readValue(e)
  lastEvent.value = \`input → "\${val.value}"\`
}
function onConfirm(e: unknown) {
  lastEvent.value = \`confirm → "\${readValue(e)}"\`
}
function onFocus() {
  lastEvent.value = 'focus'
}
function onBlur() {
  lastEvent.value = 'blur'
}`,
    codes: [
      ['basic', '<p-textarea :value="val" placeholder="请输入内容" @input="onInput" />'],
      ['placeholder', '<p-textarea :value="val" placeholder="自定义占位符" placeholder-style="color:#7c5cff;font-size:16px" />'],
      ['maxlength', '<p-textarea :value="val" :maxlength="20" placeholder="最多 20 字" @input="onInput" />'],
      ['autoHeight', '<p-textarea :value="val" auto-height placeholder="随内容自动增高" />'],
      ['focus', '<p-textarea :value="val" :focus="true" placeholder="自动聚焦" />'],
      ['disabled', '<p-textarea :value="txt" disabled />'],
      ['keyboard', '<p-textarea :value="val" :cursor-spacing="20" confirm-type="send" :confirm-hold="true" @confirm="onConfirm" />'],
    ],
    demos: [
      {
        title: "基础用法（value + @input）",
        desc: "受控写法：value 传入 + @input 回写（载荷 { value }）",
        code: 0,
        demo: `<p-textarea :value="val" placeholder="请输入内容" @input="onInput" @focus="onFocus" @blur="onBlur" />`,
        hasOutput: true,
        output: `内容：「{{ val }}」 · 最后事件：{{ lastEvent }}`,
      },
      {
        title: "占位符与样式",
        desc: "placeholder 文案 + placeholder-style 内联样式（★官方两属性）",
        code: 1,
        demo: `<p-textarea :value="val" placeholder="自定义占位符" placeholder-style="color:#7c5cff;font-size:16px" />`,
      },
      {
        title: "最大长度（maxlength）",
        desc: "超过 maxlength 无法继续输入（★官方 maxlength）",
        code: 2,
        demo: `<p-textarea :value="val" :maxlength="20" placeholder="最多 20 字" @input="onInput" />`,
        hasOutput: true,
        output: `已输入 {{ val.length }} 字`,
      },
      {
        title: "自动增高（auto-height）",
        desc: "内容增多时高度自适应（★官方 auto-height）",
        code: 3,
        demo: `<p-textarea :value="val" auto-height placeholder="随内容自动增高（多打几行试试）" />`,
      },
      {
        title: "聚焦与键盘参数",
        desc: "focus 自动聚焦；cursor-spacing / cursor / selection-* / adjust-* 控制光标与键盘（★官方系列属性）",
        code: 6,
        demo: `<p-textarea :value="val" :cursor-spacing="20" confirm-type="send" :confirm-hold="true" placeholder="按住输入并观察键盘行为" @confirm="onConfirm" />`,
      },
      {
        title: "禁用态",
        desc: "disabled 不可编辑 + 淡化（★官方对齐）",
        code: 5,
        demo: `<p-textarea :value="txt" disabled />`,
      },
    ],
    styles: `.out {
  display: block;
  background: #f2fbf5;
  border: 1px solid #d6f0e0;
  border-radius: var(--sp-radius-sm);
  padding: var(--sp-2) var(--sp-3);
  font-size: 12.5px;
  color: #2f7a4d;
  font-weight: 600;
}`,
  },
  {
    file: 'p-view',
    title: "p-view 通用容器",
    subtitle: "布局基元 · 纵向 flex 容器 + 按压反馈",
    codes: [
      ['base', '<p-view>内容</p-view>'],
      ['hover', '<p-view hover-class="my-hover" :hover-start-time="0" :hover-stay-time="200">按住我</p-view>'],
      ['none', '<p-view hover-class="none">按住无反馈</p-view>'],
      ['disabled', '<p-view disabled>禁用</p-view>'],
    ],
    demos: [
      {
        title: "基础容器",
        desc: "display:flex 纵向；box-sizing 与双端对齐",
        code: 0,
        demo: `<p-view class="box"><p-text>普通容器内容</p-text></p-view>`,
      },
      {
        title: "按压反馈（hover-*）",
        desc: "官方 hover-class / hover-start-time / hover-stay-time：按住出现按压态",
        code: 1,
        demo: `<p-view class="box box--hover" hover-class="demo-hover" :hover-start-time="0" :hover-stay-time="200">
  <p-text>按住我看反馈（松手 200ms 后消失）</p-text>
</p-view>`,
        hasOutput: true,
        output: `MP：hover-class="demo-hover" 由平台在按下时加类；Web：模拟层等效反馈`,
      },
      {
        title: "关闭按压 / 禁用",
        desc: "hover-class=none 无反馈；disabled 整体淡化",
        code: 2,
        demo: `<p-view class="col">
  <p-view class="box" hover-class="none"><p-text>hover-class=none（无按压态）</p-text></p-view>
  <p-view class="box" disabled><p-text>disabled 容器</p-text></p-view>
</p-view>`,
      },
    ],
    styles: `.col { display: flex; flex-direction: column; gap: var(--sp-3); }
.box { padding: var(--sp-3); border: 1px solid var(--p-border, #e5e5e5); border-radius: var(--sp-radius-sm); background: #fff; }
.box--hover { border-style: dashed; }
.out { display: block; font-size: 12.5px; color: #2f7a4d; }`,
  },
  {
    file: 'p-webview',
    title: "p-webview 内嵌网页",
    subtitle: "页面外壳 · 承载宿主 WebView / iframe",
    state: `const state = ref('等待 load / error 事件…')
function onLoad(e: unknown) { const d = e as { src?: string }; state.value = 'load：' + (d?.src ?? '(已加载)') }
function onError(e: unknown) { state.value = 'error：' + JSON.stringify(e) }

const remote = ref('https://example.com')
const local = ref('/about')`,
    codes: [
      ['remote', '<p-webview src="https://example.com" :height="240" />'],
      ['local', '<p-webview src="/about" :height="240" />'],
      ['events', '<p-webview src="…" @load="onLoad" @error="onError" @message="onMessage" />'],
    ],
    demos: [
      {
        title: "远程网页",
        desc: "Web 用 iframe 直接加载；MP 需配置业务域名（未配置时平台拒绝加载）",
        code: 0,
        demo: `<p-webview :src="remote" :height="240" @load="onLoad" @error="onError" />`,
        hasOutput: true,
        output: `{{ state }}`,
      },
      {
        title: "本地路径（诚实降级）",
        desc: "Web 端 iframe 可加载包内页面；★MP 端平台不支持包内本地 HTML → 显示明确提示",
        code: 1,
        demo: `<p-webview :src="local" :height="240" />`,
      },
      {
        title: "事件契约",
        desc: "load / error / message 跨端同名（Web iframe 同语义触发）",
        code: 2,
        demo: `<p-webview :src="remote" :height="200" @load="onLoad" @error="onError" />`,
      },
    ],
    styles: `.out { display: block; font-size: 12.5px; color: #2f7a4d; }`,
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
  // ★extraTemplate（页面级弹层实例等裸模板）与演示模板一样参与组件扫描（2026-09-26 手写页迁移）
  const templateSources = [...p.demos.map((d) => d.demo), ...(p.extraTemplate ? [p.extraTemplate] : [])]
  for (const tsrc of templateSources) for (const m of tsrc.matchAll(/<([a-z]+-[a-z-]+)/g)) {
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
  // ★code 可选（2026-09-26 手写页迁移）：不传则不发射 :code → demo-block 的 v-if="code" 隐藏代码面板
  const codeAttrOf = (d) => (d.code != null ? ` :code="codes.${p.codes[d.code][0]}"` : '')
  const demoBlocks = p.demos
    .map((d, i) => {
      const idx = String(i + 1).padStart(2, '0')
      const hasOut = Boolean(d.hasOutput)
      // ★属性值必须转义双引号：title/desc 里出现 `area="top"` 这类字面量时，
      //   直接拼进 title="…" 会让 Vue 解析器报「Attribute name cannot contain U+0022」
      //   （实测：p-safe 的 title 含 area="top" → Web 构建失败）→ 统一走 escAttr。
      const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      const open = `    <demo-block index="${idx}" title="${escAttr(d.title)}" desc="${escAttr(d.desc)}" :has-output="${hasOut}"${codeAttrOf(d)}>`
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
        /\bcomputed\(/.test(p.state ?? '') ? 'computed' : null,
        /\breactive\(/.test(p.state ?? '') ? 'reactive' : null,
        /\bwatchEffect\(/.test(p.state ?? '') ? 'watchEffect' : null,
        /\bonMounted\(/.test(p.state ?? '') ? 'onMounted' : null,
        /\bonUnmounted\(/.test(p.state ?? '') ? 'onUnmounted' : null,
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
${demoBlocks}${p.extraTemplate ? `\n\n${p.extraTemplate.split('\n').map((l) => (l ? `    ${l}` : l)).join('\n')}` : ''}

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
