// ui/src/fileIcons.ts —— 文件类型 → 图标（决策 #1237）
//
// 【为什么不用"统一徽章 + 单字母"】那是上一版，用户一句"辨识度不够"就否了。
//   对比 VS Code（Seti）：它靠的是**语言自己的记号**——Vue 就是那个绿色 V，Rust 就是齿轮，
//   TS 就是蓝底 TS 方块——不是"同一张底 + 换字母"。统一容器会抹平差异，正好把辨识度做没了。
//
// 【本表的画法】24 网格、**填充**（不描边）、每个类型最多两色、品牌色为准。
//   13–16px 下填充剪影比 1.7px 描边清楚一个量级（同一个 V，描边糊、填充清）。
//
// 【颜色是「语言品牌色」不是「状态色」】不借 `--ok/--warn/--bad`；加语言只改这张表。

export interface FileTypeIcon {
  /** 判据/调试用的稳定名字 */
  icon: string
  /** 主色（判据 ㉙ 用它判断"不是同一个色"） */
  color: string
  /** 24 网格内的 SVG 片段（填充，多色） */
  svg: string
}

const TS_S = 'M13.1 16.5c.9.5 1.9.8 2.9.8 1.9 0 3.1-.9 3.1-2.4 0-1.2-.7-1.9-2.2-2.4l-.8-.3c-.7-.2-1-.4-1-.8s.4-.6.9-.6c.6 0 1.2.2 1.7.5l.8-1.4c-.7-.4-1.5-.6-2.4-.6-1.7 0-2.8.9-2.8 2.3 0 1.2.7 1.8 2.1 2.3l.8.3c.7.2.9.4.9.8s-.3.7-1 .7c-.7 0-1.4-.3-2-.7z'

