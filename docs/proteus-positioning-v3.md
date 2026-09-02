# Proteus — 跨端应用框架定位（positioning）

> **Status: v3 — 45 份 plan + 1 规约（截至 2026-09-02）**
> **Slogan: One semantic model. Any render engine. Zero native glue.**

---

## 1. 一句话定位

**Proteus 是一个"渲染引擎无关、原生能力即语义"的跨端应用框架：用统一的上层语义模型描述 UI 与系统能力，通过可插拔的渲染后端（Rendering Backend）自由接入 Vue DOM、Flutter/Skia、原生 UIKit/Jetpack/ArkUI、Canvas、SSR 等任意底层引擎；通过可插拔的原生后端（Native Backend）把相机、定位、扫码、分享、通知等系统能力收敛为统一的语义接口——底层引擎自由插拔，系统能力零封装调用，同一份业务代码按页面选择最优渲染底座。**

它不是"又一个跨端方案"，而是**跨端框架赛道的方法论跃迁**：

- 不做"自绘 vs 原生"的二选一，而是**让两者共存、按需切换**；
- 不把布局算法、渲染引擎锁死在框架内部，而是把它们下沉为**可替换的后端实现**；
- 不止解决"多端跑起来"，而是把**系统级能力（玻璃、安全区、柔性布局、自适应容器、系统集成、原生能力）统一语义化**；
- **更进一步：99% 的业务场景，开发者不需要手写任何原生插件或原生代码。**

---

## 2. 我们处在什么位置

```
                    自绘一致性        原生体验        系统能力        引擎自由        原生能力零封装
Flutter    ───────────────────────────────────────────────────────────
RN         ───────────────────────────────────────────────────────────
uni-app    ───────────────────────────────────────────────────────────
Lynx       ───────────────────────────────────────────────────────────
Proteus    ───────────────────────────────────────────────────────────
```

**关键差异**：Proteus 是唯一一个**同时覆盖"原生体验 + 系统能力 + 引擎自由 + 原生能力零封装"**的框架。

---

## 3. 设计原则（摘要）

| 编号 | 原则 |
|------|------|
| #1 | 单一事实源（SFC + 路由表 + Design Token） |
| #2 | 语义收敛，原生实现（框架定义 *做什么*，后端决定 *怎么做*） |
| #3 | 编译期优先于运行期 |
| #4 | 降级不崩溃（L3→L2→L1→solid） |
| #5 | 开发者只写一次，五端自适应 |
| #10 | **统一语义 + 后端实现（可插拔后端的 methodology 根基）** |
| #10.7 | 视觉能力走 Glass 分层（L1/L2/L3） |
| #10.8 | 语义原语须对应至少一个 OS 原生能力 |
| #10.9 | 断点模型覆盖全部输入形态（touch/cursor/remote/dial/voice） |
| #10.10 | **后端抽象同时覆盖"渲染"与"原生能力"两大领域** |
| #11 | 核心能力实现为 Compiler Plugin（dogfooding） |
| #12 | AI Agent 产物须通过编译期强制校验 |

---

## 4. 架构分层

```
┌─ 应用层（业务）         SFC / 路由 / 状态 / 页面
│
├─ 语义层（框架核心）     p-* 原语 / LayoutConstraint IR / Semantic IR
│                         Glass / SafeArea / Fluid / Adaptive / System / Native
│
├─ 编译层                Compiler + Plugin API (G-21)
│                         Style Safety / FLD / CSS 矩阵 / Capability 检查
│
├─ 后端抽象层            ┬─ ProteusRenderBackend SPI  ← G-27（渲染）
│                         └─ ProteusNativeBackend  SPI  ← G-28（原生能力）
│                         BackendCapabilities / conformance test
│
└─ 后端实现（可插拔）    ┬─ VueDom / Flutter / Native / Skia / Headless
                          └─ iOS / Android / Harmony / Web / Mock
```

**核心洞察**：框架通过 IR 层只描述"要什么"（一个 200pt 圆角 12 的毛玻璃卡片、一次 QR 扫码调用），后端决定"怎么做"（UIView cornerRadius 还是 Skia RoundedRect、AVCapture 还是 CameraX）。**两套后端共用同一套 SPI 方法论，这正是"天然适配任意渲染引擎 + 任意原生能力"的来源。**

---

## 5. 杀手特性

### 5.1 系统级玻璃材质（G-07）

`<pg-glass>` 单一入口，preset 驱动。iOS 映射 `UIGlassEffect`（含灵动岛 `containerRelativeAnchor` 自动融合）、鸿蒙 `fractal`、Android `RenderEffect`、Web/Skyline `backdrop-filter`。**五端能力分 L1（必达）/L2（尽力）/L3（系统级）三档，降级不崩溃。**

