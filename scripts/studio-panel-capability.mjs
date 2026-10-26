// scripts/studio-panel-capability.mjs —— 窗口权限覆盖检查（判据 ㊹ · 决策 #1272）
//
// 【为什么要有这条】Tauri 2 的**插件命令要过 ACL**（capability 文件里列出的窗口才有权限）。
//   我们新建一个窗口（`settings`）时，capability 里只写了 `"windows": ["main"]`
//   ⇒ `plugin:window|start_dragging` 被拒绝、**前端 catch 掉** ⇒ 表现是"拖拽没反应"，
//   而代码看起来完全正确。这类缺陷判据跑 Playwright 永远抓不到（那边是桩、没有 ACL）。
//   ⇒ 这条只做**静态检查**：capability 必须覆盖所有窗口（用 `"*"`），且拖拽相关的权限必须在。
import fs from 'node:fs'
import path from 'node:path'

/** @returns {{ ok: boolean, detail: string }} */
export function checkCapability(studio) {
  const file = path.join(studio, 'capabilities', 'default.json')
  if (!fs.existsSync(file)) return { ok: false, detail: `缺 ${file}` }
  let cap
  try {
    cap = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (e) {
    return { ok: false, detail: `capability 解析失败：${e}` }
  }
  const windows = Array.isArray(cap.windows) ? cap.windows : []
  const perms = Array.isArray(cap.permissions) ? cap.permissions : []
  const need = [
    'core:window:allow-start-dragging',
    'core:window:allow-internal-toggle-maximize',
  ]
  const missing = need.filter((p) => !perms.includes(p))
  const allWindows = windows.includes('*')
  return {
    ok: allWindows && missing.length === 0,
    detail: `windows=[${windows.join(',')}] · 缺权限=${missing.length ? missing.join(',') : '无'}`,
  }
}
