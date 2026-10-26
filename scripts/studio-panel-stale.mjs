#!/usr/bin/env node
// scripts/studio-panel-stale.mjs —— "你双击的那个 .app 是不是旧的"提醒（决策 #1247 从门禁拆出）
//
// 【为什么需要（2026-10-25 用户实测踩到）】Tauri 把 `web-dist/` **编进二进制**，
//   而门禁只重建 `web-dist`、**不打包**。于是"门禁全绿 = 你看的那个 .app 是新的"是**错的**：
//   用户双击打开的可能是三天前的骨架，而且外面完全看不出来（资源压进二进制，strings 都 grep 不到，
//   .app 的 mtime 只反映链接时间）。
//
// 【它不是判据】只是打印一句人话，**不改变退出码**——因为"要不要现在打包"是人的决定
//   （打包要 1~2 分钟），不该让本机状态把门禁判红。
// 【比较基准取 UI 源码的最新 mtime】不取 web-dist：本门禁每次都重建 web-dist，
//   拿它比会变成"每次跑完都报警"，那种提醒很快就被无视了。
import fs from 'node:fs'
import path from 'node:path'

export function warnIfAppStale(studioDir) {
  const appBin = path.join(studioDir, 'build-app', 'Proteus Studio.app', 'Contents', 'MacOS', 'proteus-studio-shell')
  const uiSrc = path.join(studioDir, 'ui', 'src')
  if (!fs.existsSync(appBin) || !fs.existsSync(uiSrc)) return false
  const newest = (dir) =>
    fs
      .readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((d) => d.isFile())
      .reduce((mx, d) => Math.max(mx, fs.statSync(path.join(d.parentPath ?? d.path, d.name)).mtimeMs), 0)
  const srcAt = Math.max(newest(uiSrc), fs.statSync(path.join(studioDir, 'ui', 'index.html')).mtimeMs)
  const ageMin = (srcAt - fs.statSync(appBin).mtimeMs) / 60000
  if (ageMin <= 1) return false
  console.log(
    `\n⚠ build-app 里的 .app 比 UI 源码旧 ${Math.round(ageMin)} 分钟 —— 它嵌的是旧前端。` +
      `\n  要双击看到最新界面请重打包：pnpm run build:studio-app（或 bash packages/studio/package-app.sh）`,
  )
  return true
}
