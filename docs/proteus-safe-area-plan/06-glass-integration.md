# 与 Glass L3 的联动

> 安全区方案与 Glass plan 的交叉点——玻璃盖住状态栏/灵动岛区域时需视觉融合

---

## 1. 为什么需要联动

`<pg-glass preset="navigationBar">` 若盖住状态栏 + 灵动岛区域：
- 玻璃层与系统背景**边缘锯齿/色差**
- 灵动岛展开/收起时玻璃边界**不跟随**
- 系统状态栏文字（时间/信号）与玻璃**层级冲突**

**解决：玻璃层需延伸到灵动岛区域并与系统模糊融合。**

---

## 2. 联动映射表

| Glass 场景 | 安全区联动 | iOS 实现 |
|---|---|---|
| `navigationBar` | `<p-safe-island mode="glass-blend">` | `UIGlassEffect.containerRelativeAnchor` 包含岛 |
| `tabBar` | `p-safe-bottom` | 玻璃盖住 Home Indicator 区域 |
| `sheet` / `modal` | `p-safe-top` | 顶部避让状态栏 |
| `floating` | `p-safe-left/right`（横屏） | 横屏灵动岛侧 |
| `fullscreen` | `ignore-safe-area` | 全屏视频/游戏，但仍需玻璃融合岛区 |

---

## 3. `p-safe-island-glass` 语义

```vue
<p-safe-island mode="glass-blend">
  <pg-glass preset="navigationBar" :island-follow="true">
    <p-text class="title">{{ title }}</p-text>
  </pg-glass>
</p-safe-island>
```

编译到 iOS：
```objc
UIGlassEffect *effect = [[UIGlassEffect alloc] init];
effect.containerRelativeAnchor = [self _anchorIncludingIsland];
// 系统自动把灵动岛区域纳入模糊 → 视觉融合
```

---

## 4. 降级策略

| 平台 | `glass-blend` 降级 |
|------|---|
| iOS < 26（无 UIGlassEffect） | 普通半透明背景 + `p-safe-top` 避让 |
| Android < 12（无 RenderEffect） | 普通半透明 + 状态栏避让 |
| 鸿蒙 | ArkUI 模糊 + 状态栏避让 |
| Web | `backdrop-filter: blur()` + `env()` |
| Skyline | `backdrop-filter` + `env()` |

**降级统一为：普通半透明背景 + `p-safe-top` 避让，不崩溃、不失真。**

---

## 5. 灵动岛跟随机制

iOS 灵动岛展开/收起时：
1. 系统更新 `safeAreaInsets`
2. `containerRelativeAnchor` **自动跟随**（系统内部）
3. 玻璃边界**无闪烁**重排

**开发者无需手动监听岛的宽度变化。**

---

## 6. 状态栏内容层级

玻璃导航栏盖住状态栏时，需处理**时间/信号/电量文字**：
- iOS：系统自动处理（玻璃材质会让内容穿透显示）
- Android：需 `WindowInsetsController.setSystemBarsAppearance()` 切换深浅色
- 鸿蒙：类似 Android

Proteus 提供 `<pg-glass :status-bar-style="light|dark">` 语义收敛。

---

## 7. 验证清单

- [ ] iPhone 16 Pro 灵动岛收起：玻璃与岛融合，无锯齿
- [ ] 灵动岛展开（计时器）：玻璃边界跟随，无闪烁
- [ ] 状态栏文字清晰（深浅色切换）
- [ ] Android `<pg-glass>` + `p-safe-bottom`：玻璃盖住导航手势条，融合正常
- [ ] 降级场景（无玻璃 API）：普通背景 + 避让，不崩溃
- [ ] 横屏 `floating` 玻璃：灵动岛侧避让正确

---

## 8. 反例

❌ 玻璃层不延伸到灵动岛区域（边缘锯齿）  
❌ 硬编码玻璃高度 `88px`（应用 `p-safe-top + 44`）  
❌ 全屏玻璃不处理状态栏文字层级  
✅ 玻璃层延伸 + `containerRelativeAnchor` 包含岛 + 状态栏语义收敛
