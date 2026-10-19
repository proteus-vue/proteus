// website/scripts/lib/cap-usage/shared.mjs
// ★#1088：能力页「用法」示例的共享原语（数据分片见 cap-usage-*.mjs，装配见 index.mjs）。

/** 一条双语言示例：`{ zh, en }` 两段行数组（代码结构相同，注释/文案不同） */
export const U = (zh, en) => ({ zh, en })

/**
 * 代码骨架：抹掉行尾注释与字符串**内容**，空白归一。
 * 用于比对中英两段"是不是同一段代码"（注释与文案允许不同）。
 */
export function skeletonOf(lines) {
  return lines.map((l) =>
    l
      .replace(/\/\/.*$/, '')
      .replace(/'[^']*'/g, "''")
      .replace(/"[^"]*"/g, '""')
      .replace(/\s+/g, ' ')
      .trim(),
  )
}
