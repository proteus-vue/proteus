# Android / 鸿蒙 安全区映射

> 两平台无灵动岛，但有挖孔屏避让——映射语义到 `p-safe-top`/`p-safe-left/right`

---

## 1. Android：WindowInsets

### 1.1 获取安全区

```kotlin
// ViewCompat / WindowInsetsCompat
ViewCompat.setOnApplyWindowInsetsListener(view) { v, insets ->
    val systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
    val displayCutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout())
    // systemBars.top = 状态栏
    // displayCutout.left/right = 挖孔侧（横屏）
    v.updatePadding(
        top = systemBars.top,
        bottom = systemBars.bottom,
        left = systemBars.left + displayCutout.left,
        right = systemBars.right + displayCutout.right
    )
    insets
}
```

### 1.2 挖孔避让模式

```kotlin
// 全屏场景下让内容可延伸到状态栏下（Glass 场景需要）
WindowCompat.setDecorFitsSystemWindows(window, false)

// 挖孔模式
window.attributes.layoutInDisplayCutoutMode =
    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_DEFAULT
// DEFAULT：全屏时内容避让挖孔（竖屏）
// NEVER：内容可覆盖挖孔（危险，仅全屏视频用）
```

### 1.3 `p-safe-island` 映射

Android **无灵动岛**，`island = 0`：
- `p-safe-island` → 编译为 `p-safe-top`（仅状态栏）
- `p-safe-island-glass` → 降级为普通玻璃 + 状态栏避让

### 1.4 横屏挖孔

横屏时挖孔在左侧/右侧短边：
```kotlin
displayCutout.boundingRects  // 返回挖孔 rect 列表
// 映射到 p-safe-left / p-safe-right
```

---

## 2. 鸿蒙（ArkUI）

### 2.1 获取避让区域

```typescript
import { window } from '@kit.ArkUI'

const win = window.getLastWindow(this.context)
win.getWindowRect()           // 窗口矩形
win.getAvoidArea(window.AvoidAreaType.TYPE_SYSTEM)     // 系统栏避让
win.getAvoidArea(window.AvoidAreaType.TYPE_CUTOUT)     // 挖孔避让
```

### 2.2 监听变化

```typescript
win.on('avoidAreaChange', (area) => {
    // 挖孔避让变化时回调
    // → JSI 触发 Vue 响应式更新
})
```

### 2.3 布局实现

ArkUI 无 AutoLayout 约束概念，用 `Row/Column` + `padding`：

```typescript
// p-safe-top → padding.top = avoidArea.top
Column() {
  // 导航栏内容
}
.padding({ top: this.safeTop })
```

### 2.4 `p-safe-island` 映射

鸿蒙**无灵动岛**，`island = 0`，`p-safe-island` → `p-safe-top`。

---

## 3. 映射对照表

| 语义 | iOS | Android | 鸿蒙 |
|------|------|---------|------|
| `p-safe-top` | `safeAreaInsets.top` | `systemBars.top` | `TYPE_SYSTEM.top` |
| `p-safe-bottom` | `safeAreaInsets.bottom` | `systemBars.bottom` | `TYPE_SYSTEM.bottom` |
| `p-safe-left` | 横屏灵动岛侧 | `displayCutout.left` | `TYPE_CUTOUT.left` |
| `p-safe-right` | 横屏灵动岛侧 | `displayCutout.right` | `TYPE_CUTOUT.right` |
| `p-safe-island` | 灵动岛专属 | = top | = top |
| `p-safe-island-glass` | UIGlassEffect 融合 | 降级 | 降级 |

---

## 4. JSI 映射（Android/Kotlin via JNI）

```kotlin
// nodeOps.applySafeArea()
fun applySafeArea(node: View, spec: SafeAreaSpec) {
    ViewCompat.setOnApplyWindowInsetsListener(node) { v, insets ->
        val bars = insets.getInsets(Type.systemBars())
        val cutout = insets.getInsets(Type.displayCutout())
        // 按 spec.area 应用对应 padding
        applyInsets(v, spec, bars, cutout)
        insets
    }
    // 立即请求一次
    ViewCompat.requestApplyInsets(node)
}
```

---

## 5. 验证清单

### Android
- [ ] 挖孔屏（华为/小米）竖屏：`p-safe-top` 避让挖孔
- [ ] 横屏：挖孔在短边，`p-safe-left/right` 正确
- [ ] 全屏玻璃场景：`setDecorFitsSystemWindows(false)` 生效
- [ ] `p-safe-island-glass` 降级为普通玻璃，不崩溃

### 鸿蒙
- [ ] `getAvoidArea(TYPE_CUTOUT)` 映射正确
- [ ] 避让变化 `avoidAreaChange` 触发响应式更新
- [ ] `p-safe-island` → top，正常

---

## 6. 反例

❌ 硬编码 `statusBarHeight = 24dp`（不同厂商/版本不同）  
❌ 用 `Resources.getSystem().displayMetrics` 算安全区（不准）  
❌ Android 用 `fitsSystemWindows="true"` + 自定义 padding（冲突）  
✅ 统一走 `WindowInsets` + `ViewCompat` 监听
