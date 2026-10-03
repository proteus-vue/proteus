// packages/plugin-vite/src/page-overlay.ts
// ★★★GP4-a（2026-10-03）：**页面级 Overlay 宿主的按需注入**（Toast 队列渲染端）。
//
// 【要解决什么】队列（`@proteus-vue/runtime` 的 toast API）是**命令式**的：业务调
//   `showToast({...})` 就完事——但**得有人渲染它**（宿主组件 `p-toast-host`）。让开发者
//   每页写一次 `<p-toast-host />` 就是"每页引入"（本方案要消灭的东西，任务卡 GP5 判据：
//   八条场景**任一条需要每页引入 ⇒ 方案不成立**）⇒ 编译期**按需自动注入**每个页面。
//
// 【★★按需（不是无条件）】只有**项目里真的出现过 toast API 用法**才注入——
//   与"框架组件按需输出"同一哲学（不用的应用不背 `runtime.js` ~23KB 与宿主组件）。
//   未用 ⇒ 产物里连 `p-toast-host` 这个标签都没有（可验证）。
//
// 【★同一件事两份实现 = 修一份等于没修（本仓纪律）】注入有**两个消费方**，必须同源判定：
//   · `plugin.ts`：把 `<p-toast-host />` 标签**注入每页 wxml**
//   · `gen-routes.ts`：把 `p-toast-host` 写进每页 `usingComponents` + 纳入组件产出闭包
//   两处都调本模块的 `detectToastUsage()`——扫描规则只有一份。
//
// 【★手动优先（防重复宿主）】用户已在任一页面手写 `<p-toast-host` ⇒ **全部页面都不注入**：
//   两个宿主实例会渲染同一份队列状态（同一 toast 显示两次）——比"没注入"更糟。
//   ⇒ 检测到手动声明就整体让位（并打印说明，不静默）。
import fs from 'node:fs'
import path from 'node:path'

/**
 * 队列 API 名（与 `@proteus-vue/runtime` 的导出同源——改这里要同步 runtime/toast.ts）。
 * ★同为拼接串：避免本文件的**自身正则/注释**被扫描命中（见 MANUAL_HOST_RE 的踩坑说明）。
 */
const TOAST_API_RE = new RegExp('\\b(?:' + ['showToast', 'hideToast', 'clearToasts', 'configureToast'].join('|') + ')\\s*\\(')
/**
 * 手动声明宿主（任一**业务源文件**出现即整体不注入——防双宿主重复渲染）。
 *
 * ★★**必须写成拼接串（本组件首版踩坑）**：直接写字面量 `<p-toast-host` 会被本模块**自己**扫到
 *   （扫描覆盖整个应用目录，而 `plugin-vite/src` 在开发期就在应用根下）⇒ 恒判"手动声明" ⇒
 *   **自动注入永不生效**——正是本仓最忌的"静默失效"形态。拼接 = 自扫描不会命中。
 *   （同族纪律：生成器/扫描器的"标记字面量"必须与产出的标记解耦。）
 */
const MANUAL_HOST_RE = new RegExp('<' + 'p-toast-host[\\s/>]')

/**
 * 剥离注释（HTML 注释 / 行注释 / 块注释三种形态）——**只用于手动宿主判定**（见调用点的不对称性说明）。
 *
 * ★诚实边界：不做完整词法分析（不区分"字符串里的宿主标签"与真实标签）——
 *   字符串里写这个标签的场景近乎不存在，而引入完整 parser 的成本远超收益。
 * ★写法注意（本文件首版即踩）：注释文本里**不要**直接写块注释的起止符号组合——
 *   它会提前终止本注释块（TS 语法错）。故下方正则一律用转义形态书写、正文不写裸符号组合。
 */
