#!/usr/bin/env node
// hosts/harmony/gen-fixtures.mjs —— 鸿蒙宿主夹具再生成（**唯一事实源 → rawfile**，可复现）
//
// 【为什么必须有（本轮补）】`entry/src/main/resources/rawfile/` 的两份夹具此前是**手工放置**的
//   （`stress-44.json` 由一次性 tsx 命令生成）——不可复现：SFC 或订阅表一变，rawfile 就陈旧，
//   而"陈旧"没有任何机器判据会报。本脚本把生成链固化（与 hosts/android/gen-app4050-fixture.mjs
//   同思路），并由 `build-host-app.sh` **每次构建前自动跑**（改源即生效）。
//
// 产物：
//   ① stress-44.json —— examples/pages/consistency-stress.vue 的编译器产物（vapor-stress-artifacts.json）
//      → 构建期实例化（slot-runtime.instantiateTemplate，与 Android/iOS 运行时同一条链）
//      → {viewport, nodes}（**视口为占位**：真视口由鸿蒙侧运行时按真实屏幕传入，排版时解析 widthRatio）
//   ② app-4050-tree.json —— 与 Android **同一份夹具**（直接从 android assets 复制，字节级同源）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { instantiateTemplate } from '../../packages/slot-runtime/src/index.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const ANDROID_ASSETS = path.join(ROOT, 'hosts/android/app/src/main/assets')
const FIXTURES = path.join(HERE, 'fixtures')
const RAWFILE = path.join(HERE, 'host-app/entry/src/main/resources/rawfile')

const PLACEHOLDER_VIEWPORT = { width: 1080, height: 2400 }

function genStress() {
  const artifacts = JSON.parse(fs.readFileSync(path.join(ANDROID_ASSETS, 'vapor-stress-artifacts.json'), 'utf-8'))
  const inst = instantiateTemplate(artifacts.tpl, {
    viewport: PLACEHOLDER_VIEWPORT,
    read: (n) => artifacts.data[n],
    table: artifacts.table,
  })
  const nodes = inst.nodes
  if (!Array.isArray(nodes) || nodes.length === 0) {
    throw new Error(`实例化未产出节点：${JSON.stringify(inst).slice(0, 300)}`)
  }
  // 判据（防生成器自身静默退化）：节点数 = SFC 声明的 44（模板 8 + 静态/行实例）
  const expect = 44
  if (nodes.length !== expect) {
    throw new Error(`节点数 ${nodes.length} ≠ ${expect}——SFC 或订阅表变了？先核对再更新本判据`)
  }
  fs.mkdirSync(FIXTURES, { recursive: true })
  fs.writeFileSync(path.join(FIXTURES, 'stress-44.json'), JSON.stringify({ viewport: PLACEHOLDER_VIEWPORT, nodes }, null, 1) + '\n')
  fs.mkdirSync(RAWFILE, { recursive: true })
  fs.copyFileSync(path.join(FIXTURES, 'stress-44.json'), path.join(RAWFILE, 'stress-44.json'))
  console.log(`  ✓ stress-44.json：${nodes.length} 节点（实例化自 vapor-stress-artifacts.json）`)
}

function copyVapor() {
  // ★矩阵 #14：Vapor 设备端链的**同源材料**——与 Android 端跑的完全同一份文件
  //   （bundle-vapor.js 是 esbuild IIFE，JSVM 直接 eval；artifacts 是编译器产物 JSON）。
  const files = [
    ['bundle-vapor.js', path.join(ROOT, 'hosts/android/bridge/dist/bundle-vapor.js')],
    ['vapor-artifacts.json', path.join(ANDROID_ASSETS, 'vapor-artifacts.json')],
    // ★矩阵 #18：宿主运行时 bundle（同一份 hosts/shared 产物的 android 侧构建）
    ['bundle-host-runtime.js', path.join(ROOT, 'hosts/android/bridge/dist/bundle-host-runtime.js')],
    // ★矩阵 #12：整树级虚拟化夹具（同一份 SFC 产物——Android mountVirtualRun / iOS V12 同源）
    ['vapor-tree.json', path.join(ANDROID_ASSETS, 'vapor-tree.json')],
  ]
  for (const [name, src] of files) {
    if (!fs.existsSync(src)) {
      console.log(`  ⚠ 缺 ${path.relative(ROOT, src)}——跳过（vapor 探针将不可用）`)
      continue
    }
    if (name === 'bundle-vapor.js') {
      fs.mkdirSync(FIXTURES, { recursive: true })
      fs.copyFileSync(src, path.join(FIXTURES, name))
    }
    fs.mkdirSync(RAWFILE, { recursive: true })
    fs.copyFileSync(src, path.join(RAWFILE, name))
    console.log(`  ✓ ${name}：与 Android 同源复制（${fs.statSync(src).size}B）`)
  }
}

function copy4050() {
  const src = path.join(ANDROID_ASSETS, 'app-4050-tree.json')
  if (!fs.existsSync(src)) {
    console.log('  ⚠ 缺 android app-4050-tree.json——跳过（4050 基准将不可用）')
    return
  }
  fs.copyFileSync(src, path.join(RAWFILE, 'app-4050-tree.json'))
  console.log(`  ✓ app-4050-tree.json：与 Android 同源复制（${fs.statSync(src).size}B）`)
}

console.log('[gen-fixtures] 鸿蒙宿主夹具再生成')
genStress()
copy4050()
copyVapor()
console.log(`  产物目录：${path.relative(ROOT, RAWFILE)}/`)
