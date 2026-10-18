// packages/slot-runtime/src/text-transform.ts
// ★★★`text-transform` 的**唯一语义实现**（2026-10-18 · 批 B F3）。
//
// 【为什么在共享运行期（而不是各端宿主）】
//   · **Web** 由浏览器原生 CSS 处理，不经过本函数；
//   · **MP/Skyline** 官方样式表**没有 `text-transform`**（已核 `skyline-wxss-official.json`：110 条属性无此项）
//     ⇒ 只能编译期对**静态文本**变换；动态文本在 MP 端无通道（编译期如实诊断）；
//   · **App 三端**（Android/iOS/鸿蒙）的文本都是**同一份 JS 实例化树的字符串** ⇒ 在本文件统一变换
//     ⇒ 三端宿主**零改动**、算法只有一份（纪律：同一系统内的通用能力严禁每个宿主各实现一遍，决策 #1055）。
//
// 【★Web 真值（真 Chromium 151 实测，2026-10-18）】
//   · `uppercase` / `lowercase`：与 JS `toUpperCase/toLowerCase` **逐字符一致**
//     （实测 `straße→STRASSE`、`ﬁle→FILE`、`ΣΟΦΟΣ→σοφος`、`İSTANBUL→i̇stanbul`）
//     ⇒ 直接复用内建映射，**不手写 Unicode 表**（手写必然与 ICU 漂移）。
//   · `capitalize`：**不是** `\b\w` 正则能表达的规则——见下。
//
// 【★★capitalize 的词边界（Chromium 逐像素比对验证：135 条样本 0 差异）】
//   判定依据 = **前一个字符是否"词内"**；词首且有大小写 ⇒ 转 titlecase。
//   · **词内**：字母 / 组合符 / 十进制数字（Nd）/ 字母数字（Nl，
//     如罗马数字 Ⅻ）/ 撇号 `'` / 下划线 `_` / 中点 `·`
//   · **边界**（另起一词）：
//     – **CJK 与假名/韩文/半角片假名**（Han / Hiragana / Katakana / Hangul / U+FF66–FF9F）：
//       `abc中文def` ⇒ `Abc中文Def`（中文本身无大小写，但它**断词**）
//     – **其它数字类**（No 类：`½` `①` `²` `⅓` `⑴`）：`½abc` ⇒ `½abc` 的 `a` 不算词首
//     – emoji / 符号（`©` `→` `™` `°`）/ 标点 / `:` / 空格 / 制表
//   · **转 titlecase 而非 uppercase**：`ǳ`（U+01C6）⇒ `ǲ`（U+01C5），不是 `Ǳ`。
//   · **长度扩张的映射不采用**：`ß` 词首保持 `ß`（`toUpperCase` 得 `SS`，实测 Chromium 不展开）；
//     同理 `ﬁ`。⇒ 规则：`up.length === ch.length` 才采用（单码点 ↔ 单码点的映射）。
//   · 反例（都被实测排除）：`don't` ⇒ `Don't`（不转 T）、`a_b` ⇒ `A_b`、`a1b` ⇒ `A1b`、
//     `123abc` ⇒ `123abc`、`v1.2beta` ⇒ `V1.2beta`、`abc中文` ⇒ `Abc中文`。
//
// 【诚实边界】
//   · `full-width` / `full-size-kana`（CSS Text 3 的 CJK 宽度变换）**未实现**：三端宿主无对应通道，
//     且需要东亚宽度表 ⇒ 编译期诊断（不静默当 none）；
//   · `capitalize` 是**逐字符**判定（与 Chromium 实测一致）。CSS 规范允许 UA 用语言相关算法，
//     若某端差异以 Chromium 为准（基准 = Web）。

/** CSS `text-transform` 的封闭集（本实现支持的子集） */
export const TEXT_TRANSFORM_VALUES = ['none', 'uppercase', 'lowercase', 'capitalize'] as const

