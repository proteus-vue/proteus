#!/usr/bin/env node
// scripts/check-shell-i18n-vars.mjs —— ★★门禁：shell 脚本里禁止 `$VAR<全角字符>` 写法
//
// 【为什么需要（本会话实测踩到 3 次）】bash 的变量名**允许非 ASCII 字符**（多字节标识符），
//   而本仓注释/报错信息是**中文** ⇒ `say "… ${'$'}name：（说明）"` 这种写法里，
//   紧跟变量的全角标点（`：` `）` `（`）会被 bash 当作**变量名的一部分**
//   ⇒ `set -u` 下报 `unbound variable`（在**运行时**才炸，静态看不出）。
//
// 【实测踩点】① `scripts/setup-android-js-engine.sh`（首次，修 3 处）
//   ② `hosts/android/check-16kb-align.sh`（同一坑，新代码又犯）
//   ③ `hosts/android/build-and-run.sh`（第三次）⇒ 全仓扫描**另外发现 13 处**（跨 9 个脚本，
//     含 acceptance.sh / run-selfdraw.sh / publish-all.sh 等**既有脚本**——长期潜伏）。
//   ★与"固定 sleep 盲等"同源：**规则写在 markdown 里拦不住，只有工具层门禁是结构性的**。
//
// 【判据】扫描全部 `*.sh`：
//   ① 出现 `$VAR` 紧跟**非 ASCII 字符**即红（应写 `${VAR}<全角>`）。
//      ★白名单：`${VAR}` 形式不受影响（花括号已界定边界）；注释行也扫（注释里的示例照样会被抄）。
//   ② 出现**别的语言的注释语法**（`/* … */` JSDoc / 行首 `//` C 风格）即红——bash 只认 `#`。
//      ★实测（2026-09-29 · S5 途中）：`scripts/setup-android-js-engine.sh:149` 的
//        `/** ★判据（S2）… */` 每次运行都被 bash **当命令执行**（`/**` 被 glob 展开成 `/Applications`）
//        ⇒ 输出 `is a directory` 后**继续跑**。危害不在"跑不下去"，而在：
//        ① 报错噪声淹没真问题 ② 将来加 `set -e` 即变硬失败 ③ 它就贴在「JNI 导出断言」函数上方，
//        读代码的人会以为那是有效注释。
//      ★与 ① 同源：**语言边界的隐式规则靠工具兜住，不靠肉眼**。
//      ★heredoc（`<<'EOF'` 等）内的内容是**别的语言**（Python/JS/JSON），其中的 `//`、`/*` 是正文 ⇒ 必须跳过。
//   ③ **每个 `.sh` 必须通过 `bash -n`**（纯语法检查）。
//      ★实测（2026-09-29 收尾）：本仓**没有任何门禁**对 shell 脚本做语法检查
//        （`check:script-compile` 只管 JS/TS/Vue）⇒ 我改 `measure-paint-hint.sh` 时
//        **手工跑了 5 轮 `bash -n`** 才发现问题。两个真实成因（都不是"粗心"，是 shell 的隐式规则）：
//        · `\` 续行后跟**空行** ⇒ 命令在此结束，下一行若以 `||`/`&&` 开头即语法错误
//          （实测：`echo "a" \` + 空行 + `|| echo b` ⇒ `syntax error near unexpected token ||`）；
//        · 别的语言（Python/JS）**内联**进 shell（heredoc / `python3 -c "…"`）时与 shell 引号规则冲突。
//        ★★**顺带纠正一条我先前写错的经验**：注释里的反引号（\`cmd\`）**不会**被 bash 执行
//          （实测：`# 注释 \`echo x\`` 无任何输出）——我曾在记忆里把它写成"会触发命令替换"，
//          属**未经验证的推断**。⇒ 本条判据覆盖的是**真语法错误**，不是那条假规则。
//
// 用法：node scripts/check-shell-i18n-vars.mjs
// 退出码：0 通过 / 1 命中
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.sh')) out.push(p)
  }
  return out
}

const files = [...walk(path.join(ROOT, 'scripts')), ...walk(path.join(ROOT, 'hosts')), ...walk(path.join(ROOT, '.agents'))]
// ★正则：`$NAME` 后紧跟非 ASCII（不含 `${...}` 形式）
const RISKY = /\$[A-Za-z_][A-Za-z0-9_]*[^\x00-\x7F]/
// ★判据 ②：别的语言的注释语法（`/*` 开头 或 行首 `//`）——bash 只认 `#`
const FOREIGN_COMMENT = /^\s*(\/\*|\*\/|\/\/)/
// ★heredoc 开始：`<<` 可选 `-`，引号可有可无，结束词为字母/下划线串
const HEREDOC_START = /<<(-?)\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/

