# 10 · 性能预算与真机验收

## 1. 性能预算

| 指标 | 预算 | 测量方式 |
|------|------|---------|
| 主题样式表 (theme.css) | <5KB gzip | 构建产物分析 |
| 字体样式表 (font.css) | <2KB | 构建产物分析 |
| 主题切换主线程耗时 | <16ms (60fps) | Performance API / Instruments |
| 字体缩放 patch 节点数 | 仅用到的节点 | Vue DevTools |
| 缓存 L0 命中率 | >95% | CachePanel |
| 缓存读取 (L0) | <1ms | TraceBus |
| 缓存预取 (L3→L2) | 首帧后 idle 执行 | 不阻塞首帧 |
| 冷启动关键缓存命中 | 100% (preheat) | 骨架→内容无闪烁 |

## 2. 真机验收矩阵

| 端 | 主题 | 字体 | 缓存 |
|----|------|------|------|
| **iOS** | `overrideUserInterfaceStyle` + trait 监听 ✅ | `UIFontMetrics` + Dynamic Type ✅ | `NSCache` + 内存警告自动清空 ✅ |
| **Android** | `AppCompatDelegate` + DayNight ✅ | `sp` + `onConfigurationChanged` ✅ | **MMKV** + `LruCache` ✅ |
| **鸿蒙** | `UIAppearance.setDarkMode` ✅ | `setFontSizeScale` (API 最完整) ✅ | `Preferences` + 文件 ✅ |
| **Web** | `prefers-color-scheme` + CSS 变量 ✅ | `rem` + `:root` ✅ | IndexedDB ✅ |
| **Skyline** | `wx.onThemeChange` + WXSS 变量 ✅ | JS 计算 + CSS 变量 ✅ | `wx.setStorage`(10MB) + 文件系统 ✅ |

## 3. 无障碍验收（WCAG 1.4.4 Resize Text）

- [ ] iOS：Dynamic Type 最大档（AX5，`accessibilityLargeContentViewerEnabled`）无截断
- [ ] Android：`sp` 缩放生效，`dp` 做字号被 lint 拦截
- [ ] 鸿蒙：`setFontSizeScale(2)` 全 App 生效
- [ ] 所有端：可滚动容器包裹可缩放内容（防内容被推到屏幕外）
- [ ] Large Content Viewer：长按放大可用（iOS/Android）

## 4. 内存验证（对接 Memory Plan）

- [ ] 缓存淘汰后内存回落（LeakRegistry 验证）
- [ ] iOS 模拟内存警告 → L0 自动清空，无崩溃
- [ ] 字节预算超支 → 异步清理，不阻塞首帧
- [ ] Owner Epoch 过期 → 缓存条目自动释放

## 5. 冷启动验证（对接 IFR / Performance）

- [ ] 首帧前 theme source / font scale 已同步读取 → 无闪屏
- [ ] preheat 关键数据 → 骨架秒变真实内容
- [ ] 缓存预热在 idle 执行 → 不影响 TTI

## 6. 对标基准（相对竞品）

| 场景 | uni-app x | RN | **Proteus 目标** |
|------|-----------|----|-----------------|
| 主题切换全树重渲 | 是（根 class） | 是（需 useMemo 避免） | **否（精确追踪 + 静态优化）** |
| 字体缩放进 JS 线程 | — | 是（重建 StyleSheet） | **否（CSS 变量，GPU 合成）** |
| 缓存 OOM 风险 | 高（无预算） | 高（社区库） | **低（字节预算 + 自动淘汰）** |
| 配置复杂度 | 高（多文件多概念） | 中（手写 Provider） | **低（单文件声明）** |