export type TextTransformValue = (typeof TEXT_TRANSFORM_VALUES)[number]

/**
 * **词内**字符判定（不另起一词）——**纯码位区间实现**。
 *
 * ★★★为什么不用 Unicode 属性转义（反斜杠加 p 加大括号的语法）（2026-10-18 实测）：**鸿蒙 JSVM 不支持任何 Unicode
 *   属性转义**——bundle 一旦含它就**整包编译失败**（现象：`SUPERAPP_SCREEN_DRIVE
 *   {"error":"bundle 编译失败"}`，而 `node --check` 通过）。目标引擎是能力最弱者 ⇒ 共享层的正则
 *   只用**区间表**（与 iOS 平台层 `isCJK` 同款做法）。
 *
 * 【三类区间（与 Chromium 逐像素比对 145 条样本 0 差异得出）】
 *   · LETTER     —— 有大小写的字母类（拉丁/希腊/西里尔/亚美尼亚/格鲁吉亚/各南亚与东南亚文字…）
 *   · MARK       —— 组合符（联合附加符，如 U+0300–U+036F）
 *   · DIGIT      —— 十进制数字（Nd）+ 字母数字（Nl，如罗马数字 Ⅻ）
 *   ★**天然断词**脚本（CJK/假名/韩文/半角片假名）**不在**这些区间里 ⇒ 自然成为边界。
 *   ★No 类数字（`½ ① ²`）**不是**词内（Chromium 实测是边界）⇒ 区间表只列 Nd/Nl 区段。
 */