### 5.2 柔性布局，不是 rpx（G-22）

rpx 是"单位换算"（数值等比缩放，结构不变）；Proteus 把 **iOS `UICollectionView` / Android `GridLayoutManager` / 鸿蒙 `Grid` / CSS Grid 的系统级布局能力**收敛为 `p-grid` / `p-fluid` / `p-stack` / `p-fit`。屏幕越宽自动排越多列，折叠屏展开、窗口拖拽实时 reflow。

### 5.3 自适应容器（G-22.5）

`p-adaptive` 让弹窗**整个形态**随宽度切换：`sheet(0,600) | dialog(600,840) | popover(840,∞)`，映射各端原生容器（`UISheetPresentationController` / `BottomSheetDialog` / `UIPopoverPresentationController`）。开发者只写一次。

### 5.4 全终端柔性架构（G-25）

三维断点模型 **W × H × F**（宽度 × 高度 × 输入形态），覆盖手机/平板/PC/车机/TV/手表：

| F | 设备 | 关键能力 |
|---|------|---------|
| touch | 手机/平板/车机 | 基础 |
| cursor | PC/车机副屏 | 鼠标键盘 |
| remote | **TV** | **焦点引擎（UIFocusSystem / Leanback）** |
| dial | **手表** | **表冠 + 并发症** |
| voice | 车机 | 语音导航 |

### 5.5 AI Agent 自动接入（G-23）

在 Compiler Plugin 暴露的 `LayoutConstraint` IR 上操作（**非字符串正则替换**）：识别 `width:320px` / `@media` → 生成 `p-fluid` → 经 FLD + Style Safety 校验 → 合法才写回。AI001-005 约束，信任分级（generate 自动 / migrate PR / refactor 审批）。

### 5.6 业务开发效率（G-26）

把"决策 / 适配 / 校验 / 修复"四类高成本工作从开发者下沉到框架：决策由柔性原语收敛、适配由 p-adaptive 自动化、校验由编译期强制（FLD/CSS/GLS/NAT）、修复由 AI Agent 闭环。**竞品缺整套约束体系，所以 AI 只能猜、校验只能靠人。**

### 5.7 渲染底座自由（G-27）

**Proteus 不自研布局算法、不自研渲染引擎，而是构建一个渲染后端无关的上层模型。** 通过统一 SPI `ProteusRenderBackend`，五个官方后端可插拔：

| 后端 | 实现路径 |
|------|---------|
| VueDom | `createRenderer(nodeOps)` 零成本复用 |
| Flutter | Flutter Embedder C ABI |
| Native | nodeOps → UIKit / Jetpack / ArkUI |
| Skia | Canvas / WebGL 自绘 |
| Headless | SSR / 测试 / AI Agent 无设备回归 |

**同 App 不同页面用不同引擎**：商品详情 → Native（体验优先）、品牌动效 → Flutter（一致性）、数据大屏 → Skia（高频绘制）、H5 落地页 → Vue DOM（Web 生态复用）。业务代码完全一样，运行时加载不同 Backend。

Flutter 换不了 Skia，RN 换不了原生——**只有"上层模型 + 可插拔后端"这条路线能做到渲染引擎自由。**

### 5.8 原生能力即语义：99% 零原生代码（G-28）★ 与 5.7 同层级

**传统跨端框架要求开发者自己封装原生插件（写 Swift/Kotlin/Java 桥接 + 三端各一份 + 维护 bridge）；Proteus 把 G-27 的 SPI 方法论从"渲染"泛化到"一切原生能力"——开发者调语义接口，原生实现由 Backend 提供，业务代码零原生。**

```ts
const native = useNative()
const { text } = await native.scanQR()   // ← 完了，iOS/Android/鸿蒙全端可用
```

**99% 覆盖的帕累托结构：**

| 层 | 内容 | 覆盖 | 开发者写原生？ |
|----|------|------|---------------|
| L1 内置 | Top 30 能力（相机/定位/扫码/分享/通知/存储/蓝牙/NFC/生物识别…） | 80% | ❌ 零 |
| L2 官方 Backend | 平台 SDK 直映射（独立包按需安装） | +18% | ❌ 零（SDK 作者写） |
| L3 社区包 | 生态贡献，签名审计 | +1.9% | ⚠️ 社区写，业务不用 |
| L4 自定义 | 仅长尾 | 0.1% | ✅ 兜底 |

