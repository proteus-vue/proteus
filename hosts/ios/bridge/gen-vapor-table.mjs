// hosts/ios/bridge/gen-vapor-table.mjs —— ★构建期生成订阅表（Vapor IR V3）
//
// 【为什么必须在**构建期**生成（而不是让 app 运行时调编译器）】
//   方案 §4.4 明确：编译期产出**可序列化的订阅表**，运行时只加载。
//   本仓实测印证了这条设计：把编译器打进 bench bundle 会拽进 `@babel/*`
//   （编译器的模板/脚本分析依赖）——体积 + 若干 MB、且 app 里根本没有解析 SFC 的场景。
//   ⇒ 正解：本脚本在**构建时**跑编译器，把订阅表落成 JSON；bundle 只 import 那份 JSON。
//
// 用法：node hosts/ios/bridge/gen-vapor-table.mjs  → 写 dist/vapor-table.json
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../../..')
const OUT = path.join(HERE, 'dist', 'vapor-table.json')

// 被测 SFC：单节点更新场景（与 V0 探针同构）
const SFC = `<template>
  <p-view>
    <p-view :width="dotW" />
  </p-view>
</template>

<script setup lang="ts">
const dotW = ref(36)
</script>
`

// ★用 tsx 跑编译器（编译器是 TS 源码；本脚本在 Node 侧，不在 app 侧）
const script = `
import { buildVaporSubscriptions } from '${path.join(ROOT, 'packages/compiler/src/index.ts')}'
const sfc = ${JSON.stringify(SFC)}
const res = buildVaporSubscriptions(sfc, 'vapor-table.vue')
process.stdout.write(JSON.stringify({ ok: res.ok, table: res.table, decisions: res.decisions, notes: res.notes }))
`
const json = execFileSync('npx', ['tsx', '-e', script], { cwd: ROOT, encoding: 'utf-8', env: { ...process.env } })
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, json)
const parsed = JSON.parse(json)
console.log(`[bridge] 订阅表生成：L1 ${parsed.table.stats.l1} / L0 ${parsed.table.stats.l0}（l1Rate=${parsed.table.stats.l1Rate}）→ ${path.relative(ROOT, OUT)}`)
