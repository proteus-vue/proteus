# 09 预设清单 (Presets)

> preset = 一组经验证的最佳参数组合，业务优先用 preset，避免手调。

## 预设表

| preset | 用途 | intensity | radius | border | noise | 适用端 |
|--------|------|-----------|--------|--------|-------|-------|
| `navigationBar` | 顶部导航栏 | regular | 0 | 底细边 | 0 | 全部 |
| `tabBar` | 底部标签栏 | regular | 0 | 顶细边 | 0 | 全部 |
| `modal` | 弹窗/ActionSheet | regular | 24 | 全边 | 0.04 | 全部 |
| `card` | 卡片 | thin | 16 | 全边 | 0.03 | 全部 |
| `floating` | 悬浮按钮/胶囊 | thick | 20 | 全边+阴影 | 0.05 | 全部 |
| `sidebar` | 侧边抽屉 | regular | 0 | 右细边 | 0 | 全部 |
| `custom` | 自定义 | 由 props | 由 props | 由 props | 由 props | 全部 |

## 各端 preset → 实现对照

### navigationBar
- **iOS**：`UIGlassEffect` + 底部细边框（`scrollEdgeAppearance` 联动）
- **鸿蒙**：`backdropBlur(20)` + `.border({ width: 0.5, color: '#ffffff33' })`
- **Android**：`setBackgroundBlurRadius(20)` + 底部细描边
- **Web/Skyline**：`backdrop-filter: blur(20px)` + `box-shadow` 模拟边框

### modal
- **iOS**：`UIGlassEffect(.regular)` + 大圆角
- **鸿蒙**：`backdropBlur(24)` + `borderRadius(24)`
- **Android**：`RenderEffect` + 圆角 + 阴影
- **Web/Skyline**：`backdrop-filter: blur(24px)` + `border-radius: 24px`

### floating（L2 最明显）
- 噪点 + 高光边 + 阴影组合最丰富
- Skyline worklet 可做悬浮呼吸形变

## 使用示例

```vue
<!-- ✅ 推荐：用 preset -->
<pg-glass preset="navigationBar">
  <view class="nav-content">标题</view>
</pg-glass>

<!-- ⚠️ 特殊需求：custom -->
<pg-glass preset="custom" :radius="32" :tint="{ color: 'rgba(0,0,0,0.2)' }">
  ...
</pg-glass>
```

## 预设扩展

```ts
// 业务可注册自定义 preset
import { defineGlassPreset } from '@proteus-vue/glass'

defineGlassPreset('brandFloating', {
  intensity: 'thick',
  radius: 28,
  border: { width: 1, color: 'rgba(99,102,241,0.4)' },
  noise: 0.06,
  interactive: true,
})
```

`proteus audit glass --check-presets` 校验预设一致性。

## 对齐设计规范

- 预设参数与 Website 设计系统（`08-design-system.md`）保持一致
- Blueprint 验证项：150 页中各 preset 实际渲染快照入库