function stripComments(src: string): string {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/**
 * 取 SFC 的 `<template>` 段（无则空串）——手动宿主判定的作用域收窄。
 * ★为什么必须收窄：见调用点注释（误判 ⇒ 永不注入；脚本段里的同名文本不是声明）。
 */
function templateSectionOf(src: string): string {
  const m = /<template[^>]*>([\s\S]*)<\/template>/i.exec(src)
  return m ? m[1]! : ''
}

export interface ToastUsage {
  /** 项目里是否出现过 toast 队列 API 调用 */
  used: boolean
  /** 是否检测到手动声明的宿主（true ⇒ 不自动注入） */
  manualHost: boolean
  /** 命中的文件（诊断/日志；相对项目根） */
  files: string[]
}

/**
 * 扫描应用源码（.vue / .ts）判定是否需要注入 Toast 宿主。
 *
 * 【为什么扫全目录而不是只扫页面】**业务可能在组件、共享模块、请求拦截器里弹 toast**
 *   （登录失效提示就常在 interceptor）——只扫页面会漏 ⇒ 注入不足 = **静默不显示**（最坏形态）。
 *   过扫的代价只是"多注入一个 ~2KB 组件"，两者不对称 ⇒ 宁可过扫。
 *   ★诚实边界：本扫描是**静态词法**的（注释/字符串里的 API 名也会命中）——
 *   与"过扫可接受"同一取舍；不引入 AST（成本 >> 收益）。
 *
 * @param appDir 应用根目录（pagesDir 的上级）
 * @returns 判定结果（含命中文件清单——不静默：知道了就打印）
 */
export function detectToastUsage(appDir: string): ToastUsage {
  const files: string[] = []
  let used = false
  let manualHost = false
  const walk = (dir: string, depth: number): void => {
    if (depth > 6) return // 深度护栏（防符号链接环/深层 node_modules 误入）
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'dist') continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        walk(full, depth + 1)
        continue
      }
      if (!/\.(vue|ts)$/.test(e.name)) continue
      if (files.includes(full)) continue
      let src: string
      try {
        src = fs.readFileSync(full, 'utf-8')
      } catch {
        continue
      }
      // ★API 用法：**原样扫描**（含注释/字符串命中 ⇒ 过扫，见头注的取舍——过扫只多一个 ~2KB 组件）
      if (!used && TOAST_API_RE.test(src)) {
        used = true
        files.push(full)
      }
      // ★★手动宿主判定（本项目第二/三版踩坑后收敛为两条精确规则）：
      //   ① **只在 `.vue` 里判**——`.ts` 无模板，写不出组件标签（字符串/注释里的同名文本不是声明）；
      //   ② **只判 `<template>` 段 + 剥注释**——`<script>` 里出现该文本（比如测试断言、文档字符串）
      //      同样不是声明。
      //   为什么必须这么精确：误判 ⇒ **永不注入**（静默不显示，最坏）；漏判 ⇒ 双宿主（同一条
      //   显示两次，可见但可修正）。两者都坏，故靠"语义上确实能构成声明的位置"来切分。
      if (!manualHost && e.name.endsWith('.vue') && MANUAL_HOST_RE.test(stripComments(templateSectionOf(src)))) {
        manualHost = true
      }
    }
  }
  walk(appDir, 0)
  return { used, manualHost, files }
}

/** 注入的宿主标签（**自闭合**——与页面里手写 `<p-safe />` 同形态；位置在页面 wxml 末尾） */
export const TOAST_HOST_TAG = '<p-toast-host />'

/**
 * 把宿主标签**追加**到页面 wxml（末尾）。
 *
 * 【为什么放末尾】宿主可见内容由 `<teleport>` 渲染到 root-portal（脱离页面层叠），标签位置
 *   不影响层叠；末尾 = 对页面既有结构**零扰动**（前缀插入会改变文档序，可能影响布局/选择器）。
 *
 * 【★一次被推翻的"经验"（记录在此防重犯）】首跑排障时我判断"放在页面根之外 ⇒ 组件不被创建"，
 *   并据此改成"塞进 scroll-view 之内"。**后续用探针通道重验，两种位置都被正常创建与渲染**
 *   ——当时的"组件不存在"结论来自**错误的查询方法**（页面级 `createSelectorQuery` 看不到组件
 *   内部，本仓探针机制的存在理由），不是摆放位置的问题。
 *   ⇒ 教训（与本仓"注释里的经验也要验证"同条）：**排障结论必须用能看见该层的通道复核**，
 *     否则会把测量装置的缺陷写成产品约束（本文件的注释就是这个坑的现场记录）。
 *
 * ★诚实边界：宿主根是全屏 fixed（Overlay 定位需要），故它会覆盖页面——但**只有提示面板自身
 *   接管点击**（根容器不绑事件），页面交互不受影响（真机点击验证过）。
 */
export function injectToastHost(wxml: string): string {
  return `${wxml}\n${TOAST_HOST_TAG}`
}
