// terminal.ts —— 零依赖的终端屏幕模型 + ANSI 解析（决策 #1279）
//
// 【为什么自己写】`ui/` 刻意零 npm 依赖（决策 #1187：装库要改根 lockfile 并触发全仓 relink，
//   本仓实测失败两次）。xterm.js 是唯一的终端标杆，但它不是"能内联的几百行"。
//   ⇒ 这里实现一个**够用且可验证**的子集：光标移动 / 换行滚动 / 擦除 / SGR 颜色（16 + 256 + 真彩）/
//     保存恢复 / 备用屏 / 滚动区。不做：鼠标事件、超链接、图片（Sixel/Kitty）、圆角边框绘制。
//
// 【它的边界要说清楚】不是完整 VT 解析器。复杂 TUI（vim/tmux）能用是因为它们**主要**用到
//   上面这些序列；真遇到不支持的序列，最坏情形是"某处显示不对"，不会崩（未知序列一律**吞掉**，
//   绝不把 `ESC[1;2H` 原样打到屏幕上 —— 那才是真正难看的失败）。
//
// 【为什么是"单元格数组"而不是字符串】颜色/粗体是**每格属性**，字符串表达不了；
//   40x120 = 4800 格，重绘时按"属性相同的连续段"合并成 span，DOM 数量仍然是几十个。

/** 一格的属性。颜色用 CSS 字符串（null = 用默认前景/背景） */
export interface Cell {
  ch: string
  fg: string | null
  bg: string | null
  bold: boolean
  dim: boolean
  italic: boolean
  underline: boolean
}

const DEFAULT_CELL: Cell = { ch: ' ', fg: null, bg: null, bold: false, dim: false, italic: false, underline: false }

/** 标准 16 色（跟主流终端主题一致；深浅各 8） */
const PALETTE16 = [
  '#2e3138', '#e5534b', '#39c07a', '#e2b341', '#4c8dff', '#c792ea', '#7fdbca', '#c8ccd4',
  '#5c6370', '#ff7b72', '#56d364', '#ffcb6b', '#82aaff', '#d2a8ff', '#a5e8dd', '#ffffff',
]

/** 256 色索引 → CSS。0-15 走主题表，16-231 是 6×6×6 立方，232-255 是灰阶。 */
export function colorOf(n: number): string {
  if (n < 16) return PALETTE16[n < 0 ? 0 : n]
  if (n < 232) {
    const i = n - 16
    const r = Math.floor(i / 36)
    const g = Math.floor((i % 36) / 6)
    const b = i % 6
    const c = (v: number) => (v === 0 ? 0 : 55 + v * 40)
    return `rgb(${c(r)},${c(g)},${c(b)})`
  }
  const v = 8 + (n - 232) * 10
  return `rgb(${v},${v},${v})`
}

export class Terminal {
  cols: number
  rows: number
  /** 屏幕（含属性）；每行 cols 格，行数 = rows */
  grid: Cell[][] = []
  /** 光标 */
  cx = 0
  cy = 0
  /** 延迟换行：写满最后一列后不立刻换行（xterm 语义：要等下一个字符才 wrap） */
  private pendingWrap = false
  /** 当前 SGR 状态（后续字符沿用） */
  private cur: Omit<Cell, 'ch'> = { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false }
  /** 滚动区（CSI r）。默认整屏 */
  private top = 0
  private bottom: number
  /** 备用屏（?1049）：vim/less 用它，退出时恢复主屏 */
  private altGrid: Cell[][] | null = null
  private savedCursor = { x: 0, y: 0, fg: null as string | null, bg: null as string | null }
  cursorVisible = true
  /** ★回滚缓冲（决策 #1393）：滚出屏幕顶部的整行留在这里，供鼠标滚轮回看。
      为什么之前"滚不动"：网格只有 rows 行，超出的行**直接被丢掉**，没有历史可滚。 */
  scrollback: Cell[][] = []
  /** 视口偏移：0 = 贴底（实时）；>0 = 向上回看这么多行 */
  viewOffset = 0
  /** 缓冲上限（行）。2000 行 ≈ 常见终端默认值，内存占用可忽略（每行 cols 个对象） */
  static readonly SCROLLBACK_MAX = 2000
  /** 解析状态机 */
  private state: 'ground' | 'esc' | 'csi' | 'osc' | 'osc_st' | 'charset' = 'ground'
  private params = ''
  private oscAcc = ''
  /** 版本号：每次内容变化 +1，渲染层据此判断要不要重画 */
  version = 0

