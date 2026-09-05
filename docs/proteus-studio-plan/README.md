# Proteus Studio — 自有宿主壳（G-56）

> 原则 #0「不绑定」系列，第 19 次泛化（官方链：G-51=15、G-52=16、G-53=17、G-54=18，G-55 落地不占序；#393 修正，原稿误作 16）。
> **不绑定宿主来源**：宿主可以是第三方（VSCode / IntelliJ / Zed），也可以是自有的（Studio）。
> 内核对两者一视同仁。

---

## 核心判断

**自研宿主壳 ≠ 自研编辑器。**

| 决策 | 模块 |
|------|------|
| 🚫 **绝不自研** | 编辑器内核、GUI 框架 |
| ♻️ **复用**（零改动） | G-55 知识内核、G-53/54 设备桥 |
| ✅ **自研** | 宿主壳、面板 UI、编排层、移动端伴侣 |

**真实自研占比**：仅「编排 + 面板 UI」。

### 为什么绝不自研编辑器内核

| 项目 | 结局 |
|------|------|
| xi-editor（Google） | **已死** |
| Lapce | 3 万 star，**至今 pre-alpha** |
| Floem（其 GUI 框架） | 两年未发新版；**IME 切不出来、屏幕阅读器读不到** |

> **G-56.1 是红线，无例外、无降级。**

---

## 文档导航

| 文件 | 内容 |
|------|------|
| **01-problem.md** | 三个宿主的共同天花板；自研 vs 集成的边界判断 |
| **02-architecture.md** | ★ 能力边界矩阵（本份最重要）；四宿主能力真值表 |
| **03-spi.md** | StudioShell / EmbedStrategy / PlatformRisk；仅新增 3 个类型 |
| **04-editor-integration.md** | CodeMirror 6 / xterm.js+pty / libmpv 集成方案 |
| **05-mobile-companion.md** | ★ 移动端伴侣——三个宿主做不到的独特价值 |
| **06-risks-degradation.md** | 八条风险与降级路径；R8（自研 GUI）是唯一无降级的 |
| **07-ecosystem-compat.md** | ★ 能否接 VSCode 插件生态？不能，及为什么不追求（→ 后续插件生态 plan，未编号） |
| **conformance.md** | INV-ST-01~08 / CMP-171~178 / 67 cases / NEG-01~09 |
| **rules.md** | G-56.1~9 铁律 + AP-ST-01~08 反模式 |
| **architecture-update.md** | 原则 #13.66~68；成熟度 L5；已知缺口 |
| **reference-impl.cjs** | ★ 零依赖参考实现，**67/67 通过** |

---

## 快速验证

```bash
node reference-impl.cjs   # → self-test: 67/67
bash verify.sh             # → PASS=86 FAIL=0
sha256sum -c CHECKSUM.sha256
```

---

## 四宿主能力矩阵

| capability | vscode | intellij | zed | studio |
|-----------|--------|----------|-----|--------|
| panel.custom | ✅ | ✅ | ❌ | ✅ |
| panel.embeddedCanvas | ✅ | ✅ | ❌ | ✅ |
| button.custom | ✅ | ✅ | ❌ | ✅ |
| console.custom | ✅ | ✅ | ❌ | ✅ |
| device.native | ⚠️ 自绘 | ⚠️ 自绘 | ❌ | ✅ |
| **form.mobile** | ❌ | ❌ | ❌ | ✅ |

**Studio 在 `device.native` 与 `form.mobile` 是唯一 ✅** —— 这是它存在的理由。

---

## 八条不变量

```
INV-ST-01  新增自有宿主不改内核（架构试金石）
INV-ST-02  编辑器内核与 GUI 框架禁自研
INV-ST-03  设备输入坐标必须归一化 0..1
INV-ST-04  平台风险如实上报，禁默认 hw
INV-ST-05  嵌入失败 → 降级，不崩溃
INV-ST-06  四个宿主共用同一内核
INV-ST-07  无障碍树优先于截图比对
INV-ST-08  移动端形态仅 Studio 具备
```

---

## 降级链

```
mpv-offscreen → mpv-wid → window → web → headless
     (PoC)      (X11/Win)  (Wayland) (Linux风险) (CI)
```

**每一档返回 `DEGRADED` + 原因，不判 FAIL、不阻断 CI。**

---

## ⚠️ 诚实边界

1. **Tauri 性能数字（3.2MB / 380ms / 42MB）是框架级 benchmark，非 Proteus 实测** —— 按 G-56.8 不得对外宣称
2. **libmpv 离屏 FBO 真嵌入未验证** —— 需 PoC
3. **iOS 跨 App inspect 无先例** —— 建议先做 companion.sdk
4. **移动端伴侣是推演，无参考实现**
5. **Linux 默认降级到 Web 版** —— 除非通过实测白名单

---

## 建议实施顺序

```
阶段 1  Studio 桌面版（编辑器 + 终端 + 设备嵌入）
阶段 2  Linux 降级链 + libmpv PoC 验证   ← 决定性
阶段 3  ★ 移动端伴侣（先 companion.sdk）
```

**不要一开始做伴侣** —— 它是风险最高、先例最少的部分。
**阶段 2 的 PoC 决定 `device.native` 这个"唯一 ✅"是否真的成立。**
