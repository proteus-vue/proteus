#!/usr/bin/env node
// scripts/check-secret-scan.mjs —— ★★★凭证/私密材料入库扫描（2026-10-07 · hosts 第二刀 Stage 3）
//
// 【为什么立（真实缺口）】hosts/harmony 的**根** `build-profile.json5` 含机器本地签名材料
//   （`signingConfigs[].material`：certpath/profile/storeFile 绝对路径 + keyPassword/storePassword
//   口令）。它**曾险些被误提交**——当时只靠"记得别提交 + .gitignore"兜住，**没有任何机器判据**。
//   与 sleep/全量重跑同族：**这类遗漏只有工具层能兜住**（人/记忆靠不住）。
//
// 【判据（只扫 **git 已跟踪**的文件——未跟踪的本机材料不在管辖内）】
//   ① 敏感扩展名被跟踪：*.p12 *.p7b *.pfx *.jks *.keystore *.cer *.pem *.key *.mobileprovision
//   ② 文件内含 **非空的口令键**：`"keyPassword": "<≥8 字符>"` / `"storePassword": "<...>"`
//      （模板/脚本里出现的只是**裸词或注释**，不是 JSON 键值形态 ⇒ 不误报）
//   ③ 含 PEM 私钥块（-----BEGIN ... PRIVATE KEY-----）
//   ④ 被跟踪的 `build-profile.json5` 含**非空 signingConfigs**（= 真材料；模板是 `[]`）
//
// 用法：node scripts/check-secret-scan.mjs   （退出码 0 通过 / 1 发现入库存疑材料）
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const SENSITIVE_EXT = /\.(p12|p7b|pfx|jks|keystore|cer|pem|key|mobileprovision|keystore)$/i
/** 只扫文本类文件内容（二进制跳过） */
const TEXT_EXT = /\.(json5?|ts|tsx|js|mjs|cjs|sh|bash|ya?ml|md|txt|properties|gradle|xml|swift|java|kt|ets|cpp|h|cmake)$/i

function tracked() {
  try {
    return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf-8' })
      .split('\0')
      .filter(Boolean)
  } catch {
    return []
  }
}

const problems = []
const files = tracked()

for (const rel of files) {
  // ① 敏感扩展名
  if (SENSITIVE_EXT.test(rel)) {
    problems.push(`① ${rel}：敏感凭据类文件被 git 跟踪（证书/密钥/描述文件不得入库）`)
    continue
  }
  // ②③④ 内容扫描（仅文本类 + 限定体积）
  const abs = path.join(ROOT, rel)
  if (!TEXT_EXT.test(rel)) continue
  let src = ''
  try {
    const st = fs.statSync(abs)
    if (st.size > 2 * 1024 * 1024) continue
    src = fs.readFileSync(abs, 'utf-8')
  } catch {
    continue
  }
  // ② 非空口令键（JSON 键值形态；值 ≥8 字符）——注释里的裸词不匹配
  const pw = src.match(/"(?:keyPassword|storePassword)"\s*:\s*"([^"]{8,})"/)
  if (pw) problems.push(`② ${rel}：含明文口令键（"…Password": "<${pw[1].length} 字符>"）——机器本地材料不得入库`)
  // ③ PEM 私钥块
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(src)) {
    problems.push(`③ ${rel}：含 PEM 私钥块（-----BEGIN … PRIVATE KEY-----）`)
  }
  // ④ 被跟踪的 build-profile.json5 含非空 signingConfigs
  if (/build-profile\.json5$/.test(rel)) {
    const m = src.match(/"signingConfigs"\s*:\s*\[([\s\S]*?)\]/)
    if (m && m[1].trim().length > 0 && /"material"|"certpath"|"storeFile"|"keyPassword"|"storePassword"/.test(m[1])) {
      problems.push(`④ ${rel}：被跟踪且含**非空 signingConfigs**（真签名材料）——应改为模板（signingConfigs: []）并本地生成`)
    }
  }
}

if (problems.length) {
  console.error('⛔ 凭证/私密材料入库扫描未通过：')
  for (const p of problems) console.error('  ' + p)
  console.error('\n修法：① 从 git 移除（git rm --cached <file>）+ 写进 .gitignore；')
  console.error('      ② 口令类改模板占位（如 build-profile.template.json5 的 signingConfigs: []）+ 本地生成；')
  console.error('      ③ 若口令曾**真提交**，除移除还需**轮换**该凭证（历史不可靠删除）。')
  process.exit(1)
}
console.log(`✅ 无凭据入库（已跟踪 ${files.length} 个文件；敏感扩展名 / 明文口令键 / PEM 私钥 / 非空 signingConfigs 均未命中）`)
