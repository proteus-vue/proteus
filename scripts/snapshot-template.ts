// scripts/snapshot-template.ts
// create-proteus 模板快照生成器 —— 从主仓库抽取"最小可运行闭环"到 packages/create-proteus/templates/
// 运行：tsx scripts/snapshot-template.ts（create-proteus 模板与主仓库保持同步的手段）
// 复制规则：
//   直接复制：packages/{shared,runtime,router,plugin-vite}/src（含路径替换） index.html tsconfig.json
//   手写模板：package.json / proteus.config.ts / vite.config.ts / src/main.ts / src/main.mp.ts /
//              src/App.vue / src/pages/index.vue / src/router/auto-routes.ts（精简占位）
//   ★拆包后：router/runtime/shared/plugin-vite 源码来自 packages/*/src，复制进模板 src/ 保持可用（步骤 7 重构）
//   ★步骤 5：插件（plugin.ts→vite-plugin-mp-transform.ts）+ appSkeleton + gen-routes（库）+ cli 入口都来自 packages/plugin-vite
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TPL = path.join(ROOT, 'packages', 'create-proteus', 'templates')

/** 复制目录（跳过指定文件） */
function copyDir(src: string, dest: string, skip: string[] = []): string[] {
  const copied: string[] = []
  if (!fs.existsSync(src)) return copied
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || skip.includes(entry.name)) continue
    const from = path.join(src, entry.name)
    const to = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      fs.mkdirSync(to, { recursive: true })
      copied.push(...copyDir(from, to))
    } else {
      fs.mkdirSync(path.dirname(to), { recursive: true })
      fs.copyFileSync(from, to)
      copied.push(path.relative(TPL, to))
    }
  }
  return copied
}

function copyFile(src: string, dest: string, replace?: Array<[RegExp, string]>): string {
  let content = fs.readFileSync(src, 'utf-8')
  for (const [re, to] of replace ?? []) content = content.replace(re, to)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, content)
  return path.relative(TPL, dest)
}

// 清理受管路径（保留手写模板：package.json / proteus.config.ts / vite.config.ts /
// src/main* / src/App.vue / src/pages/ / src/router/auto-routes.ts）
const MANAGED = ['src/platform', 'src/runtime', 'src/shims', 'src/router', 'scripts', 'vite-plugin-mp-transform.ts', 'tsconfig.json', 'index.html']
// 手写的 auto-routes.ts 不在脚本管理范围：暂存（放 TPL 外，避免被 rm src/router 连带删除）后恢复
const autoRoutes = path.join(TPL, 'src', 'router', 'auto-routes.ts')
const backup = path.join(path.dirname(TPL), '.auto-routes.bak')
if (fs.existsSync(autoRoutes)) fs.renameSync(autoRoutes, backup)
for (const p of MANAGED) fs.rmSync(path.join(TPL, p), { recursive: true, force: true })
if (fs.existsSync(backup)) {
  fs.mkdirSync(path.dirname(autoRoutes), { recursive: true })
  fs.renameSync(backup, autoRoutes)
}

const copied: string[] = []
// 1. 框架本体运行时（拆包：runtime 归 packages/runtime；模板暂复制保持可用，步骤 7 重构）
fs.mkdirSync(path.join(TPL, 'src', 'runtime'), { recursive: true })
copied.push(...copyDir(path.join(ROOT, 'packages', 'runtime', 'src'), path.join(TPL, 'src', 'runtime')))
for (const dir of ['platform', 'shims']) {
  fs.mkdirSync(path.join(TPL, 'src', dir), { recursive: true })
  copied.push(...copyDir(path.join(ROOT, 'packages', 'shared', 'src', dir), path.join(TPL, 'src', dir)))
}
// 2. router（排除 auto-routes.ts，模板用精简占位）+ RouterView（应用壳，随应用存放）
//    ★拆包步骤 4：框架源码来自 packages/router/src；RouterView 与应用侧 auto-routes 同目录（相对导入 ./auto-routes）
fs.mkdirSync(path.join(TPL, 'src', 'router'), { recursive: true })
copied.push(...copyDir(path.join(ROOT, 'packages', 'router', 'src'), path.join(TPL, 'src', 'router'), ['auto-routes.ts']))
copied.push(copyFile(path.join(ROOT, 'examples', 'router', 'RouterView.vue'), path.join(TPL, 'src', 'router', 'RouterView.vue')))
// 3. gen-routes（库）+ cli 入口 + 插件 + appSkeleton（★步骤 5：全部来自 packages/plugin-vite/src）
fs.mkdirSync(path.join(TPL, 'scripts'), { recursive: true })
copied.push(...copyDir(path.join(ROOT, 'scripts'), path.join(TPL, 'scripts'), ['snapshot-template.ts', 'gen-routes.ts']))
// gen-routes 库：模板内解析 ../proteus.config（自包含 ProteusConfig interface）与 ../src/router/types（vendored）
copied.push(
  copyFile(path.join(ROOT, 'packages', 'plugin-vite', 'src', 'gen-routes.ts'), path.join(TPL, 'scripts', 'gen-routes.ts'), [
    [/'@proteus\/router'/g, "'../src/router/types'"],
    [/from '\.\/config'/g, "from '../proteus.config'"],
  ]),
)
// gen-routes CLI 入口（模板脚本 gen-routes-cli.ts：读 ../proteus.config + 执行库）
copied.push(
  copyFile(path.join(ROOT, 'packages', 'plugin-vite', 'src', 'cli.ts'), path.join(TPL, 'scripts', 'gen-routes-cli.ts'), [
    [/\.\.\/\.\.\/\.\.\/proteus\.config\.ts/g, '../proteus.config.ts'],
  ]),
)
// 插件（import 相对 appSkeleton 改模板 vendored 位置；@proteus/compiler 走 npm 包）
copied.push(
  copyFile(
    path.join(ROOT, 'packages', 'plugin-vite', 'src', 'plugin.ts'),
    path.join(TPL, 'vite-plugin-mp-transform.ts'),
    [[/\.\/appSkeleton/, '../src/runtime/appSkeleton']],
  ),
)
// appSkeleton（构建期 app.js 骨架模板，随插件 vendored 进模板 src/runtime/）
copied.push(copyFile(path.join(ROOT, 'packages', 'plugin-vite', 'src', 'appSkeleton.ts'), path.join(TPL, 'src', 'runtime', 'appSkeleton.ts')))
// 4. tsconfig / index.html（入口路径指向模板工程的 src/）
copied.push(copyFile(path.join(ROOT, 'tsconfig.json'), path.join(TPL, 'tsconfig.json')))
copied.push(copyFile(path.join(ROOT, 'index.html'), path.join(TPL, 'index.html'), [[/\/examples\/main\.ts/g, '/src/main.ts']]))

console.log(`[snapshot] 已快照 ${copied.length} 个文件到 packages/create-proteus/templates/`)
console.log('提示：package.json / proteus.config.ts / vite.config.ts / src/main* / src/App.vue / src/pages/ 为手写模板，改主仓时记得同步')
