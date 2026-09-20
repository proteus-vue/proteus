/**
 * 编译器产物改写：结构性防线（2026-09-20 外部实战报告第十四节后新增）
 *
 * 背景：报告第五轮发现 Bug B（正则字面量被当变量改写），我们修了 `rewriteInstanceRefsSafe`；
 * 第六轮报告指出**同一文件里还有两处独立实现**（`computedInitLine` / `rewriteBareMethodCalls`），
 * 它们仍是朴素正则 → 正则与字符串照样被误改。报告的评价一语中的：
 * **「同一件事有三份实现，修一份就等于没修」**（与第十二节 components 事故同源）。
 *
 * 本测试把「只允许一份实现」变成机器判据：
 *   ① 静态：`script.ts` 中不得再出现裸的 `(?<!\.)\b…${name}\b` 式改写（只允许走统一扫描器）；
 *   ② 动态：三条路径（方法体 / computed 表达式 / 字符串）对正则与字符串都不得误改；
 *   ③ 生命周期 async 标记（Bug C）在 AST 与文本回退两条路径都保留。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformScriptToPage, compileVueSfc } from '@proteus-vue/compiler'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const scriptSrc = fs.readFileSync(path.join(root, 'packages/compiler/src/script.ts'), 'utf8')
const opts = { px2rpx: true, rpxRatio: 2 } as never

describe('编译器产物改写结构性防线（Bug B 三路径 / Bug C async）', () => {
  it('script.ts 不得再有**未包字面量保护**的裸标识符改写（同一件事只允许一份实现）', () => {
    // 规则：裸标识符改写只有两条合法路径——
    //   ① `rewriteInstanceRefsSafe(...)`（自带字面量/属性/key/声明位保护）
    //   ② 包在 `mapCodeOutsideLiterals(...)` 回调里（字面量保护由包装器提供）
    // 判据：出现 `(?<!\.)\b${...}\b` / `(?<![\w$.])${x}(?![\w$])` 这类**裸标识符**改写的行，
    //   必须位于 `mapCodeOutsideLiterals` 的调用回溯范围内（向上找最近的函数/回调边界）。
    const lines = scriptSrc.split('\n')
    const offenders: string[] = []
    for (let i = 0; i < lines.length; i++) {
      const code = lines[i].replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '')
      const isBareIdentRewrite = /\(\?<!\\?\.\)\\b/.test(code) || /\(\?<!\[[^\]]*\]\)\$\{[^}]*\}\(\?!\[/.test(code)
      if (!isBareIdentRewrite) continue
      // 向上 40 行内是否出现 mapCodeOutsideLiterals（回调体内即受其保护）
      const window = lines.slice(Math.max(0, i - 40), i + 1).join('\n')
      if (/mapCodeOutsideLiterals/.test(window)) continue
      offenders.push(`${i + 1}: ${lines[i].trim().slice(0, 110)}`)
    }
    expect(offenders, '这些行是未受字面量保护的裸标识符改写——应走 rewriteInstanceRefsSafe 或 mapCodeOutsideLiterals').toEqual([])
  })

  it('方法体路径：正则字面量与字符串内容都不被误改', () => {
    const { js } = transformScriptToPage(
      "const s = useSession()\nfunction f() { return (x||'').replace(/\\s/g,'') + 'count s here' }",
      opts,
      { file: 't.vue' } as never,
    )
    expect(js).toContain("replace(/\\s/g,'')")
    expect(js).not.toContain('\\this')
    expect(js).toContain("'count s here'")
    // 裸名仍应被正确改写（功能未丢）
    expect(js).toMatch(/this\.s\b|this\.data\.s\b/)
  })

  it('computed 表达式路径：正则与字符串都不被误改', () => {
    const { js } = transformScriptToPage(
      "const s = useSession()\nconst w = computed(() => ({ n: (x||'').replace(/\\s/g,'').length, tag: 's' }))",
      opts,
      { file: 't.vue' } as never,
    )
    expect(js).toContain('replace(/\\s/g')
    expect(js).not.toContain('\\this')
    expect(js).toContain("'s'")
  })

  it('字符类正则 [\\s\\S] 跨行形态完整保留（外部工程 10 处误改的主形态）', () => {
    const { js } = transformScriptToPage(
      "const s = useSession()\nfunction strip(t) { return t.replace(/[\\s\\S]*?x/g, '') }",
      opts,
      { file: 't.vue' } as never,
    )
    expect(js).toContain('/[\\s\\S]*?x/g')
    expect(js).not.toContain('\\this')
  })

  it('声明位保护：const/let/var 声明的同名变量不被改写（统一扫描器已覆盖）', () => {
    const { js } = transformScriptToPage('const s = ref(1)\nfunction f() { const s = 2; return s }', opts, { file: 't.vue' } as never)
    expect(js).toContain('const s = 2') // 声明位不得变成 `const this.s`
    expect(js).not.toContain('const this.')
  })

  it('Bug C：async 生命周期回调在 AST 路径保留 async（onReady/onUnload/onLoad）', () => {
    const cases: Array<[string, string]> = [
      ["import { onMounted } from 'vue'\nonMounted(async () => { await load() })", 'async onReady() {'],
      ["import { onUnmounted } from 'vue'\nonUnmounted(async () => { await cleanup() })", 'async onUnload() {'],
      ["import { onLoad } from '@proteus-vue/runtime'\nonLoad(async (o) => { await boot(o) })", 'async onLoad(options) {'],
    ]
    for (const [src, want] of cases) {
      const { js } = transformScriptToPage(src, opts, { file: 't.vue' } as never)
      expect(js, `应产出 ${want}`).toContain(want)
    }
  })

  it('Bug C：非 async 生命周期回调不得被加上 async（不多不少）', () => {
    const { js } = transformScriptToPage("import { onMounted } from 'vue'\nonMounted(() => { load() })", opts, { file: 't.vue' } as never)
    expect(js).toContain('onReady() {')
    expect(js).not.toContain('async onReady()')
  })

  it('Bug C：async 回调产物语法合法（await 位于 async 函数内）', () => {
    const { js } = transformScriptToPage(
      "import { onMounted } from 'vue'\nonMounted(async () => { await Promise.all([a(), b()]) })",
      opts,
      { file: 't.vue' } as never,
    )
    // eslint-disable-next-line no-new-func
    expect(() => new Function(js)).not.toThrow()
  })

  // ★同族第 3 处（报告未列，本仓顺带挖出）：方法名改写对**字符串内容**误改
  it('方法名字符串内容不被误改（`name()` 形态只在代码位改写）', () => {
    const { js } = transformScriptToPage(
      "function save() { return 1 }\nfunction f() { return 'call save() now' }\nfunction g() { save() }",
      opts,
      { file: 't.vue' } as never,
    )
    expect(js, '字符串内容不得被改写').toContain("'call save() now'")
    // 真调用仍应改写（功能未丢）
    expect(js, '真实调用仍应 this 化').toMatch(/this\.save\(\)/)
  })

  // ★同族第 4 处（报告未列）：动态 SVG 表达式改写对字符串内容误改
  it('动态 SVG 表达式内的字符串不被误改（变量仍正确改写）', () => {
    const src =
      '<template>\n  <svg viewBox="0 0 10 10"><circle :cx="s === 1 ? 3 : 4" r="1" />' +
      '<title :aria-label="\'has s inside\'"></title></svg>\n</template>\n<script setup>\nconst s = ref(1)\n</script>'
    const r = compileVueSfc(src, { filename: 't.vue', px2rpx: true, rpxRatio: 2 } as never)
    expect(r.js, '字符串内容不得被改写').toContain("'has s inside'")
    expect(r.js, '表达式里的变量仍应改写').toContain('this.data.s === 1')
  })
})
