// hosts/shared/bridge/showcase-ink.ts —— ★★Morpheus 炫技场 · **第四个节目：墨绘·山水卷**
//
// 【这一场是什么（用户："这个新增能力可以做单独的节目吗？"→"既然要做直接做到天花板的质量"）】
//   一幅水墨长卷在观众眼前**自己画出来**：展卷 → 远山三叠（晕染 + 落笔）→ 飞瀑 → 江水涨潮
//   → 明月升起（带月晕）→ 云海翻涌 → 松竹风摆 → 渔舟荡漾 → 飞鸟掠水 → 题款 → 落印
//   → 云开月明 → 收卷。
//
// 【★★"天花板质量"的四个技术支点（对首版"像儿童版"的根治）】
//   ① **墨分五色**（焦/浓/重/淡/清）：描边色用 `#RRGGBBAA`（CSS4 序，内核解析——低 8 位 alpha）
//      ⇒ 一根线也能有"墨气"；同一条山脊线画**三层**：
//        晕（宽 2.2× · alpha 25% · 下移 5px）= 笔肚的湿墨；
//        骨（正常宽 · alpha 90%）= 笔锋的骨线；
//        枯（0.45× · alpha 50% · 下移 2px）= 飞白/散锋。
//      三层同 `d`、**错时起笔**（晕先→骨中→枯后）⇒ 层层叠加读出"笔触"而不是"矢量线"。
//   ② **山体不是空白**：每叠山有一条**晕染填充**（闭合多边形裁剪的浅色块）——
//      "见笔又见墨"。填充的揭示 = 多边形从压扁"涨"起（墨从纸里晕开）。
//   ③ **构图有纵深**：远/中/近三叠（色阶递深 + 基线错落）+ 飞瀑（中景）+ 渔舟（近水）
//      + 前景岩与竹（最近层）——不是一张平铺的折线图。
//   ④ **笔锋动力学**（每笔都有起→行→收）：山脊骨线走三段关键帧
//      `起笔（慢 12%）→ 行笔（58%）→ 收笔（30% · easeOut）`——"画"的节奏感。
//
// 【C1/C2 能力的演出面（本节目存在的意义）】
//   · C2 `strokeProgress`（kind 31）：**全部 21 条描边**（山 9 + 瀑 3 + 水纹 6 + 竹 9? + 舟 + 鸟）
//     ——"自己长出来"的落笔感；渔舟荡漾/水波起伏用 yoyo。
//   · C1 `clip`（kind 15..30）：卷轴展开/收卷（幕布 inset）· 山体晕染涨起（polygon 顶点插值）
//     · 江水涨潮（inset）· 明月由缺到圆（circle 圆心）· 月晕扩散（circle 半径）· 题款逐字书写
//     · 落印（inset 从中心炸开）· 云海翻涌（polygon 顶缘形变）。
//
// 【★"空白卷轴"基态律（可循环的关键）】树里声明的 clip/svg 基态 = 未演出状态：
//   幕布全遮 · 山体压扁 · 月亮圆心在盒外 · 月晕半径 0 · 江面全隐 · 云压扁在底边 ·
//   题款全隐 · 印章零尺寸 · 全部描边进度 = 0。⇒ `animStop` 清值即复原 ⇒ 无缝循环。
//
// 【13 幕】
// ```
// unfurl(展卷) → mountains(远山三叠) → waterfall(飞瀑) → river(江水涨潮) → moonrise(明月)
//  → clouds(云海) → grove(松竹风摆) → boat(渔舟荡漾) → birds(飞鸟掠水)
//  → inscription(题款) → seal(落印) → moonGlow(云开月明·万物共息) → close(收卷)
// ```
//
// 【诚实边界】本模块不碰宿主：不建树（`buildInkTree` 只产 JSON）、不发令、不读设备
//   （与 showcase-flip / showcase-lights 同款——CI 与设备 import 同一份）。

import { compileAnimations } from '@proteus-vue/animation'
import type { EngineAnim, GradientFill } from '@proteus-vue/animation'
// ★spanMs 与灯光秀共用同一实现（"一处实现"——不复制第二份算术）
import { spanMs } from './showcase-lights'

/* ────────────────────────── 色板（墨分五色 + 宣纸） ────────────────────────── */

export const INK_PALETTE = {
  /** 宣纸（整卷底色） */
  paper: '#f2ead6',
  /** 幕布（揭幕/收卷——深墨蓝） */
  curtain: '#151c26',
  /** 题款墨色（近焦墨） */
  ink: '#161d24',
  /** 题款起笔色（淡一号——书写完成时以文字色动画收进焦墨） */
  inkFaint: '#8d9599',
  /** 月（暖白——★必须与纸色拉开：目视迭代前月亮与纸几乎同色，根本看不见） */
  moon: '#fdf6dd',
  moonLit: '#fffef5',
  /** 水色（涨潮后微沉） */
  water: '#e0e9e6',
  waterDeep: '#c8dad9',
  /** 松竹（青墨——3 层写法：湿/骨/枯由 alpha 派生） */
  bamboo: '#2f4d3a',
  /** 飞鸟（浓墨） */
  bird: '#1c262e',
  /** 渔舟（船体浓墨 / 桅淡一号） */
  boatHull: '#22303a',
  boatMast: '#4a5a66',
  /** 印章（朱砂；落印时从亮一号沉定） */
  seal: '#ae3a2e',
  sealLit: '#c94b3f',
  /** 山（三叠的骨线色——淡→浓，色阶即纵深） */
  mtFar: '#5d6f86',
  mtMid: '#3b4854',
  mtNear: '#232d36',
  /** 山体晕染的色相（各个 alpha 由 blend 预混） */
  washTint: '#7d8ea6',
} as const

/* ────────────────────────── 颜色工具（预混——保持线格式 6 位纯净） ────────────────────────── */

