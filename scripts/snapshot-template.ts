// scripts/snapshot-template.ts
// create-proteus 模板快照生成器 —— 从主仓库抽取"最小可运行闭环"到 packages/create-proteus/templates/
// 运行：tsx scripts/snapshot-template.ts（create-proteus 模板与主仓库保持同步的手段）
// 复制规则：
//   直接复制：src/platform/ src/router/(除 auto-routes.ts) src/runtime/ src/shims/ scripts/gen-routes.ts
//              vite-plugin-mp-transform.ts（含路径替换） index.html tsconfig.json
//   手写模板：package.json / proteus.config.ts / vite.config.ts / src/main.ts / src/main.mp.ts /
//              src/App.vue / src/pages/index.vue / src/router/auto-routes.ts（精简占位）
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
// 1. 框架本体运行时（相对 import 自包含，直接复制）
for (const dir of ['platform', 'runtime', 'shims']) {
  fs.mkdirSync(path.join(TPL, 'src', dir), { recursive: true })
  copied.push(...copyDir(path.join(ROOT, 'src', dir), path.join(TPL, 'src', dir)))
}
// 2. router（排除 auto-routes.ts，模板用精简占位）+ RouterView（应用壳，随应用存放）
fs.mkdirSync(path.join(TPL, 'src', 'router'), { recursive: true })
copied.push(...copyDir(path.join(ROOT, 'src', 'router'), path.join(TPL, 'src', 'router'), ['auto-routes.ts']))
copied.push(copyFile(path.join(ROOT, 'examples', 'router', 'RouterView.vue'), path.join(TPL, 'src', 'router', 'RouterView.vue')))
// 3. gen-routes + 占位入口 + 插件（插件 import 路径替换为 npm 包）
fs.mkdirSync(path.join(TPL, 'scripts'), { recursive: true })
copied.push(...copyDir(path.join(ROOT, 'scripts'), path.join(TPL, 'scripts'), ['snapshot-template.ts']))
copied.push(
  copyFile(
    path.join(ROOT, 'vite-plugin-mp-transform.ts'),
    path.join(TPL, 'vite-plugin-mp-transform.ts'),
    [[/\.\/packages\/compiler\/src/g, '@proteus/compiler']],
  ),
)
// 4. tsconfig / index.html（入口路径指向模板工程的 src/）
copied.push(copyFile(path.join(ROOT, 'tsconfig.json'), path.join(TPL, 'tsconfig.json')))
copied.push(copyFile(path.join(ROOT, 'index.html'), path.join(TPL, 'index.html'), [[/\/examples\/main\.ts/g, '/src/main.ts']]))

console.log(`[snapshot] 已快照 ${copied.length} 个文件到 packages/create-proteus/templates/`)
console.log('提示：package.json / proteus.config.ts / vite.config.ts / src/main* / src/App.vue / src/pages/ 为手写模板，改主仓时记得同步')
