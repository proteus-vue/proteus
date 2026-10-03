// tests/lifecycle-callback.test.ts
// ★★★2026-10-04（生命周期体系）：**回调式生命周期**（从框架导入）回归锁。
//
// 【本轮的由来（用户指令）】「生命周期函数需要在页面写同名函数，比如 onShow，这个体验太差了，
//   应该从我们框架导入使用才对，我们框架需要一套完整的体系开放给开发者使用」。
//
// 【修掉的两类实测缺陷】
//   ① 回调体被静默丢弃：onShow(cb)/onHide(cb)/onResize(cb) 等（onMounted 之外）此前只被警告
//      "未映射的生命周期钩子…已剥离"（错误原因：其实有对等钩子），回调体进不了产物；
//      其中 onResize(cb) 更被当"顶层副作用"裸注入 onLoad ⇒ 产物裸调用无 import ⇒ ReferenceError（启动即崩）。
//   ② 重复键覆盖：提取端（onMounted→onReady）与生成端（总线安全清单自动补 onReady）**无去重** ⇒
//      JS 重复键后者覆盖前者 ⇒ 用户回调静默失效（真实 superapp 页面实测命中）。
//
// 【本文件覆盖】提取→生成全链路：正文/参数透传/async/派发尾巴/去重/组件剥离/对象体警告/
//   声明式不回归/扫描器（三元 vs 返回类型注解）回归。
import { describe, it, expect } from 'vitest'
import { transformScriptToPage, validateJs } from '@proteus-vue/compiler'

const opts = { px2rpx: true, rpxRatio: 2 }
const compile = (script: string, extra: Record<string, unknown> = {}) =>
  transformScriptToPage(script, opts, { filename: 'pages/t.vue', ...extra } as never)

/** **定义**计数（Page 顶层 2 空格缩进的 `hook(` / `async hook(`——不把 `this.onReachBottom()` 这类引用算进去） */
const countHook = (js: string, hook: string): number =>
  (js.match(new RegExp(`^  (?:async )?${hook}\\s*\\(`, 'gm')) ?? []).length

/** 抽 onLoad 方法体（2 空格缩进的闭合 `},` 为止——别用固定长度切片把后续方法卷进来） */
const onLoadBody = (js: string): string => /onLoad\(options\) \{([\s\S]*?)\n  \},/.exec(js)?.[1] ?? ''

