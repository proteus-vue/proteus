// packages/create-proteus/src/index.ts
// create-proteus：npm create proteus my-app —— 复制模板工程 + 替换项目名
// 核心逻辑（copyTemplate）为纯函数，可单测
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 发布形态：dist/index.js 的上级目录即包根（含 templates/）；开发态可用环境变量覆盖
const TEMPLATES_DIR =
  process.env.CREATE_PROTEUS_TEMPLATES ??
  new URL('../templates/', import.meta.url).pathname

const NEXT_STEPS = (name: string) => `✅ 已生成工程：${name}

下一步：
  cd ${name}
  npm install            # 安装依赖（@proteus/compiler 发布后可正常安装；未发布时用仓库 workspace 或 npm link）
  npm run dev:web        # Web 端（浏览器打开 Vite 提示地址）
  npm run build:mp       # 小程序端（微信开发者工具导入 dist/mp-weixin，需替换 proteus.config.ts 的 appid）

提示：
  - npx proteus explain src/pages/index.vue   # 决策 trace（该文件触发的全部转换规则）
  - npx proteus rules                         # 编译器能力清单（49 条 AI 说明书）
  - 编辑 proteus.config.ts 的 rules 段        # 底线循环 ③：改配置即改变编译行为`

/** 复制模板工程到目标目录（纯函数：返回生成的文件列表；templatesDir 可注入便于测试） */
export function copyTemplate(
  targetDir: string,
  opts: { name: string },
  templatesDir: string = TEMPLATES_DIR,
): string[] {
  const generated: string[] = []
  walk(templatesDir, (from, rel) => {
    const to = path.join(targetDir, rel)
    fs.mkdirSync(path.dirname(to), { recursive: true })
    // 模板变量替换：{{name}} → 项目名
    const content = fs
      .readFileSync(from, 'utf-8')
      .replace(/\{\{name\}\}/g, opts.name)
    fs.writeFileSync(to, content)
    generated.push(rel)
  })
  return generated
}

function walk(dir: string, visit: (file: string, rel: string) => void, base = ''): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    const rel = base ? `${base}/${entry.name}` : entry.name
    if (entry.isDirectory()) walk(full, visit, rel)
    else visit(full, rel)
  }
}

function main(): void {
  const [nameArg, ...rest] = process.argv.slice(2)
  if (!nameArg) {
    console.error('用法：npm create proteus <项目名>（如 npm create proteus my-app）')
    process.exitCode = 1
    return
  }
  if (rest.length) {
    console.error(`多余参数：${rest.join(' ')}`)
    process.exitCode = 1
    return
  }
  // 项目名规范：小写字母/数字/连字符（npm 包名要求）
  const name = nameArg.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '')
  if (!name) {
    console.error('项目名不合法（仅允许字母/数字/连字符）')
    process.exitCode = 1
    return
  }
  if (fs.existsSync(nameArg) && fs.readdirSync(nameArg).length > 0) {
    console.error(`目录已存在且非空：${nameArg}`)
    process.exitCode = 1
    return
  }
  const targetDir = nameArg
  const files = copyTemplate(targetDir, { name })
  console.log(`已复制 ${files.length} 个文件（含模板快照：框架本体 + 编译管线 + 首页）`)
  console.log(NEXT_STEPS(nameArg))
}

main()
