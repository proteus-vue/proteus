# 01 三平台液态玻璃能力调研

## 结论先行

✅ **可行**，但必须按"分层映射"而非"像素级统一"理解。

| 平台 | 玻璃能力层级 | 关键版本 | 可达性 |
|------|------------|---------|-------|
| iOS | 系统级 `UIGlassEffect`（iOS 26+），回退 `UIVisualEffectView` | iOS 26 / 18 | 高 |
| 鸿蒙 | ArkUI `blur` + NEXT fractal | API 9+，NEXT 最完善 | **高（中国系统最优）** |
| Android | `RenderEffect` + `Window.setBackgroundBlur` | API 31+ | 中（碎片化） |
| Web | `backdrop-filter` + SVG/Canvas Shader | CSS Backdrop Filter L1 | 高 |
| Skyline | `backdrop-filter` + worklet | Skyline 2.x | 高（战略价值点） |

## 关键事实

### iOS
- **iOS 26+** 才有 `UIGlassEffect`（Liquid Glass 设计语言核心 API）
- 低版本回退 `UIVisualEffectView(.blur(style:))`
- 必须用版本守门：可用性检测 → 回退链

### 鸿蒙（重点深耕理由）
- ArkUI 的 `blur`/`backdropBlur` 从 **API 9** 起稳定
- HarmonyOS NEXT 强化了材质系统（fractal/玻璃态）
- **中国自研系统，玻璃支持最完善** → Proteus 差异化深耕点

### Android
- `RenderEffect.createBlurEffect()` 需 **API 31 (Android 12)**
- `Window.setBackgroundBlurRadius` 同版本
- **国内 ROM 控制中心玻璃是系统特权，App 调不到**：
  - 小米 HyperOS、OPPO ColorOS、vivo OriginOS 的私有 API 不稳定
  - **明确不做主干，仅留扩展口**

### Web / Skyline
- `backdrop-filter: blur()` 已广泛支持
- 高级质感靠 CSS `::before` noise + 高光边 + 动画
- **Skyline 支持 worklet 动画** → 可做 60fps 动态玻璃形变，这是选 Skyline 的战略价值

## 可行性判定

| 方案 | 可行性 | 说明 |
|------|-------|------|
| 三端统一 CSS | ⚠️ 仅 L1 | 能稳定跨端，但质感天花板低 |
| 三端统一系统级 | ❌ 不可行 | Web/Skyline 无系统 API |
| **分层映射（采用）** | ✅ | L1 统一 + L2/L3 尽力提升 |

## 对齐既有体系

- 对齐 `Platform` 判别联合（types-plan §8）
- 对齐 `CapabilityDescriptor`（跨端能力静态可分析）
- 对齐 `--trace-transform`（新增 `--trace-glass`）
- 对齐 `proteus audit`（新增 `glass` 子命令）

---
依赖：Component 体系、Platform 能力注册表、Compiler IR
被依赖：Website（Playground 演示）、Blueprint（验证项）