function parseHex6(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

/** 预混两色（t = b 的比例）——"半透明晕染"在**不透明色**上等价呈现（线格式保持 6 位） */
export function blend(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parseHex6(a)
  const [br, bg, bb] = parseHex6(b)
  const f = (x: number, y: number): number => Math.round(x * (1 - t) + y * t)
  const hx = (v: number): string => v.toString(16).padStart(2, '0')
  return `#${hx(f(ar, br))}${hx(f(ag, bg))}${hx(f(ab, bb))}`
}

/**
 * 给 `#RRGGBB` 加 alpha 后缀（CSS4 序 `#RRGGBBAA`——**内核解析**，宿主收 u32 打包值）。
 * ★描边色必须走这条（alpha 在颜色里 = 墨色浓淡）；填充色**不用**（宿主 parseHex 的
 *   8 位约定是 AARRGGBB，与内核 CSS4 不一致——填充一律用 `blend` 预混成 6 位，绕开分歧）。
 */
export function ink(hex: string, alpha: number): string {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
  return `${hex}${a.toString(16).padStart(2, '0')}`
}

/**
 * ★★**墨晕渐变**（v1 渐变的第一个真实用例——2026-10-01）："中心浓、边缘透明"的径向渐变。
 *
 * 【为什么是它（对"预混纯色"的根治）】椭圆 puff 用**一个纯色**填充时边缘是硬边——
 *   放大图里读成"色块"。真径向渐变（中心 alpha 高 → 边缘 0）才是"墨在纸里晕开"。
 *   ★这解决了 v1 之前**做不到**的事：纯色填充无法表达"边缘渐隐"。
 *
 * @param edge 全透明（alpha 0）——固定，避免调用方写出"边缘不透明"的假晕
 */
export function inkWash(hex: string, centerAlpha: number): GradientFill {
  return {
    kind: 'radial',
    cx: 0.5,
    cy: 0.5,
    r: 0.55,
    stops: [
      { offset: 0, color: hex, alpha: centerAlpha },
      { offset: 0.55, color: hex, alpha: centerAlpha * 0.55 },
      { offset: 1, color: hex, alpha: 0 },
    ],
  }
}

/** ★云/雾的**竖直渐隐**（上浓下淡——云带顶缘的柔边） */
export function mistFade(hex: string, topAlpha: number): GradientFill {
  return {
    kind: 'linear',
    angle: 180, // 向下：从上（浓）到下（淡）
    stops: [
      { offset: 0, color: hex, alpha: topAlpha },
      { offset: 1, color: hex, alpha: 0 },
    ],
  }
}

/* ────────────────────────── 节点 id（节目单与判据共用的稳定契约） ────────────────────────── */

export const INK_IDS = {
  root: 1,
  /** 纸角晕（旧纸的淡渍——两处）+ 三点小渍 */
  corners: [2, 3] as const,
  specks: [4, 5, 6] as const,
  /** 三叠山：每叠 = **椭圆晕团 ×2**（`borderRadius` 天然柔边——绕开 polygon 16 参数限制；
   *   水墨的"晕"本来就是圆的）+ 三层笔触（湿/骨/枯）+ 米点。
   *   `rangeFill` 保持**静态占位**（今不再用 clip 动画——保留 id 兼容判据的旧读数路径）。 */
  rangePuffs: [[17, 18], [27, 28], [37, 38]] as const,
  rangeFill: [10, 20, 30] as const,
  rangeWet: [11, 21, 31] as const,
  rangeCore: [12, 22, 32] as const,
  rangeDry: [13, 23, 33] as const,
  rangeDots: [[14, 15], [24, 25], [34, 35]] as const,
  /** 飞瀑（三笔 + 落水处的两点飞沫） */
  waterfall: [40, 41, 42] as const,
  fallMist: [43, 44] as const,
  /** 崖口（两崖夹瀑——给飞瀑一个"从山涧出来"的交代） */
  fallGate: 45,
  /** 江水（水面 / 深水带 / 月影 / 六道水纹） */
  water: 50,
  waterDeep: 51,
  reflection: 52,
  ripples: [53, 54, 55, 56, 57, 58] as const,
  /** 明月（外晕 / 内晕 / 月盘） */
  haloOuter: 60,
  haloInner: 61,
  moon: 62,
  /** 云海：2 条 polygon 带（大起伏 3 丘）+ 3 个椭圆云团（软边） */
  clouds: [70, 71] as const,
  cloudPuffs: [72, 73, 74] as const,
  /** 松竹：每棵 = 主段 / 次段 / 叶簇 三条笔触（80,81,82 / 83,84,85 / 86,87,88） */
  bamboo: [[80, 81, 82], [83, 84, 85], [86, 87, 88]] as const,
  /** 渔舟（船身 / 桅帆 / 渔人） */
  boat: [90, 91, 92] as const,
  /** 飞鸟三只 */
  birds: [95, 96, 97] as const,
  /** 题款「山水清音」四字（竖排、逐字书写） */
  titleChars: [100, 101, 102, 103] as const,
  /** 印章（印面 / 白文内框） */
  sealFill: 110,
  sealInner: 111,
  /** 前景坡岸（两坡——补底部留白）+ 水草（四笔） */
  banks: [130, 131] as const,
  reeds: [132, 133, 134, 135] as const,
  /** 幕布（最上层） */
  curtain: 120,
  /** ★★卷轴（真·展卷/收卷）：卷筒（横向渐变做圆柱明暗）+ 上下轴头（木色圆头），
   *   随展卷边界自右向左滚动；右端另有一组**固定轴**（画已展开端的轴）。 */
  rollCylinder: 140,
  rollKnobTop: 141,
  rollKnobBottom: 142,
  rollerRightBar: 143,
  rollerRightKnobTop: 144,
  rollerRightKnobBottom: 145,
} as const

/**
 * 逐幕末态探针的样本 id（宿主 `recordAct` 按它采"本幕终态" + `probe_all` 全量进幕读数）。
 * ★首个 = **幕中采样的主断言目标**（`mid_probe`）：山二骨线（id 22）在 mountains 幕 45% 处
 *   进度应**严格居中**——"真的在画"（不是 0 瞬现、也不是 1 早已画完）的机器证据。
 */
export const INK_SAMPLE_IDS: readonly number[] = [
  INK_IDS.rangeCore[1],
  INK_IDS.curtain,
  INK_IDS.moon,
  INK_IDS.haloOuter,
  INK_IDS.titleChars[3],
  INK_IDS.sealFill,
  INK_IDS.clouds[0],
  INK_IDS.water,
  INK_IDS.waterDeep,
  INK_IDS.reflection,
  INK_IDS.ripples[2],
  INK_IDS.rangeCore[0],
  INK_IDS.rangeWet[0],
  INK_IDS.rangePuffs[0][0],
  INK_IDS.rangePuffs[0][1],
  INK_IDS.bamboo[0][1],
  INK_IDS.boat[0],
  INK_IDS.birds[0],
  INK_IDS.waterfall[0],
  INK_IDS.fallMist[0],
  INK_IDS.banks[0],
  INK_IDS.banks[1],
  INK_IDS.rollCylinder,
]

/* ────────────────────────── 造型（d 的坐标系 = 节点盒 px——与 C2 内核解析同一约定） ────────────────────────── */

/** 确定性微扰（手绘感——不用随机数：同输入必须同输出，判据可复跑） */
function noise(i: number, amp: number): number {
  return Math.sin(i * 2.399 + 0.7) * amp
}

/**
 * 山脊线：折线 + 微噪声（"手"的抖），每段转角处轻 Q 收圆（不是数学折线）。
 * `sag` = 谷底整体下沉量（px）——三叠的基线错落靠它。
 */
function ridge(w: number, h: number, peaks: ReadonlyArray<readonly [number, number]>, y0: number, seed: number): string {
  const pts: Array<[number, number]> = []
  pts.push([0, y0 * h])
  peaks.forEach(([px, py], i) => {
    pts.push([px * w, py * h + noise(i + seed, h * 0.02)])
  })
  pts.push([w, y0 * h])
  let d = `M${Math.round(pts[0]![0])} ${Math.round(pts[0]![1])}`
  for (let i = 1; i < pts.length; i++) {
    const [x, y] = pts[i]!
    const [px, py] = pts[i - 1]!
    // ★上拱（第四轮目视）：控制点抬到段中点**上方**（h*0.09）⇒ 峰顶圆润——
    //   直线段中点交叉读成"折线图"，上拱才读成"山峦"。
    const cx = px + (x - px) * 0.5 + noise(i * 3 + seed, w * 0.004)
    const cy = (py + y) * 0.5 - h * 0.09
    d += ` Q${Math.round(cx)} ${Math.round(cy)} ${Math.round(x)} ${Math.round(y)}`
  }
  return d
}

/** 水纹（8 段 Q 交替起伏的波——`phase` 错相） */
function wave(w: number, h: number, phase: number): string {
  const y = Math.round(h / 2)
  const a = Math.round(h * 0.4)
  const seg = w / 8
  let d = `M0 ${y}`
  for (let i = 0; i < 8; i++) {
    const up = (i + phase) % 2 === 0
    d += ` Q ${Math.round((i + 0.5) * seg)} ${up ? y - a : y + a} ${Math.round((i + 1) * seg)} ${y}`
  }
  return d
}

/** 飞瀑（垂直三笔：两岸峭 + 中间细流；`x` 是相对节点宽的落点分数） */
function fallLine(w: number, h: number, x: number, bow: number): string {
  const cx = Math.round(w * x)
  const bx = Math.round(w * x + bow * w)
  return `M${cx} 0 Q ${bx} ${Math.round(h * 0.45)} ${cx} ${h}`
}
/**
 * 崖口（飞瀑上方的"两崖夹口"）——第四轮目视：三笔悬空像铁丝 ⇒
 * 给一个崖口（左右两片斜面在瀑顶收拢）＝"水从山涧里出来"。
 */
function fallGate(w: number, h: number): string {
  const P = (x: number, y: number): string => `${Math.round(x)} ${Math.round(y)}`
  // ★注意 `M` 后必须直接跟**两个**数字：`M${P(a,b)}` 会是 "M x y" ✓；
  //   而 `M0 ${P(a,b)}` 会拼成 "M0 x y"（多一个 0 ⇒ 后续命令错位）。
  return `M${P(0, h * 0.5)} Q ${P(w * 0.22, h * 0.18)} ${P(w * 0.4, 0)}`
    + ` M${P(w, h * 0.5)} Q ${P(w * 0.78, h * 0.18)} ${P(w * 0.6, 0)}`
}

/** 竹（主段 + 次段 + 叶簇——竹节用短折表示） */
function bambooStem(w: number, h: number): string {
  const cx = Math.round(w * 0.5)
  const P = (x: number, y: number): string => `${Math.round(x)} ${Math.round(y)}`
  return [
    `M${P(cx, h)} Q ${P(cx + w * 0.03, h * 0.72)} ${P(cx, h * 0.46)}`,
    `M${P(cx, h * 0.46)} Q ${P(cx - w * 0.03, h * 0.24)} ${P(cx + w * 0.02, h * 0.04)}`,
  ].join(' ')
}
function bambooLeaves(w: number, h: number): string {
  const cx = Math.round(w * 0.5)
  const P = (x: number, y: number): string => `${Math.round(x)} ${Math.round(y)}`
  // ★第四轮目视：叶片必须**细长且下垂**（首版短粗椭圆像"萝卜"）——
  //   每片 = 一条长 Q（叶尖远超叶柄，且两端下沉 = 垂叶）；三簇六片、错落。
  const leaf = (y0: number, dx: number, len: number, droop: number): string =>
    `M${P(cx, y0)} Q ${P(cx + dx * len * 0.6, y0 - len * 0.32)} ${P(cx + dx * len, y0 - len * 0.1 + droop)}`
  return [
    leaf(h * 0.44, 1, w * 0.52, h * 0.05),
    leaf(h * 0.46, -1, w * 0.46, h * 0.06),
    leaf(h * 0.28, 1, w * 0.44, h * 0.04),
    leaf(h * 0.3, -1, w * 0.4, h * 0.05),
    leaf(h * 0.12, 1, w * 0.38, h * 0.03),
    leaf(h * 0.14, -1, w * 0.3, h * 0.04),
  ].join(' ')
}

/** 渔舟（船身：两端翘的一叶轻舟） */
function boatHull(w: number, h: number): string {
  const P = (x: number, y: number): string => `${Math.round(x)} ${Math.round(y)}`
  // ★第四轮目视：首版闭合"透镜"读成眼睛 ⇒ 真船形 = **平口（略凹）舷线 + 浅弧船底**：
  //   舷线（凹）从船尾到船首，船底（外弧）收回来——"一叶轻舟"。
  const gun = h * 0.42 // 舷高
  const bow = h * 0.52 // 船首翘
  return `M0 ${Math.round(gun)} Q ${P(w * 0.3, h * 0.5)} ${P(w * 0.5, h * 0.5)}`
    + ` Q ${P(w * 0.72, h * 0.5)} ${P(w, Math.round(bow))}`
    + ` Q ${P(w * 0.8, h * 0.86)} ${P(w * 0.5, h * 0.88)}`
    + ` Q ${P(w * 0.2, h * 0.86)} ${P(0, Math.round(gun))} Z`
}

/** 桅帆（一竖一横一弧——极简的帆影） */
function boatSail(w: number, h: number): string {
  const P = (x: number, y: number): string => `${Math.round(x)} ${Math.round(y)}`
  return `M${P(w * 0.5, h * 0.2)} L${P(w * 0.5, 0)} M${P(w * 0.5, h * 0.14)} Q ${P(w * 0.78, h * 0.05)} ${P(w * 0.86, h * 0.2)}`
}
/** 渔人（低头撑篙的一笔） */
function boatMan(w: number, h: number): string {
  const P = (x: number, y: number): string => `${Math.round(x)} ${Math.round(y)}`
  return `M${P(w * 0.22, h * 0.16)} Q ${P(w * 0.3, h * 0.5)} ${P(w * 0.5, h * 0.66)} M${P(w * 0.22, h * 0.16)} L${P(w * 0.34, h * 0.1)}`
}

/** 飞鸟（双翼一弧——"人"字） */
function bird(w: number, h: number): string {
  const y = Math.round(h * 0.8)
  return `M0 ${y} Q ${Math.round(w * 0.25)} 0 ${Math.round(w * 0.5)} ${y}`
    + ` Q ${Math.round(w * 0.75)} 0 ${w} ${y}`
}

/**
 * ★★**鸟的扑翼态**（路径变形 v1 的第一处用法）——与 `bird` **同结构**（`M Q Q`，
 *   两点坐标一致）而控制点**下压**（`down` 分数）⇒ 两态之间逐点插值 = 翅膀上下拍。
 *
 * 【为什么这是"别人不敢试"的】**CSS 完全不能做**：`d` 属性不可过渡（网页端要靠
 *   GSAP MorphSVG / flubber 这类库逐点重算）。这里两态声明在树里，一条 `pathMorph`
 *   通道驱动，内核逐帧插值（唯一 lerp 实现），宿主只翻译结果。
 */
function birdFlap(w: number, h: number, down: number): string {
  const y = Math.round(h * 0.8)
  const ctl = Math.round(h * down)
  return `M0 ${y} Q ${Math.round(w * 0.25)} ${ctl} ${Math.round(w * 0.5)} ${y}`
    + ` Q ${Math.round(w * 0.75)} ${ctl} ${w} ${y}`
}

/* ────────────────────────── 云海顶点（树与幕共用同一份——单一事实源） ────────────────────────── */

/** 压扁态（零面积——"未起云"基态）：8 点，顶缘全在底边 */
export const MIST_FLAT: readonly number[] = [0, 1, 0.14, 1, 0.32, 1, 0.5, 1, 0.68, 1, 0.86, 1, 1, 1, 0, 1]
/** 云形 A（缓峰缓谷——6 点顶缘，起伏 ≤0.28） */
export const MIST_A: readonly number[] = [0, 0.72, 0.14, 0.5, 0.32, 0.66, 0.5, 0.44, 0.68, 0.62, 0.86, 0.52, 1, 0.68, 0, 1]
/** 云形 B（相位错开——翻涌的二态） */
export const MIST_B: readonly number[] = [0, 0.55, 0.14, 0.72, 0.32, 0.46, 0.5, 0.68, 0.68, 0.48, 0.86, 0.66, 1, 0.55, 0, 1]
/** 云形 C（第三带——更碎更淡） */
export const MIST_C: readonly number[] = [0, 0.6, 0.14, 0.42, 0.32, 0.6, 0.5, 0.4, 0.68, 0.56, 0.86, 0.44, 1, 0.58, 0, 1]

/* ────────────────────────── 三叠山的定义（树与幕共用） ────────────────────────── */

interface RangeDef {
  /** 顶（H 分数）· 高（H 分数）· 左右（W 分数）· 基线（盒内分数） */
  top: number
  hh: number
  lf: number
  wf: number
  y0: number
  seed: number
  /** 脊线折点（笔触用——不限数量） */
  peaks: ReadonlyArray<readonly [number, number]>
  /**
   * 椭圆晕团（2 个/叠；`[cx 分数, cy 分数, rw 相对 W, rh 相对 W]`）——
   * ★不用 polygon 做晕染（16 参数上限逼出硬边斜块，放大图核对即弃）：
   *   椭圆靠 `borderRadius` 天然柔边，且"墨晕"本就是圆的。
   */
  puffs: ReadonlyArray<readonly [number, number, number, number]>
  /** ★★"呼吸"的另一态山形（**峰数不同**——异构变形的用武之地：内核自动重采样） */
  peaksAlt: ReadonlyArray<readonly [number, number]>
}

/**
 * ★★三叠山的**构图**（2026-10-01 第二轮目视迭代——"儿童版"的根因在这里）：
 *   首版三叠**全宽等幅堆叠**（0.94/0.88/1.0 宽）⇒ 读成"三行锯齿"而不是山水。
 *   真实山水的构图是**横向错落 + 疏密有致**：
 *     · 远山：小而偏右（0.30–0.86），最淡、峰最缓——"天际一痕"；
 *     · 中山：中段偏左（0.06–0.62），一座主峰（0.42 处）＋ 侧峰——远山的"主角"；
 *     · 近山：全宽但**左低右高**，双主峰（0.16 / 0.78）＋ 其间谷口（飞瀑源头）——
 *       "近处大山压阵"。
 *   ⇒ 三叠不是叠罗汉，而是**错开的三个高度层**（远山顶 ≈ 中山腰 ≈ 近山脚）。
 */
export const RANGES: readonly RangeDef[] = [
  { // 远山（天际一痕——淡、缓、偏右）
    top: 0.105, hh: 0.105, lf: 0.3, wf: 0.66, y0: 0.98, seed: 1,
    peaks: [[0.08, 0.48], [0.2, 0.4], [0.33, 0.46], [0.45, 0.34], [0.58, 0.48], [0.72, 0.42], [0.85, 0.5], [0.95, 0.45]],
    // 呼吸态：**少峰大峦**（4 峰 vs 8 峰——异构 ⇒ 内核自动重采样）
    peaksAlt: [[0.12, 0.42], [0.36, 0.32], [0.62, 0.44], [0.88, 0.4]],
    puffs: [[0.34, 0.6, 0.22, 0.1], [0.68, 0.64, 0.26, 0.11]],
  },
  { // 中山（主角——一座主峰在 0.42，偏左）
    top: 0.145, hh: 0.15, lf: 0.06, wf: 0.62, y0: 0.985, seed: 7,
    peaks: [[0.05, 0.52], [0.14, 0.42], [0.26, 0.48], [0.42, 0.26], [0.55, 0.45], [0.66, 0.38], [0.78, 0.5], [0.9, 0.44]],
    // 呼吸态：主峰更耸、两翼舒展（3 峰 vs 8）
    peaksAlt: [[0.16, 0.44], [0.42, 0.16], [0.74, 0.4]],
    puffs: [[0.3, 0.58, 0.2, 0.11], [0.72, 0.6, 0.22, 0.12]],
  },
  { // 近山（压阵——全宽、左低右高、双主峰 + 谷口）
    top: 0.205, hh: 0.21, lf: 0.0, wf: 1.0, y0: 0.985, seed: 13,
    peaks: [[0.03, 0.56], [0.1, 0.46], [0.16, 0.3], [0.26, 0.5], [0.36, 0.4], [0.46, 0.56], [0.52, 0.46], [0.6, 0.54], [0.7, 0.38], [0.78, 0.26], [0.88, 0.46], [0.96, 0.54]],
    // 呼吸态：双峰更高更窄（4 峰 vs 12）
    peaksAlt: [[0.14, 0.24], [0.36, 0.46], [0.62, 0.5], [0.8, 0.2]],
    puffs: [[0.2, 0.56, 0.24, 0.12], [0.66, 0.54, 0.28, 0.14]],
  },
]

/* ────────────────────────── 卷轴几何（单一事实源：树/幕/测试共用） ────────────────────────── */

/**
 * ★★**卷轴几何**（树与幕共用——单一事实源）。
 *
 * 【为什么要"真卷轴"而不是"幕布平移"】用户："继续真正的画卷展开"——幕布遮蔽只是
 *   "揭幕"，真画卷展开的观感来自：**一根卷筒（带轴头）在纸面上滚动**，纸从筒下吐出。
 *   ⇒ 卷筒贴展卷边界移动（与幕布的裁剪边界**同一时间曲线**），筒身用**横向渐变**
 *   做圆柱明暗（本引擎渐变能力的第一处"物理感"应用）。
 *
 * 坐标约定：卷筒初始**贴右缘**（闭合态——整卷只露它的外缘），展开后**落到左缘**
 *   （展开完成——左端只剩轴）；`txOpen` 是它的 translateX 终点（负数）。
 */
export interface ScrollMetrics {
  /** 卷筒宽度（px） */
  bandW: number
  /** 轴头宽（px；比筒身宽——两端出头） */
  knobW: number
  /** 轴头高（px） */
  knobH: number
  /** 展开完成时卷筒的 translateX（从贴右缘 → 贴左缘） */
  txOpen: number
}

export function scrollMetrics(view: { width: number; height: number }): ScrollMetrics {
  const bandW = Math.max(10, Math.round(view.width * 0.042))
  const knobW = Math.round(bandW * 1.9)
  const knobH = Math.round(view.height * 0.026)
  // 贴右缘：left = W - bandW；贴左缘：left = 0 ⇒ tx = -(W - bandW)
  const txOpen = -(view.width - bandW)
  return { bandW, knobW, knobH, txOpen }
}

/* ────────────────────────── 树构造（空卷基态——见文件头"空白卷轴"基态律） ────────────────────────── */

interface View {
  width: number
  height: number
}

/**
 * 造"水墨长卷"的请求树（`{viewport, nodes}` JSON——几何全部由内核算）。
 * ★每个元素都**绝对定位**（构图精确）；节点数组顺序 = 绘制顺序（后者在上）。
 */
export function buildInkTree(view: View): string {
  const W = Math.round(view.width)
  const H = Math.round(view.height)
  const P = INK_PALETTE
  const R = (v: number): number => Math.round(v)
  const sw = (f: number): number => Math.max(2, R(W * f))
  /** 渐变式的描边宽度基准（W 的千分比） */
  const SW = { far: 0.0042, mid: 0.0058, near: 0.0078 }

  const nodes: Array<Record<string, unknown>> = []

  // ① 宣纸
  nodes.push({ id: INK_IDS.root, width: W, height: H, backgroundColor: P.paper })

  // ② 纸角晕 + 小渍（旧纸的呼吸——★目视迭代：首版 10%/7% 太大太脏（像污块），
  //   收到 **4.5%/3.5%** 且缩小半径——只留"旧纸的暖"，不留"脏"）
  const cornerA = blend(P.paper, '#c9b98f', 0.045)
  const cornerB = blend(P.paper, '#c9b98f', 0.035)
  nodes.push({
    id: INK_IDS.corners[0], parentId: INK_IDS.root, position: 'absolute',
    left: R(-W * 0.28), top: R(H * 0.68), width: R(W * 0.5), height: R(W * 0.5),
    borderRadius: R(W * 0.25), backgroundColor: cornerA,
  })
  nodes.push({
    id: INK_IDS.corners[1], parentId: INK_IDS.root, position: 'absolute',
    left: R(W * 0.74), top: R(-H * 0.05), width: R(W * 0.38), height: R(W * 0.38),
    borderRadius: R(W * 0.19), backgroundColor: cornerB,
  })
  const speckCol = blend(P.paper, '#9a8a66', 0.12)
  const specks: Array<[number, number, number]> = [[0.12, 0.815, 0.012], [0.885, 0.862, 0.009], [0.52, 0.905, 0.007]]
  specks.forEach(([fx, fy, fr], i) => {
    nodes.push({
      id: INK_IDS.specks[i], parentId: INK_IDS.root, position: 'absolute',
      left: R(W * (fx - fr / 2)), top: R(H * (fy - fr / 2)), width: R(W * fr), height: R(W * fr),
      borderRadius: R(W * fr / 2), backgroundColor: speckCol,
    })
  })

  // ③ 三叠山（远→近：椭圆晕团 + 湿/骨/枯三层笔触 + 米点）
  const rangeBase = [SW.far, SW.mid, SW.near]
  const puffFills = [blend(P.paper, P.washTint, 0.1), blend(P.paper, P.washTint, 0.15), blend(P.paper, P.washTint, 0.07)]
  RANGES.forEach((rg, r) => {
    const rw = R(W * rg.wf)
    const rh = R(H * rg.hh)
    const top = R(H * rg.top)
    const left = R(W * rg.lf)
    const core = rangeBase[r]!
    const coreColor = [P.mtFar, P.mtMid, P.mtNear][r]!

    // 椭圆晕团 ×2（山腰的墨晕——`borderRadius` 天然柔边；基态 scale≈0.15 由节目单涨起）
    rg.puffs.forEach(([fx, fy, pw, ph], k) => {
      const puffW = R(W * pw)
      const puffH = R(W * ph)
      nodes.push({
        id: INK_IDS.rangePuffs[r]![k]!, parentId: INK_IDS.root, position: 'absolute',
        left: left + R(rg.wf * W * (fx - pw / 2)), top: top + R(rh * fy) - R(puffH / 2),
        width: puffW, height: puffH,
        borderRadius: R(puffH / 2),
        // ★★真渐变（v1 · 2026-10-01）：中心浓 → 边缘全透明——**边缘渐隐**是纯色填充
        //   做不到的（那正是"色块感"的来源）。底色同时给（渐变未挂时的兜底）。
        backgroundColor: puffFills[r],
        fillGradient: inkWash(coreColor, [0.06, 0.09, 0.05][r]!),
        // ★基态全隐（inset top=1）：不用 scale 揭现——transform 只在动画开始时才生效，
        //   未到该幕时节点是 scale=1 **可见**的（破坏"空白卷轴"基态律）。clip 基态才是真隐藏。
        clipPath: { kind: 'inset', params: [1, 0, 0, 0] },
      })
    })

    // 三层笔触（同一 d·不同宽/色/偏移——"晕→骨→枯"）
    //   ★★路径变形 v2（"山峦呼吸"）：B 态 = `peaksAlt`（**峰数不同** ⇒ 异构）——
    //     内核自动重采样到同构后插值（v1 会拒绝这种配对）。呼吸幕里三层同步变形。
    const dCore = ridge(rw, rh, rg.peaks, rg.y0, rg.seed)
    const dAlt = ridge(rw, rh, rg.peaksAlt, rg.y0, rg.seed + 40)
    nodes.push({
      id: INK_IDS.rangeWet[r], parentId: INK_IDS.root, position: 'absolute',
      left, top: top + R(rh * 0.02), width: rw, height: rh,
      svgPath: { d: dCore, stroke: ink(coreColor, r === 0 ? 0.22 : 0.26), strokeWidth: core * W * 2.3 },
      svgPathTo: { d: dAlt },
    })
    nodes.push({
      id: INK_IDS.rangeCore[r], parentId: INK_IDS.root, position: 'absolute',
      left, top, width: rw, height: rh,
      svgPath: { d: dCore, stroke: ink(coreColor, r === 0 ? 0.82 : 0.94), strokeWidth: core * W },
      svgPathTo: { d: dAlt },
    })
    nodes.push({
      id: INK_IDS.rangeDry[r], parentId: INK_IDS.root, position: 'absolute',
      left, top: top + R(rh * 0.008), width: rw, height: rh,
      svgPath: { d: dCore, stroke: ink(coreColor, r === 0 ? 0.4 : 0.5), strokeWidth: core * W * 0.42 },
      svgPathTo: { d: dAlt },
    })

    // 米点（山腰两点——"点苔"）
    // ★底色**不得**用 `ink()`（8 位）：内核的 `#RRGGBBAA` 是 CSS4 序，而 Android 宿主
    //   `parseHex` 的 8 位约定是 `#AARRGGBB`（既有约定）⇒ 两端会读出不同颜色。
    //   填充一律 `blend` 预混成 6 位（绕开分歧；描边可安全用 alpha——走内核解析）。
    const dotR = [0.008, 0.0095, 0.011][r]!
    rgDots(r).forEach(([fx, fy], k) => {
      const dr = R(W * dotR)
      nodes.push({
        id: INK_IDS.rangeDots[r]![k]!, parentId: INK_IDS.root, position: 'absolute',
        left: R(W * (rg.lf + fx * rg.wf)) - dr / 2, top: R(H * rg.top + fy * rh) - dr / 2,
        width: dr, height: dr, borderRadius: dr,
        backgroundColor: blend(P.paper, coreColor, 0.55),
        clipPath: { kind: 'inset', params: [1, 0, 0, 0] }, // 同上：基态全隐（clip 揭现）
      })
    })
  })
  function rgDots(r: number): Array<[number, number]> {
    const table: Array<Array<[number, number]>> = [
      [[0.3, 0.55], [0.62, 0.42]],
      [[0.22, 0.5], [0.72, 0.35]],
      [[0.36, 0.45], [0.8, 0.4]],
    ]
    return table[r]!
  }

  // ④ 飞瀑（近山谷口（0.52 处）落下——两岸峭 + 中流细 + 落水飞沫）
  //    ★位置随第二轮构图迭代：近山双主峰（0.16 / 0.78）之间是谷口 ⇒ 瀑在其间才"合理"。
  const fallTop = R(H * 0.255)
  const fallH = R(H * 0.2)
  const fallW = R(W * 0.1)
  const fallLeft = R(W * 0.47)
  nodes.push({
    id: INK_IDS.waterfall[0], parentId: INK_IDS.root, position: 'absolute',
    left: fallLeft, top: fallTop, width: fallW, height: fallH,
    svgPath: { d: fallLine(fallW, fallH, 0.3, 0.06), stroke: ink('#7d8ea6', 0.55), strokeWidth: sw(0.006) },
  })
  nodes.push({
    id: INK_IDS.waterfall[1], parentId: INK_IDS.root, position: 'absolute',
    left: fallLeft, top: fallTop, width: fallW, height: fallH,
    svgPath: { d: fallLine(fallW, fallH, 0.5, -0.04), stroke: ink('#43535f', 0.9), strokeWidth: sw(0.0035) },
  })
  nodes.push({
    id: INK_IDS.waterfall[2], parentId: INK_IDS.root, position: 'absolute',
    left: fallLeft, top: fallTop, width: fallW, height: fallH,
    svgPath: { d: fallLine(fallW, fallH, 0.7, 0.05), stroke: ink('#7d8ea6', 0.4), strokeWidth: sw(0.0045) },
  })
  // 崖口（两崖夹口——"水从山涧里出来"；无它则三笔悬空像铁丝）
  nodes.push({
    id: INK_IDS.fallGate, parentId: INK_IDS.root, position: 'absolute',
    left: fallLeft - R(fallW * 0.3), top: fallTop - R(fallH * 0.035),
    width: R(fallW * 1.6), height: R(fallH * 0.16),
    svgPath: { d: fallGate(R(fallW * 1.6), R(fallH * 0.16)), stroke: ink('#43535f', 0.8), strokeWidth: sw(0.005) },
  })
  const mistR = R(W * 0.012)
  nodes.push({
    id: INK_IDS.fallMist[0], parentId: INK_IDS.root, position: 'absolute',
    left: R(W * 0.50) - mistR, top: fallTop + fallH - mistR, width: mistR * 2, height: mistR * 2,
    borderRadius: mistR, backgroundColor: blend(P.paper, '#9fb0c0', 0.4),
  })
  const mistR2 = R(W * 0.008)
  nodes.push({
    id: INK_IDS.fallMist[1], parentId: INK_IDS.root, position: 'absolute',
    left: R(W * 0.545) - mistR2, top: fallTop + fallH + R(H * 0.008) - mistR2, width: mistR2 * 2, height: mistR2 * 2,
    borderRadius: mistR2, backgroundColor: blend(P.paper, '#9fb0c0', 0.3),
  })

  // ⑤ 江水（水面 / 深水带——两条 inset 涨潮；月影；六道水纹）
  const waterTop = 0.455
  const waterH = 0.215
  nodes.push({
    id: INK_IDS.water, parentId: INK_IDS.root, position: 'absolute',
    left: 0, top: R(H * waterTop), width: W, height: R(H * waterH),
    backgroundColor: P.water,
    clipPath: { kind: 'inset', params: [1, 0, 0, 0] },
  })
  nodes.push({
    id: INK_IDS.waterDeep, parentId: INK_IDS.root, position: 'absolute',
    left: 0, top: R(H * (waterTop + 0.085)), width: W, height: R(H * (waterH - 0.085)),
    backgroundColor: P.waterDeep,
    clipPath: { kind: 'inset', params: [1, 0, 0, 0] },
  })
  // 月影（在月盘正下方——预混淡色；基态全隐，随明月一起显）
  const reflW = R(W * 0.16)
  nodes.push({
    id: INK_IDS.reflection, parentId: INK_IDS.root, position: 'absolute',
    left: R(W * 0.30), top: R(H * 0.545), width: reflW, height: R(reflW * 0.34),
    borderRadius: R(reflW * 0.17),
    backgroundColor: blend(P.waterDeep, P.moon, 0.42),
    clipPath: { kind: 'inset', params: [0, 1, 0, 0] },
  })
  // 六道水纹（近粗浓、远细淡——纵深）
  const ripples: Array<[number, number, number, number]> = [
    // [top(H), wf, phase, widthFactor]
    [0.492, 0.62, 0, 0.0028],
    [0.518, 0.72, 1, 0.0032],
    [0.548, 0.8, 0, 0.0036],
    [0.578, 0.86, 1, 0.004],
    [0.612, 0.9, 0, 0.0044],
    [0.648, 0.94, 1, 0.0048],
  ]
  ripples.forEach(([top, wf, ph, wfac], i) => {
    const lw = R(W * wf)
    const lh = R(H * 0.032)
    const alpha = 0.32 + i * 0.1
    nodes.push({
      id: INK_IDS.ripples[i]!, parentId: INK_IDS.root, position: 'absolute',
      left: R((W - lw) / 2), top: R(H * top), width: lw, height: lh,
      svgPath: { d: wave(lw, lh, ph), stroke: ink('#41616c', alpha), strokeWidth: sw(wfac) },
    })
  })

  // ⑥ 明月（月晕外/内 —— 圆圈预混淡色；月盘——circle 基态圆心在盒外）
  const haloSize = R(W * 0.44)
  const haloCx = R(W * 0.14)
  const haloCy = R(H * 0.095)
  nodes.push({
    id: INK_IDS.haloOuter, parentId: INK_IDS.root, position: 'absolute',
    left: haloCx, top: haloCy, width: haloSize, height: haloSize,
    borderRadius: R(haloSize / 2),
    backgroundColor: blend(P.paper, P.moon, 0.28),
    // ★★真渐变（v1）：月晕的外圈（中心 alpha 0.32 → 边缘 0）——"光"必须有渐隐
    fillGradient: inkWash(P.moon, 0.34),
    clipPath: { kind: 'circle', params: [0.5, 0.5, 0] },
  })
  const haloSize2 = R(W * 0.34)
  nodes.push({
    id: INK_IDS.haloInner, parentId: INK_IDS.root, position: 'absolute',
    left: haloCx + R((haloSize - haloSize2) / 2), top: haloCy + R((haloSize - haloSize2) / 2),
    width: haloSize2, height: haloSize2,
    borderRadius: R(haloSize2 / 2),
    backgroundColor: blend(P.paper, P.moon, 0.5),
    // ★★真渐变（v1）：月晕内圈（更浓）
    fillGradient: inkWash(P.moon, 0.5),
    clipPath: { kind: 'circle', params: [0.5, 0.5, 0] },
  })
  const moonSize = R(W * 0.235)
  nodes.push({
    id: INK_IDS.moon, parentId: INK_IDS.root, position: 'absolute',
    left: haloCx + R((haloSize - moonSize) / 2), top: haloCy + R((haloSize - moonSize) / 2),
    width: moonSize, height: moonSize,
    borderRadius: R(moonSize / 2),
    backgroundColor: P.moon,
    clipPath: { kind: 'circle', params: [0.5, 1.9, 0.5] },
  })

  // ⑦ 云海：**2 条 polygon 带**（大起伏 3 丘——见 MIST_*，7 点/14 参数）+
  //    **3 个椭圆云团**（柔边——`borderRadius`；与山晕同一思路）。
  //    ★第二轮目视修正：首版三条带都是 0.4 起伏的直横带 ⇒ 读成"色带"而非云——
  //      现在起伏拉到 0.35–0.9 且**错落**，椭圆团补充柔边质感。
  const cloudDefs: Array<[number, number, string]> = [
    [0.075, 0.14, blend(P.paper, '#cfdce8', 0.3)],
    [0.175, 0.12, blend(P.paper, '#cfdce8', 0.2)],
  ]
  cloudDefs.forEach(([top, hh, color], i) => {
    nodes.push({
      id: INK_IDS.clouds[i]!, parentId: INK_IDS.root, position: 'absolute',
      left: 0, top: R(H * top), width: W, height: R(H * hh),
      backgroundColor: color,
      // ★★真渐变（v1）：云带**顶浓底淡**（竖直渐隐）——比纯色的"横贯色带"接近云
      fillGradient: mistFade(blend(P.paper, '#b9cbdb', 0.55), i === 0 ? 0.85 : 0.7),
      // ★★渐变 v2（两态）：**晨雾态**（更暖更亮）——由 `gradientMix` 通道过渡。
      //   ★这是 CSS 做不到的事：`background-image` 的渐变不可过渡（改色标是硬跳变）。
      //   两态结构严格一致（同 linear、同 2 色标）——内核建树时会再校验一次。
      fillGradientTo: mistFade(blend(P.paper, '#e8d9b8', 0.6), i === 0 ? 0.95 : 0.8),
      clipPath: { kind: 'polygon', params: MIST_FLAT },
    })
  })
  const puffDefs: Array<[number, number, number, number, number]> = [
    // [cx(W), cy(H), w(W), h(W), tint]——云团（宽扁椭圆，可重叠成"云气"）
    [0.19, 0.115, 0.5, 0.115, 0.34],
    [0.62, 0.155, 0.58, 0.13, 0.28],
    [0.34, 0.205, 0.44, 0.09, 0.22],
  ]
  puffDefs.forEach(([cx, cy, pw, ph, tint], i) => {
    const puffW = R(W * pw)
    const puffH = R(W * ph)
    nodes.push({
      id: INK_IDS.cloudPuffs[i]!, parentId: INK_IDS.root, position: 'absolute',
      left: R(W * cx - puffW / 2), top: R(H * cy - puffH / 2),
      width: puffW, height: puffH,
      borderRadius: R(puffH / 2),
      backgroundColor: blend(P.paper, '#cfdce8', tint),
      // ★★真渐变（v1）：云团的径向渐隐（边缘不切边）
      fillGradient: inkWash('#c3d4e4', tint + 0.15),
      // ★★v2 两态：晨光晕（更暖）——moonGlow 幕混合过去（同 radial / 同 3 色标）
      fillGradientTo: inkWash('#f0dcb4', tint + 0.2),
      clipPath: { kind: 'inset', params: [1, 0, 0, 0] }, // 基态全隐（clip 揭现）
    })
  })

  // ⑧ 松竹三棵（每棵 = 主段/次段/叶簇 三条笔触）+ 前景岩
  // 前景石（★第三轮目视：首版 0.4W×0.1H 压在水面上像"大灰弧"——收到 0.24W×0.045H 且贴下缘）
  const rock = blend(P.paper, '#5b6a78', 0.13)
  nodes.push({
    id: 89, parentId: INK_IDS.root, position: 'absolute',
    left: R(-W * 0.06), top: R(H * 0.688), width: R(W * 0.24), height: R(H * 0.045),
    borderRadius: R(H * 0.022), backgroundColor: rock,
  })
  const rock2 = blend(P.paper, '#5b6a78', 0.09)
  nodes.push({
    id: 93, parentId: INK_IDS.root, position: 'absolute',
    left: R(W * 0.60), top: R(H * 0.695), width: R(W * 0.3), height: R(H * 0.038),
    borderRadius: R(H * 0.019), backgroundColor: rock2,
  })
  const bam: Array<[number, number, number, number]> = [
    // [left(W), top(H), w(W), h(H)]
    [0.055, 0.40, 0.19, 0.30],
    [0.155, 0.45, 0.15, 0.245],
    [0.235, 0.485, 0.12, 0.2],
  ]
  bam.forEach(([lf, tf, wf, hf], i) => {
    const bw = R(W * wf)
    const bh = R(H * hf)
    const left = R(W * lf)
    const top = R(H * tf)
    const a = 0.9 - i * 0.08
    nodes.push({
      id: INK_IDS.bamboo[i]![0]!, parentId: INK_IDS.root, position: 'absolute',
      left, top, width: bw, height: bh,
      svgPath: { d: bambooStem(bw, bh), stroke: ink(P.bamboo, a), strokeWidth: sw(0.0062 - i * 0.0012) },
    })
    nodes.push({
      id: INK_IDS.bamboo[i]![1]!, parentId: INK_IDS.root, position: 'absolute',
      left, top, width: bw, height: bh,
      svgPath: { d: bambooLeaves(bw, bh), stroke: ink(P.bamboo, a * 0.72), strokeWidth: sw(0.0048 - i * 0.001) },
    })
    // 第三条 = 竹节的小横（同节点占位——用叶簇 d 的短横变体保持三段式计数）
    nodes.push({
      id: INK_IDS.bamboo[i]![2]!, parentId: INK_IDS.root, position: 'absolute',
      left, top: R(top + H * 0.012), width: bw, height: bh,
      svgPath: { d: bambooLeaves(bw, bh), stroke: ink(P.bamboo, a * 0.4), strokeWidth: sw(0.0022) },
    })
  })

  // ⑨ 渔舟（船身 / 桅帆 / 渔人——三笔；随波荡漾）
  const boatW = R(W * 0.19)
  const boatH = R(H * 0.052)
  const boatLeft = R(W * 0.275)
  const boatTop = R(H * 0.532)
  nodes.push({
    id: INK_IDS.boat[0], parentId: INK_IDS.root, position: 'absolute',
    left: boatLeft, top: boatTop, width: boatW, height: boatH,
    svgPath: { d: boatHull(boatW, boatH), stroke: ink(P.boatHull, 0.92), strokeWidth: sw(0.0052) },
  })
  nodes.push({
    id: INK_IDS.boat[1], parentId: INK_IDS.root, position: 'absolute',
    left: boatLeft, top: boatTop - R(boatH * 0.95), width: boatW, height: boatH,
    svgPath: { d: boatSail(boatW, boatH), stroke: ink(P.boatMast, 0.7), strokeWidth: sw(0.0035) },
  })
  nodes.push({
    id: INK_IDS.boat[2], parentId: INK_IDS.root, position: 'absolute',
    left: boatLeft, top: boatTop - R(boatH * 0.55), width: boatW, height: boatH,
    svgPath: { d: boatMan(boatW, boatH), stroke: ink(P.boatHull, 0.85), strokeWidth: sw(0.0032) },
  })

  // ⑩ 飞鸟三只（左高 → 右低，大小递变）
  const birdDefs: Array<[number, number, number, number]> = [
    // [left(W), top(H), w(W), h(H)]
    [0.13, 0.065, 0.085, 0.02],
    [0.235, 0.10, 0.06, 0.015],
    [0.30, 0.13, 0.045, 0.012],
  ]
  birdDefs.forEach(([lf, tf, wf, hf], i) => {
    const bw2 = R(W * wf)
    const bh2 = R(H * hf)
    nodes.push({
      id: INK_IDS.birds[i]!, parentId: INK_IDS.root, position: 'absolute',
      left: R(W * lf), top: R(H * tf), width: bw2, height: bh2,
      svgPath: { d: bird(bw2, bh2), stroke: ink(P.bird, 0.85 - i * 0.1), strokeWidth: sw(0.0048 - i * 0.001) },
      // ★★路径变形 v1（两态）：翅膀由"平展"到"下扑"——`pathMorph` 通道驱动逐点插值
      //   （同结构 `M Q Q`；控制点下压 = 拍翅）。三只错时（队形感）。
      svgPathTo: { d: birdFlap(bw2, bh2, 1.65) },
    })
  })

  // ⑪ 题款「山水清音」（竖排四字；每字 inset 基态全隐——逐字书写）
  const charSize = R(W * 0.082)
  const colX = R(W * 0.845)
  const colY0 = R(H * 0.052)
  const chars = ['山', '水', '清', '音']
  chars.forEach((ch, i) => {
    nodes.push({
      id: INK_IDS.titleChars[i]!, parentId: INK_IDS.root, position: 'absolute',
      left: colX, top: colY0 + i * R(charSize * 1.32),
      width: R(charSize * 1.15), height: R(charSize * 1.3),
      text: ch, color: P.ink, fontSize: charSize,
      clipPath: { kind: 'inset', params: [0, 1, 0, 0] },
    })
  })

  // ⑫ 印章（印面 + 白文内框；基态中心零尺寸——"未落印"）
  //    ★基态用 [0.5,0.5,0.5,0.5]（中心零尺寸）而非 [1,1,1,1]：
  //      后者是两轴反相矩形，Android Path.addRect 不做坐标排序 ⇒ 仍覆盖整盒（印章提前可见）。
  const sealSize = R(W * 0.088)
  const sealLeft = R(W * 0.152)
  const sealTop = R(H * 0.052)
  nodes.push({
    id: INK_IDS.sealFill, parentId: INK_IDS.root, position: 'absolute',
    left: sealLeft, top: sealTop, width: sealSize, height: sealSize,
    backgroundColor: P.seal,
    clipPath: { kind: 'inset', params: [0.5, 0.5, 0.5, 0.5] },
  })
  const inset = R(sealSize * 0.16)
  nodes.push({
    id: INK_IDS.sealInner, parentId: INK_IDS.root, position: 'absolute',
    left: sealLeft, top: sealTop, width: sealSize, height: sealSize,
    svgPath: {
      d: `M${inset} ${inset} L${sealSize - inset} ${inset} L${sealSize - inset} ${sealSize - inset} L${inset} ${sealSize - inset} Z`,
      stroke: ink('#f6f0d8', 0.85), strokeWidth: sw(0.0035),
    },
    clipPath: { kind: 'inset', params: [0.5, 0.5, 0.5, 0.5] },
  })

  // ⑫.5 前景坡岸（两坡——补底部留白；reveal 随"江水"幕涨起）+ 水草四笔
  const bankCol = blend(P.paper, '#8a9aa8', 0.16)
  const bankCol2 = blend(P.paper, '#8a9aa8', 0.1)
  const bankDefs: Array<[number, number, number, number, string]> = [
    // [left(W), top(H), w(W), h(H), color]
    [-0.12, 0.90, 0.62, 0.17, bankCol],
    [0.52, 0.925, 0.66, 0.15, bankCol2],
  ]
  bankDefs.forEach(([lf, tf, wf, hf, col], i) => {
    nodes.push({
      id: INK_IDS.banks[i]!, parentId: INK_IDS.root, position: 'absolute',
      left: R(W * lf), top: R(H * tf), width: R(W * wf), height: R(H * hf),
      borderRadius: R(H * hf / 2), backgroundColor: col,
      clipPath: { kind: 'inset', params: [1, 0, 0, 0] }, // 基态全隐（随江水涨起）
    })
  })
  // 水草（左岸四笔——细长的草茎，风摆）
  const reedDefs: Array<[number, number, number, number, number]> = [
    // [left(W), top(H), w(W), h(H), bow]
    [0.04, 0.845, 0.06, 0.085, 0.4],
    [0.075, 0.855, 0.05, 0.075, -0.3],
    [0.105, 0.848, 0.055, 0.09, 0.35],
    [0.135, 0.858, 0.045, 0.07, -0.4],
  ]
  reedDefs.forEach(([lf, tf, wf, hf, bow], i) => {
    const rw2 = R(W * wf)
    const rh2 = R(H * hf)
    const P = (x: number, y: number): string => `${Math.round(x)} ${Math.round(y)}`
    const d = `M${P(rw2 * (0.5 - bow * 0.24), rh2)} Q ${P(rw2 * (0.5 + bow * 0.3), rh2 * 0.42)} ${P(rw2 * (0.5 + bow * 0.52), 0)}`
    nodes.push({
      id: INK_IDS.reeds[i]!, parentId: INK_IDS.root, position: 'absolute',
      left: R(W * lf), top: R(H * tf), width: rw2, height: rh2,
      svgPath: { d, stroke: ink('#4a6448', 0.55), strokeWidth: sw(0.003) },
    })
  })

  // ⑬ 右端固定轴（画"已展开端"的轴——幕布**之下**：闭合时被墨幕遮住，展开后露出）
  const sm = scrollMetrics(view)
  const woodDark = '#5a4530'
  const woodKnob = '#6f523a'
  const rBarW = Math.max(6, R(W * 0.016))
  const rBarLeft = W - rBarW - R(W * 0.004)
  nodes.push({
    id: INK_IDS.rollerRightBar, parentId: INK_IDS.root, position: 'absolute',
    left: rBarLeft, top: 0, width: rBarW, height: H,
    backgroundColor: woodDark,
    // 圆柱明暗（横）：暗-亮-暗 —— 与卷筒同一手法（本引擎渐变的"物理感"用法）
    fillGradient: {
      kind: 'linear', angle: 90,
      stops: [
        { offset: 0, color: '#4a3826' },
        { offset: 0.4, color: '#8a6a48' },
        { offset: 1, color: '#3f2f20' },
      ],
    },
  })
  const rKnobLeft = rBarLeft + Math.round(rBarW / 2) - Math.round(sm.knobW / 2)
  nodes.push({
    id: INK_IDS.rollerRightKnobTop, parentId: INK_IDS.root, position: 'absolute',
    left: rKnobLeft, top: -R(sm.knobH * 0.4), width: sm.knobW, height: sm.knobH,
    borderRadius: R(sm.knobH / 2), backgroundColor: woodKnob,
  })
  nodes.push({
    id: INK_IDS.rollerRightKnobBottom, parentId: INK_IDS.root, position: 'absolute',
    left: rKnobLeft, top: H - R(sm.knobH * 0.6), width: sm.knobW, height: sm.knobH,
    borderRadius: R(sm.knobH / 2), backgroundColor: woodKnob,
  })

  // ⑭ 幕布（**最上层**——数组末尾；inset 基态全遮）
  nodes.push({
    id: INK_IDS.curtain, parentId: INK_IDS.root, position: 'absolute',
    left: 0, top: 0, width: W, height: H,
    backgroundColor: P.curtain,
    clipPath: { kind: 'inset', params: [0, 0, 0, 0] },
  })

  // ⑮ 卷筒组（**在幕布之上**：闭合时整卷只见它的外缘；展开时贴边界滚动）——
  //    卷筒（横向渐变圆柱明暗）+ 上下轴头（木色圆头，两端出头）。
  nodes.push({
    id: INK_IDS.rollCylinder, parentId: INK_IDS.root, position: 'absolute',
    left: W - sm.bandW, top: 0, width: sm.bandW, height: H,
    backgroundColor: '#cdb992',
    // ★圆柱明暗：左暗→中亮→右暗（横向线性渐变）——"纸卷成筒"的立体感
    fillGradient: {
      kind: 'linear', angle: 90,
      stops: [
        { offset: 0, color: '#8f7d5c' },
        { offset: 0.28, color: '#eadcbc' },
        { offset: 0.55, color: '#cdb992' },
        { offset: 1, color: '#7f6d4d' },
      ],
    },
  })
  const kLeft = W - sm.bandW + Math.round(sm.bandW / 2) - Math.round(sm.knobW / 2)
  nodes.push({
    id: INK_IDS.rollKnobTop, parentId: INK_IDS.root, position: 'absolute',
    left: kLeft, top: -R(sm.knobH * 0.4), width: sm.knobW, height: sm.knobH,
    borderRadius: R(sm.knobH / 2), backgroundColor: woodKnob,
  })
  nodes.push({
    id: INK_IDS.rollKnobBottom, parentId: INK_IDS.root, position: 'absolute',
    left: kLeft, top: H - R(sm.knobH * 0.6), width: sm.knobW, height: sm.knobH,
    borderRadius: R(sm.knobH / 2), backgroundColor: woodKnob,
  })

  return JSON.stringify({ viewport: { width: W, height: H }, nodes })
}

/* ────────────────────────── 节目单 ────────────────────────── */

/** 一幕（与灯光秀/翻折剧场同形 + 本节目的能力计数） */
export interface InkAct {
  name: string
  spanMs: number
  holdMs: number
  durationMs: number
  anims: EngineAnim[]
  note: string
  /** 颜色通道指令条数（点缀） */
  colorAnims: number
  /** 裁剪参数通道指令条数（C1——本节目主角之一） */
  clipAnims: number
  /** SVG 描边进度指令条数（C2——本节目主角之二） */
  strokeAnims: number
  /** 3D 旋转指令条数（本节目未用——保持与灯光秀 Act 同形，恒 0） */
  rotate3dAnims: number
  /** 自定义贝塞尔指令条数（本节目的印压回弹用） */
  curveBezierAnims: number
  /** 循环指令条数（荡漾/翻涌用） */
  repeatAnims: number
  /** 判据的"进行中采样"标记（宿主在幕 45% 处采探针——"描边真的在进程中"的证据） */
  midSample?: boolean
}

export interface InkProgram {
  next(): InkAct | null
  plan(): string[]
}

interface Step {
  name: string
  note: string
  holdMs?: number
  midSample?: boolean
  build: () => EngineAnim[]
}

/** 一条声明 → 已绑定节点的内核指令（编译期校验在 `compileAnimations` 内跑） */
function onto(nodeId: number, d: Parameters<typeof compileAnimations>[0][number]): EngineAnim[] {
  return compileAnimations([d], { nodeId }).anims
}

function isColorKind(kind: number): boolean {
  return kind >= 5 && kind <= 12
}
function isClipKind(kind: number): boolean {
  return kind >= 15 && kind <= 30
}
function isStrokeKind(kind: number): boolean {
  return kind === 31
}

/**
 * **笔锋动力学**（起→行→收的三段关键帧）：慢起笔（蓄墨）· 快行笔（扫过）· 缓收笔（提锋）。
 * ★同一根线走这条曲线 = "画"出来的；`easeOut` 一镜到底是"长"出来的——差别肉眼可辨。
 */
function brush(totalMs: number): Array<{ to: number; durationMs: number; curve: 'easeIn' | 'easeOut' | 'linear' | 'easeInOut' }> {
  return [
    { to: 0.14, durationMs: Math.round(totalMs * 0.14), curve: 'easeIn' },
    { to: 0.86, durationMs: Math.round(totalMs * 0.56), curve: 'easeInOut' },
    { to: 1, durationMs: Math.round(totalMs * 0.3), curve: 'easeOut' },
  ]
}

export function createInkProgram(_env: { view: View }): InkProgram {
  const P = INK_PALETTE
  const I = INK_IDS
  const steps: Step[] = []

  // ① 展卷（unfurl）：幕布从右端向左卷走（inset right 0→1——古画展开方向）
  steps.push({
    name: 'unfurl',
    note: '真·展卷：卷筒（带轴头）自右缘向左滚动，墨幕被卷上筒身（幕布 inset right 0→1 与卷筒 translateX 同曲线）——空纸自右向左显露',
    holdMs: 300,
    build: () => {
      const sm2 = scrollMetrics(_env.view)
      return [
        ...onto(I.curtain, { kind: 'clip', from: [0, 0, 0, 0], to: [0, 1, 0, 0], durationMs: 1500, curve: 'easeInOut' }),
        // ★卷筒组（筒身 + 上下轴头）与幕布**同一时长同一曲线**（两处不同步会"脱筒"——判据钉住同曲线）
        ...onto(I.rollCylinder, { kind: 'translateX', from: 0, to: sm2.txOpen, durationMs: 1500, curve: 'easeInOut' }),
        ...onto(I.rollKnobTop, { kind: 'translateX', from: 0, to: sm2.txOpen, durationMs: 1500, curve: 'easeInOut' }),
        ...onto(I.rollKnobBottom, { kind: 'translateX', from: 0, to: sm2.txOpen, durationMs: 1500, curve: 'easeInOut' }),
      ]
    },
  })

  // ② 远山三叠（mountains）：每叠 = 椭圆晕团晕开（clip 揭现）+ 湿/骨/枯三层笔触落笔（错时）+ 点苔
  //    ★笔序：晕（先，最快）→ 骨（中）→ 枯（后，最急）——读起来是"三笔写成一座山"
  steps.push({
    name: 'mountains',
    note: '远山三叠：晕团先晕开（椭圆柔边）+ 湿/骨/枯三层错时落笔（晕 2.3× 宽 · 骨 90% 浓 · 枯 飞白）+ 点苔',
    holdMs: 400,
    midSample: true, // 45% 时中山骨线应在"行笔"中（进程证据）
    build: () => {
      const out: EngineAnim[] = []
      RANGES.forEach((rg, r) => {
        const dly = r * 420
        out.push(...onto(I.rangeWet[r], { kind: 'strokeProgress', from: 0, to: 1, durationMs: 1500, delayMs: dly + 150, curve: 'easeOut' }))
        out.push(...onto(I.rangeCore[r], { kind: 'strokeProgress', from: 0, to: 1, durationMs: 2000, delayMs: dly + 320, keyframes: brush(2000) }))
        out.push(...onto(I.rangeDry[r], { kind: 'strokeProgress', from: 0, to: 1, durationMs: 1100, delayMs: dly + 720, curve: 'easeOut' }))
        // 椭圆晕团随落笔晕开（clip 揭现——"墨在纸里晕开"）
        I.rangePuffs[r]!.forEach((puffId, k) => {
          out.push(...onto(puffId, { kind: 'clip', from: [1, 0, 0, 0], to: [0, 0, 0, 0], durationMs: 1200, delayMs: dly + 60 + k * 260, curve: 'easeOut' }))
        })
        // 点苔（clip 揭现——同"基态全隐"纪律）
        I.rangeDots[r]!.forEach((dotId, k) => {
          out.push(...onto(dotId, { kind: 'clip', from: [1, 0, 0, 0], to: [0, 0, 0, 0], durationMs: 320, delayMs: dly + 900 + k * 220, curve: 'easeOut' }))
        })
      })
      return out
    },
  })

  // ③ 飞瀑（waterfall）：三笔自上而下 · 飞沫两点轻落（scale 回弹）
  steps.push({
    name: 'waterfall',
    note: '飞瀑：两岸峭与中流自上而落（3 笔·错时）——落水处两点飞沫弹落（backOut）',
    holdMs: 300,
    build: () => {
      const out: EngineAnim[] = []
      out.push(...onto(I.fallGate, { kind: 'strokeProgress', from: 0, to: 1, durationMs: 900, curve: 'easeOut' }))
      I.waterfall.forEach((id, i) => {
        out.push(...onto(id, { kind: 'strokeProgress', from: 0, to: 1, durationMs: 1400 + i * 160, delayMs: i * 160, curve: 'easeInOut' }))
      })
      I.fallMist.forEach((id, i) => {
        out.push(...onto(id, { kind: 'scale', from: 0.15, to: 1, durationMs: 420, delayMs: 1200 + i * 240, curveBezier: [0.34, 1.56, 0.64, 1] }))
      })
      return out
    },
  })

  // ④ 江水涨潮（river）：水面 / 深水带自下漫上（两条 inset 错时）· 月影随水显形 · 六道水纹自左及右
  steps.push({
    name: 'river',
    note: '江水涨潮：水面与深水带自下漫上（两条 inset 错时）· 月影随水显形 · 六道水纹自左及右（近粗浓远细淡）',
    holdMs: 300,
    build: () => {
      const out: EngineAnim[] = [
        ...onto(I.water, { kind: 'clip', from: [1, 0, 0, 0], to: [0.3, 0, 0, 0], durationMs: 1300, curve: 'easeOut' }),
        ...onto(I.waterDeep, { kind: 'clip', from: [1, 0, 0, 0], to: [0.34, 0, 0, 0], durationMs: 1500, delayMs: 260, curve: 'easeOut' }),
        ...onto(I.reflection, { kind: 'clip', from: [0, 1, 0, 0], to: [0, 0, 0, 0], durationMs: 1200, delayMs: 900, curve: 'easeOut' }),
      ]
      I.ripples.forEach((id, i) => {
        out.push(...onto(id, { kind: 'strokeProgress', from: 0, to: 1, durationMs: 900, delayMs: 700 + i * 190, curve: 'easeOut' }))
      })
      // 前景坡岸（自下缘"长"出来 = clip 揭现）＋ 水草随坡落笔
      I.banks.forEach((id, i) => {
        out.push(...onto(id, { kind: 'clip', from: [1, 0, 0, 0], to: [0, 0, 0, 0], durationMs: 1200, delayMs: 400 + i * 260, curve: 'easeOut' }))
      })
      I.reeds.forEach((id, i) => {
        out.push(...onto(id, { kind: 'strokeProgress', from: 0, to: 1, durationMs: 700, delayMs: 1000 + i * 180, curve: 'easeOut' }))
      })
      return out
    },
  })

  // ⑤ 明月升起（moonrise）：月晕两圈先扩散（circle 半径 0→满）· 月盘圆心从盒外升到盒心（由缺到圆）
  steps.push({
    name: 'moonrise',
    note: '明月升起：月晕两圈先扩散（circle 半径 0→0.5）· 月盘由盒底升入（圆心 cy 1.9→0.5）——由缺到圆',
    holdMs: 450,
    build: () => [
      ...onto(I.haloOuter, { kind: 'clip', from: [0.5, 0.5, 0], to: [0.5, 0.5, 0.5], durationMs: 1600, curve: 'easeOut' }),
      ...onto(I.haloInner, { kind: 'clip', from: [0.5, 0.5, 0], to: [0.5, 0.5, 0.5], durationMs: 1300, delayMs: 200, curve: 'easeOut' }),
      ...onto(I.moon, { kind: 'clip', from: [0.5, 1.9, 0.5], to: [0.5, 0.5, 0.5], durationMs: 1700, delayMs: 150, curve: 'easeOut' }),
    ],
  })

  // ⑥ 云海翻涌（clouds）：三带自水平线翻涌升起（polygon 顶点插值 · 错时 0→240→480ms）
  steps.push({
    name: 'clouds',
    note: '云海翻涌：两条云带自水平线涨起（polygon 压扁→云形 · 错时 0.26s）+ 椭圆云团随之涨起（柔边云气）',
    holdMs: 300,
    build: () => [
      ...onto(I.clouds[0], { kind: 'clip', from: [...MIST_FLAT], to: [...MIST_A], durationMs: 1100, curve: 'easeOut' }),
      ...onto(I.clouds[1], { kind: 'clip', from: [...MIST_FLAT], to: [...MIST_B], durationMs: 1100, delayMs: 260, curve: 'easeOut' }),
      // 椭圆云团随云带一起涨起（clip 揭现 · 错时——柔边"云气"）
      ...I.cloudPuffs.flatMap((id, i) =>
        onto(id, { kind: 'clip', from: [1, 0, 0, 0], to: [0, 0, 0, 0], durationMs: 1100, delayMs: 120 + i * 260, curve: 'easeOut' }),
      ),
    ],
  })

  // ⑦ 松竹风摆（grove）：三棵全部笔触（主段→次段→叶簇 · 错时）· 风过梢动（整体 translateX ±5 yoyo 2 次）
  steps.push({
    name: 'grove',
    note: '松竹风摆：三棵次第落笔（主段→次段→叶簇 · 错时）· 风过梢动（translateX ±5 · yoyo 2 次）',
    holdMs: 250,
    build: () => {
      const out: EngineAnim[] = []
      I.bamboo.forEach((triple, i) => {
        const dly = i * 260
        out.push(...onto(triple[0], { kind: 'strokeProgress', from: 0, to: 1, durationMs: 900, delayMs: dly, curve: 'easeOut' }))
        out.push(...onto(triple[1], { kind: 'strokeProgress', from: 0, to: 1, durationMs: 700, delayMs: dly + 380, curve: 'easeOut' }))
        out.push(...onto(triple[2], { kind: 'strokeProgress', from: 0, to: 1, durationMs: 600, delayMs: dly + 620, curve: 'easeOut' }))
        // 风摆：同一棵的三条笔触**同相**（整体轻摆——不同相会把竹"撕开"）
        const dir = i % 2 === 0 ? 1 : -1
        for (const id of triple) {
          out.push(...onto(id, { kind: 'translateX', from: 0, to: dir * (5 - i), durationMs: 1500, delayMs: 1100, repeat: 2, direction: 'alternate', curve: 'easeInOut' }))
        }
      })
      return out
    },
  })

  // ⑧ 渔舟荡漾（boat）：三笔落成（船身→桅帆→渔人）· 随即随波轻荡（translateY ±3 + rotate ±1.2° yoyo 4 次）
  steps.push({
    name: 'boat',
    note: '渔舟荡漾：船身→桅帆→渔人三笔落成 · 随波轻荡（translateY ±3 · rotate ±1.2° · yoyo 4 次）——水面的生气',
    holdMs: 300,
    build: () => {
      const out: EngineAnim[] = [
        ...onto(I.boat[0], { kind: 'strokeProgress', from: 0, to: 1, durationMs: 1300, curve: 'easeOut' }),
        ...onto(I.boat[1], { kind: 'strokeProgress', from: 0, to: 1, durationMs: 900, delayMs: 520, curve: 'easeOut' }),
        ...onto(I.boat[2], { kind: 'strokeProgress', from: 0, to: 1, durationMs: 700, delayMs: 860, curve: 'easeOut' }),
      ]
      // 荡漾：三节点同相（船整体晃——不同相会散架）
      for (const id of I.boat) {
        out.push(...onto(id, { kind: 'translateY', from: 0, to: 3, durationMs: 1400, delayMs: 1100, repeat: 4, direction: 'alternate', curve: 'easeInOut' }))
        out.push(...onto(id, { kind: 'rotate', from: 0, to: 1.2, durationMs: 1400, delayMs: 1100, repeat: 4, direction: 'alternate', curve: 'easeInOut' }))
      }
      return out
    },
  })

  // ⑨ 飞鸟掠水（birds）：三只依次落笔 · 掠向下游（X 右移 + Y 下探——队形错时）
  steps.push({
    name: 'birds',
    note: '飞鸟掠水：三只依次落笔（错时）· 掠向下游 · **扇翅（路径变形：两态逐点插值 · yoyo）**',
    holdMs: 300,
    build: () => {
      const out: EngineAnim[] = []
      I.birds.forEach((id, i) => {
        out.push(...onto(id, { kind: 'strokeProgress', from: 0, to: 1, durationMs: 650, delayMs: i * 300, curve: 'easeOut' }))
        out.push(...onto(id, { kind: 'translateX', from: -W0(_env, 0.1), to: W0(_env, 0.12), durationMs: 1800, delayMs: i * 300, curve: 'easeInOut' }))
        out.push(...onto(id, { kind: 'translateY', from: -H0(_env, 0.02), to: H0(_env, 0.03), durationMs: 1800, delayMs: i * 300, curve: 'easeInOut' }))
        // ★★路径变形 v1：**扇翅**（两态逐点插值 · yoyo 3 次）——线与掠飞同时进行。
        //   ★这是 CSS 做不到的（`d` 不可过渡）——见 birdFlap 注释。
        //   ★遍数取 **3（奇数）**：末态 = `to`（下扑位）——判据在逐幕末态探针上读得到**非零**
        //     因子（"通道通"与"翅膀真的停在扑位"是两件事；偶数遍会 yoyo 回 0，看不出动过）。
        out.push(...onto(id, { kind: 'pathMorph', from: 0, to: 1, durationMs: 380, delayMs: i * 300 + 500, repeat: 3, direction: 'alternate', curve: 'easeInOut' }))
      })
      return out
    },
  })

  // ⑩ 题款（inscription）：四字自上而下逐字书写（每字 inset 右裁 1→0 · 错时 0.38s）· 墨色由浅入焦
  steps.push({
    name: 'inscription',
    note: '题款「山水清音」：四字自上而下逐字书写（每字 inset 右裁 · 错时 0.38s）· 墨色由浅灰渗成焦墨（textColor）',
    holdMs: 400,
    build: () => {
      const out: EngineAnim[] = []
      I.titleChars.forEach((id, i) => {
        out.push(...onto(id, { kind: 'clip', from: [0, 1, 0, 0], to: [0, 0, 0, 0], durationMs: 620, delayMs: i * 380, curve: 'linear' }))
        out.push(...onto(id, { kind: 'textColor', from: P.inkFaint, to: P.ink, durationMs: 900, delayMs: i * 380, curve: 'easeOut' }))
      })
      return out
    },
  })

  // ⑪ 落印（seal）：印面从中心炸开（inset 0.5→0）· 白文内框随后画上 · 按压回弹（scale 1.4→1 · backOut）
  steps.push({
    name: 'seal',
    note: '落印：印面从中心炸开（inset 0.5→0 · easeOut）· 白文内框随后（描边 0→1）· 按压回弹（scale 1.4→1 · backOut）· 印色沉定',
    holdMs: 350,
    build: () => [
      ...onto(I.sealFill, { kind: 'clip', from: [0.5, 0.5, 0.5, 0.5], to: [0, 0, 0, 0], durationMs: 340, curve: 'easeOut' }),
      ...onto(I.sealInner, { kind: 'clip', from: [0.5, 0.5, 0.5, 0.5], to: [0, 0, 0, 0], durationMs: 380, delayMs: 120, curve: 'easeOut' }),
      ...onto(I.sealInner, { kind: 'strokeProgress', from: 0, to: 1, durationMs: 520, delayMs: 160, curve: 'easeOut' }),
      ...onto(I.sealFill, { kind: 'scale', from: 1.4, to: 1, durationMs: 360, curveBezier: [0.34, 1.56, 0.64, 1] }),
      ...onto(I.sealFill, { kind: 'color', from: P.sealLit, to: P.seal, durationMs: 800, curve: 'easeOut' }),
    ],
  })

  // ⑫ 云开月明（moonGlow·万物共息）：云带 yoyo 翻涌 + 第三带飘离 · 月呼吸（scale + 色）· 月影微荡 · 水纹起伏
  //     ★这是"活着的一幅画"的幕：已画之物各有微动，唯一没有新笔——观者看"气韵"
  steps.push({
    name: 'moonGlow',
    note: '云开月明·万物共息：云海 yoyo 翻涌（三带错相）· 月晕呼吸（scale yoyo）· 月影微荡 · 水纹起伏——已画之物各有微动',
    holdMs: 300,
    build: () => {
      const out: EngineAnim[] = [
        ...onto(I.clouds[0], { kind: 'clip', from: [...MIST_A], to: [...MIST_B], durationMs: 2400, repeat: 2, direction: 'alternate', curve: 'easeInOut' }),
        ...onto(I.clouds[1], { kind: 'clip', from: [...MIST_B], to: [...MIST_C], durationMs: 2600, delayMs: 300, repeat: 2, direction: 'alternate', curve: 'easeInOut' }),
        // ★第三带已并入椭圆云团（柔边）——cloudPuffs 在 moonGlow 里做缓慢横向漂移
        ...I.cloudPuffs.flatMap((id, i) =>
          onto(id, { kind: 'translateX', from: 0, to: i % 2 === 0 ? 26 : -22, durationMs: 2600, delayMs: i * 300, repeat: 2, direction: 'alternate', curve: 'easeInOut' }),
        ),
        // ★★路径变形 v2（异构"山峦呼吸"——CSS 做不到）：三叠山的**三层笔触**同步在两组
        //   山形之间缓变（峰数不同 ⇒ 内核重采样）——山在动，但读不出"坐标在插值"。
        //   错时 0.4s（远→中→近，像"气"从远处漫过来）。yoyo 2 次（一来一回）。
        ...[...I.rangeWet, ...I.rangeCore, ...I.rangeDry].flatMap((id, i) =>
          onto(id, { kind: 'pathMorph', from: 0, to: 1, durationMs: 2600, delayMs: (i % 3) * 400, repeat: 2, direction: 'alternate', curve: 'easeInOut' }),
        ),
        // ★★渐变 v2（两态混合——CSS 做不到）：云带/云团由"冷雾"过渡到"晨光暖雾"，
        //   再 yoyo 回冷 —— "云开月明"的色调叙事（不是换一个渐变，是**渐变本身在呼吸**）
        ...I.clouds.flatMap((id, i) => [
          ...onto(id, { kind: 'gradientMix', from: 0, to: 1, durationMs: 2200, delayMs: i * 300, repeat: 2, direction: 'alternate', curve: 'easeInOut' }),
        ]),
        ...I.cloudPuffs.flatMap((id, i) => [
          ...onto(id, { kind: 'gradientMix', from: 0, to: 1, durationMs: 2400, delayMs: 200 + i * 320, repeat: 2, direction: 'alternate', curve: 'easeInOut' }),
        ]),
        ...onto(I.haloOuter, { kind: 'scale', from: 1, to: 1.06, durationMs: 1800, repeat: 2, direction: 'alternate', curve: 'easeInOut' }),
        ...onto(I.moon, { kind: 'scale', from: 1, to: 1.09, durationMs: 1800, repeat: 2, direction: 'alternate', curve: 'easeInOut' }),
        ...onto(I.moon, { kind: 'color', from: P.moon, to: P.moonLit, durationMs: 1800, repeat: 2, direction: 'alternate', curve: 'easeInOut' }),
        ...onto(I.reflection, { kind: 'translateX', from: -4, to: 4, durationMs: 1600, repeat: 2, direction: 'alternate', curve: 'easeInOut' }),
      ]
      I.ripples.forEach((id, i) => {
        out.push(...onto(id, { kind: 'translateY', from: 0, to: i % 2 === 0 ? -2.5 : 2.5, durationMs: 1500 + i * 120, repeat: 2, direction: 'alternate', curve: 'easeInOut' }))
      })
      return out
    },
  })

  // ⑬ 收卷（close）：幕布盖回满屏（right 1→0）——卷终（终态 = 基态：全遮 ⇒ 下一轮从空卷再开）
  steps.push({
    name: 'close',
    note: '真·收卷：卷筒自左缘滚回右缘，墨幕重新卷起（幕布 inset right 1→0 与卷筒 translateX 同曲线）——卷终（终态 = 基态）',
    holdMs: 1000,
    build: () => {
      const sm2 = scrollMetrics(_env.view)
      return [
        ...onto(I.curtain, { kind: 'clip', from: [0, 1, 0, 0], to: [0, 0, 0, 0], durationMs: 1600, curve: 'easeInOut' }),
        ...onto(I.rollCylinder, { kind: 'translateX', from: sm2.txOpen, to: 0, durationMs: 1600, curve: 'easeInOut' }),
        ...onto(I.rollKnobTop, { kind: 'translateX', from: sm2.txOpen, to: 0, durationMs: 1600, curve: 'easeInOut' }),
        ...onto(I.rollKnobBottom, { kind: 'translateX', from: sm2.txOpen, to: 0, durationMs: 1600, curve: 'easeInOut' }),
      ]
    },
  })

  let index = 0
  return {
    next(): InkAct | null {
      const s = steps[index]
      if (!s) return null
      index += 1
      const anims = s.build()
      const span = spanMs(anims)
      const hold = s.holdMs ?? 0
      return {
        name: s.name,
        spanMs: span,
        holdMs: hold,
        durationMs: span + hold,
        anims,
        note: s.note,
        colorAnims: anims.filter((x) => isColorKind(x.kind)).length,
        clipAnims: anims.filter((x) => isClipKind(x.kind)).length,
        strokeAnims: anims.filter((x) => isStrokeKind(x.kind)).length,
        rotate3dAnims: 0,
        curveBezierAnims: anims.filter((x) => x.curveBezier !== undefined).length,
        repeatAnims: anims.filter((x) => x.repeat !== undefined).length,
        ...(s.midSample ? { midSample: true } : {}),
      }
    },
    plan(): string[] {
      return steps.map((s) => s.name)
    },
  }
}

/** 自 W/H 取像素（本节目单只吃 view 尺寸——`_env` 保持与旧签名一致） */
function W0(env: { view: View }, f: number): number {
  return Math.round(env.view.width * f)
}
function H0(env: { view: View }, f: number): number {
  return Math.round(env.view.height * f)
}