const WORD_CHAR_RANGES: ReadonlyArray<readonly [number, number]> = [
  // ── LETTER：拉丁 ──
  [0x0041, 0x005A], [0x0061, 0x007A],           // ASCII
  [0x00AA, 0x00AA], [0x00B5, 0x00B5], [0x00BA, 0x00BA],
  [0x00C0, 0x00D6], [0x00D8, 0x00F6], [0x00F8, 0x02C1],   // 带变音拉丁 / IPA / 修饰字母
  [0x02C6, 0x02D1], [0x02E0, 0x02E4],
  [0x0370, 0x0373], [0x0376, 0x0377], [0x037A, 0x037D], [0x037F, 0x037F],
  [0x0386, 0x0386], [0x0388, 0x03F5], [0x03F7, 0x0481],   // 希腊 + 部分西里尔
  [0x048A, 0x052F],                              // 西里尔补充
  [0x0531, 0x0556], [0x0560, 0x0588],            // 亚美尼亚
  [0x05D0, 0x05EA], [0x05EF, 0x05F2],            // 希伯来
  [0x0620, 0x064A], [0x066E, 0x066F], [0x0671, 0x06D3], [0x06D5, 0x06D5],
  [0x06E5, 0x06E6], [0x06EE, 0x06EF], [0x06FA, 0x06FC],   // 阿拉伯
  [0x0710, 0x072F], [0x074D, 0x07A5],            // 叙利亚 / 塔纳
  [0x0904, 0x0939], [0x0958, 0x0961],            // 天城文
  [0x0971, 0x0980], [0x0985, 0x09B9],            // 孟加拉
  [0x0A05, 0x0A39], [0x0A85, 0x0AB9],            // 古木基 / 古吉拉特
  [0x0B05, 0x0B39], [0x0B85, 0x0BB9],            // 奥里亚 / 泰米尔
  [0x0C05, 0x0C39], [0x0C85, 0x0CB9],            // 泰卢固 / 卡纳达
  [0x0D05, 0x0D39], [0x0D85, 0x0DC6],            // 马拉雅拉姆 / 僧伽罗
  [0x0E01, 0x0E30], [0x0E32, 0x0E33], [0x0E40, 0x0E46],   // 泰文
  [0x0E81, 0x0EB0], [0x0EB2, 0x0EB3], [0x0EC0, 0x0EC6],   // 老挝文
  [0x0F40, 0x0F6C],                              // 藏文
  [0x1000, 0x102A], [0x1050, 0x1055],            // 缅文 / 傣文
  [0x10A0, 0x10FA], [0x10FC, 0x10FF],            // 格鲁吉亚
  // ★谚文**字母**（U+1100–11FF 全段，含首辅音/元音/终辅音）算词内（Chromium 实测：
  //   `\u1100 abc` 的拉丁不算词首时保持小写）——注意与**谚文音节**（U+AC00 起）不同，后者断词。
  [0x1100, 0x11FF],                              // 谚文字母
  [0x1200, 0x135A], [0x13A0, 0x13F5],            // 埃塞俄比亚 / 切罗基
  [0x1401, 0x166C], [0x166F, 0x167F],            // 统一加拿大原住民
  [0x1681, 0x169A], [0x16A0, 0x16EA],            // 奥甘 / 卢恩
  [0x1700, 0x170C], [0x170E, 0x1711],            // 塔加洛
  [0x1780, 0x17B3],                              // 高棉
  [0x1820, 0x1842], [0x1885, 0x1886],            // 蒙古
  [0x1900, 0x191E], [0x1950, 0x196D],            // 林布 / 德宏傣
  [0x1A00, 0x1A16], [0x1B05, 0x1B33],            // 布吉 / 巴厘
  [0x1C90, 0x1CBF],                              // 格鲁吉亚扩展
  [0x1E00, 0x1F15], [0x1F18, 0x1F1D], [0x1F20, 0x1F45], [0x1F48, 0x1F4D],
  [0x1F50, 0x1F57], [0x1F59, 0x1F59], [0x1F5B, 0x1F5B], [0x1F5D, 0x1F5D],
  [0x1F5F, 0x1F7D], [0x1F80, 0x1FB4], [0x1FB6, 0x1FBC], [0x1FBE, 0x1FBE],
  [0x1FC2, 0x1FC4], [0x1FC6, 0x1FCC], [0x1FD0, 0x1FD3], [0x1FD6, 0x1FDB],
  [0x1FE0, 0x1FEC], [0x1FF2, 0x1FF4], [0x1FF6, 0x1FFC],   // 拉丁扩展附加 / 希腊扩展
  [0x2071, 0x2071], [0x207F, 0x207F], [0x2090, 0x209C],
  [0x2102, 0x2102], [0x2107, 0x2107], [0x210A, 0x2113], [0x2115, 0x2115],
  [0x2119, 0x211D], [0x2124, 0x2124], [0x2126, 0x2126], [0x2128, 0x2128],
  [0x212A, 0x212D], [0x212F, 0x2139], [0x213C, 0x213F], [0x2145, 0x2149], [0x214E, 0x214E],   // 字母式符号
  [0x2C00, 0x2C7B], [0x2C7E, 0x2CE4],            // 格拉哥里 / 科普特
  [0x2D00, 0x2D25], [0x2D30, 0x2D67],            // 格鲁吉亚小写 / 提非纳
  [0x3005, 0x3006],                              // 々 〆（CJK 迭代号——**是字母**）
  [0x3100, 0x312F], [0x31A0, 0x31BF],            // 注音符号（**词内**：Chromium 实测不断词）
  [0xA000, 0xA48C],                              // 彝文
  [0xA4D0, 0xA4FD], [0xA500, 0xA60C],            // 傈僳 / 瓦伊
  [0xA640, 0xA66E], [0xA680, 0xA69C],            // 西里尔扩展
  [0xA722, 0xA787], [0xA78B, 0xA7AE],            // 拉丁扩展 D
  [0xA7B0, 0xA7C5], [0xA7CB, 0xA7CF],
  [0xA800, 0xA801], [0xA803, 0xA805], [0xA807, 0xA80A], [0xA80C, 0xA822],   // 德宏傣
  [0xA840, 0xA873], [0xA882, 0xA8B3],            // 八思巴 / 索拉什特拉
  [0xA90A, 0xA925], [0xA930, 0xA946],            // 爪哇 / 泰卢固扩展
  [0xA960, 0xA97C],                              // 谚文扩展 A
  [0xA984, 0xA9B2], [0xA9E0, 0xA9E4],            // 贾维 / 缅甸扩展
  [0xAA00, 0xAA28], [0xAA40, 0xAA42], [0xAA44, 0xAA4B],   // 占婆
  [0xAA60, 0xAA76], [0xAA7A, 0xAA7A],            // 缅文扩展
  [0xAA80, 0xAAAF], [0xAAB1, 0xAAB1], [0xAAB5, 0xAAB6], [0xAAB9, 0xAABD],
  [0xAAC0, 0xAAC0], [0xAAC2, 0xAAC2], [0xAADB, 0xAADD],   // 傣泐
  [0xAB01, 0xAB06], [0xAB09, 0xAB0E], [0xAB11, 0xAB16], [0xAB20, 0xAB26], [0xAB28, 0xAB2E],   // 埃塞俄比亚扩展
  [0xAB70, 0xABE2],                              // 切罗基小写
  // ★谚文音节（U+AC00–D7A3）**不在**本表：Chromium 实测韩文**断词**（`한글abc` ⇒ `한글Abc`）
  //   ⇒ 它属 WORD_BREAK_RANGES。谚文**字母**（U+1100–11FF / A960–A97F）是单词内字符（在上面列）。
  [0xF900, 0xFA6D], [0xFA70, 0xFAD9],            // CJK 兼容表意（**是字母**）
  [0xFB00, 0xFB06], [0xFB13, 0xFB17],            // 拉丁/亚美尼亚连字
  [0xFB1F, 0xFB28], [0xFB2A, 0xFB36], [0xFB38, 0xFB3C], [0xFB3E, 0xFB3E],
  [0xFB40, 0xFB41], [0xFB43, 0xFB44], [0xFB46, 0xFBB1],   // 希伯来呈现形
  [0xFBD3, 0xFD3D], [0xFD50, 0xFD8F], [0xFD92, 0xFDC7],   // 阿拉伯呈现形
  [0xFDF0, 0xFDFB], [0xFE70, 0xFE74], [0xFE76, 0xFEFC],   // 阿拉伯补充
  [0xFF21, 0xFF3A], [0xFF41, 0xFF5A],            // 全角拉丁
  [0xFF66, 0xFFDC],                              // 半角片假名/谚文（**注**：片假名区也是字母）
  // ── MARK：组合符 ──
  [0x0300, 0x036F], [0x0483, 0x0489], [0x0591, 0x05BD], [0x05BF, 0x05BF],
  [0x05C1, 0x05C2], [0x05C4, 0x05C5], [0x0610, 0x061A], [0x064B, 0x065F],
  [0x0670, 0x0670], [0x06D6, 0x06DC], [0x06DF, 0x06E4], [0x06E7, 0x06E8],
  [0x06EA, 0x06ED], [0x0900, 0x0903], [0x093A, 0x093C], [0x093E, 0x094F],
  [0x0951, 0x0957], [0x0962, 0x0963], [0x0981, 0x0983], [0x09BC, 0x09BC],
  [0x09BE, 0x09C4], [0x09C7, 0x09C8], [0x09CB, 0x09CD], [0x0A01, 0x0A03],
  [0x0A3C, 0x0A51], [0x0A70, 0x0A71], [0x0A75, 0x0A75], [0x0A81, 0x0A83],
  [0x0ABC, 0x0ABC], [0x0ABE, 0x0AC5], [0x0AC7, 0x0AC9], [0x0ACB, 0x0ACD],
  [0x0B01, 0x0B03], [0x0B3C, 0x0B3C], [0x0B3E, 0x0B44], [0x0B47, 0x0B48],
  [0x0B4B, 0x0B4D], [0x0B56, 0x0B57], [0x0C00, 0x0C04], [0x0C3E, 0x0C44],
  [0x0C46, 0x0C48], [0x0C4A, 0x0C4D], [0x0C55, 0x0C56], [0x0D00, 0x0D03],
  [0x0D3B, 0x0D3C], [0x0D3E, 0x0D44], [0x0D46, 0x0D48], [0x0D4A, 0x0D4D],
  [0x0D57, 0x0D57], [0x0E31, 0x0E31], [0x0E34, 0x0E3A], [0x0E47, 0x0E4E],
  [0x0EB1, 0x0EB1], [0x0EB4, 0x0EB9], [0x0EBB, 0x0EBC], [0x0EC8, 0x0ECD],
  [0x0F18, 0x0F19], [0x0F35, 0x0F35], [0x0F37, 0x0F37], [0x0F39, 0x0F39],
  [0x0F3E, 0x0F3F], [0x0F71, 0x0F84], [0x0F86, 0x0F87], [0x0F8D, 0x0F97],
  [0x0F99, 0x0FBC], [0x102B, 0x103E], [0x1056, 0x1059], [0x1712, 0x1714],
  [0x17B4, 0x17D3], [0x180B, 0x180D], [0x1AB0, 0x1AFF], [0x1DC0, 0x1DFF],
  [0x20D0, 0x20F0],                              // 组合用附加符号
  [0xFE20, 0xFE2F],                              // 组合用半角标记
  // ── DIGIT：十进制数字（Nd）与字母数字（Nl） ──
  [0x0030, 0x0039],                              // ASCII
  [0x0660, 0x0669], [0x06F0, 0x06F9],            // 阿拉伯-印度 / 扩展
  [0x07C0, 0x07C9], [0x0966, 0x096F], [0x09E6, 0x09EF],
  [0x0A66, 0x0A6F], [0x0AE6, 0x0AEF], [0x0B66, 0x0B6F], [0x0BE6, 0x0BEF],
  [0x0C66, 0x0C6F], [0x0CE6, 0x0CEF], [0x0D66, 0x0D6F], [0x0DE6, 0x0DEF],
  [0x0E50, 0x0E59], [0x0ED0, 0x0ED9], [0x0F20, 0x0F29],
  [0x1040, 0x1049], [0x1090, 0x1099], [0x17E0, 0x17E9],
  [0x1810, 0x1819], [0x1946, 0x194F], [0x19D0, 0x19D9],
  [0x1A80, 0x1A89], [0x1A90, 0x1A99], [0x1B50, 0x1B59],
  [0x1C40, 0x1C49], [0x1C50, 0x1C59],
  [0xFF10, 0xFF19],                              // 全角数字
  [0x2160, 0x2188],                              // 罗马数字（Nl）
]

