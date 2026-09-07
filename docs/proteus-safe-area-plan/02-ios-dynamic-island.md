# iOS 安全区与灵动岛专项

> 主战场：iOS 16.1+，刘海 → 灵动岛演进，以及 safeAreaInsets 自动跟随机制

---

## 1. safeAreaInsets 是什么

`UIView.safeAreaInsets`：系统实时维护的**安全区域边距**，包含：
- `top`：状态栏（44pt）+ 刘海/灵动岛余量
- `bottom`：Home Indicator（34pt）
- `left/right`：横屏时刘海/灵动岛所在侧

**关键：灵动岛完全包含在 `safeAreaInsets.top` 内**，所以理论上 `p-safe-top` 已天然避让灵动岛——**前提是用了正确的约束方式**。

---

## 2. 两种约束方式（对 vs 错）

### ❌ 错误：硬编码数值

```swift
// 错误示范（开发者常犯的）
navBar.frame = CGRect(x: 0, y: 44, width: w, height: 44)
// 灵动岛展开后 y=44 的内容会叠到岛下
```

### ✅ 正确：`safeAreaLayoutGuide` 约束

```swift
// 正确：用 AutoLayout 锚定 safeAreaLayoutGuide
navBar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor).isActive = true
navBar.leadingAnchor.constraint(equalTo: view.leadingAnchor).isActive = true
navBar.trailingAnchor.constraint(equalTo: view.trailingAnchor).isActive = true
navBar.heightAnchor.constraint(equalToConstant: 44).isActive = true
```

**灵动岛展开时系统自动增大 `safeAreaInsets.top`，`safeAreaLayoutGuide` 自动下移，导航栏无需任何代码即可跟随。**

---

## 3. 灵动岛三态与 safeAreaInsets

| 状态 | 岛形态 | safeAreaInsets.top | 应对 |
|---|---|---|---|
| 收起 | 胶囊 ~59pt 宽 | 59pt（含状态栏 44 + 岛余量 15） | 静态布局即可 |
| 展开（计时/导航/AirPods） | 药丸/大块，宽可变 | **系统自动增大** | LayoutGuide 自动跟随 |
| 满宽（来电/屏幕镜像） | 横条满宽 | 自动 | 同上 |

**开发者无需监听岛的宽度变化**——那是系统内部的事，`safeAreaInsets` 是唯一真相源。

---

## 4. 手动扩展安全区（进阶）

某些场景（如自定义浮层、全屏视频）需要手动扩展安全区：

```swift
// 让子 VC 的安全区包含父 VC 的某个区域
childVC.additionalSafeAreaInsets = UIEdgeInsets(top: 100, ...)
```

Proteus 的 `<p-safe mode="extend">` 映射到这个 API。

---

## 5. 玻璃与灵动岛融合（Glass L3 联动核心）

这是 Proteus 相对 RN/Flutter 的差异化点：

```objc
// p-safe-island-glass 的 iOS 实现
UIGlassEffect *effect = [[UIGlassEffect alloc] init];
effect.containerRelativeAnchor = [self _anchorIncludingIsland]; // 关键
// containerRelativeAnchor 设为包含灵动岛的 rect，
// 系统会把岛区域纳入模糊，实现视觉融合

UIView *glassView = [[UIView alloc] initWithFrame:...];
[glassView addGlassEffect:effect];
```

**iOS 26 玻璃材质会随灵动岛形态动态调整**，所以只要锚点正确包含岛区域，融合是系统自动的——**这正是 JSI 直调的价值**：能触达 `UIGlassEffect` 这类系统级 API。

---

## 6. 横屏灵动岛（易被忽略）

iOS 横屏时灵动岛跑到**左侧短边**：

| 方向 | 灵动岛位置 | safeAreaInsets |
|---|---|---|
| 竖屏 | 顶部 | top 变大 |
| 横屏（Home 键右） | 左侧 | **left 变大** |
| 横屏（Home 键左） | 右侧 | **right 变大** |

`p-safe-island` 在横屏自动映射为 `safeAreaInsets.left/right`（iOS），其他端横屏无岛 → `island = 0`。

---

## 7. 监听安全区变化

```swift
// UIViewController
override func viewSafeAreaInsetsDidChange() {
    super.viewSafeAreaInsetsDidChange()
    // 灵动岛展开/收起、转场、状态栏高度变化（通话条）时触发
    // 通知 Vue 响应式层更新 useSafeArea()
}
```

Proteus Runtime 在原生侧监听此回调 → JSI 触发 JS 侧 reactive 更新 → Vue patch。

---

## 8. JSI 映射接口（App Renderer nodeOps 扩展）

```typescript
// nodeOps 新增
interface SafeAreaNodeOps {
  applySafeArea(node: NativeNode, spec: SafeAreaSpec): void
  applyIslandGlass(node: NativeNode, spec: IslandGlassSpec): void
}

// SafeAreaSpec
type SafeAreaSpec = {
  area: 'top' | 'bottom' | 'left' | 'right' | 'horizontal' | 'all'
  mode: 'constraint' | 'extend' | 'ignore'
}
```

---

## 9. 验证清单（iOS 真机）

- [ ] iPhone 16 Pro，灵动岛收起态：导航栏内容不贴顶
- [ ] 计时器触发灵动岛展开：导航栏自动下移，无闪烁
- [ ] 来电满宽横条：内容不叠
- [ ] 横屏：灵动岛在左侧，`p-safe-island` → left
- [ ] `<pg-glass navigationBar>` + `p-safe-island-glass`：玻璃与岛融合无锯齿
- [ ] 无灵动岛设备（iPad/旧 iPhone）：`island = 0`，不崩溃
- [ ] `useSafeArea()` 响应式更新正确
- [ ] 硬编码 `44px/59px` 被 `--strict-css` CSS014 捕获
