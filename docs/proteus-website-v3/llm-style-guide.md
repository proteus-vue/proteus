# Proteus Website v3 — LLM Style Guide（设计风格规则 · 便于 LLM 执行）

> **本文件是 `.llmrules` 的人类可读展开版**，供 LLM 在生成官网页面/组件时逐步对照。
> 上层约束：`PROTEUS-METHODOLOGY`（原则 #0）+ `01-website-rearchitecture.md`（W-1~W-5）+ `design-tokens.json`（确定值）。
> 所有数值以 `design-tokens.json` 为准；本文件负责"怎么用"。

---

## 0. 一句话总纲

> **官网不是"组件库文档站"，而是"语义模型的可体验证明场"（W-1/W-4）。**
> 因此 LLM 生成的每一个页面都必须同时满足：**① 视觉统一（Token）② 信息架构同构（五层 SPI）③ 可交互证明（Playground 范式）④ 迁移诚实（小程序对照为附录）**。

---

## 1. 设计语言关键词（视觉定位）

| 关键词 | 含义 | LLM 执行 |
|--------|------|----------|
| **Dark-first** | 深色为主，扁平 | `bg #0a0a0c`，禁止浅色主体 |
| **Glass-light** | 轻磨砂，非重度毛玻璃 | `backdrop-filter: blur(12px)` 仅 nav |
| **Conic mark** | 品牌标识 = 同心方 conic 渐变 | `.logo .mark { conic-gradient(...) }` |
| **Gradient text** | 仅 Hero h1 强调 | brand → brand2 |
| **1px line** | 分隔用细线，非阴影 | `border:1px solid var(--line)` |
| **Mono for IR** | 代码/IR/后端映射用等宽 | `var(--font-mono)` |
| **Backend colors** | iOS/Android/Flutter/Skia 固定色 | 见 Token，永不替换 |

---

## 2. 颜色用法矩阵（LLM 取色表）

```
背景层：  bg(#0a0a0c) → panel(#121216) → panel2(#1a1a20)
文本层：  ink(#f2f2f5) → muted(#8a8a99) → dim(#5c5c6a)
强调层：  brand(#7c5cff 紫) · brand2(#00e0c6 青) · accent(#ff8a5c 橙)
状态层：  ok(#3ddc97) · warn(#ffb454) · rec(#ff6b6b)
后端层：  vue(#42b883) · ios(#0a84ff) · android(#3ddc84) · flutter(#54c5f8) · skia(#ffd54f) · harmony(#ff8a5c)
```

**用法规则：**
- 正文只用 `ink`，次级 `muted`，禁用提示 `dim`。
- CTA 主按钮 = `brand` 填充；次按钮 = 透明 + `line` 描边（`ghost`）。
- 后端名出现时必须用其后端色（`ios` 蓝、`android` 绿…），这是"多后端剖面"的可读性根基。
- 状态色：`ok` 用于 ✓ passing，`warn` 用于降级/partial，`rec` 用于 ✗ 缺失（对标表 `.yes/.part/.no`）。

---

## 3. 排版规则

```css
body    { font: 15px/1.6 <font.family>; color: var(--ink); }
h1      { font-size: clamp(34px,5.4vw,60px); line-height:1.08; letter-spacing:-.025em; font-weight:800; }
h2      { font-size: 26px; }
h4      { font-size: 17px; }
code    { font-family: var(--font-mono); }
.eyebrow{ font-size:12px; letter-spacing:.14em; text-transform:uppercase; color:brand2; }
```

**反例（LLM 必须避免）：**
- ❌ `font-size: 32px` 写死 body 标题（应用 h1 clamp）。
- ❌ 中文用 serif / Comic Sans。
- ❌ 行高 1.2 的密排正文（lineHeight 必须 1.6）。

---

## 4. 间距 / 圆角 / 容器

```
容器：   max-width:1180px; margin:0 auto; padding: 0 24px（section 纵向 40/60/72）
圆角：   sm4 / md7 / lg9 / xl14 / pill20 / chip6 / logo8
间距：   取自 space.scale [4,6,8,10,12,14,16,18,22,24,26,28,30,40,60,72]
栅格：   features 3 列 · dimensions 4 列 · demoGrid repeat(auto-fill,minmax(110px,1fr))
断点：   ≤820px → 全部单栏
```