/** 该码点是否属于**词内**字符（字母 / 组合符 / 数字；撇号与下划线另判） */
function isWordChar(cp: number): boolean {
  for (let i = 0; i < WORD_CHAR_RANGES.length; i++) {
    const r = WORD_CHAR_RANGES[i]!
    if (cp >= r[0] && cp <= r[1]) return true
  }
  return false
}


/**
 * **天然断词**的脚本：CJK（含扩展）/ 日文假名 / 韩文音节 / 半角片假名 / 注音符号 / 々〆。
 *   ★它们本身没有大小写，但**使前后文另起一词**（Chromium 实测 `abc中文def` ⇒ `Abc中文Def`）。
 *   ★★与 `WORD_CHAR_RANGES` **可能重叠**（半角片假名、注音符号在两表都有）⇒ 调用方必须
 *     **先判本表**（断词优先），否则 `ｱabc` 会被当成词内（与 Chromium 不符）。
 */
const WORD_BREAK_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x11FF],   // 谚文字母（单独出现时也算断词——Chromium 实测 \u1100 后另起词）
  [0x2E80, 0x2EFF],   // CJK 部首补充
  [0x2F00, 0x2FDF],   // 康熙部首
  [0x3005, 0x3007],   // 々 〆 〇（Chromium 实测 `々abc` ⇒ `々Abc`）
  [0x3021, 0x3029],   // 〡–〩（汉数字）
  [0x3038, 0x303B],   // ヽヾ 〻〼
  [0x3040, 0x30FF],   // 平假名 + 片假名
  [0x3130, 0x318F],   // 谚文兼容字母
  // ★注音符号（U+3100–312F / 31A0–31BF）**不在**本表：Chromium 逐像素实测是**词内**
  //   （`ㄅabc` ⇒ `ㄅabc`、`ㄅㄆabc` ⇒ `ㄅㄆabc`）⇒ 归 WORD_CHAR_RANGES。
  [0x31F0, 0x31FF],   // 片假名语音扩展
  [0x3400, 0x4DBF],   // CJK 扩展 A
  [0x4E00, 0x9FFF],   // CJK 统一表意
  [0xA960, 0xA97F],   // 谚文扩展 A
  [0xAC00, 0xD7FF],   // 谚文音节（含扩展 B）
  [0xF900, 0xFAFF],   // CJK 兼容表意
  [0xFF66, 0xFF9F],   // 半角片假名
  [0x20000, 0x2FA1F], // CJK 扩展 B–兼容补充
]