  constructor(cols = 80, rows = 24) {
    this.cols = Math.max(2, cols)
    this.rows = Math.max(1, rows)
    this.bottom = this.rows - 1
    this.grid = this.makeGrid()
  }

  private makeGrid(): Cell[][] {
    return Array.from({ length: this.rows }, () => Array.from({ length: this.cols }, () => ({ ...DEFAULT_CELL })))
  }

  /** 尺寸变化：保留左上角内容（终端 resize 的通行做法），超出部分丢弃 */
  resize(cols: number, rows: number) {
    const c = Math.max(2, cols)
    const r = Math.max(1, rows)
    if (c === this.cols && r === this.rows) return
    const next = Array.from({ length: r }, (_, y) =>
      Array.from({ length: c }, (_, x) => this.grid[y]?.[x] ?? { ...DEFAULT_CELL }),
    )
    this.grid = next
    this.cols = c
    this.rows = r
    this.top = 0
    this.bottom = r - 1
    this.cx = Math.min(this.cx, c - 1)
    this.cy = Math.min(this.cy, r - 1)
    this.pendingWrap = false
    this.version++
  }

  /** 整屏清空（重开会话时用） */
  reset(cols = this.cols, rows = this.rows) {
    this.cols = Math.max(2, cols)
    this.rows = Math.max(1, rows)
    this.bottom = this.rows - 1
    this.grid = this.makeGrid()
    this.cx = 0
    this.cy = 0
    this.top = 0
    this.altGrid = null
    this.pendingWrap = false
    this.cur = { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false }
    this.version++
  }

  /** 纯文本（判据/复制用）：每行去掉尾部空白 */
  /** 滚轮回看：delta>0 向上看历史；返回是否真的动了（供 UI 决定是否重绘） */
  scrollView(delta: number): boolean {
    const max = this.scrollback.length
    const next = Math.max(0, Math.min(max, this.viewOffset + delta))
    if (next === this.viewOffset) return false
    this.viewOffset = next
    return true
  }

  /** 回到实时（贴底）—— 用户一敲键、或切会话时调用 */
  resetView() {
    this.viewOffset = 0
  }

  /** 当前视口要画的 rows 行（历史 + 实时）；offset=0 时就是 grid 本身 */
  visibleRows(): Cell[][] {
    const off = this.viewOffset
    if (!off) return this.grid
    const fromHistory = this.scrollback.slice(Math.max(0, this.scrollback.length - off))
    const need = this.rows - fromHistory.length
    const live = need > 0 ? this.grid.slice(0, need) : []
    const out = [...fromHistory, ...live]
    /* 行数不足时补空行（回看顶部时下方没有实时内容） */
    while (out.length < this.rows) {
      out.push(Array.from({ length: this.cols }, () => ({ ...DEFAULT_CELL })))
    }
    return out
  }

  text(): string {
    return this.grid.map((row) => row.map((c) => c.ch).join('').replace(/\s+$/, '')).join('\n')
  }

  // ── 主循环 ────────────────────────────────────────────────────────────

  /** 喂入一段文本（可以含任意控制序列；跨 chunk 的半截序列会被缓存） */
  write(data: string) {
    for (const ch of data) this.step(ch)
    this.version++
  }

  private step(ch: string) {
    const code = ch.codePointAt(0) ?? 0
    switch (this.state) {
      case 'ground':
        if (code === 0x1b) this.state = 'esc'
        else this.print(ch, code)
        return
      case 'esc':
        this.onEsc(ch)
        return
      case 'csi':
        // 参数字节 0x30-0x3F，中间字节 0x20-0x2F，终止字节 0x40-0x7E
        if (code >= 0x40 && code <= 0x7e) {
          this.onCsi(this.params, ch)
          this.params = ''
          this.state = 'ground'
        } else {
          this.params += ch
          if (this.params.length > 64) {
            // 异常长参数：直接丢弃（真实序列没有这么长），避免吃掉后面所有输出
            this.params = ''
            this.state = 'ground'
          }
        }
        return
      case 'osc':
        // OSC 以 BEL 或 ST(ESC \) 结束；内容（改标题/超链接）本实现忽略，但要**正确吞掉**
        if (code === 0x07) this.state = 'ground'
        else if (code === 0x1b) this.state = 'osc_st'
        else this.oscAcc += ch
        return
      case 'osc_st':
        this.state = ch === '\\' ? 'ground' : 'osc'
        return
      case 'charset':
        // ESC ( B 之类：吃一个字节后回地面
        this.state = 'ground'
        return
    }
  }

