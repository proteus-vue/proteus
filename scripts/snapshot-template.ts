// scripts/snapshot-template.ts
// create-proteus 模板快照生成器 —— 从主仓库抽取"应用壳"到 packages/create-proteus/templates/
// 运行：tsx scripts/snapshot-template.ts（create-proteus 模板与主仓库保持同步的手段）
// ★拆包步骤 7：模板不再复制框架本体（src/platform|runtime|router|shims 的框架代码）——
//   模板依赖 @proteus/{router,runtime,shared,plugin-vite} npm 包（workspace 链接 / 发布后 registry）
// 复制（受管）：
//   - 应用壳：examples/router/{RouterView.vue,index.ts} → src/router/
//   - 应用侧全局类型：packages/shared/src/shims/*.d.ts → src/shims/（微信宿主类型，应用侧持有）
//   - scripts/mp-entry-stub.ts（vite mp 构建占位入口）
//   - index.html（入口路径替换）
// 手写模板（snapshot 不管理，改主仓时手动同步）：
//   package.json / proteus.config.ts / vite.config.ts / tsconfig.json / src/main* / src/App.vue /
//   src/pages/ / src/router/auto-routes.ts / scripts/gen-routes.ts
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

// 清理受管路径（保留手写模板：package.json / proteus.config.ts / vite.config.ts / tsconfig.json /
// src/main* / src/App.vue / src/pages/ / src/router/auto-routes.ts / scripts/gen-routes.ts）
const MANAGED = ['src/platform', 'src/runtime', 'src/router', 'src/shims', 'scripts', 'vite-plugin-mp-transform.ts']
// 手写的占位文件不在脚本管理范围：暂存（放 TPL 外，避免被 rm 连带删除）后恢复
function stash(rel: string): void {
  const src = path.join(TPL, rel)
  const bak = path.join(path.dirname(TPL), `.${rel.replace(/\//g, '-')}.bak`)
  if (fs.existsSync(src)) fs.renameSync(src, bak)
}
function unstash(rel: string): void {
  const src = path.join(TPL, rel)
  const bak = path.join(path.dirname(TPL), `.${rel.replace(/\//g, '-')}.bak`)
  if (fs.existsSync(bak)) {
    fs.mkdirSync(path.dirname(src), { recursive: true })
    fs.renameSync(bak, src)
  }
}
stash('src/router/auto-routes.ts')
stash('scripts/gen-routes.ts')
for (const p of MANAGED) fs.rmSync(path.join(TPL, p), { recursive: true, force: true })
unstash('src/router/auto-routes.ts')
unstash('scripts/gen-routes.ts')

const copied: string[] = []
// 1. 应用壳：RouterView + 应用单例（工厂化：路由表由应用注入 createRouter）
fs.mkdirSync(path.join(TPL, 'src', 'router'), { recursive: true })
copied.push(copyFile(path.join(ROOT, 'examples', 'router', 'RouterView.vue'), path.join(TPL, 'src', 'router', 'RouterView.vue')))
copied.push(copyFile(path.join(ROOT, 'examples', 'router', 'index.ts'), path.join(TPL, 'src', 'router', 'index.ts')))
// 2. 应用侧全局类型（微信宿主类型声明：wx/Page/RouteBuilder/MpEvent/declare module '*.vue'）
copied.push(...copyDir(path.join(ROOT, 'packages', 'shared', 'src', 'shims'), path.join(TPL, 'src', 'shims')))
// 3. 编译管线占位入口（真实 app.js 由 @proteus/plugin-vite 插件 buildStart 直出）
fs.mkdirSync(path.join(TPL, 'scripts'), { recursive: true })
copied.push(...copyDir(path.join(ROOT, 'scripts'), path.join(TPL, 'scripts'), ['snapshot-template.ts', 'bundle-report.ts', 'gen-routes.ts']))
// 4. index.html（入口路径指向模板工程的 src/）
copied.push(copyFile(path.join(ROOT, 'index.html'), path.join(TPL, 'index.html'), [[/\/examples\/main\.ts/g, '/src/main.ts']]))

console.log(`[snapshot] 已快照 ${copied.length} 个文件到 packages/create-proteus/templates/`)
console.log('提示：package.json / proteus.config.ts / vite.config.ts / tsconfig.json / src/main* / src/App.vue / src/pages/ / src/router/auto-routes.ts / scripts/gen-routes.ts 为手写模板，改主仓时记得同步')