describe('★★★2026-10-04 生命周期体系：回调式提取（从框架导入）', () => {
  it('① onShow(cb) 回调体进产物 + 派发尾巴（此前静默丢弃）', () => {
    const r = compile("import { ref, onShow } from '@proteus-vue/runtime'\nconst x = ref(1)\nonShow(() => { x.value = 5 })")
    expect(validateJs(r.js).ok, '产物必须语法有效').toBe(true)
    expect(r.js, 'onShow 钩子生成').toMatch(/onShow\(\) \{/)
    expect(r.js, '用户回调体在内（ref 写已改写 setData）').toContain('setData({ x: 5 })')
    expect(r.js, '总线派发尾巴').toContain('proteusPageEmit("show")')
    expect(countHook(r.js, 'onShow'), 'onShow 只应有一个定义').toBe(1)
  })

  it('② onResize((e) => …)：参数透传 + resize 载荷派发；**绝不再裸注入 onLoad**', () => {
    const r = compile("import { ref, onResize } from '@proteus-vue/runtime'\nconst w = ref(0)\nonResize((e) => { w.value = e.size.windowWidth })")
    expect(validateJs(r.js).ok).toBe(true)
    expect(r.js, '参数名进签名').toMatch(/onResize\(e\) \{/)
    expect(r.js, '用户体在内').toContain('.windowWidth')
    expect(r.js, '载荷派发').toContain('proteusPageEmit("resize"')
    // ★关键回归：onLoad 里不得出现裸 onResize( 调用（旧缺陷：ReferenceError）
    const seg = onLoadBody(r.js)
    expect(seg, '未取到 onLoad 体（判据失效）').toContain('this.setData')
    expect(seg, 'onLoad 不得裸注入 onResize(').not.toMatch(/[^.\w]onResize\(/)
  })

  it('③ onMounted + 生命周期总线：**只有一个 onReady**（重复键覆盖缺陷回归锁）', () => {
    const r = compile("import { ref, onMounted } from 'vue'\nconst x = ref(1)\nonMounted(() => { x.value = 42 })")
    expect(countHook(r.js, 'onReady'), 'onReady 不得重复（后者会覆盖前者 ⇒ 用户回调静默失效）').toBe(1)
    expect(r.js).toContain('setData({ x: 42 })')
    expect(r.js, '提取式 onReady 也应有派发（否则运行时订阅者收不到）').toContain('proteusPageEmit("ready")')
  })

  it('④ onLoad((o) => …)：参数名透传（var o = options 别名）', () => {
    const r = compile("import { ref, onLoad } from '@proteus-vue/runtime'\nconst id = ref('')\nonLoad((o) => { id.value = o.id })")
    expect(validateJs(r.js).ok).toBe(true)
    expect(r.js, '形参别名').toContain('var o = options')
    expect(countHook(r.js, 'onLoad'), 'onLoad 唯一').toBe(1)
  })

  it('⑤ 页面原生名回调（onHide/onTabItemTap/onReachBottom）全支持', () => {
    const r = compile(
      "import { ref, onHide, onTabItemTap, onReachBottom } from '@proteus-vue/runtime'\nconst x = ref(0)\nonHide(() => { x.value = 1 })\nonTabItemTap(() => { x.value = 2 })\nonReachBottom(() => { x.value = 3 })",
    )
    expect(validateJs(r.js).ok).toBe(true)
    for (const h of ['onHide', 'onTabItemTap', 'onReachBottom']) {
      expect(countHook(r.js, h), `${h} 定义唯一`).toBe(1)
    }
    expect(r.js).toContain('proteusPageEmit("hide")')
    expect(r.js).toContain('proteusPageEmit("tab-item-tap")')
    expect(r.js).toContain('proteusPageEmit("reach-bottom")')
  })

  it('⑥ 决策型（onShareAppMessage）回调式：生成钩子 + 体透传（声明才显示入口语义保持）', () => {
    const r = compile("import { onShareAppMessage } from '@proteus-vue/runtime'\nonShareAppMessage(function () { return { title: 'x' } })")
    expect(validateJs(r.js).ok).toBe(true)
    expect(countHook(r.js, 'onShareAppMessage'), '唯一').toBe(1)
    expect(r.js, '返回体透传').toContain("title: 'x'")
  })

  it('⑦ 对象表达式体（隐式返回）：显式警告 + 不生成（不静默坏产物）', () => {
    const r = compile("import { onShareAppMessage } from '@proteus-vue/runtime'\nonShareAppMessage(() => ({ title: 'x' }))")
    expect(validateJs(r.js).ok).toBe(true)
    expect(r.warnings.join('\n'), '必须可见地警告形态不支持').toContain('对象表达式体')
  })

  it('⑧ async 回调：产物钩子带 async（Bug C 语义保持）', () => {
    const r = compile("import { onShow } from '@proteus-vue/runtime'\nonShow(async () => { await Promise.resolve(1) })")
    expect(validateJs(r.js).ok, 'async 体不得丢标记（await 在非 async 里是语法错）').toBe(true)
    expect(r.js).toMatch(/async onShow\(\) \{/)
  })

  it('⑨ 同一钩子多处声明：只取第一处 + 可见警告', () => {
    const r = compile("import { onShow } from '@proteus-vue/runtime'\nonShow(() => {})\nonShow(() => {})")
    expect(countHook(r.js, 'onShow')).toBe(1)
    expect(r.warnings.join('\n')).toContain('2 次')
  })

  it('⑩ 声明式（顶层同名函数）不回归：单一定义 + 派发尾巴', () => {
    const r = compile('import { ref } from "vue"\nconst x = ref(1)\nfunction onShow() { x.value = 9 }')
    expect(countHook(r.js, 'onShow')).toBe(1)
    expect(r.js).toContain('setData({ x: 9 })')
    expect(r.js).toContain('proteusPageEmit("show")')
  })

  it('⑪ 组件模式：页面级钩子无对等 ⇒ 剥离 + 可见警告；onMounted/onUnmounted 仍映射', () => {
    const r = transformScriptToPage("import { onShow, onMounted } from '@proteus-vue/runtime'\nonShow(() => {})\nonMounted(() => {})", opts, {
      filename: 'components/x/index.vue',
      isComponent: true,
    } as never)
    expect(r.warnings.join('\n'), '可见说明').toContain('组件内 onShow()')
    expect(countHook(r.js, 'onShow'), '组件不生成页面钩子').toBe(0)
    expect(r.js, '组件 ready 钩子仍在（onMounted 映射）').toMatch(/\bready\(\) \{/)
  })

  it('⑫ 未映射 onXxx（onErrorCaptured 等）照旧剥离 + 警告（不回归）', () => {
    const r = compile("import { onErrorCaptured } from '@proteus-vue/runtime'\nonErrorCaptured(() => {})")
    expect(r.warnings.join('\n')).toContain('未映射的生命周期钩子')
  })

  it('⑬ `from vue` 导入页面钩子名：不是 Vue API ⇒ 友好提示（不 fail-closed 报错）+ 照常提取', () => {
    const r = compile("import { onShow } from 'vue'\nconst x = ref(1)\nonShow(() => { x.value = 5 })")
    expect(r.warnings.join('\n')).toContain('不是 Vue API')
    expect(r.js).toContain('setData({ x: 5 })')
  })
})

describe('★★★2026-10-04 嵌套注册：不提取 + 从体移除 + 可见警告（superapp 实测真缺陷）', () => {
  it('嵌套 onUnmounted（在 onMounted 体内）：产物无裸调用残留、onUnload 不引用闭包变量', () => {
    const r = compile(
      [
        "import { ref, onMounted, onUnmounted } from 'vue'",
        'const x = ref(0)',
        'onMounted(() => {',
        '  const t = setInterval(() => syncReadout(), 200)',
        '  onUnmounted(() => clearInterval(t))',
        '})',
        'function syncReadout() { x.value = 1 }',
      ].join('\n'),
    )
    expect(validateJs(r.js).ok, '产物必须语法有效').toBe(true)
    // 先剥注释再判（留痕注释里含 onUnmounted() 字样——本仓"扫描面排除注释"同款纪律）
    const codeOnly = r.js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(codeOnly, '外层体不得残留 onUnmounted 裸调用（MP 无此变量 ⇒ ReferenceError）').not.toMatch(/[^.\w]onUnmounted\(/)
    // onUnload 只应是安全清单版本（不含 clearInterval(t) 闭包引用）
    const onUnloadSeg = /onUnload\(\) \{([\s\S]*?)\n  \},/.exec(r.js)?.[1] ?? ''
    expect(onUnloadSeg, '不得引用闭包变量 t').not.toMatch(/clearInterval\(t\)/)
    expect(r.warnings.join('\n'), '必须可见地指引顶层写法').toContain('嵌套在其它回调体内注册')
  })

  it('标准写法（顶层 let + 顶层 onUnmounted）：闭包状态提为实例属性（this.timer）', () => {
    const r = compile(
      [
        "import { ref, onMounted, onUnmounted } from 'vue'",
        'const x = ref(0)',
        'let timer: number | null = null',
        'onMounted(() => { timer = setInterval(() => syncReadout(), 200) as unknown as number })',
        'onUnmounted(() => { if (timer !== null) clearInterval(timer) })',
        'function syncReadout() { x.value = 1 }',
      ].join('\n'),
    )
    expect(validateJs(r.js).ok).toBe(true)
    expect(r.js, '顶层 let → 实例属性').toMatch(/this\.timer = setInterval/)
    expect(r.js, 'onUnload 读实例属性').toMatch(/clearInterval\(this\.timer\)/)
    expect(r.warnings.join('\n'), '不该有嵌套警告').not.toContain('嵌套在其它回调体内注册')
  })
})

describe('★★★2026-10-04 扫描器回归：三元 else 分支不得被当返回类型注解吞掉（p-loading-host 实测）', () => {
  it('三元中的调用 + 后续箭头：产物保持完整（esbuild Malformed 缺陷回归锁）', () => {
    const r = compile("const x = ref(0)\nfunction f(): void {\n  const q = typeof wxq.in === 'function' ? wxq.in(r) : wxq\n  q.exec((res) => { x.value = res.length })\n}")
    expect(validateJs(r.js).ok, '产物必须语法有效（旧缺陷：? wxq.in(r) =>  …）').toBe(true)
    expect(r.js, '三元完整保留').toContain('? wxq.in(r) : wxq')
  })

  it('合法箭头返回类型注解照常剥除（不回归）', () => {
    const r = compile('const x = ref(0)\nfunction f(): void {\n  const g = (a: number): void => { x.value = a }\n  g(1)\n}')
    expect(validateJs(r.js).ok).toBe(true)
    expect(r.js).toMatch(/\(a\) =>/)
    expect(r.js).not.toMatch(/\)\s*:\s*void\s*=>/)
  })

  it('嵌套函数参数含函数类型（A–E 族）仍全剥（前一轮修复不回归）', () => {
    const r = compile('function outer(): void {\n  function inner(cb: (() => void) | undefined): void { cb && cb() }\n  inner(undefined)\n}')
    expect(validateJs(r.js).ok).toBe(true)
    expect(r.js).toMatch(/function inner\s*\(cb\)/)
  })
})
