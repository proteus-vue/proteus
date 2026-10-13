# 液态玻璃「对齐 iOS」差距分析（子代理独立调研 · 决策 #909）

> **状态**：**只登记结论，未改代码**（用户 2026-10-13 晚：「把结论记下来今天先不改了，明天再继续」）。
> **方法**：四路子代理**外部干净视角**独立取证——① 内核折射/位移场 ② 内容自适应/兜底 ③ iOS 真值联网调研 ④ 宿主合成/采样链路。
> **触发**：用户真机对照——「我们的折射效果以及玻璃效果和 iOS 差很远；iOS 会根据背景自动加亮色或暗色兜底保证可视性，我们的完全是透明的」。

---

## 〇、结论速览（一句话）

我们的玻璃"看起来纯透明"**不是一个 bug，而是四条叠加的结构性差距**：

1. **中心 100% 平坦**（`prof=0`）＋ **完全没有背景模糊**（单次采样）⇒ 在纯色/浅底上，玻璃**逐像素等于不存在**，只剩边缘一条发丝亮边。
2. **"自适应"只有逐像素单点亮度仿射**，**没有区域级背景估计** ⇒ 无法像 iOS 那样"整块翻成浅霜/深霜"。
3. **描边恒为"加白"** ⇒ 亮底上"白上加白" ⇒ 轮廓**消失**（这正是"完全是透明的"的主因）。
4. **折射位移量级被钉死且偏小**（≈最短边的 7.4%）＋ **输入降采样三端不一致**（2/3/1·2·4）丢高频 ⇒ "无高频可弯折"，折射感弱。

而 **iOS 的自适应核心是"亮度/对比度"，不是"折射"**（官方原文见 §三）——两件事必须分开做。

---

## 一、内核折射/位移场（子代理·角度①）

真源 `packages/shader-codegen-rust/src/materials/glass.wgsl`（CPU oracle `reference.rs` 同源）。

### 关键数值（按真源公式手算）

| 量 | 公式 | 130×130 盒 | 1170×150 条（≈iPhone tab bar） |
|---|---|---|---|
| `band`（折射带） | `max(hsmin·0.33, 6)` = **0.165·min(w,h)** | 21.45 | 24.75 |
| `strength` | `clamp(refract_depth/(hsmin·0.44))` | **1.0（代数恒等）** | **1.0** |
| 峰值位移 `bend` | `0.45·band` = **0.074·min** | 9.65 px | 11.1 px |
| 位移/带宽比 | 0.45（**<1，永不折叠**） | — | — |
| 亮边宽 | `0.35·band` | 7.5 px | 8.7 px |
| 采样 | **1 次 `textureSample`（零模糊）** | — | — |
| `saturation` | 原生默认 | **1.0**（且先前 12% 去饱和） | 1.0 |

### 五条差距

- **G1 中心平坦 ⇒ 亮底隐形**：`prof = 1 − smoothstep(0,1,e)`，`e≥1`（`d≥band`）恒为 0 ⇒ 中心区**逐像素 = 无玻璃**，只叠加亮度仿射（白底压到 ~0.75）。iOS 的材质中心也始终有"基座模糊 + 整体 tint"。
- **G2 位移 < 带宽，永不折叠 ⇒ 无"透镜弯折"**：峰值 `0.45·band` 且 `prof` 单调向外 ⇒ 只是背景**平滑外扩**；真透镜需峰值 **≥ 带宽**（出现压缩/漩涡/非单调采样）。
- **G3 带宽口径疑似差 2×**：注释自称"条高 1/3"，代码 `hsmin·0.33 = 0.165·min` = 最短边的 **1/6**。若按注释应 `0.33·min`（带宽与位移峰值一起被砍半）。
- **G4 无背景模糊 ⇒ 读作"透明贴纸"**：`u.blur` 是**死 uniform**（`glass.wgsl` 不读，只有一行过时注释）；玻璃材质内无任何模糊核（模糊在独立的 `backdropBlur/frosted/vibrancy` 材质里）。背景锐利 ⇒ 观感是"没遮罩的色偏"。
- **G5 `refract_depth` 是死旋钮**：宿主传 `min(w,h)·0.22` 恰等于分母 `hsmin·0.44` ⇒ `strength≡1.0`，且 `clamp(...,0.5,2)` 兜底 ⇒ **任何调参都改不动折射**。