**每个 section 模板：**
```css
.pw3-section { max-width:1180px; margin:0 auto; padding:60px 24px; }
@media(max-width:820px){ .pw3-section{ padding:40px 24px; } }
```

---

## 5. 组件规范（LLM 生成时必须复用这些 class）

### 5.1 导航 `.pw3-nav`
```html
<nav class="pw3-nav">
  <div class="pw3-nav-in">
    <a class="pw3-logo" href="#"><span class="pw3-mark"></span>Proteus <span>/ semantic engine</span></a>
    <div class="pw3-nav-links">
      <a href="#playground">Playground</a>
      <a href="#primitives">Primitives</a>
      <a href="#compare">Compare</a>
      <a href="#migrate">Migrate</a>
      <a href="#" class="pw3-github">GitHub →</a>
    </div>
  </div>
</nav>
```
样式锚点：`sticky top:0; backdrop-filter:blur(12px); border-bottom:1px solid line`。

### 5.2 Hero `.pw3-hero`
- eyebrow chip → h1（含 `<em>` 渐变）→ sub → CTA(primary+ghost) → pills。
- **结构不可省**：这是首页翻转的核心表达（01 §3.1）。

### 5.3 卡片 `.pw3-card`
```css
.pw3-card { border:1px solid var(--line); border-radius:14px; padding:24px; background:var(--panel); }
.pw3-card:hover { border-color: var(--brand); }   /* 微交互：仅边框变色，不变形 */
```

### 5.4 Tag / Pill
```css
.pw3-tag   { font-size:11px; padding:2px 8px; border-radius:4px; background:rgba(124,92,255,.14); color:#b6a3ff; border:1px solid rgba(124,92,255,.3); }
.pw3-tag.live { background:rgba(61,220,151,.12); color:var(--ok); border-color:rgba(61,220,151,.3); }
.pw3-pill  { border:1px solid var(--line); border-radius:20px; padding:4px 12px; font-size:13px; color:var(--muted); }
```

### 5.5 表格（对标/矩阵）
```css
table { width:100%; border-collapse:collapse; font-size:13px; }
th,td { padding:12px 14px; text-align:left; border-bottom:1px solid var(--line); vertical-align:top; }
th { color:var(--muted); font-weight:600; font-size:12px; text-transform:uppercase; letter-spacing:.05em; }
td.yes{color:var(--ok)}  td.part{color:var(--warn)}  td.no{color:var(--rec)}
tr:hover td { background:var(--panel); }
```
**铁律**：每行必须有可点击 evidence 链接（W-4）。

### 5.6 后端映射块 `.pw3-backend-map`
展示"同一语义原语，多后端实现剖面"——**这是 Proteus 官网区别于所有竞品的核心组件**：
```html
<div class="pw3-backend-map">
  <div><b style="color:var(--ios)">iOS</b> → UICollectionView</div>
  <div><b style="color:var(--and)">Android</b> → LazyLayout</div>
  <div><b style="color:var(--flutter)">Flutter</b> → GridView.builder</div>
  <div><b style="color:var(--skia)">Skia</b> → SkCanvas::drawRect</div>
</div>
```
LLM 生成任何原语页都必须包含此块（W-2）。

---

## 6. 页面骨架模板（LLM 照此生成新页面）

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Proteus — {PAGE_TITLE}</title>
<style>
  /* :root Token —— 直接复用 design-tokens.json，禁止新增颜色 */
  :root{ --bg:#0a0a0c; --panel:#121216; ... }
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--ink);font:15px/1.6 <font.family>;}
  /* 引入本文件 §5 全部组件 class */
</style>
</head>
<body>
  <nav class="pw3-nav">...</nav>
  <section class="pw3-hero">...</section>
  <section class="pw3-section">   <!-- 主体：交互 Demo / 后端剖面 / 表格 / 迁移对照 -->  </section>
  <footer>...</footer>
  <script> /* 交互逻辑（如四维度切换） */ </script>
