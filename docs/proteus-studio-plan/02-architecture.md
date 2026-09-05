# G-56 架构：能力边界矩阵

> 核心原则：**自研编排，集成组件。**
> 判断依据不是"能不能做"，而是"做了会不会掉进维护陷阱"。

---

## 1. 能力边界矩阵（本份最重要的表）

| 模块 | 决策 | 选型 | 决策依据 |
|------|------|------|---------|
| **编辑器内核** | 🚫 **绝不自研** | **CodeMirror 6** | xi-editor 已死、Lapce 仍在 pre-alpha、Floem IME 不可用 |
| **终端** | 集成 | **xterm.js + portable-pty** | Terax（Tauri 2）已上线；`tauri-plugin-pty` 现成 |
| **模拟器嵌入** | 集成 | **libmpv**（`--wid` / 离屏 FBO） | mpv-tauri 三平台实证 |
| **GUI 框架** | 🚫 **绝不自研** | **Tauri 2**（系统 WebView） | Lapce 自研 Floem 两年未发新版 |
| **应用壳** | ✅ 自研 | Tauri 2 + Rust | 这是本份的主体 |
| **面板 UI** | ✅ 自研 | Web 技术栈 | 需要画布时（依赖图、视频流） |
| **编排层** | ✅ 自研 | Rust | 宿主特有，无可集成 |
| **知识内核** | ♻️ **复用** | G-55 FrameworkKnowledgeProvider | **零改动**（架构试金石） |
| **设备桥** | ♻️ **复用** | G-53/G-54 DeviceBridge | 仅加双通道扩展 |
| **移动端伴侣** | ✅ 自研 | Tauri 2 mobile | 三个宿主做不到的独特价值 |

**统计**：自研 4 项 / 集成 3 项 / 复用 2 项 / 禁区 2 项。

---

## 2. 为什么是 CodeMirror 6 而不是 Monaco

| 维度 | CodeMirror 6 | Monaco |
|------|--------------|--------|
| 体积 | **~50 KB** | 2-5 MB |
| 移动端 | ✅ 可运行 | ❌ 不支持 |
| 框架耦合 | 无 | 与 VSCode 强耦合 |
| 生产验证 | Replit 生产环境 | VSCode |

**决定性因素不是体积，是移动端。** Monaco 在手机上跑不了，而**移动端伴侣是本份的独特价值**（见 05 号文档）——选 Monaco 等于提前放弃这条。

> 顺带呼应 G-55 的 Web 兜底档：CodeMirror 6 同时用于 Studio 和 Web 版 DevTools，**一份代码两处用**。

---

## 3. 为什么是 Tauri 2 而不是 Electron

### 3.1 性能数据（2026-07 独立复测，框架级）

| 指标 | Tauri 2.x | Electron 34 |
|------|-----------|-------------|
| 空包体积 | **3.2 MB** | 85 MB |
| 冷启动 | **380 ms** | 1420 ms |
| 空闲内存 | **42 MB** | 168 MB |
| IPC 往返 | **0.12 ms** | 0.45 ms |

### 3.2 决定性因素：移动端

| | Tauri 2 | Electron |
|--|---------|----------|
| iOS / Android 目标 | ✅ | ❌ |

**性能是加分项，移动端是入场券。** 三个宿主都上不了移动端，这是 Studio 存在的最大理由。

### 3.3 ⚠️ Linux 是 Tauri 的软肋（必须前置）

| 问题 | 说明 |
|------|------|
| NVIDIA + WebKitGTK | **窗口全白**，官方有专门 debug 页 |
| Ubuntu 版本碎片 | 20.04/22.04/24.04 的 webkit2gtk **互不兼容**，4.0 与 4.1 无法同时链接 |
| 社区实测 | 系统代理 403、点击 `<input>` 卡死、`set_position` 失效 |
| **WebGL 静默降级** | Linux 上可能降到软件光栅化，而 WebKitGTK 为防指纹**把 renderer 伪装成 "Apple GPU"**——**检测不出来** |

