// packages/icons/src/set.ts —— ★Keryx OS 级图标集（组装层）—— **图标即数据（SVG path），不是字体**。
//
// 【组装关系】本文件把三部分合起来：
//   ① **生成数据** `./generated/icons.generated.ts`（GENERATED_ICONS）——由 `scripts/gen-icons.mjs` 从
//      Material Symbols（Apache-2.0）取 outline+filled、**缩放 960→24 网格**、归一化为绝对 M/L/C/Q/Z 产出；
//   ② **别名表**（ICON_ALIASES）——官方 `<icon type>` + 历史名 → 主名（策展契约，非生成）；
//   ③ 常量：ICON_CATEGORIES / UNKNOWN_ICON。
//
// 【★OS 级规范（图标库方案 §6）】
//   · 命名 = **kebab-case 语义名**（`arrow-back` 非 `arrowBack`）；主名 = kebab(Material Symbol 符号名)。
//   · 类别 = action / communication / media / status / file / navigation / form（每枚登记）。
//   · **双体系**：`d` = **outline**（线性，默认）；`filled` = **filled**（选中/激活态变体，缺省表示无该变体）。
//     取法：`iconByName('star')` = outline；`iconByName('star-filled')` = filled（无则回退 outline）。
//   · 网格 = 24×24（生成器已把源 960 网格缩放对齐——App 内核/宿主不读 viewBox，必须在数据侧归）。
//   · 零字面 hex（颜色由消费端 `currentColor`/token 着色——数据不含颜色）。
//   · 零 unicode 字形（拒绝字体/字形依赖——tofu 结构性排除）。
//
// 【路径来源】Material Symbols（Apache-2.0，https://fonts.google.com/icons）。见生成物头注。

import { GENERATED_ICONS } from './generated/icons.generated'

export interface IconDef {
  /** **outline**（线性）路径——默认形态；绝对 M/L/C/Q/Z，24×24 网格 */
  d: string
  /** **filled**（填充）路径——选中/激活态变体；缺省 = 该图标无 filled 变体 */
  filled?: string
  /** 视口（统一 `0 0 24 24`；缺省即此值） */
  viewBox?: string
  /** ★类别（图标库方案 §6 规范清单之一） */
  category: string
}

/** 图标类别规范清单（图标库方案 §6——门禁据此校验，新增类别须先改规范）。 */
export const ICON_CATEGORIES = ['action', 'communication', 'media', 'status', 'file', 'navigation', 'form'] as const

/** ★Keryx 主图标集（主名 = kebab-case；一枚图标一个主名）。由生成物 + 无重复保证。 */
export const ICON_SET: Record<string, IconDef> = GENERATED_ICONS as unknown as Record<string, IconDef>

/**
 * ★别名表（**非主名** → 主名）——向后兼容 + 官方语义保留（图标库方案 §6「官方小程序 type 别名表保留」）。
 *   · 官方 `<icon type>`：`success`→check-circle / `cancel`→error / `clear`→error / `waiting`→schedule /
 *     `success_no_circle`→check；
 *   · 语义等价历史名：`house`→home / `user`→person / `back`/`arrow-left`→arrow-back / `message`→chat /
 *     `plus`→add / `minus`→remove / `heart`→favorite / `warn`→warning / `clock`→schedule / `more`→more-horiz；
 *   · 早期 camelCase 兼容：`arrowLeft`/`arrowRight`/`arrowUp`/`arrowDown`。
 *   消费端（p-icon / gen-routes / Web shim）一律经 `resolveIconName` 解析。
 */
export const ICON_ALIASES: Record<string, string> = {
  // 语义等价历史名
  house: 'home',
  user: 'person',
  more: 'more-horiz',
  message: 'chat',
  plus: 'add',
  minus: 'remove',
  heart: 'favorite',
  back: 'arrow-back',
  // 早期 camelCase（P0 曾用）
  arrowLeft: 'arrow-back',
  arrowRight: 'arrow-forward',
  arrowUp: 'arrow-upward',
  arrowDown: 'arrow-downward',
  // 早期 kebab 别名
  'arrow-left': 'arrow-back',
  'arrow-right': 'arrow-forward',
  'arrow-up': 'arrow-upward',
  'arrow-down': 'arrow-downward',
  // 官方小程序 <icon type>
  success: 'check-circle',
  warn: 'warning',
  waiting: 'schedule',
  clock: 'schedule',
  success_no_circle: 'check',
  clear: 'error',
}

/** 主名清单（规范枚举；门禁/文档/检索——**不含别名**）。 */
export const ICON_NAMES: string[] = Object.keys(ICON_SET)

/** 别名清单（向后兼容映射；门禁校验其均指向存在的主名）。 */
export const ICON_ALIAS_NAMES: string[] = Object.keys(ICON_ALIASES)

/** filled 变体后缀（`name` + 此后缀 ⇒ 取 filled 态，缺省回退 outline）。 */
export const FILLED_SUFFIX = '-filled'

/** 未知图标名的**显式占位**（沿用 p-icon "未知 → ?" 语义，但**不用 unicode 字形**）。 */
export const UNKNOWN_ICON: IconDef = {
  d: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z',
  viewBox: '0 0 24 24',
  category: 'status',
}
