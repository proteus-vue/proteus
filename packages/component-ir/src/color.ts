// packages/component-ir/src/color.ts
// ★★颜色**保守判定**（唯一实现；供「paint-hint 推导」与「遮挡剔除」共用）
//
// 【为什么单独成模块（本仓纪律：同一语义一处实现）】
//   同一个问题在两处被问到：① 编译期推导 paint-hint（"这层能不能用紧凑/无 backing store 格式"）；
//   ② 运行期遮挡剔除（"这个矩形能不能盖住下面的内容"）。
//   两处的**判据完全相同**：*这个颜色是不是确实（不透明 / 纯色）*。
//   ⇒ 若各写一份，必然漂移：一处放松到"具名色也算"，另一处保守 ⇒ 同一个节点两条结论。
//
// 【为什么必须保守（"拿不准一律否"）】
//   误判的后果是**静默画错**（不是慢）：
//   · 判成"不透明" ⇒ 遮挡剔除会把下面真实可见的内容裁掉（内容消失）；
//   · 判成"单色可紧凑存储" ⇒ 平台按单通道格式分配 ⇒ **双色内容被压成单色**（画面错）。
//   ⇒ 只认最明确的写法；具名色（`red`）/ `hsl()` / CSS 变量 / 未知函数式一律**返回 false**。
//
// 【★本模块诞生的直接原因（2026-09-29 实测）】
//   `isMonochrome` 原推导是 `hasText && text.color && !backgroundImage && !needsCompositing`
//   ——它只检查"字是什么颜色"，**完全不看底色**。实测（本仓 probe）：
//     `color:#ffffff; background-color:#285ac8`（白字 + 蓝底，正是 4050 夹具的形状）⇒ 判 true。
//   而单通道紧凑格式（iOS `gray8Uint`）**表达不了两个颜色** ⇒ 一旦接线就是画面错。
//   同理 `isPureBackground`（"不分配 backing store"）也没有排除**带文本**的节点。
//   两个 hint 此前**无任何消费者**（全仓 grep 零命中）⇒ 缺陷一直不可见；
//   本模块 + 推导修复是"接线前先把判据弄对"。

/** 颜色是否**确实不透明**（保守：拿不准 ⇒ false） */
export function isOpaqueColor(color: string | undefined | null): boolean {
  if (color === undefined || color === null) return false
  const c = color.trim().toLowerCase()
  if (c === '') return false
  if (c === 'transparent') return false
  // #rgb / #rrggbb（无 alpha 通道 ⇒ 不透明）
  if (/^#[0-9a-f]{3}$/.test(c) || /^#[0-9a-f]{6}$/.test(c)) return true
  // #rgba / #rrggbbaa——仅当 alpha 为 ff/f 时才算不透明
  if (/^#[0-9a-f]{4}$/.test(c)) return c[4] === 'f'
  if (/^#[0-9a-f]{8}$/.test(c)) return c.slice(7) === 'ff'
  // rgb(r,g,b)（三参无 alpha ⇒ 不透明）；rgba(...) α 必须 >= 1
  const m = /^rgba?\(([^)]*)\)$/.exec(c)
  if (m !== null) {
    const parts = m[1]!.split(',').map((t) => t.trim())
    if (parts.length === 3) return true
    if (parts.length === 4) {
      const a = Number(parts[3])
      return Number.isFinite(a) && a >= 1
    }
  }
  return false // 具名色 / hsl / var() / 其它：拿不准 ⇒ false
}