> **最后一条最危险**：你无法验证的性能，不叫性能。
> 因此 G-56.5 规定：Linux 档默认降级到 Web 版，除非通过实测白名单。

---

## 4. 分层架构

```
┌──────────────────────────────────────────────┐
│ L3  面板 UI（Web 技术栈，自研）                │
│     ├─ 框架知识面板（G-54 六项能力）           │
│     ├─ 设备预览面板（libmpv 画布）             │
│     ├─ 终端面板（xterm.js）                    │
│     ├─ 编辑器面板（CodeMirror 6）              │
│     └─ 断言结果面板（G-54 conformance）        │
├──────────────────────────────────────────────┤
│ L2  编排层（Rust，自研）                       │
│     ├─ 面板布局与状态                          │
│     ├─ 降级决策（嵌入口/平台风险）              │
│     └─ 宿主能力探测                            │
├──────────────────────────────────────────────┤
│ L1  协议层（复用 G-54/G-55）                   │
│     LSP / DAP / 自研 RPC / DeviceBridge       │
├──────────────────────────────────────────────┤
│ L0  内核（复用 G-55，★ 零改动）                │
│     FrameworkKnowledgeProvider                │
└──────────────────────────────────────────────┘
```

**L0 零改动是本份的架构断言**（INV-ST-01）。

---

## 5. 四个宿主的统一契约

```typescript
interface HostAdapter {
  readonly id: 'vscode' | 'intellij' | 'zed' | 'studio'
  readonly capabilities: HostCapability[]
  supports(cap: HostCapability): boolean
  // 能力缺失 → DEGRADED，不崩溃（G-51 INV-02 精神）
}

type HostCapability =
  | 'panel.custom'        // 自定义面板
  | 'panel.embeddedCanvas' // 面板内嵌画布（视频流）
  | 'button.custom'       // 自定义按钮
  | 'console.custom'      // 控制台自定义
  | 'device.native'       // 原生设备嵌入
  | 'form.mobile'         // 移动端形态
```

**能力矩阵真值表**（实测，非推断）：

| capability | vscode | intellij | zed | studio |
|-----------|--------|----------|-----|--------|
| panel.custom | ✅ | ✅ | ❌ | ✅ |
| panel.embeddedCanvas | ✅ | ✅ | ❌ | ✅ |
| button.custom | ✅ | ✅ | ❌ | ✅ |
| console.custom | ✅ | ✅ | ❌ | ✅ |
| device.native | ⚠️ 自绘 | ⚠️ 自绘 | ❌ | ✅ libmpv |
| form.mobile | ❌ | ❌ | ❌ | ✅ |

**Studio 在 device.native 是唯一 ✅**，在 form.mobile 是唯一 ✅——这就是它存在的理由。

---

## 6. 降级链（延续 G-53/G-54 五档，宿主侧对称）

```
studio-embedded (libmpv --wid / 离屏 FBO)
   ↓ Wayland 或嵌入失败
studio-window   (独立窗口，mpv 自绘)
   ↓ 平台不支持
web             (浏览器打开，CodeMirror 6 + MJPEG)
   ↓ 无浏览器
headless        (CLI，仅断言结果，无画面)
```

**纪律**：每一档返回 `DEGRADED` 并标注原因，**不判 FAIL、不阻断 CI**。

---

## 7. 架构试金石（延续 G-55，加强版）

```
步骤 1  记录内核 apiSurface 快照 S1（三宿主已完成时）
步骤 2  新增 Studio 适配器（只写 L2/L3，不碰 L0）
步骤 3  记录 apiSurface 快照 S2
断言：S1 === S2
```

**为什么自有宿主比第三方适配器更能暴露问题**：

> 自有宿主最容易产生"给它开个后门"的诱惑——"反正都是我们的代码"。
> **恰恰是这种情形，最能验证分层是否真的做对了。**

这条断言在 `reference-impl.cjs` 中可运行验证。
