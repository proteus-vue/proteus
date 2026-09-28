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
// ★★SFC 从**单节点探针**升级为「页面 + 列表」的真实形态（V4 收官：全量 SFC → 端上渲染）
//
// 【为什么升级（本仓实测的缺口）】旧 SFC 只有 2 个节点、无文本、无 v-for
//   ⇒ 它验证的只是"指令通道能打通"，而**模板产物**（静态样式/文本/v-for 行）
//   从未参与过端上渲染。升级后：静态样式走 style 串、动态走绑定、列表走 v-for
//   ⇒ 模板实例化 + 订阅表 + splice 三条链在同一棵树上被一起验证。
const SFC = `<template>
  <p-view style="flex-direction: column; padding-top: 60px; padding-left: 16px; background-color: #101020">
    <p-text style="font-size: 24px; color: #ffffff; margin-bottom: 12px">Vapor 全量 SFC</p-text>
    <p-view v-for="item in list" :key="item.id" style="flex-direction: row; align-items: center; height: 56px; flex-shrink: 0; margin-bottom: 8px; background-color: #1b1b21; border-radius: 12px">
      <p-view :width="item.dotW" style="height: 36px; flex-shrink: 0; background-color: #6f4ae8; border-radius: 18px" />
      <p-text :width="item.textW" style="font-size: 16px; color: #ffffff">{{ item.title }}</p-text>
    </p-view>
  </p-view>
</template>

<script setup lang="ts">
const list = ref([{ id: 1, dotW: 36, textW: 120, title: 'a' }])
</script>
`

// ★用 tsx 跑编译器（编译器是 TS 源码；本脚本在 Node 侧，不在 app 侧）
const script = `
import { buildVaporSubscriptions, buildLayoutTemplate } from '${path.join(ROOT, 'packages/compiler/src/index.ts')}'
const sfc = ${JSON.stringify(SFC)}
const res = buildVaporSubscriptions(sfc, 'vapor-table.vue')
// ★同一次构建产出**两件产物**（订阅表 + 模板）——它们的 id 空间必须同源
const tpl = buildLayoutTemplate(sfc, 'vapor-table.vue')
process.stdout.write(JSON.stringify({
  ok: res.ok && tpl.ok,
  table: res.table,
  template: tpl.template,
  decisions: res.decisions,
  notes: res.notes,
  templateDiagnostics: tpl.diagnostics,
  hasErrors: res.hasErrors,
}))
`
const json = execFileSync('npx', ['tsx', '-e', script], { cwd: ROOT, encoding: 'utf-8', env: { ...process.env } })
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, json)
const parsed = JSON.parse(json)
console.log(
  `[bridge] 订阅表生成：L1 ${parsed.table.stats.l1} / L0 ${parsed.table.stats.l0}（l1Rate=${parsed.table.stats.l1Rate}）` +
  ` · 模板 ${parsed.template.nodes.length} 节点 / ${parsed.template.lists.length} 列表` +
  ` · 模板诊断 ${parsed.templateDiagnostics.length} 条 → ${path.relative(ROOT, OUT)}`)