  private onEsc(ch: string) {
    switch (ch) {
      case '[':
        this.params = ''
        this.state = 'csi'
        return
      case ']':
        this.oscAcc = ''
        this.state = 'osc'
        return
      case '(':
      case ')':
      case '*':
      case '+':
      case '#':
        this.state = 'charset'
        return
      case '7': // DECSC 保存光标
        this.savedCursor = { x: this.cx, y: this.cy, fg: this.cur.fg, bg: this.cur.bg }
        this.state = 'ground'
        return
      case '8': // DECRC 恢复光标
        this.cx = Math.min(this.savedCursor.x, this.cols - 1)
        this.cy = Math.min(this.savedCursor.y, this.rows - 1)
        this.cur.fg = this.savedCursor.fg
        this.cur.bg = this.savedCursor.bg
        this.state = 'ground'
        return
      case 'D': // IND 下移
        this.lineFeed()
        this.state = 'ground'
        return
      case 'M': // RI 上移
        if (this.cy === this.top) this.scrollDown(1)
        else this.cy = Math.max(0, this.cy - 1)
        this.state = 'ground'
        return
      case 'c': // RIS 全复位
        this.reset()
        this.state = 'ground'
        return
      default:
        // 未知 ESC 序列：吞掉（绝不能原样打到屏幕上）
        this.state = 'ground'
    }
  }

  // ── 打印 ──────────────────────────────────────────────────────────────

  private print(ch: string, code: number) {
    if (code === 0x0a) {
      this.lineFeed()
      return
    }
    if (code === 0x0d) {
      this.cx = 0
      this.pendingWrap = false
      return
    }
    if (code === 0x08) {
      // 退格：光标左移，边界不越界（**不**擦字符：是否擦由 shell 自己发空格决定）
      if (this.cx > 0) this.cx--
      this.pendingWrap = false
      return
    }
    if (code === 0x09) {
      const next = Math.min(this.cols - 1, (Math.floor(this.cx / 8) + 1) * 8)
      this.cx = next
      this.pendingWrap = false
      return
    }
    if (code === 0x07) return // bell：静音（IDE 里响铃是骚扰）
    if (code < 0x20) return // 其它控制字符忽略

    if (this.pendingWrap) {
      this.cx = 0
      this.lineFeed()
      this.pendingWrap = false
    }
    const row = this.grid[this.cy]
    if (row && row[this.cx]) {
      row[this.cx] = { ch, ...this.cur }
    }
    if (this.cx === this.cols - 1) {
      this.pendingWrap = true
    } else {
      this.cx++
    }
  }

  private lineFeed() {
    if (this.cy === this.bottom) this.scrollUp(1)
    else this.cy = Math.min(this.rows - 1, this.cy + 1)
  }

  /** 滚动区整体上移 n 行（新行填空白） */
  private scrollUp(n: number) {
    for (let i = 0; i < n; i++) {
      /* 主屏滚动才进历史；备用屏（altGrid）里滚出去的是 vim/less 的临时画面，不该进 */
      if (!this.altGrid && this.top === 0) {
        const gone = this.grid[0]
        if (gone) {
          this.scrollback.push(gone)
          if (this.scrollback.length > Terminal.SCROLLBACK_MAX) this.scrollback.shift()
        }
      }
      this.grid.splice(this.top, 1)
      this.grid.splice(this.bottom, 0, Array.from({ length: this.cols }, () => ({ ...DEFAULT_CELL })))
    }
  }

  private scrollDown(n: number) {
    for (let i = 0; i < n; i++) {
      this.grid.splice(this.bottom, 1)
      this.grid.splice(this.top, 0, Array.from({ length: this.cols }, () => ({ ...DEFAULT_CELL })))
    }
  }

  // ── CSI ───────────────────────────────────────────────────────────────