/** 该码点是否属于**天然断词**脚本（CJK/假名/韩文/半角片假名） */
function isWordBreakScript(cp: number): boolean {
  for (let i = 0; i < WORD_BREAK_RANGES.length; i++) {
    const r = WORD_BREAK_RANGES[i]!
    if (cp >= r[0] && cp <= r[1]) return true
  }
  return false
}

/**
 * 单码点 titlecase 特例（JS 无 `toTitlecase`，而 `toUpperCase` 在 digraph 上给的是全大写形式）。
 *   `ǳ`(U+01C6) ⇒ `ǲ`(U+01C5) · `ǉ`⇒`ǈ` · `ǌ`⇒`ǋ` · `ǳ`(U+01F3)⇒`ǲ`(U+01F2)
 */
const TITLECASE_OVERRIDES: Record<string, string> = {
  '\u01C6': '\u01C5',
  '\u01C9': '\u01C8',
  '\u01CC': '\u01CB',
  '\u01F3': '\u01F2',
}

/**
 * 应用 `text-transform`。`none`/`undefined`/未知值 ⇒ **原样返回**（零行为变化）。
 *
 * @param text 原始文本
 * @param transform `uppercase` / `lowercase` / `capitalize`
 */
export function applyTextTransform(text: string, transform: string | undefined | null): string {
  if (!text || !transform || transform === 'none') return text
  if (transform === 'uppercase') return text.toUpperCase()
  if (transform === 'lowercase') return text.toLowerCase()
  if (transform === 'capitalize') {
    // 逐**码点**遍历（`for...of`：代理对与组合序列不会被拆成半个字符）
    let out = ''
    let prevIsWordChar = false
    for (const ch of text) {
      if (!prevIsWordChar) {
        const up = TITLECASE_OVERRIDES[ch] ?? ch.toUpperCase()
        // ★长度扩张（`ß`→`SS`、`ﬁ`→`FI`）不采用——实测 Chromium 在词首保持原字符
        out += up.length === ch.length ? up : ch
      } else {
        out += ch
      }
      // ★词内 = 字母/组合符/数字 + 撇号 + 下划线 + 中点（纯区间表；见 WORD_CHAR_RANGES 头注）。
      //   ★★**断词脚本优先**：半角片假名/注音符号同时落在两张表里 —— 断词表必须赢（否则 `ｱabc`
      //     会被当成词内 ⇒ 与 Chromium 实测不符）。
      const cp = ch.codePointAt(0) ?? 0
      prevIsWordChar = !isWordBreakScript(cp) && (isWordChar(cp) || ch === "'" || ch === '_' || ch === '·')
    }
    return out
  }
  return text
}
