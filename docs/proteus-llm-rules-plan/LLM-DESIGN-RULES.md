# Proteus Website v3 — LLM Design Rules（官网设计风格规则 · 便于 LLM 执行）

> 一份让 LLM（Cursor / Copilot / Claude Code / Codex 等）**能直接照着生成合规官网代码**的设计规则包。
> 上层约束：`PROTEUS-METHODOLOGY`（原则 #0）+ `01-website-rearchitecture.md`（W-1~W-5）+ 49 份 plan。

---

## 1. 包结构（6 份 + 2 fixture + 1 校验器）

```
LLM 规则包
├── design-tokens.json      ★ 唯一事实源（颜色/字号/间距/后端色/设备色，确定值）
├── .llmrules               ★ MUST/MUST_NOT 硬规则（Cursor 等直接消费）
├── llm-style-guide.md      ★ 人类可读执行手册（组件规范/页面骨架/示例/反例）
├── verify-llm.js           ★ 自动化校验器（把规则变成 CI gate）
├── primitives-grid.html    ✅ 合规示例（用规则生成的 /primitives/layout/grid 页）
├── __fixture-good.html     ✅ 合规 fixture（校验器应 0 错误）
├── __fixture-bad.html      ❌ 违规 fixture（校验器应报错 —— 自证有效性）
└── README.md               （本文件）
```

**LLM 使用顺序：**
1. 读 `design-tokens.json` → 取颜色/字号/间距（**禁止自由发挥数值**）
2. 读 `.llmrules` → 明确 MUST / MUST_NOT
3. 读 `llm-style-guide.md` §5~§7 → 复用组件 class / 套页面骨架
4. 写代码 → 跑 `node verify-llm.js <file>` → 0 errors 才提交

---

## 2. 快速使用

```bash
# 校验单个文件
node verify-llm.js index.html

# 校验本目录全部 .html
node verify-llm.js --all

# CI gate（errors>0 退出码 1）
node verify-llm.js --all || exit 1
```

**退出码约定：** `0` = 通过，`1` = 有 error（**warning 不阻断**，仅提示）。

---

## 3. 校验项一览（与 .llmrules 一一对应）

| 编号 | 检查 | 严重度 | 触发示例 |
|------|------|--------|---------|
| C1 | 裸色值不在 palette（未走 `var(--*)`） | error | `background:#3b82f6` |
| C2 | 交互 Demo 改写源码节点（违反"源码不变"不变式） | error | `#src.innerHTML = ...` |
| C3 | 出现后端名(iOS/Android/Flutter/Skia)未用其后端色 | warning | 写"iOS"却用红色 |
| C4 | 交互 Demo 缺少 IR 面板 | warning | 无 `.ir-panel`/`#ir` |
| C5 | slogan 缺失 / `wx.*` 作为首选 API | warning | 页内首选 `wx.request` |
| C6 | 缺少关键 CSS 变量定义 | warning | 未声明 `--brand` |
| C7 | 结构缺失（DOCTYPE/lang/viewport/title） | error | 无 `<title>` |

**放行项（合规）：**
- `:root { --x: #hex }` 变量声明 → 视为局部 token 定义
- `var(--*)` 引用 → 合规
- `design-tokens.json` 全局 palette 内的色值 → 合规

---

## 4. 颜色体系速览（LLM 取色表）

```
基础：  bg #0a0a0c · panel #121216 · panel2 #1a1a20 · line #26262e
文本：  ink #f2f2f5 · muted #8a8a99 · dim #5c5c6a
品牌：  brand #7c5cff · brand2 #00e0c6 · accent #ff8a5c
状态：  ok #3ddc97 · warn #ffb454 · rec #ff6b6b
后端：  ios #0a84ff · android #3ddc84 · flutter #54c5f8 · skia #ffd54f · vue #42b883
代码：  kw #c792ea · tag #e06c75 · attr #d19a66 · str #98c379 · com #5c6370 · fn #61afef
设备：  phoneBg #0d1530 · tabletBg #111c40 · tvBg #0a1024 · watchBg #0d0d18 …
        （详见 design-tokens.json → color.device / color.aux）
```

**铁律：** 出现 `iOS` → 用 `var(--ios)`（#0a84ff）；`Android` → `var(--and)`；`Flutter` → `var(--flutter)`；`Skia` → `var(--skia)`。
这是"多后端剖面"（W-2）的可读性根基，颜色不得替换。

---

## 5. 一句话风格定位

> **深色优先 · 扁平细线 · 品牌渐变仅用于 Hero · 等宽字体仅用于代码/IR · 后端固定色 · 可交互证明（Playground 范式）· 小程序对照仅附录。**

---

## 6. 自测（fixture 自证校验器有效性）

```
$ node verify-llm.js __fixture-bad.html
▶ __fixture-bad.html
  ✗ [C1] 裸色值 #3b82f6 …
  ✗ [C1] 裸色值 #ff0000 …
  ✗ [C2] 交互 Demo 不得改写源码节点 …
  → errors: 3, warnings: 5        ← 证明：规则确实能抓违规

$ node verify-llm.js __fixture-good.html
▶ __fixture-good.html
  → errors: 0, warnings: 0        ← 证明：合规代码不被误杀

$ node verify-llm.js index.html primitives-grid.html flexible-multi-device.html
  → errors: 0, warnings: 0 (×3)   ← 存量页全部合规
```

---

## 7. 集成进 Cursor / Claude Code

**Cursor（项目级 `.cursorrules` 已是 `.llmrules` 的别名）：** 直接读取本目录 `.llmrules` + `design-tokens.json`。
**Claude Code：** 在 `CLAUDE.md` 里引用：
```
- 官网代码必须遵守 ./website-v3/.llmrules
- 颜色/间距必须来自 ./website-v3/design-tokens.json
- 生成后跑 node ./website-v3/verify-llm.js <file>，0 errors 才可提交
```
**GitHub Actions：**
```yaml
- run: cd proteus-website-v3 && node verify-llm.js --all
```

---

## 8. 演进规则

- **新增颜色** → 先写进 `design-tokens.json`（含语义命名），校验器自动放行；**禁止先在代码里写裸 hex 再补规则**。
- **新增组件 class** → 补进 `llm-style-guide.md` §5 + 一个合规示例页。
- **收紧规则** → 先跑 `--all` 确认存量全绿，再提交（避免 CI 突然红）。

---

*配套：PROTEUS-METHODOLOGY · G-27/28/29/30/31/32 · 01-website-rearchitecture.md*
*Architecture: `@proteus/architecture` · Plans: 49 · Website v3 · 2026-09-02*