  /** 解析参数串：`12;34` → [12,34]；空 → []；`?1049` 的 `?` 单独用 privateMode 判断 */
  private nums(p: string, dflt: number): number[] {
    const body = p.replace(/^[?>!]/, '')
    if (!body) return [dflt]
    return body.split(';').map((s) => (s === '' ? dflt : Number.parseInt(s, 10) || 0))
  }

  private onCsi(p: string, final: string) {
    const priv = p.startsWith('?')
    const a = this.nums(p, 1)
    switch (final) {
      case 'm':
        this.sgr(p)
        return
      case 'H':
      case 'f': {
        this.cy = Math.min(this.rows - 1, Math.max(0, (a[0] || 1) - 1))
        this.cx = Math.min(this.cols - 1, Math.max(0, (a[1] || 1) - 1))
        this.pendingWrap = false
        return
      }
      case 'A':
        this.cy = Math.max(0, this.cy - (a[0] || 1))
        return
      case 'B':
        this.cy = Math.min(this.rows - 1, this.cy + (a[0] || 1))
        return
      case 'C':
        this.cx = Math.min(this.cols - 1, this.cx + (a[0] || 1))
        this.pendingWrap = false
        return
      case 'D':
        this.cx = Math.max(0, this.cx - (a[0] || 1))
        this.pendingWrap = false
        return
      case 'G':
        this.cx = Math.min(this.cols - 1, Math.max(0, (a[0] || 1) - 1))
        return
      case 'd':
        this.cy = Math.min(this.rows - 1, Math.max(0, (a[0] || 1) - 1))
        return
      /* ★★`CSI J` / `CSI K` 的**缺省参数是 0**（擦到末尾），不是 1（决策 #1285）。
         通用 `nums(p, 1)` 对 A/B/C/D/H（"移动 1 格"）是对的，但套到 J/K 上就把
         "擦光标之后" 变成了 "擦光标之前" ⇒ zsh 画完提示符后的 `ESC[K` 会把**整行提示符反擦掉**，
         再配合 `ESC[J` 把上面几行一起抹 ⇒ 用户看到"闪一下就全黑"。
         实测证据：用户点开终端时抓的 816 字节里，`\x1b[J`（第 642 字节）和 `\x1b[K`（第 787 字节）
         **都是裸的**（无参数）⇒ 默认 0。 */
      case 'K':
        this.eraseLine(p === '' ? 0 : (a[0] ?? 0))
        return
      case 'J':
        this.eraseScreen(p === '' ? 0 : (a[0] ?? 0))
        return
      case 'L':
        for (let i = 0; i < (a[0] || 1); i++) {
          this.grid.splice(this.bottom, 1)
          this.grid.splice(this.cy, 0, Array.from({ length: this.cols }, () => ({ ...DEFAULT_CELL })))
        }
        return
      case 'M':
        for (let i = 0; i < (a[0] || 1); i++) {
          this.grid.splice(this.cy, 1)
          this.grid.splice(this.bottom, 0, Array.from({ length: this.cols }, () => ({ ...DEFAULT_CELL })))
        }
        return
      case 'P': {
        const row = this.grid[this.cy]
        if (row) {
          row.splice(this.cx, a[0] || 1)
          while (row.length < this.cols) row.push({ ...DEFAULT_CELL })
        }
        return
      }
      case '@': {
        const row = this.grid[this.cy]
        if (row) {
          for (let i = 0; i < (a[0] || 1); i++) row.splice(this.cx, 0, { ...DEFAULT_CELL })
          row.length = this.cols
        }
        return
      }
      case 'S':
        this.scrollUp(a[0] || 1)
        return
      case 'T':
        this.scrollDown(a[0] || 1)
        return
      case 'r': {
        const t = (a[0] || 1) - 1
        const b = (a[1] || this.rows) - 1
        this.top = Math.max(0, Math.min(t, this.rows - 1))
        this.bottom = Math.max(this.top, Math.min(b, this.rows - 1))
        this.cx = 0
        this.cy = this.top
        return
      }
      case 'h':
      case 'l': {
        if (!priv) return
        const on = final === 'h'
        for (const n of a) {
          if (n === 25) this.cursorVisible = on
          // ?1049 = 备用屏（vim/less/man）；进入时清屏，退出时回主屏
          if (n === 1049 || n === 47 || n === 1047) {
            if (on && !this.altGrid) {
              this.altGrid = this.grid.map((r) => r.map((c) => ({ ...c })))
              this.grid = this.makeGrid()
              this.cx = 0
              this.cy = 0
            } else if (!on && this.altGrid) {
              this.grid = this.altGrid
              this.altGrid = null
              this.cx = 0
              this.cy = 0
            }
          }
        }
        return
      }
      default:
        // 未知 CSI：吞掉（不把序列打到屏幕上）
        return
    }
  }

