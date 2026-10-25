// ui/src/fileIcons.ts —— 文件类型 → 图标 + 类型色（决策 #1233）
//
// 【为什么不直接用「文档轮廓 + 类型字」】13px 的树行里，文档轮廓会把可用像素再切掉一圈，
//   里面的字母只剩 4px 高，读不出来。所以**每个类型只留一个记号**（V / T / J / R / # / {} / M / P / C），
//   靠"形状 + 类型色"两条腿区分——色盲/灰度截图下还有形状，纯形状下还有颜色。
//
// 【颜色是「文件类型色」不是「状态色」】和语法着色的 `--syn-*` 一样，这一层不许借用
//   `--ok/--warn/--bad`（那三个表达"系统状态"）。所以这里写死十六进制，并集中在**一个表**里。
//
// 【未登记的扩展名】返回 `null` ⇒ 走通用文档图标。加新语言时**只改这张表**（判据 ㉙ 会盯着树里出现的类型）。

export interface FileTypeIcon {
  /** StudioIcon 的 name */
  icon: string
  /** 类型色（不是状态色） */
  color: string
}

const BY_EXT: Record<string, FileTypeIcon> = {
  vue: { icon: 'fileVue', color: '#41b883' },
  ts: { icon: 'fileTs', color: '#4f9dff' },
  tsx: { icon: 'fileTs', color: '#4f9dff' },
  js: { icon: 'fileJs', color: '#e5c454' },
  jsx: { icon: 'fileJs', color: '#e5c454' },
  rs: { icon: 'fileRs', color: '#f0916d' },
  css: { icon: 'fileCss', color: '#5aa7f7' },
  json: { icon: 'fileJson', color: '#d9b45b' },
  md: { icon: 'fileMd', color: '#8fa3c8' },
  py: { icon: 'filePy', color: '#5aa7f7' },
  m: { icon: 'fileC', color: '#a78bfa' },
  h: { icon: 'fileC', color: '#a78bfa' },
}

/** 按扩展名取图标；未登记返回 null（调用方退回通用文件图标）。 */
export function fileTypeIcon(path: string): FileTypeIcon | null {
  const i = path.lastIndexOf('.')
  if (i < 0) return null
  return BY_EXT[path.slice(i + 1).toLowerCase()] ?? null
}

/** 判据用：当前表里登记了哪些扩展名。 */
export const knownExtensions = (): string[] => Object.keys(BY_EXT)
