// packages/plugin-vite/src/app-shell.ts
// ★★★GP3-b1（2026-10-03）：**App 壳定位**（MP 编译管线的共用入口）。
//
// 【为什么单列一个模块】**两处消费者必须同源**（本仓"同一件事两份实现 = 修一份等于没修"纪律）：
//   ① `plugin.ts`：编译 App 壳 → Global 层片段 + 注入每个页面；按「组件引用闭包」决定哪些框架组件要产出——
//      **闭包必须以 App 壳为起点之一**（否则"只被 Global 层用到的组件"不产出 → 真机 usingComponents 未找到）；
//   ② `gen-routes.ts`：每页 page.json 的 `usingComponents`——注入进页面的 Global 层 wxml 里的标签
//      **必须**在该页注册（否则整块不渲染）。
//   ⇒ 判定"哪个文件是 App 壳"只有这一处实现（改一处不会只改半边）。
import fs from 'node:fs'
import path from 'node:path'
import { effectiveVariants } from '@proteus-vue/compiler'

/** 挂载层标签（与 contracts 的 MOUNT_LAYER_TAGS 同源语义——这里做**便宜预筛**，精判在编译器） */
const MOUNT_LAYER_TAG_RE = /<(?:app-root|global-layer|page-layer|overlay-layer)[\s>/]/

/** 源码是否是"声明了挂载层的 App 壳"（便宜门：只做正则预筛，不做完整编译） */
export function looksLikeAppShell(source: string): boolean {
  return MOUNT_LAYER_TAG_RE.test(source)
}

/**
 * 定位应用根的 **App 壳**文件：`App.vue` 或平台变体 `App.mp.vue`（按 mp 平台解析，与既有变体机制同源），
 * 且**声明了挂载层标签**（未声明 ⇒ 不是壳——如只做 Web 根组件的 App.vue，返回 null）。
 *
 * @param appDir 应用根目录（pagesDir 的上级）
 * @returns 绝对路径；无壳则 null
 */
export function findAppShellFile(appDir: string): string | null {
  if (!fs.existsSync(appDir)) return null
  let names: string[]
  try {
    names = effectiveVariants(
      fs.readdirSync(appDir, { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith('.vue'))
        .map((e) => e.name),
      'mp',
    ).filter((n) => /^app(\.[a-z0-9]+)?\.vue$/i.test(n))
  } catch {
    return null
  }
  for (const n of names) {
    const f = path.join(appDir, n)
    try {
      if (looksLikeAppShell(fs.readFileSync(f, 'utf-8'))) return f
    } catch {
      /* 读失败不阻断（构建侧会再读） */
    }
  }
  return null
}
