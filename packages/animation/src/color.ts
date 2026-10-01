// packages/animation/src/color.ts
// ★★颜色（2026-10-01）—— **CSS 颜色 → 通道**（跨语言契约的 TS 半边）
//
// 【为什么需要这份 TS 实现（而不是只留 Rust 侧）】
//   颜色的数值是**跨语言契约**：内核（Rust）解析**底色**（树 DTO 的 `backgroundColor`），
//   本包解析**动画的 from/to**（用户声明的颜色），两者必须给出**同一种字节序与同一种简写展开**，
//   否则"动画的终点"与"复位回底色的结果"会对不上（同一份源码在端上出现颜色跳变）。
//   `tests/anim-color-golden.test.ts` 以内核实测值（`cargo test --lib parse_css_color_dump`）为期望
//   比对本文件 ⇒ 任一侧改了规则而另一侧没跟 ⇒ 当场红。
//
// 【支持形态（与内核 `ffi.rs::parse_css_color` 完全一致）】
//   `#RGB`（简写，各通道重复一位）· `#RRGGBB`（不透明）· `#RRGGBBAA`（CSS4 序，低 8 位 = alpha）
//   ★8 位**取 CSS4 序**（与 Web 一致）——不是 Android 的 `#AARRGGBB`（那条在本引擎里不采纳，
//     理由：底色的来源是 CSS 风格声明，与 Web 保持一致才不会出现"网页与 App 颜色不同"）。
//   ★未知形态**抛错**（不静默落黑——静默会把"写错的颜色"变成看不见的 bug）。

/** 颜色通道（0..255；`a` 缺省 = 255 不透明） */
export interface ColorChannels {
  r: number
  g: number
  b: number
  a: number
}

/** 打包为 `0xAARRGGBB`（与内核 `parse_css_color` 的返回值同形——golden 用它逐位比对） */
export function packChannels(c: ColorChannels): number {
  return (((c.a & 0xff) << 24) | ((c.r & 0xff) << 16) | ((c.g & 0xff) << 8) | (c.b & 0xff)) >>> 0
}

/** 通道 → `#rrggbb`（诊断/报告用；alpha 非 255 时输出 `#rrggbbaa`） */
export function channelsToHex(c: ColorChannels): string {
  const h = (n: number): string => n.toString(16).padStart(2, '0')
  const rgb = `#${h(c.r)}${h(c.g)}${h(c.b)}`
  return c.a === 255 ? rgb : `${rgb}${h(c.a)}`
}

/**
 * CSS 十六进制颜色 → 通道（**与内核同规则**；见文件头）
 *
 * @throws 非法形态（非 `#` 开头 / 非法十六进制 / 位数不在 {3,6,8}）
 */
export function parseColorToChannels(css: string): ColorChannels {
  if (typeof css !== 'string') {
    throw new Error(`颜色必须是字符串（收到 ${typeof css}）——用 '#RRGGBB' 形态`)
  }
  const s = css.trim()
  if (!s.startsWith('#')) {
    throw new Error(`颜色 "${s}" 不支持：只接受 #RGB / #RRGGBB / #RRGGBBAA 十六进制形态`)
  }
  const hex = s.slice(1)
  if (!/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error(`颜色 "${s}" 不是合法十六进制（应为 #RGB / #RRGGBB / #RRGGBBAA）`)
  }
  switch (hex.length) {
    case 3: {
      // #RGB：各通道重复一位（#f0a → #ff00aa，alpha = FF）
      return {
        r: parseInt(hex[0]! + hex[0]!, 16),
        g: parseInt(hex[1]! + hex[1]!, 16),
        b: parseInt(hex[2]! + hex[2]!, 16),
        a: 255,
      }
    }
    case 6:
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: 255,
      }
    case 8:
      // ★CSS4 序 `#RRGGBBAA`（低 8 位 = alpha）
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: parseInt(hex.slice(6, 8), 16),
      }
    default:
      throw new Error(
        `颜色 "${s}" 位数非法（${hex.length} 位）——只接受 #RGB（3）/ #RRGGBB（6）/ #RRGGBBAA（8）`,
      )
  }
}