Compiler 扫描 `app.config.ts` 的 `capabilities` → **自动生成** iOS `Info.plist` / Android `AndroidManifest.xml` / 鸿蒙 `module.json5` 权限声明——**杜绝运行时才发现漏配权限**。

uni-app 插件市场"找插件碰运气"、RN/Flutter "写 MethodChannel/Native Module"——**只有"语义接口 + 官方 Backend"这条路线能做到原生能力零封装。**

### 5.9 与 DSL 映射方案的本质差异（方法论总结）

普通 DSL 映射 = **语法翻译**（DSL → Swift/Kotlin，无 IR、映射硬编码、无约束系统、渲染后端绑定）；Proteus = **语义收敛 + 后端映射**（IR 是平台无关的"要什么"，渲染走 `ProteusRenderBackend`、原生能力走 `ProteusNativeBackend`，均动态基于能力匹配）。**前者是"换语言写原生"，后者是"定义语义、让任何后端实现它"。**

---

## 6. 对标矩阵（核心差异）

| 维度 | uni-app | React Native | Lynx | Flutter | **Proteus** |
|------|---------|--------------|------|---------|-------------|
| 渲染底座 | WebView | 原生 | 自绘+原生 | Skia（锁定） | **可插拔（Vue/Flutter/Native/Skia）** |
| 同 App 多后端 | ❌ | ❌ | ❌ | ❌ | **✅ 按页面切换** |
| 接入 Flutter/Skia | ❌ | ❌ | 部分 | 原生 | **✅ SPI 标准后端** |
| 不自研渲染引擎 | — | — | — | ❌ 锁死 Skia | **✅ 设计前提** |
| 玻璃材质 | 模拟 | 模拟 | 模拟 | Material | **系统级（L1/L2/L3）** |
| 布局适配 | rpx（单位换算） | LayoutBuilder | 条件分支 | AdaptiveScaffold | **系统级柔性布局（p-*）** |
| 弹窗适配 | 手动判断 | 手动选 | 手动 | Material 规范 | **p-adaptive 自动切形态** |
| 车机 | ❌ | ❌ | ❌ | ⚠️ | **✅ driving-safe** |
| TV 焦点 | ❌ | ⚠️ keyCode | ❌ | ⚠️ | **✅ 焦点引擎语义** |
| 手表 | ❌ | ❌ | ❌ | ⚠️ | **✅ 表冠 + 并发症** |
| 手写原生插件 | 找插件/自己写 | **必须写 Native Module** | 部分 | **必须写 Plugin** | **✅ 99% 零原生代码（G-28）** |
| 原生能力接入 | 插件市场（质量不一） | MethodChannel | 有限 | Platform Channel | **语义接口 + 官方 Backend** |
| 权限声明 | 手动配 | 手动配 | 手动 | 手动 | **Compiler 自动生成** |
| AI 自动布局 | ❌ | ❌ | ❌ | ❌ | **✅ IR 操作 + 强制校验** |
| 编译期校验 | ❌ | ❌ | ⚠️ | ⚠️ | **✅ FLD/CSS/GLS/NAT 铁律** |
| DSL 映射 vs 语义 IR | DSL→原生（翻译） | 翻译 | 翻译 | Skia 绑定 | **语义 IR + 双 SPI** |

**结论**：竞品缺的不是某个 API，而是"显式语义 + 可编程 IR + 后端原生映射 + 强制校验"这套方法论。Proteus 从 G-01 一路搭建到 G-28，恰好把这四者全部建好——并且**把这套方法论同时应用到了"渲染"与"原生能力"两大领域**，这是任何其他框架都没有做到的。

---

## 7. 与原则 #10 的同构性

| 能力 | 语义原语 | 后端映射 |
|------|----------|----------|
| 玻璃 | `<pg-glass>` | UIGlassEffect / fractal / RenderEffect |
| 安全区 | `<p-safe-*>` | safeAreaInsets / WindowInsets |
| 网格 | `<p-grid>` | UICollectionView / GridLayoutManager |
| 弹窗 | `<p-modal>` | UISheet / BottomSheet / Popover |
| **渲染** | **Render IR (node tree)** | **VueDom / Flutter / Native / Skia** |
| **原生能力** | **Native IR (capability)** | **iOS / Android / Harmony / Web** |

**G-27 + G-28 = 原则 #10 的完全兑现**：把"语义收敛 + 后端实现"从 UI 能力推广到**渲染层**与**原生能力层**——框架核心只定义"要什么"，所有"怎么做"都下沉为可插拔、可替换、可 conformance-test 的后端。

---

## 8. 严格规则（摘要）

