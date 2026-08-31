# 11 · 分批执行策略（G-27 / G-28）

## 1. 执行位

- **G-27 Theme**（P1）
- **G-27 FontScale**（P1）
- **G-28 Cache**（P1）

**三者互相独立**，可与 G-25（Memorial）/ G-26（Skeleton）并行启动。

## 2. 依赖关系

```
G-27 Theme ─┬─ M1: token + CSS 变量 (Web/Skyline)         ── 零依赖
            ├─ M2: iOS overrideUserInterfaceStyle          ── App Renderer M2
            ├─ M2: Android AppCompatDelegate + DayNight    ── App Renderer M2
            ├─ M3: 鸿蒙 UIAppearance.setDarkMode           ── App Renderer M3
            └─ M4: AOT 主题样式表生成                      ── Performance B1

G-27 Font ──┬─ M1: 语义 + Web rem 联动                     ── 零依赖
            ├─ M2: iOS UIFontMetrics + Android sp 动态     ── 零依赖
            ├─ M3: 鸿蒙 setFontSizeScale                   ── App Renderer M3
            └─ M4: FontBus + Large Content Viewer          ── 零依赖

G-28 Cache ─┬─ M1: L0/L2 抽象 + 字节预算                   ── Memory Plan
            ├─ M2: Android MMKV 集成                        ── 零依赖
            ├─ M2: iOS Codable + NSCache                   ── 零依赖
            ├─ M3: 鸿蒙 Preferences + 文件                 ── App Renderer M3
            └─ M4: AOT 预取 + IFR 冷启动                   ── Performance B1
```

**关键**：M1 三项全部**零依赖**（纯逻辑、可单测），可同期启动 —— 最快出可演示 demo。

## 3. 批次划分

### M1（零依赖，最快启动）

| 任务 | 产物 | 可测性 |
|------|------|--------|
| Theme token + Web CSS 变量 | `@proteus-vue/theme` | 单测：token 解析 + 样式表生成 |
| FontScale 语义 + Web rem | `@proteus-vue/font` | 单测：clamp + finalScale 计算 |
| L0/L2 抽象 + 字节预算 | `@proteus-vue/cache` | 单测：LRU + TTL + 预算超支 |

### M2（依赖 App Renderer M2）

- iOS/Android 原生 binding（主题 + 缓存）
- Android MMKV 集成

### M3（依赖 App Renderer M3）

- 鸿蒙 `UIAppearance`（**API 最完整，可放后面做**）
- 鸿蒙 Preferences + 文件缓存

### M4（依赖 Performance B1）

- AOT 主题样式表 + 预取清单生成
- IFR 冷启动缓存预暖

### M5（集成验收）

- 三能力组合 + Memorial/Skeleton/Glass/SafeArea 联动
- 真机五端验收矩阵

## 4. Prompt 模板

```
Implement Proteus G-27 Theme semantic layer:
1. Define ThemeTokens type (color/spacing, color has light+dark)
2. Implement reactive ThemeBus: source='light'|'dark'|'system',
   resolved = source==='system' ? systemTheme : source
3. Compiler: analyze $theme.x refs → static theme stylesheet +
   root data-theme toggle (O(1) global switch)
4. Each-end binding: iOS overrideUserInterfaceStyle (public API, iOS 13+) /
   Android AppCompatDelegate / Harmony UIAppearance.setDarkMode
5. Persist: sync read on launch (no flash), write on change
6. Tests: no hardcoded colors (CSS016), token refs statically analyzable,
   switch <16ms
```

## 5. 风险与缓解

| 风险 | 缓解 |
|------|------|
| Skyline 无 `:root`/media query | 用 `page` 选择器 + WXSS 变量 |
| iOS 私有 API 风险 | 只用公开 `overrideUserInterfaceStyle`（iOS 13+） |
| Android DayNight 需 AppCompatActivity | Proteus 默认继承 |
| 鸿蒙权限 | `UPDATE_CONFIGURATION` 为普通应用权限 |
| 缓存序列化阻塞主线程 | Worker / Codable 异步 |
| 主题闪屏 | 同步读取 + IFR 首帧前确定 |
