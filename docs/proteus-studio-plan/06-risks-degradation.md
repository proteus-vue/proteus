# G-56 风险与降级

> 原则：**每一条风险都必须有对应的降级路径。**
> 没有降级路径的风险 = 未处理的定时炸弹。

---

## 1. 风险总表

| # | 风险 | 等级 | 降级路径 | 已验证 |
|---|------|------|---------|--------|
| R1 | Linux WebKitGTK 白屏（NVIDIA） | 🔴 高 | → Web 版 | ❌ |
| R2 | WebKitGTK 版本碎片 | 🟡 中 | → Web 版 | ❌ |
| R3 | **WebGL 静默降级** | 🔴 高 | 帧率实测 + honest `unknown` | ❌ |
| R4 | Wayland 下 mpv 嵌入失效 | 🟡 中 | → 独立窗口 | ❌ |
| R5 | mpv 离屏 FBO "非真嵌入" | 🟡 中 | → `--wid` / 独立窗口 | ❌ |
| R6 | iOS 不允许跨 App inspect | 🔴 高 | → companion.sdk | ❌ |
| R7 | Tauri 移动端性能未知 | 🟡 中 | 功能降级 | ❌ |
| R8 | 自研 GUI 的诱惑 | 🔴 高 | **架构禁区，无降级** | ✅ 纪律 |

**R8 是唯一不给降级路径的**——因为它一旦发生，项目就进入死亡螺旋（见 §5）。

---

## 2. R1/R2/R3：Linux WebKitGTK 三连

### 2.1 现象

| 问题 | 表现 |
|------|------|
| NVIDIA + WebKitGTK | **窗口全白**，官方有专门 debug 页 |
| Ubuntu 版本碎片 | 20.04/22.04/24.04 的 webkit2gtk **互不兼容**，4.0 与 4.1 无法同时链接 |
| 社区实测 | 系统代理 403、点击 `<input>` 卡死、`set_position` 失效 |

### 2.2 R3 是最危险的：静默降级

> Linux 上 WebGL 可能**静默降级**到软件光栅化，
> 而 WebKitGTK 为防指纹追踪，**把 renderer string 伪装成 `"Apple GPU"`**——
> **你根本检测不出来。**

**这意味着常规能力探测完全失效。**

### 2.3 缓解方案（非根治）

```typescript
async function probeRenderBackend(canvas): Promise<'hw' | 'sw' | 'unknown'> {
  const fps = await measureFps(canvas, 1000)
  if (fps > 50) return 'hw'
  if (fps < 20) return 'sw'
  return 'unknown'   // ★ 诚实标注，不猜
}
```

**G-56.5**：`unknown` 必须如实上报，**禁止默认当作 `'hw'`**。

这是 G-37「未实测不宣称」在平台探测上的直接应用——**你无法验证的性能，不叫性能。**

### 2.4 降级决策

```typescript
function resolveLinuxStrategy(env): EmbedStrategy {
  if (env.gpu === 'nvidia-linux')      return { mode: 'web' }   // R1
  if (env.risks.includes('WEBKITGTK_VERSION_MISMATCH'))
                                        return { mode: 'web' }   // R2
  if (env.renderBackend === 'sw')      return { mode: 'web' }   // R3
  if (env.renderBackend === 'unknown') return { mode: 'web' }   // R3 保守
  return { mode: 'mpv-wid', wid: env.windowId }
}
```

**默认策略：Linux 一律降级到 Web 版**，除非通过实测白名单。

> 宁可让用户用 Web 版（功能完整），也不要赌一个无法验证的原生体验。

---

## 3. R4：Wayland

### 3.1 现象

Wayland **没有向应用暴露窗口句柄**的概念。`--wid` 依赖 X11/Windows/macOS 的窗口 ID，**在 Wayland 下不存在**。

**这不是 bug，是设计差异。**

### 3.2 加剧因素

JetBrains 2026.1 EAP 明确写了 **"Wayland by Default"**。
Wayland 正在成为默认，**这个风险只会变大，不会变小。**

### 3.3 降级

```
mpv-wid (X11/Windows/macOS)
   ↓ Wayland
window (mpv 独立窗口)
   ↓
web
```

**注意**：这与 JetBrains 侧的情况一致——内嵌窗口在 Wayland 下同样失效。**不是 Tauri 特有的问题，是整个 Linux 桌面生态的迁移成本。**

---

## 4. R5：mpv "非真嵌入"

### 4.1 现象

社区反馈：mpv-tauri 的部分实现**并非真嵌入，只是"让 mpv 窗口跟随父窗口移动"**。

**表现**：拖动父窗口时子窗口跟不上、层级错乱、无法裁剪。

### 4.2 真嵌入路径

```
libmpv vo=libmpv（离屏渲染）→ FBO → 宿主画布合成
```

这条路我核到过实践记录，**但未验证**。

### 4.3 处置

**必须先做 PoC**，不能默认可行。

```
PoC 通过 → mpv-offscreen（最佳）
PoC 失败 → mpv-wid（次优，真窗口嵌入）
仍失败   → window → web
```

> **本份不承诺 libmpv 离屏嵌入可行**，只给出契约与降级路径。

---

## 5. R8：自研 GUI 的诱惑（唯一无降级的风险）

### 5.1 为什么它最危险

前七个风险都是**技术风险**，能降级。
**R8 是项目风险**——一旦开始自研 GUI，就进入：

```
自研 GUI → IME 问题 → 修 IME
        → 无障碍问题 → 修无障碍
        → 渲染问题 → 修渲染
        → 两年过去，主功能还没做
```

### 5.2 实证

| 项目 | 结局 |
|------|------|
| **xi-editor** | **已死** |
| **Lapce** | 3 万 star，**至今 pre-alpha** |
| **Floem** | 两年未发新版；**IME 切不出来、屏幕阅读器读不到** |

Lapce 主程：*"GUI is just such a beast of complexity"*，团队至今无人全职。

### 5.3 防线

**G-56.1（铁律，无例外）**：

> **禁止自研编辑器内核与 GUI 框架。**
> 任何触碰此线的提案，无论收益多大，一律否决。

**这条不给降级路径**——因为一旦越过，就没有回头路。

**唯一允许的"自研"**：面板 UI 与编排层（基于 Web 技术栈，不碰 GUI 框架）。

---

## 6. 降级链总图

```
                    ┌─ mpv-offscreen (最佳，需 PoC)
                    │
studio 设备嵌入 ─────┼─ mpv-wid      (X11/Win/macOS)
                    │
                    └─ window       (Wayland)
                           ↓
                        web        (Linux 风险 / 无 mpv)
                           ↓
                      headless     (CI，仅断言)

宿主形态 ── Studio → Web 版 → CLI
伴侣形态 ── native → sdk → remote
```

**每一档返回 `DEGRADED` 并标注原因，不判 FAIL、不阻断 CI。**
（延续 G-51 INV-02「能力缺失 → 降级 ≠ 崩溃」）

---

## 7. 未验证清单（诚实边界）

以下均为**设计推演，非实测**：

- [ ] libmpv 离屏 FBO 真嵌入
- [ ] Tauri 2 移动端性能
- [ ] iOS 跨 App inspect 可行性
- [ ] Linux WebKitGTK 各项风险的实际触发率
- [ ] Wayland 下各降级档的实际表现
- [ ] Studio 相对三个宿主的实际性能提升

**本份的性能数字（Tauri 3.2MB / 380ms / 42MB）是框架级 benchmark，非 Proteus 实测。**
按 G-55.7 纪律：**不得对外宣称。**
