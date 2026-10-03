#!/usr/bin/env node
// scripts/hooks/deny-direct-edit.mjs —— ★★★PreToolUse 拦截：**禁用 sed/awk/perl 等就地批量改源文件**
//
// 【为什么立（2026-10-04 用户明示 + 本轮真实代价）】
//   用户原话：「发现你因为自己的编辑失误无数次删除改错文件，**修改文件不能直接修改源文件，
//     必须先在临时文件修改然后做 diff**，这样才能提前知道有没有把文件改坏」。
//   本轮实测（AI 用 `python3 -` 内联脚本 + 正则批量改 superapp 四页）：
//     · `class="sa-card"` → `class="card"`（**类名被剥前缀**，全局样式全丢）
//     · `function readVal(...)` / `function webBridge(...)` 整块被正则吞掉（引用处全断）
//     · `(s as {...}).data` 被替换成语法残片（TS1005/TS1128 一片）
//   每次都"改完才发现 → 再花更多时间修回来"。
//   ⇒ **纪律**：程序化编辑**必须走** `scripts/safe-edit.mjs`（临时文件 → diff → 校验 → 才落盘）。
//     本 hook 拦"绕过它"的常见形态；静态门禁（check:safe-edit）扫脚本内部的同类行为。
//
// 【拦什么（判据：命令字面量里出现"就地编辑文件"的形态，且**不是**在调 safe-edit）】
//   · `sed -i`（就地编辑）
//   · `perl -i` / `perl -pi`
//   · `python3 - <<EOF`（内联脚本）**且**脚本体内含写文件调用（`open(...,'w')` / `writeFileSync` / `Path.write_text`）
//   · `node -e "..."` **且**内含写文件调用（`writeFileSync` / `fs.write`）
//   · 重定向写入源码文件：`> file.vue` / `>> file.ts`（排除 /tmp、临时目录、构建产物 dist）
//
// 【为什么 hook 只看字面量还不够 ⇒ 配套静态门禁】
//   与 sleep 那条同源：脚本**内部**的就地编辑字面上看不见 ⇒ `pnpm check:safe-edit` 扫
//   `scripts/**` `.agents/**` `hosts/**` 的 .sh/.mjs/.py，拦 "sed -i / perl -i / 内联 python 写文件"。
//
// 【合法例外（放行）】
//   · 调 `scripts/safe-edit.mjs`
//   · 写**临时/构建**产物：路径含 `/tmp/`、`/var/folders/`、`dist/`、`build/`、`.tmp`
//   · 读-only 的 sed/awk/perl（无 `-i`）——如 `grep`/`sed -n '1,5p'` 取片段
//   · `git` 相关（`git apply` / `git checkout` 等版本控制操作）
//
// 【输出契约（与另两条 hook 一致）】`exit 2` = block（stderr 写理由），`exit 0` = 放行。
//   ★不得用 stdout JSON（ZCode schema 嵌套校验会失败 ⇒ deny 被静默丢弃，本仓 5 天失效的根因）。
import { stdin } from 'node:process'

const raw = await new Promise((resolve) => {
  let buf = ''
  stdin.setEncoding('utf8')
  stdin.on('data', (c) => (buf += c))
  stdin.on('end', () => resolve(buf))
})

let payload = {}
try {
  payload = JSON.parse(raw || '{}')
} catch {
  process.exit(0) // 输入异常 → 放行（不因 hook 自身问题阻断会话）
}

const toolName = payload.tool_name ?? payload.toolName ?? ''
if (toolName !== 'Bash') process.exit(0)

const input = payload.tool_input ?? payload.toolInput ?? {}
const command = typeof input.command === 'string' ? input.command : ''
if (!command) process.exit(0)

/** 判定"是否在走 safe-edit"（走了就放行——它是唯一合法通道） */
const usesSafeEdit = /scripts\/safe-edit\.mjs/.test(command)

/** 目标路径是否为"临时/构建产物"（写这些不受限——本纪律只管**源文件**） */
const TMP_PATH_RE = /(?:\/tmp\/|\/var\/folders\/|dist\/|build\/|\.tmp\b|\/dev\/null|mktemp)/

const reasons = []

if (!usesSafeEdit) {
  // ① sed -i / perl -i（就地编辑）
  if (/\bsed\b[^|;&]*\s-i\b/.test(command) || /\bsed\b\s+-i/.test(command)) {
    reasons.push('`sed -i`（就地编辑源文件）')
  }
  if (/\bperl\b[^|;&]*\s-[a-z]*i[a-z]*\b/.test(command)) {
    reasons.push('`perl -i`（就地编辑源文件）')
  }
  // ② 内联脚本 + 写文件（python/node 的 heredoc / -e / -c）
  const inlineScript = /python3?\s+(-|<<)/.test(command) || /\bnode\s+(-e|--eval|<<)/.test(command)
  const writesFile = /open\s*\([^)]*['"][wa]\+?['"]|writeFileSync|write_text|\.write\s*\(|copyFileSync|fs\.write/.test(command)
  if (inlineScript && writesFile) {
    reasons.push('内联 python/node 脚本内写文件（批量编辑的常见形态）')
  }
  // ③ 重定向写入源码文件（排除临时路径）
  const redirRe = />>?\s*([^\s;&|]+)/g
  let m
  while ((m = redirRe.exec(command))) {
    const target = m[1]
    if (TMP_PATH_RE.test(target)) continue
    if (/\.(vue|ts|tsx|js|mjs|cjs|json|md|sh|py|rs|java|swift|kt|css|scss|html)$/.test(target)) {
      reasons.push(`重定向写入源码文件：\`> ${target}\``)
    }
  }
}

if (reasons.length === 0) process.exit(0)

process.stderr.write(
  [
    '⛔ 直接编辑源文件被拦截（用户 2026-10-04 纪律：「修改文件不能直接修改源文件，必须先在临时文件修改然后做 diff」）。',
    '',
    `  命中：${reasons.join(' / ')}`,
    '',
    '  为什么：本轮实测——正则批量改代码把类名前缀剥掉、把函数整块吞掉、把表达式改成语法残片，',
    '          每次都"改完才发现 → 再花更多时间修回来"。',
    '',
    '  正确做法（唯一合法通道）：',
    '    node scripts/safe-edit.mjs <file> --replace \'s/旧/新/g\'            # 预演：临时文件 + diff + 校验（不改源文件）',
    '    node scripts/safe-edit.mjs <file> --replace \'s/旧/新/g\' --apply    # 确认 diff 无误后落盘（仅校验全过才写）',
    '    node scripts/safe-edit.mjs <file> --script /tmp/transform.mjs --apply   # 复杂改写用 JS 变换函数',
    '',
    '  校验项：语法（node --check / json / py_compile / bash -n）· SFC 结构（成对标签）·',
    '          花括号平衡突变 · 体积突变 · **SFC 脚本里"编辑前声明、编辑后无声明但被引用"的标识符**（函数被吞的探测器）',
    '',
    '  写临时/构建产物（/tmp、dist、build）不受此限。',
  ].join('\n'),
)
process.exit(2)