### 其他

- **边缘高光是发丝级且依赖朝向**：`bevel_mask` 只在 `e<0.35`（≈7–9px），`specular` 项 `pow(facing,6)` 极窄。
- **原生端缺 iOS 的饱和提升**：iOS `.regular` 是 `blur + saturate(~1.8)`（本仓 `degrade.ts:12` 的 `CSS_SATURATE=1.8` **只补给了 Web/MP CSS 路径**，原生自绘拿不到）⇒ 玻璃偏灰。
- **parity 门禁只证"三端自洽"**：`check-glass-pixel-parity` 比的是 Metal 落地 == Rust oracle（同源于一份 WGSL）⇒ **只能证明"移植没错"，不能证明"像 iOS"**（与 AGENTS.md「三端自洽 ≠ 标准真值」同源）。

---

## 二、内容自适应/可视性兜底（子代理·角度②）

### 现状清单

| 能力 | 有没有 | 层级 |
|---|---|---|
| 逐像素亮度仿射（暗底提亮/亮底轻压） | ✅ 有（决策 #908） | 内核 `glass.wgsl:129-131` |
| 该仿射的输入 | ⚠️ **仅单像素** `lum` | 内核 `glass.wgsl:112`（非区域统计） |
| 兜底可见性（发丝亮边+顶光） | ⚠️ **有但恒为加白** | 内核 `glass.wgsl:140-144` |
| **背景区域亮度/对比度估计** | ❌ 无（三端宿主零统计） | — |
| **浅霜/深霜整体切换** | ❌ 无 | — |
| **自适应描边（亮底→暗线，暗底→亮线）** | ❌ 无（描边恒白） | — |
| **前景内容对比保护** | ❌ 无 | — |
| Web/MP 等效自适应 | ❌ 完全无 | `degrade.ts:56-75` 仅 `blur+saturate+静态 tint` |

### 关键差距

我们**有**一种自适应，但形态是"**内核层、逐像素、单点**亮度仿射"，**只与"该像素正后方那一格"有关**；iOS 是"**区域估计 → 全局亮暗基调切换 + 自适应对比描边 + 前景保护**"四件套，我们全缺。

### 亮底为何"隐形"（主因链）

`lum=1` ⇒ `target_l=0.71` ⇒ 只把 1.0 压到 ~0.75（`d_aff≈−0.25`，仍浅）；同时 `edge_hi/rim` **加白**且 `min(...,1.0)` 饱和 ⇒ **边缘与白底零对比** ⇒ 轮廓消失。**亮底上"既压不暗、又加不亮"（白上加白）= 用户看到的"完全透明"。**

---

## 三、iOS 真值调研（子代理·角度③ · 联网官方取证）

### 官方明确事实（附原文摘录）

**1）`.regular` vs `.clear`（WWDC25 Session 219 / HIG Materials）**
- regular：**"blurs and adjusts the luminosity of background content to maintain legibility"**（模糊并**调节背景内容亮度**以维持可读性）；"all the visual and **adaptive** effects"；任意尺寸、可叠任何内容之上。
- clear：**"does not have adaptive behaviors"**，永久更透明；需要 **dimming layer**（HIG：亮底建议 **35% 压暗层**）；仅用于"媒体丰富内容 + 前景粗亮"三条件同时满足时。

**2）随背景自适应 = 官方"是"（WWDC219 / HIG）**
- **"each layer continuously adapts based on what's behind it"**（不像旧材质有固定明暗外观）。
- 小元素（navbar/tabbar）**"flip from light to dark based on the background"**；大元素（menu/sidebar）**不翻转**（"表面太大，翻转会分散注意"）。
- **"the amount of tint and the dynamic range shift to always ensure buttons remain legible"**。
- 滚动：**"as text scrolls underneath, shadows become more prominent"**；**"when darker content scrolls under … the effect intelligently switches to a subtle dimming"**。
- 图标/文字**"flip from light to dark … mirroring the glass's behavior"**。
- visionOS（最直白）：**"glass automatically adapts to the luminance of the objects and colors behind it"**。
- 尺寸调制（WWDC284）：**"Glass adapts the appearance based on its size. A larger size is more opaque. A smaller size is clearer, and switches between light and dark mode automatically."**