/**
 * 逐行标注"是否在 heredoc 内"（浅解析：够用即可）。
 *
 * ★为什么必须做：本仓脚本用 heredoc 内嵌 Python/JS（如 acceptance.sh 的聚合段），
 *   那些语言里的 C 风格行注释与块注释是**正文**——不跳过就会误报一片。
 *   ⇒ 只在**真的会被 bash 解释的行**上判 ②（这也正是 ① 之外的"语言边界"判据的语义）。
 *
 * ★踩坑记录（本文件自身）：块注释里**不能出现块注释的结束符**——
 *   初版在下面这行注释里写了 C 风格块注释的字面示例 ⇒ 块注释被**提前终止**，
 *   其后文字被当作代码 ⇒ `SyntaxError`。（与门禁要抓的坑同族：语言边界。）
 */
function heredocLines(lines) {
  const inside = new Array(lines.length).fill(false)
  let end = null // 当前 heredoc 的结束词（null = 不在 heredoc 内）
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (end !== null) {
      inside[i] = true
      if (line.trim() === end) end = null
      continue
    }
    const m = HEREDOC_START.exec(line)
    if (m) {
      // ★同一行可能有多个 heredoc（罕见）；此处取**最后一个**（与 bash 的读取顺序一致）
      const starts = [...line.matchAll(new RegExp(HEREDOC_START.source, 'g'))]
      end = starts[starts.length - 1][3]
      // 若本行的结束词就是自身（`<<EOF` 后紧跟 EOF），交给下一轮
    }
  }
  return inside
}

const hits = []
const foreignHits = []
for (const f of files) {
  const rel = path.relative(ROOT, f)
  const lines = fs.readFileSync(f, 'utf-8').split('\n')
  const inHeredoc = heredocLines(lines)
  lines.forEach((line, i) => {
    const m = RISKY.exec(line)
    if (m) hits.push({ file: rel, line: i + 1, text: m[0], src: line.trim().slice(0, 100) })
    if (!inHeredoc[i] && FOREIGN_COMMENT.test(line)) {
      foreignHits.push({ file: rel, line: i + 1, src: line.trim().slice(0, 100) })
    }
  })
}

console.log(`shell 变量边界检查（扫 ${files.length} 个 .sh）`)
if (hits.length) {
  console.error(`\n❌ 发现 ${hits.length} 处 \`$VAR<全角字符>\`（bash 会把全角标点当变量名的一部分 ⇒ set -u 下 unbound variable）：\n`)
  for (const h of hits) console.error(`  ${h.file}:${h.line}  「${h.text}」\n      ${h.src}`)
  console.error('\n  修法：写成 `${VAR}<全角>`（花括号界定变量边界，与语言无关）')
}
if (foreignHits.length) {
  console.error(`\n❌ 发现 ${foreignHits.length} 处**非 bash 注释语法**（bash 只认 \`#\`；\`/*…*/\` 与 \`//\` 会被当命令执行）：\n`)
  for (const h of foreignHits) console.error(`  ${h.file}:${h.line}\n      ${h.src}`)
  console.error('\n  修法：改成 `# …`（实测：\`/** … */\` 被 glob 展开成 /Applications 后打印 "is a directory" 并继续执行）')
}
// ── 判据 ③：`bash -n` 语法检查（真实语法错误；见文件头对"注释反引号无害"的纠正）──
const syntaxHits = []
for (const f of files) {
  const r = spawnSync('bash', ['-n', f], { encoding: 'utf8' })
  if (r.status !== 0) {
    const msg = `${r.stderr ?? ''}`.split('\n').filter((l) => l.trim() && !/^\s*\^/.test(l)).slice(0, 2).join(' / ')
    syntaxHits.push({ file: path.relative(ROOT, f), msg })
  }
}

if (hits.length || foreignHits.length || syntaxHits.length) {
  if (syntaxHits.length) {
    console.error(`\n❌ 发现 ${syntaxHits.length} 个**语法错误**（bash -n 未通过）：\n`)
    for (const h of syntaxHits) console.error(`  ${h.file}\n      ${h.msg}`)
    console.error('\n  常见成因（都实测过）：')
    console.error('   · `\\` 续行后跟**空行** ⇒ 命令在此结束，下一行的 `||`/`&&` 成语法错误')
    console.error('   · 把别的语言（Python/JS）内联进 shell ⇒ 引号规则冲突；应**独立成文件**')
  }
  process.exit(1)
}
console.log('✅ 三类检查全过：变量边界 · 注释语言 · bash -n 语法')
