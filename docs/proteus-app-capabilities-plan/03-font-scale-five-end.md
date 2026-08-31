# 03 · 动态字体缩放：五端实现细则

## 1. 语义模型

```typescript
interface FontConfig {
  scale: number        // 应用级覆盖，默认 1.0
  followSystem: boolean // 默认 true
  min: number          // 0.8
  max: number          // 1.5
  base: number         // 设计稿基准 px，默认 16
}
```

**最终缩放** = `clamp(followSystem ? systemScale : 1, min, max) * appScale`

## 2. 五端系统能力

### iOS — Dynamic Type

- **系统值**：`UIApplication.shared.preferredContentSizeCategory`（`XS` ~ `XXXL`）
- **标准字体**：`UIFont.preferredFont(forTextStyle: .body)` → 自动随系统缩放
- **自定义字体（关键）**：
  ```swift
  let font = UIFont(name: "Custom", size: 16)!
  label.font = UIFontMetrics(forTextStyle: .body).scaledFont(for: font)
  label.adjustsFontForContentSizeCategory = true
  ```
- **监听**：`NotificationCenter` 监听 `UIContentSizeCategory.didChangeNotification` **或** 重写 `traitCollectionDidChange`
- **JSI**：`UIFontMetrics.scaledFontFor` + `preferredContentSizeCategory`

### Android — Font Scale

- **单位**：一律用 `sp`（scale-independent pixels），**禁止 `dp` 做字号**
- **系统值**：`Resources.getConfiguration().fontScale`（0.85 / 1.0 / 1.15 / 1.3 / 1.45 / 2.0 ...）
- **动态变更**：
  - `Activity.onConfigurationChanged(newConfig)` 接收 `fontScale` 变化
  - **或** `recreate()` Activity（简单粗暴但会重建视图）
- **Compose**：`LocalDensity.current.fontScale`（注意：Compose 无障碍树不暴露字号单位，需测试）
- **应用级覆盖**：`Configuration.fontScale = customScale` + `resources.updateConfiguration`

### 鸿蒙 — fontScale（API 最完整）

- **设置**：`applicationContext.setFontSizeScale(2)`（需 `ohos.permission.UPDATE_CONFIGURATION`，**普通应用权限**）
- **读取**：`UIAppearance.getFontScale()`（同步）
- **粗细**：`UIAppearance.setFontWeightScale(scale)`（鸿蒙独有）
- **跟随系统**：`UIContext.isFollowingSystemFontScale()` / `getMaxFontScale()`
- **监听**：`UIAppearance` 回调

### Web

- **系统跟随**：`(prefers-color-scheme 无关)` → 无标准系统字号监听，靠 `rem`
- **映射**：`:root { font-size: 16px }` + 全部用 `rem` → 改根字号全部联动
- **应用级**：改 `--font-scale` CSS 变量 + `calc()`

### Skyline

- **无原生 sp 概念** → JS 计算 `scale` → 设 CSS 变量 `--font-scale`
- **组件**：`<text>` 用 `style="font-size: calc(16px * var(--font-scale))"`

## 3. 统一事件总线 FontBus

```typescript
class FontBus {
  systemScale = ref(1.0)
  appScale = ref(1.0)
  followSystem = ref(true)
  
  get finalScale() {
    const s = this.followSystem.value ? this.systemScale.value : 1
    return clamp(s * this.appScale.value, 0.8, 1.5)
  }
  
  // 各端原生监听 → 更新 systemScale
  // Web: 无标准监听，poll 或 ResizeObserver(root)
  // iOS: traitCollectionDidChange / NotificationCenter
  // Android: onConfigurationChanged
  // 鸿蒙: UIAppearance 回调
}
```

## 4. 响应式应用

```vue
<!-- 自动响应式：font-size 用 ref，变化精确到节点 -->
<p-text :style="{ fontSize: 16 * $font.finalScale + 'px' }">内容</p-text>

<!-- 推荐：语义字号（对接 theme tokens） -->
<p-text class="body">内容</p-text>
<!-- .body { font-size: calc(16px * var(--font-scale)) } -->
```

**精确追踪**：Vue Proxy 只 patch 用了 `font-size` 的节点 —— **列表项不受影响**（对比 RN 需 useMemo 手动优化）。

## 5. 无障碍：Large Content Viewer

| 端 | 原生 API | Proteus 封装 |
|----|---------|-------------|
| iOS | `UILargeContentViewerInteraction` + `showsLargeContentViewer = true` | `<p-text large-content>` |
| Android | `LargeContentViewer` 库 | `<p-text large-content>` |
| 鸿蒙 | — | 降级放大手势 |

**用途**：字体缩放到很大时，长按元素弹出超大版本（iOS 辅助功能要求）。

## 6. 布局约束（lint 规则）

```
FONT001: 可缩放文本容器的高度不应固定（防截断）
FONT002: 使用 sp/rem，禁止 px 做字号（除 1px 边框）
FONT003: 缩放上限 clamp 生效，超范围降级不崩溃
FONT004: 跟随系统默认开启，禁止全局关闭（accessibility anti-pattern）
```

**对比 RN**：`Text.defaultProps.allowFontScaling = false` 是公认的 accessibility anti-pattern —— **Proteus 不允许全局关闭**。

## 7. 验收

- [ ] iOS Dynamic Type 最大档（AX5）无截断，滚动容器可滚动
- [ ] Android `sp` 缩放生效，`dp` 做字号被 lint 拦截
- [ ] 鸿蒙 `setFontSizeScale(2)` 全 App 生效（含 ArkUI 原生控件）
- [ ] 应用级覆盖 + 系统级叠加，最终值 = clamp(系统 × 应用)
- [ ] 字号变更精确追踪到节点（DevTools 验证 patch 范围）
- [ ] Large Content Viewer 可用（iOS/Android）
- [ ] 不影响安全区（灵动岛避让不受影响，对接 safe-area 方案）