**3）折射/lensing（WWDC219）**
- **"dynamically bends, shapes, and concentrates light in real time"**。
- **"picking colors from nearby content … achieved by sampling content from an area larger than itself"**（★**采样比自身更大的区域** —— 折射实现的官方线索）。
- 尺寸越大 ⇒ **"more pronounced lensing and refraction effects"**。

**4）容器/融合（`UIGlassContainerEffect` / `GlassEffectContainer`）**
- 多玻璃合成一个效果；间距变小 ⇒ **"merging like small droplets of water"**；**"enforces a uniform adaptation"**；**"share their sampling region"**（共享采样区）。

### 判定

- **"自动亮暗兜底" = 官方明确"是"**，且是 regular 的**分层自动行为**（明暗翻转 / tint 与动态范围随背景 / 阴影随内容 / 滚动时压暗）。clear 不自动（需手动压暗层）。
- **"折射只边缘、中心透过" = 官方无明文，强推断**：官方仅 HIG 示意图措辞 **"a subtle bend in the edges"** + 图标语境把边缘处理叫 **"specular highlight"**；三份第三方复刻（kube.io / specy.app 等）一致建模为"**边缘 bezel 内位移折射 + 中心平面**"。**不宜当官方断言。**
- **关键澄清**：**自适应（亮度/对比）与折射（lensing）是两条独立通路**——我们两条都缺，且**先补齐"亮度/对比自适应"**（官方明确、见效快、解决"透明"）。

### 未找到权威来源的点（勿编造）
- "折射只在边缘"无官方原文；区域亮度估计的**算法/阈值/频率**未公开；大小元素翻转的**分界**未公开；"adjusts luminosity"是改自身还是改背景未澄清。

---

## 四、宿主合成/采样链路（子代理·角度④）

### 三端降采样/输出对照（均未对齐）

| 维度 | Android | iOS | Harmony |
|---|---|---|---|
| 输入降采样 | `DIV=2` → 2 设备px/纹素 | `capturePxPerPoint=scale/3` → 3px | `S`：≥512→4；≥256→2；否则→1 |
| 着色器过滤 | `FILTER_MODE_LINEAR` | **采样器未绑定**（见 D2） | `VK_FILTER_LINEAR` |
| 输出分辨率 | **全分辨率** | `scale/2` 再放大 | `1/S` 再放大 |

### 三条差距

- **D1 输入降采样三端不一致（2/3/1·2·4）** ⇒ 同玻璃在不同端锐度差 1.5–2×，且 Harmony 随尺寸跳变。高频（线稿/文字边）**进着色器前已被低通** ⇒ 位移场只剩平滑色块可弯 ⇒ 观感"糊/透明"。**主因放大器。**
- **D2 ★iOS 采样器未绑定（结构性缺口，三端唯一）**：`glass-metal.swift` **全文无 `setFragmentSamplerState`**（只绑 texture0/buffer0），而 MSL 按参数顺序期望 sampler@0 ⇒ 采样器**未定义状态**（可能 nearest/clamp-zero）。与 Android/Harmony 显式 LINEAR 不一致。**需真机验证其对观感的实际影响。**
- **D3 输出分辨率不对齐**：iOS/Harmony 输出降采样再放大 ⇒ 边缘高光/内缘亮线（玻璃"材质身份"来源）被放大糊化。

### 顺带核实（几何/单位）
- **U0（台账已登记）**：Android `applyOps` 二进制指令值**不乘密度** ⇒ 经 applyOps 改几何的玻璃节点/胶囊按 1/density 绘制（静态 mount 正确）。**玻璃盒几何同样中招**。
- **新隐患**：玻璃 pass 直接按 `c.x/c.y` 画、**不走节点的 translate 动画层**（`ProteusHostView.java:3468-3482` 只做 scroll/fixed 补偿）⇒ 玻璃面可能**不随节点平移动画移动**。