  private eraseLine(mode: number) {
    const row = this.grid[this.cy]
    if (!row) return
    const blank = { ...DEFAULT_CELL }
    if (mode === 0) for (let x = this.cx; x < this.cols; x++) row[x] = { ...blank }
    else if (mode === 1) for (let x = 0; x <= this.cx; x++) row[x] = { ...blank }
    else for (let x = 0; x < this.cols; x++) row[x] = { ...blank }
  }

  private eraseScreen(mode: number) {
    const blank = () => Array.from({ length: this.cols }, () => ({ ...DEFAULT_CELL }))
    if (mode === 0) {
      this.eraseLine(0)
      for (let y = this.cy + 1; y < this.rows; y++) this.grid[y] = blank()
    } else if (mode === 1) {
      this.eraseLine(1)
      for (let y = 0; y < this.cy; y++) this.grid[y] = blank()
    } else {
      for (let y = 0; y < this.rows; y++) this.grid[y] = blank()
    }
  }

  /** SGR：0 复位；1/2/3/4 粗细斜下划线；22/23/24 关；30-37/90-97 前景；40-47/100-107 背景；39/49 默认；38/48 扩展 */
  private sgr(p: string) {
    const raw = p.replace(/^[?>!]/, '')
    const codes = raw === '' ? [0] : raw.split(';').map((x) => (x === '' ? 0 : Number.parseInt(x, 10)))
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i]
      if (c === 0) this.cur = { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false }
      else if (c === 1) this.cur.bold = true
      else if (c === 2) this.cur.dim = true
      else if (c === 3) this.cur.italic = true
      else if (c === 4) this.cur.underline = true
      else if (c === 22) {
        this.cur.bold = false
        this.cur.dim = false
      } else if (c === 23) this.cur.italic = false
      else if (c === 24) this.cur.underline = false
      else if (c === 39) this.cur.fg = null
      else if (c === 49) this.cur.bg = null
      else if ((c >= 30 && c <= 37) || (c >= 90 && c <= 97)) {
        this.cur.fg = colorOf(c >= 90 ? c - 90 + 8 : c - 30)
      } else if ((c >= 40 && c <= 47) || (c >= 100 && c <= 107)) {
        this.cur.bg = colorOf(c >= 100 ? c - 100 + 8 : c - 40)
      } else if (c === 38 || c === 48) {
        // 扩展色：38;5;N（256 色）或 38;2;r;g;b（真彩）
        const target = c === 38 ? 'fg' : 'bg'
        const mode = codes[i + 1]
        if (mode === 5) {
          const n = codes[i + 2] ?? 0
          this.cur[target] = colorOf(n)
          i += 2
        } else if (mode === 2) {
          const r = codes[i + 2] ?? 0
          const g = codes[i + 3] ?? 0
          const b = codes[i + 4] ?? 0
          this.cur[target] = `rgb(${r},${g},${b})`
          i += 4
        } else {
          i += 1 // 未知形式：跳过，别把后续当内容打出去
        }
      }
    }
  }
}

/** 供渲染层：把一行按"属性相同"合并成段，减少 DOM 数量 */
export interface Run {
  text: string
  fg: string | null
  bg: string | null
  bold: boolean
  dim: boolean
  italic: boolean
  underline: boolean
}

export function runsOf(row: Cell[]): Run[] {
  const out: Run[] = []
  for (const c of row) {
    const last = out[out.length - 1]
    if (last && last.fg === c.fg && last.bg === c.bg && last.bold === c.bold && last.dim === c.dim && last.italic === c.italic && last.underline === c.underline) {
      last.text += c.ch
    } else {
      out.push({ text: c.ch, fg: c.fg, bg: c.bg, bold: c.bold, dim: c.dim, italic: c.italic, underline: c.underline })
    }
  }
  return out
}
