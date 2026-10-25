// ui/src/fileIcons.ts —— 文件类型 → 图标 + 类型色（决策 #1233）
//
// 【徽章式（决策 #1235）】类型色**徽章底** + 白色单记号，而不是裸字母。
//   裸字母在 13px 下看起来像"随手画的几笔"（用户说"太简陋"），加一层统一规格的圆角徽章，
//   整排才像一个**系统**：同一圆角、同一留白、同一描边粗细。JetBrains 的文件图标就是这个路子。
//   ★记号保持单个（V / T / J / R / # / {} / M / P / C）：13px 下双字母会糊。
//
// 【颜色是「文件类型色」不是「状态色」】和语法着色的 `--syn-*` 一样，这一层不许借用
//   `--ok/--warn/--bad`（那三个表达"系统状态"）。所以这里写死十六进制，并集中在**一个表**里。
//
// 【未登记的扩展名】返回 `null` ⇒ 走通用文档图标。加新语言时**只改这张表**（判据 ㉙ 会盯着树里出现的类型）。

export interface FileTypeIcon {
  icon: string
  /** 类型色（不是状态色）：徽章底色 */
  color: string
  /** 徽章内的白色记号 */
  glyph: string
}

const BY_EXT: Record<string, FileTypeIcon> = {
  vue: { icon: 'fileVue', color: '#41b883', glyph: '<path d="M5.5 7h3.6L12 11.4 14.9 7h3.6L12 18.5z"/>' },
  ts: { icon: 'fileTs', color: '#4f9dff', glyph: '<path d="M5.5 6.5h13"/><path d="M12 6.5V18"/>' },
  tsx: { icon: 'fileTs', color: '#4f9dff', glyph: '<path d="M5.5 6.5h13"/><path d="M12 6.5V18"/>' },
  js: { icon: 'fileJs', color: '#e5c454', glyph: '<path d="M15 6.5v8.2a3.3 3.3 0 0 1-6.6.5"/>' },
  jsx: { icon: 'fileJs', color: '#e5c454', glyph: '<path d="M15 6.5v8.2a3.3 3.3 0 0 1-6.6.5"/>' },
  rs: { icon: 'fileRs', color: '#f0916d', glyph: '<path d="M7 18V6h4.2a4 4 0 0 1 0 8H7"/><path d="m12.6 14 4.4 4"/>' },
  css: { icon: 'fileCss', color: '#5aa7f7', glyph: '<path d="M9.5 5 7.5 19M16.5 5l-2 14M5.5 10h13M5 15h13"/>' },
  json: { icon: 'fileJson', color: '#d9b45b', glyph: '<path d="M9.5 5H8a3 3 0 0 0-3 3v8a3 3 0 0 0 3 3h1.5"/><path d="M14.5 5H16a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-1.5"/>' },
  md: { icon: 'fileMd', color: '#8fa3c8', glyph: '<path d="M3.5 17V7.5l4 4.5 4-4.5V17"/><path d="M18 7.5V17"/><path d="m15.5 14.5 2.5 2.5 2.5-2.5"/>' },
  py: { icon: 'filePy', color: '#5aa7f7', glyph: '<path d="M7.5 18V6h4.2a3.6 3.6 0 0 1 0 7.2H7.5"/>' },
  m: { icon: 'fileC', color: '#a78bfa', glyph: '<path d="M16.5 8.6a5.2 5.2 0 1 0 0 6.8"/>' },
  h: { icon: 'fileC', color: '#a78bfa', glyph: '<path d="M16.5 8.6a5.2 5.2 0 1 0 0 6.8"/>' },
}

/** 按扩展名取图标；未登记返回 null（调用方退回通用文件图标）。 */
export function fileTypeIcon(path: string): FileTypeIcon | null {
  const i = path.lastIndexOf('.')
  if (i < 0) return null
  return BY_EXT[path.slice(i + 1).toLowerCase()] ?? null
}

/** 判据用：当前表里登记了哪些扩展名。 */
export const knownExtensions = (): string[] => Object.keys(BY_EXT)