| 规则 | 级别 | 说明 |
|------|------|------|
| FLD001-006 | error/warning | 禁用硬编码断点、手写媒体查询、`Dimensions.get` |
| CSS017/018 | error | 禁用 `backdrop-filter` 裸写、无障碍缺失 |
| GLS001-006 | error | Glass 须通过 `<pg-glass>` 入口 |
| AI001-005 | error/warning | Agent 产物须过 `--strict-css` + FLD |
| PRIM001-005 | error | 禁止手动 `if (isDesktop)` |
| VEH001 / TV001 / WATCH001 | error | 车机 driving-safe / TV focus-mode / 手表单列 |
| **RND001-005** | **error** | **禁止绕过 Render SPI 直调渲染引擎；后端须通过 conformance test** |
| **NAT001-005** | **error** | **禁止绕过 Native SPI 直调原生 SDK；Backend 须三端实现 + 签名审计** |

---

## 9. 规划体系（45 份 + 1 规约）

```
基础设施    G-01~G-06, G-21       Compiler / Plugin / Memory / IFR
架构方法论  G-07, G-27, G-28       Glass / ★ 可插拔渲染后端 / ★ 可插拔原生后端
应用能力    G-11~G-16             Memorial / Skeleton / Theme / Font / Cache / Style Safety
工程化      G-17~G-19             Router / CLI / DevTools
布局体系    G-22, G-22.5          Fluid Layout / Adaptive Container
语义层      G-24, G-25            语义原语全景 / 全终端（车机·TV·手表）
AI          G-23                  AI Agent 自动接入
效能        G-26                  业务开发效率
```

**架构级方法论层（7 份）**：G-22 / G-22.5 / G-24 / G-25 / G-23 / G-27 / G-28——它们先于具体 plan，是整套体系的地基。其中 **G-27（渲染）+ G-28（原生能力）** 是层级最高的两条，定义了 Proteus 与所有竞品的本质区别。

---

## 10. 对外话术（可直接引用）

1. **"uni-app 的 rpx 还在单位层打转，Proteus 已经把 iOS/Android/鸿蒙的系统级布局引擎搬进了框架。"**
2. **"Flutter 锁死 Skia，RN 锁死原生——Proteus 是唯一支持同 App 原生/自绘混合的跨端框架。"**
3. **"uni-app 靠插件市场碰运气，RN/Flutter 要手写 Native Module——Proteus 让 99% 的业务场景零原生代码。"**
4. **"竞品缺的不是 AI 模型，而是显式约束 + 可编程 IR。Proteus 把这二者都建好了，所以 AI 能安全自动写布局。"**
5. **"Proteus 不自研渲染引擎、不要求开发者封装原生插件——它构建的是一个渲染引擎与原生能力都可插拔的上层语义模型。"**
6. **"普通 DSL 映射是'换种语法写原生代码'；Proteus 是'定义语义，让任何后端实现它'——这是语法翻译与架构方法论的代际差。"**

---

## 11. 路线图（M1 建议）

```
G-22 clamp 算法 + 断点推导              ← 零依赖可单测（已验证）
G-21 Compiler Plugin API                ← IR 可编程访问
G-27 ProteusRenderBackend SPI           ← ★ 先于各端 Backend 落地（B1）
G-28 ProteusNativeBackend SPI           ← ★ 与 G-27 同批，双 SPI 一套方法论（B1）
G-23 Agent Core + 2 个工具              ← 串起 Plugin + clamp
G-24 B1 桌面交互原语                    ← p-hover / p-shortcut
G-25 B1 三维断点 + 焦点引擎             ← resolveProfile(W,H,F)
G-26 度量基建 + 同需求对照实测
Performance / Website Playground
```

---

## 12. 配套资产

- `proteus-architecture`（规约，含铁律总表）
- `proteus-devtools-vue-devtools/`（G-19）
- `proteus-fluid-layout/`（G-22）
- `proteus-adaptive-container/`（G-22.5）
- `proteus-ai-fluid-agent/`（G-23）
- `proteus-semantic-primitives/`（G-24）
- `proteus-device-adaptation/`（G-25）
- `proteus-dev-efficiency/`（G-26）
- `proteus-render-backend/`（G-27，含 Render SPI + 五后端 + conformance test）
- **`proteus-native-backend/`（G-28，含 Native SPI + Top30 清单 + 权限自动生成）**

---

## 13. 结语

> **Proteus — One semantic model. Any render engine. Zero native glue.**
> 一套语义，任意渲染引擎，任意原生能力，全终端自适应，99% 业务场景零原生代码。

---

*Status: v3 — Plans: 45 / 规约: 1 / 最后更新: 2026-09-02*