</body>
</html>
```

---

## 7. Playground / 柔性 Demo 范式（最高优先级）

每个交互 Demo 必须满足"**源码不变，Backend 切换 → 结果变**"这一不变式。
参考实现：`index.html`（四维度）、`flexible-multi-device.html`（六端）。

**最小合规结构：**
```html
<div class="pw3-playground">
  <div class="pw3-pg-head">
    <h3>Mini Playground</h3>
    <span class="pw3-tag live">● LIVE</span>
  </div>
  <div class="pw3-dimensions">   <!-- 四维度 select：Render/Compiler/Device/Capability -->
    <div class="pw3-dim"><label>Render</label><select data-dim="render">...</select></div>
    ...
  </div>
  <div class="pw3-editor-layout">
    <div class="pw3-editor"><pre id="src">{SOURCE — 永不修改}</pre></div>
    <div class="pw3-render-pane" id="out">...</div>
  </div>
  <div class="pw3-ir-panel" id="ir">{ "renderBackend":"...", "device":"...", "capability":{...} }</div>
</div>
```

**JS 契约（LLM 必须实现）：**
```js
const state = { render:'vuedom', compiler:'node', device:'phone', capability:'ios' };
function render(){
  // 1. 更新后端剖面文案（iOS→UICollectionView ...）
  // 2. 更新 IR 面板 JSON（必须反映 state 全部四维）
  // 3. 若 device 为 car/tv/watch → 标 RECORDED ON DEVICE，展示降级提示
  // 4. ★ 不得修改 #src 内容（不变式断言）
}
document.querySelectorAll('select[data-dim]').forEach(s =>
  s.addEventListener('change', e => { state[e.target.dataset.dim]=e.target.value; render(); }));
```

**反例：**
- ❌ 切换设备时重新赋给 `#src` 不同代码（违反不变式）。
- ❌ 用截图/视频冒充原生渲染却不标 `RECORDED ON DEVICE`（违反 W-3 诚实）。
- ❌ IR 面板是死的静态文字（必须随 select 实时更新）。

---

## 8. 五层 SPI 在文案中的正确表述

LLM 写任何架构描述时，五层必须齐全且顺序固定：
```
语义原语 (G-31/32)  → 编译后端 (G-29)  → 渲染后端 (G-27)  → 能力后端 (G-28)  → 端 (G-30)
```
**模板句：**
> "一份 `<p-grid>` 语义原语（G-32），经 CompilerIR 由 Node/Rust/WASM 编译（G-29），交由 VueDom / Native / Flutter / Skia 渲染（G-27），调用 iOS / Android / Harmony 原生能力（G-28），部署到手机/平板/PC/车机/TV/手表任意端（G-30）。"

---

## 9. 迁移对照规范（小程序 → Proteus）

`/migrate` 与每个原语页附录必须含此表，且**小程序列不得作为首选示例**：
| 小程序 | Proteus 语义 | 备注 |
|--------|-------------|------|
| `wx.request` | `useFetch()` | Hook + Promise |
| `swiper` | `<p-stack snap="mandatory" loop>` | **组件被消灭，还原为属性** |
| `scroll-view` | `<p-scroll axis="x">` | 同上 |
| `movable-view` | `<p-draggable :axis="'both'">` | 同上 |
| `wx.login` | `useAuth().login()` | 非微信端走 OAuth/验证码 Backend |
| `wx.scanCode` | `useNative().scanQR()` | 车机 Tier 2 → `@conditional` 降级 |

---

## 10. LLM 自检清单（生成后逐条打勾）

```
[ ] 所有颜色均来自 design-tokens.json（grep 无杂色 hex）
[ ] 所有间距/圆角取自 Token scale
[ ] max-width:1180px + padding:0 24px 容器
[ ] 820px 断点单栏处理
[ ] 深色主题，无浅色主体
[ ] Hero h1 含渐变 <em>，eyebrow 用 brand2
[ ] slogan 精确："One semantic model. Any engine — at every layer."
[ ] 无 wx.*/uni.* 作为首选示例（仅附录）
[ ] 含 pw3-backend-map（多后端剖面）
[ ] 交互 Demo 满足"源码不变/Backend 切换"不变式
[ ] IR 面板随选择实时更新
[ ] 对标表每行有 evidence 链接
[ ] 原生/Flutter/Skia 标 RECORDED ON DEVICE
[ ] Tier 2 降级有显式提示
[ ] 引用 plan ID（G-27~G-32）
[ ] 单文件可双击运行，无外部未声明依赖
```

---

*本文件与 `.llmrules`、`design-tokens.json`、`verify-llm.js` 构成官网 LLM 可执行规则集。*
*Architecture: `@proteus/architecture` · Plans: 49 · Website v3 · 2026-09-02*
