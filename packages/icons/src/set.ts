// packages/icons/src/set.ts —— ★Keryx OS 级图标集 —— **图标即数据（SVG path），不是字体**。
//
// 【为什么是数据（图标库方案 §4）】icon font 踩在"Do 放弃区"（不自建字体基础设施）；unicode 字形跨端
//   字体依赖 + 可渲染成 tofu。⇒ 单一真源 = SVG path `d` + viewBox，编译期内联进 IR，零运行时请求、零字体依赖。
//
// 【★对齐 OS 级图标库方案 §6「图标集设计规范」】——2026-10-11 收口：
//   · 命名 = **kebab-case 语义名**（`arrow-left` 非 `arrowLeft`）；官方小程序 `<icon type>` 别名表保留
//     （`success`/`cancel`/`clear`/`waiting`/`success_no_circle`… 走 ICON_ALIASES，不是主名）。
//   · 类别 = 规范清单 action / communication / media / status / file / navigation / form（每枚登记）。
//   · 无重复：同名路径的"别名图"收敛为**一枚主名**（其余进 ICON_ALIASES），无同路径多主名。
//   · 零字面 hex（颜色只允许 token/currentColor——本数据不含颜色，由消费端 currentColor 着色）。
//   · viewBox 统一 24×24 基准网格（光学修正见门禁/转换器）。
//   · 【诚实边界·P1/P2】outline（线性 stroke 1.5/2px）与 filled 成对体系**尚未建**——需线性源 SVG
//     （填充路径"改档位"变不出线性），本集当前均为 **filled**；duotone 双色槽同为 P2。
//
// 【路径来源】Material Symbols（Apache-2.0）——24×24 网格；含 h/v/z 等，构建期经 `normalizePath` 归一到 M/L/C/Q/Z。

export interface IconDef {
  /** 原始设计师路径（可能含 h/v/a/s/t 等） */
  d: string
  /** 视口（默认 24×24） */
  viewBox?: string
  /** ★类别（图标库方案 §6 规范清单之一：action/communication/media/status/file/navigation/form） */
  category: string
}

/** 图标类别规范清单（图标库方案 §6——门禁据此校验，新增类别须先改规范）。 */
export const ICON_CATEGORIES = ['action', 'communication', 'media', 'status', 'file', 'navigation', 'form'] as const

/** ★Keryx 图标集（主名 = kebab-case 语义名；一枚图标一个主名，无重复路径）。 */
export const ICON_SET: Record<string, IconDef> = {
  // ── navigation ──
  home: { d: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z', category: 'navigation' },
  user: { d: 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z', category: 'navigation' },
  menu: { d: 'M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z', category: 'navigation' },
  more: { d: 'M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm12 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z', category: 'navigation' },
  'arrow-left': { d: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z', category: 'navigation' },
  'arrow-right': { d: 'M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z', category: 'navigation' },
  'arrow-up': { d: 'M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8z', category: 'navigation' },
  'arrow-down': { d: 'M20 12l-1.41-1.41L13 16.17V4h-2v12.17l-5.58-5.59L4 12l8 8z', category: 'navigation' },

  // ── communication ──
  message: { d: 'M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z', category: 'communication' },
  chat: { d: 'M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z', category: 'communication' },

  // ── action ──
  search: { d: 'M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z', category: 'action' },
  plus: { d: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z', category: 'action' },
  minus: { d: 'M19 13H5v-2h14v2z', category: 'action' },
  close: { d: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z', category: 'action' },
  check: { d: 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z', category: 'action' },
  download: { d: 'M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z', category: 'action' },
  settings: { d: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z', category: 'action' },
  star: { d: 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z', category: 'action' },
  heart: { d: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z', category: 'action' },

  // ── status ──
  success: { d: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z', category: 'status' },
  info: { d: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z', category: 'status' },
  warn: { d: 'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z', category: 'status' },
  error: { d: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z', category: 'status' },
  clock: { d: 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z', category: 'status' },
}

/**
 * ★别名表（**非主名** → 主名）——向后兼容 + 官方语义保留（图标库方案 §6「官方小程序 type 别名表保留」）。
 *   · 官方 `<icon type>`：`success_no_circle`（无圈对勾）/ `cancel`（圈叉）/ `clear` / `waiting`（时钟）；
 *   · 语义等价历史名：`house`（= home）、`person`（= user）、`back`（= arrow-left）；
 *   · 早期 camelCase 兼容：`arrowLeft`/`arrowRight`/`arrowUp`/`arrowDown`（P0 曾用，统一到 kebab）。
 *   消费端（p-icon / gen-routes / Web shim）一律经 `resolveIconName` 解析，主名表保持干净（无重复）。
 */
export const ICON_ALIASES: Record<string, string> = {
  house: 'home',
  person: 'user',
  back: 'arrow-left',
  arrowLeft: 'arrow-left',
  arrowRight: 'arrow-right',
  arrowUp: 'arrow-up',
  arrowDown: 'arrow-down',
  success_no_circle: 'check',
  cancel: 'error',
  clear: 'error',
  waiting: 'clock',
}

/** 主名清单（规范枚举；门禁/文档/检索——**不含别名**）。 */
export const ICON_NAMES: string[] = Object.keys(ICON_SET)

/** 别名清单（向后兼容映射；门禁校验其均指向存在的主名）。 */
export const ICON_ALIAS_NAMES: string[] = Object.keys(ICON_ALIASES)

/** 未知图标名的**显式占位**（沿用 p-icon "未知 → ?" 语义，但**不用 unicode 字形**——用一个显式路径：圆角方框 + 问号感）。 */
export const UNKNOWN_ICON: IconDef = { d: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z', viewBox: '0 0 24 24', category: 'status' }