const BY_EXT: Record<string, FileTypeIcon> = {
  // Vue：绿色 V（外）+ 深色 V（内）—— 语言本身的记号，一眼认
  vue: {
    icon: 'vue',
    color: '#41B883',
    svg:
      '<path d="M2.2 4.2h4.9L12 12.2 16.9 4.2h4.9L12 20.6z" fill="#41B883"/>' +
      '<path d="M7.1 4.2h2.9L12 7.3l2-3.1h2.9L12 11.7z" fill="#35495E"/>',
  },
  // TS / TSX：蓝底白 TS（TypeScript 官方色）
  ts: {
    icon: 'ts',
    color: '#3178C6',
    svg:
      '<rect x="2" y="2" width="20" height="20" rx="3.4" fill="#3178C6"/>' +
      '<path d="M6 8.4h5.3v1.8H9.4v6.4H7.9v-6.4H6z" fill="#fff"/>' +
      `<path d="${TS_S}" fill="#fff"/>`,
  },
  // JS / JSX：黄底黑 JS（JavaScript 官方色）
  js: {
    icon: 'js',
    color: '#F7DF1E',
    svg:
      '<rect x="2" y="2" width="20" height="20" rx="3.4" fill="#F7DF1E"/>' +
      '<path d="M9.4 8.4h1.5v5.6c0 1.5-.8 2.3-2.2 2.3-.8 0-1.4-.3-1.9-1l1-1c.2.3.4.5.8.5.4 0 .7-.2.7-.9z" fill="#1B1B1B"/>' +
      `<path d="${TS_S}" fill="#1B1B1B" transform="translate(0.2 0)"/>`,
  },
  // Rust：齿轮（Rust 的官方记号就是齿轮），暖锈色
  rs: {
    icon: 'rs',
    color: '#DEA584',
    svg:
      '<path d="M12 2.2l1.9 1.6 2.4-.6.7 2.4 2.4.7-.6 2.4 1.6 1.9-1.6 1.9.6 2.4-2.4.7-.7 2.4-2.4-.6L12 21.8l-1.9-1.6-2.4.6-.7-2.4-2.4-.7.6-2.4L3.6 12l1.6-1.9-.6-2.4 2.4-.7.7-2.4 2.4.6z" fill="#DEA584"/>' +
      '<circle cx="12" cy="12" r="4.4" fill="#1B1B1B"/><circle cx="12" cy="12" r="2.7" fill="#F6EFEA"/>',
  },
  // CSS：蓝色盾牌 + 白色 "3"（CSS3 的经典记号）
  css: {
    icon: 'css',
    color: '#3B82F6',
    svg:
      '<path d="M3.6 3.2h16.8l-1.7 15.2L12 20.8l-6.7-2.4z" fill="#3B82F6"/>' +
      '<path d="M16.6 7.6H9l.2 2.4h7.2l-.6 5.6-3.8 1.1-3.8-1.1-.2-2.6h2.4l.1 1.1 1.5.4 1.6-.4.2-1.9H8.2l-.5-4.6h9.1z" fill="#fff"/>',
  },
  // JSON：黄铜色大括号（最通用的 JSON 记号）
  json: {
    icon: 'json',
    color: '#E5B93C',
    svg:
      '<path d="M9.6 3.4c-2 0-3.1 1-3.1 2.9v2.4c0 1-.5 1.6-1.5 1.7v1.2c1 .1 1.5.7 1.5 1.7v2.4c0 1.9 1.1 2.9 3.1 2.9" stroke="#E5B93C" stroke-width="2.1" fill="none" stroke-linecap="round"/>' +
      '<path d="M14.4 3.4c2 0 3.1 1 3.1 2.9v2.4c0 1 .5 1.6 1.5 1.7v1.2c-1 .1-1.5.7-1.5 1.7v2.4c0 1.9-1.1 2.9-3.1 2.9" stroke="#E5B93C" stroke-width="2.1" fill="none" stroke-linecap="round"/>',
  },
  // Markdown：蓝底白 M↓（GitHub 的 markdown 徽章同款）
  md: {
    icon: 'md',
    color: '#42A5F5',
    svg:
      '<rect x="1.6" y="4.6" width="20.8" height="14.8" rx="2.6" fill="#42A5F5"/>' +
      '<path d="M4.6 16V9.2l2.4 3 2.4-3V16" stroke="#fff" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M16.4 9.2V15m0 0-2.2-2.4M16.4 15l2.2-2.4" stroke="#fff" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  // Python：蓝/黄双色块（Python 官方蓝黄）
  py: {
    icon: 'py',
    color: '#3776AB',
    svg:
      '<rect x="2.6" y="2.6" width="18.8" height="18.8" rx="4" fill="#3776AB"/>' +
      '<path d="M2.6 13.4h18.8v3.6a2.4 2.4 0 0 1-2.4 2.4H5a2.4 2.4 0 0 1-2.4-2.4z" fill="#FFD43B"/>' +
      '<circle cx="9" cy="8" r="1.5" fill="#fff"/><circle cx="15" cy="16" r="1.5" fill="#3776AB"/>',
  },
  // C / Objective-C（.m/.h）：紫底白 C
  m: {
    icon: 'c',
    color: '#A78BFA',
    svg:
      '<rect x="2" y="2" width="20" height="20" rx="3.4" fill="#A78BFA"/>' +
      '<path d="M15.9 9.2a4.6 4.6 0 1 0 0 5.6" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/>',
  },
}

const ALIAS: Record<string, string> = { tsx: 'ts', jsx: 'js', h: 'm' }

/** 按扩展名取图标；未登记返回 null（调用方退回通用文档图标）。 */
export function fileTypeIcon(path: string): FileTypeIcon | null {
  const i = path.lastIndexOf('.')
  if (i < 0) return null
  const ext = path.slice(i + 1).toLowerCase()
  return BY_EXT[ALIAS[ext] ?? ext] ?? null
}

/** 判据用：当前表里登记了哪些扩展名。 */
export const knownExtensions = (): string[] => Object.keys(BY_EXT)