---

## 五、差距清单（按"最可能是主因"排序 · 供明天排期）

| 优先级 | 差距 | 归属 | 说明 |
|---|---|---|---|
| **P0** | **亮底轮廓消失（描边恒白）+ 中心平坦** | 内核 | 直接解释"完全透明"；补"自适应描边极性 + 中心基座（微模糊/整体 tint）" |
| **P0** | **无背景模糊** | 内核 | 单次采样；补一个轻量基座模糊 |
| **P1** | **无区域级背景估计 → 浅霜/深霜切换** | 内核+宿主+材质 | 需新增区域亮度 uniform + 宿主统计；对齐 iOS"据背景亮度选明暗" |
| **P1** | **位移量级偏小 + 带宽口径疑似差 2×** | 内核 | 峰值 0.45·band→≥1×；`band` 口径核对（0.165·min vs 注释的 1/3） |
| **P1** | **`refract_depth` 被归一化旁路（调参无效）** | 内核 | 去掉/放宽 `strength` 归一 |
| **P2** | **iOS 采样器未绑定** | iOS 宿主 | 加 `setFragmentSamplerState`（LINEAR+CLAMP） |
| **P2** | **三端降采样/输出不对齐** | 三端宿主 | 统一"输入 ≤2×、输出全分辨率"为基准 |
| **P2** | **原生缺 saturate(~1.8)** | 内核/材质 | 补通透感 |
| **P3** | **前景对比保护** | 全栈 | 玻璃明暗变化时校验/补偿前景色 |
| **P3** | **Web/MP 零自适应** | 降级层 | CSS 侧按背景切换 tint/描边 |
| **P3** | **U0 单位 + 玻璃不随 translate 动画** | 宿主/内核 | 见 §四 |

---

## 六、可验证假设（明天先跑量化的）

- **H1（亮底边缘对比=0）**：Rust oracle 喂**纯白背板**，测玻璃边缘带 `ΔL_edge` ⇒ 预期≈0（加白饱和）⇒ 坐实"描边无极性翻转"。对照黑底应 >0。
- **H2（位移不折叠）**：横竖彩条 fixture，检测边缘带内是否出现**非单调采样**（回折/漩涡）⇒ 当前 `0.45<1` 必然无。
- **H3（`refract_depth` 无效）**：宿主传 `2×refract_depth` 重跑，像素不变即证实归一化旁路。
- **H4（降采样影响）**：固定高频 backdrop + 玻璃盒，只改 `DIV`/`capturePxPerPoint`/`S`，测玻璃带内**梯度能量比**（保高频比例）。
- **H5（iOS 采样器）**：Xcode GPU Capture 看 `fs_glass` sampler 状态；或最小 A/B 绑定后对比块状→平滑。
- **H6（saturate）**：`u.saturation` 1.0→1.7 真机 A/B 截图。

> **纪律提醒（AGENTS.md）**：改内核/宿主后**先零设备编译 + CPU oracle**；改 `packages/{compiler,runtime,plugin-vite}` 走 `pnpm test:coupled`；**多端对照以 iOS 液态玻璃为基准（#892）**；`check-glass-pixel-parity` 只证三端自洽，**不可当"像 iOS"的证据**。

---

## 附：主要取证文件

- 内核：`packages/shader-codegen-rust/src/materials/glass.wgsl`（72-95 / 107 / 129-145）、`reference.rs`、`materials/mod.rs`
- 材质真源：`packages/glass/src/{types,presets,resolve,degrade}.ts`（`degrade.ts:12` saturate 1.8）
- 宿主：`hosts/android/.../GlassMaterial.java`、`ProteusHostView.java`（3309-3485）；`hosts/ios/ProteusHost/runtime/glass-metal.swift`（206-250）、`selfdraw-scene.swift`（1086-1165）；`hosts/harmony/.../proteus_render.cpp`（glassPass）
- iOS 真值：WWDC25 219/284/323/361 · HIG Materials · `UIGlassEffect`/`GlassEffectContainer`/`UIGlassContainerEffect` 文档 JSON
