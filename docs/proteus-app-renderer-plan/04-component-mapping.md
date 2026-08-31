# 04 组件映射表（p-* → Native View）

## 1. 基础组件

| `p-*` | iOS | Android | 鸿蒙 | 属性映射 |
|-------|-----|---------|------|---------|
| `p-view` | UIView | View | StackLayout | layout / background |
| `p-text` | UILabel | TextView | Text | text / fontSize / color |
| `p-image` | UIImageView | ImageView | Image | src / resizeMode |
| `p-scroll-view` | UIScrollView | NestedScrollView | ScrollView | scrollY / onScroll |
| `p-list` | UITableView | RecyclerView | List | data / itemTpl |
| `p-input` | UITextField | TextInputLayout | TextInput | value / placeholder |
| `p-button` | UIButton | Button | Button | text / onPress |
| `p-switch` | UISwitch | SwitchCompat | Toggle | checked / onChange |

## 2. 布局组件

| `p-*` | iOS | Android | 鸿蒙 |
|-------|-----|---------|------|
| `p-flex` | UIStackView | FlexboxLayout | FlexLayout |
| `p-grid` | UICollectionView | GridLayoutManager | GridLayout |
| `p-absolute` | 绝对定位 | ConstraintLayout | PositionLayout |

## 3. 反馈组件

| `p-*` | iOS | Android | 鸿蒙 |
|-------|-----|---------|------|
| `p-toast` | UIAlertController | Toast | promptAction |
| `p-modal` | UIViewController | DialogFragment | CustomDialog |
| `p-loading` | UIActivityIndicator | ProgressBar | LoadingProgress |
| `p-glass` | UIGlassEffect | RenderEffect | blur modifier |

## 4. 映射规则

```ts
// mapping registry
export const componentMap = {
  'p-view': { ios: 'UIView', android: 'View', harmony: 'StackLayout' },
  'p-glass': {
    ios: { type: 'UIGlassEffect', level: 3 },  // L3 系统级
    android: { type: 'RenderEffect', level: 3 },
    harmony: { type: 'blur', level: 3 },
    web: { type: 'backdrop-filter', level: 1 },   // L1 降级
    skyline: { type: 'backdrop-filter', level: 1 }
  }
}
```

## 5. 属性差异处理

平台专属属性走 `Platform` 判别联合（对齐 Platform plan）：

```ts
<p-view :style="{
  ...commonStyle,
  ios: { shadowRadius: 8 },
  android: { elevation: 4 }
}">
```

无法统一的属性 → 抛编译期警告 → 强制开发者显式处理。
