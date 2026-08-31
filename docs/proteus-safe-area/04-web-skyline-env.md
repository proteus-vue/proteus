# Web / Skyline 安全区方案

> Web 有浏览器原生 `env()` 支持，Skyline 部分支持——映射语义到统一 `p-safe-*`

---

## 1. Web 端

### 1.1 CSS `env()` 原生支持

```css
.nav-bar {
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
  padding-left: env(safe-area-inset-left);
  padding-right: env(safe-area-inset-right);
}
```

### 1.2 必需：`viewport-fit=cover`

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
```

**`viewport-fit=cover` 是 `env()` 生效的前提**——否则网页被限制在安全区内，`env()` 返回 0。

### 1.3 `p-safe-*` 编译映射

| 写法 | 编译产物 |
|------|---------|
| `padding-top: p-safe-top` | `padding-top: env(safe-area-inset-top)` |
| `padding-bottom: p-safe-bottom` | `padding-bottom: env(safe-area-inset-bottom)` |

Compiler 构建期直接替换为 `env()`，运行期零开销。

### 1.4 `p-safe-island` 映射

Web **无硬件灵动岛**：
- iPhone Safari：`env(safe-area-inset-top)` 在刘海机上有值（约 44px）
- 桌面浏览器：`env()` 返回 0
- `p-safe-island` → `env(safe-area-inset-top)`（语义一致）

### 1.5 JS 运行时 `useSafeArea()`

Web 端无需 JSI，用 `ResizeObserver` 监听视口（动态变化罕见，但横屏/虚拟键盘会触发）：

```typescript
// Web 实现
const safe = reactive({
  top: cssEnv('safe-area-inset-top'),
  bottom: cssEnv('safe-area-inset-bottom'),
  left: 0, right: 0, island: 0
})
// 横屏/虚拟键盘时 env() 可能变化，需监听
```

---

## 2. Skyline（微信小程序）

### 2.1 系统信息 API

```javascript
const sysInfo = wx.getSystemInfoSync()
// sysInfo.safeArea = { top, bottom, left, right, width, height }
// sysInfo.statusBarHeight
// sysInfo.screenHeight / windowHeight
```

### 2.2 CSS `env()` 支持情况

- Skyline 基础库 **8.0.49+** 部分支持 `env(safe-area-inset-*)`
- **不是所有版本/机型都支持**，需兜底

### 2.3 胶囊按钮避让（小程序特有）

小程序右上角有**胶囊按钮**（胶囊菜单），需额外避让：

```javascript
const menu = wx.getMenuButtonBoundingClientRect()
// menu = { top, bottom, left, right, width, height }
// 自定义导航栏需避开胶囊按钮区域
```

### 2.4 `p-safe-*` 编译映射

Compiler 按 target=skyline 编译：

| 语义 | 编译产物 |
|------|---------|
| `p-safe-top` | `env(safe-area-inset-top)` + 胶囊避让（自定义导航栏时） |
| `p-safe-bottom` | `env(safe-area-inset-bottom)` |
| `p-safe-island` | `env(safe-area-inset-top)`（小程序无灵动岛） |

### 2.5 Skyline 特殊约束

Skyline 的 `backdrop-filter` 支持是你选它的关键价值（WebView 版不支持），但：
- `position: fixed` 仅在相对视口时支持
- `overflow: scroll` 必须 `<scroll-view>`
- 这些已在 CSS Compat plan 的「❌ 禁止」档标注

---

## 3. 编译期降级策略

```
p-safe-* 语义
    ↓ Compiler 按 target 分支
┌──────────┬──────────────────────────────┐
│ Web      │ env() + viewport-fit=cover   │
│ Skyline  │ env() + safeArea API + 胶囊  │
│ iOS      │ safeAreaLayoutGuide (JSI)    │
│ Android  │ WindowInsets (JSI)           │
│ 鸿蒙     │ getAvoidArea (JSI)           │
└──────────┴──────────────────────────────┘
```

**降级原则**：某端 `env()` 不支持时，Compiler 注入 JS 运行期计算（`useSafeArea()` 的返回值绑定到 style）。

---

## 4. 验证清单

### Web
- [ ] `viewport-fit=cover` 注入正确
- [ ] iPhone Safari 刘海机 `env()` 生效
- [ ] 横屏 `env()` 更新
- [ ] 桌面浏览器 `env()` = 0 不崩溃

### Skyline
- [ ] `getSystemInfo().safeArea` 正确
- [ ] 胶囊按钮避让（自定义导航栏）
- [ ] `env()` 在支持版本生效，不支持版本降级为 JS 计算
- [ ] `backdrop-filter` 可用（Skyline 优势验证）

---

## 5. 反例

❌ Web 端忘记 `viewport-fit=cover`（`env()` 全返回 0，最常见问题）  
❌ Skyline 用 `position: fixed` 盖住顶部但不包 `<p-safe>`  
❌ 硬编码 `statusBarHeight`（应用 `safeArea.top`）  
✅ Web/Skyline 优先 `env()`，不支持时降级 JS
