# Compiler 集成：安全区语义编译期映射

> 归入 CSS Compat plan（G-21）+ App Renderer（G-22）

---

## 1. 编译期转换总览

`p-safe-*` 语义在 Compiler 构建期按 `target` 分支编译为各端原生代码：

```
SFC 样式 / 模板
    ↓ parse
AST
    ↓ Compiler IR（新增 SafeArea 节点类型）
IR
    ↓ codegen 按 target 分支
┌─────────────────────────────────────────┐
│ Web      → CSS env() + viewport meta   │
│ Skyline  → env() + safeArea JS         │
│ iOS      → safeAreaLayoutGuide 约束    │
│ Android  → WindowInsets padding        │
│ 鸿蒙     → getAvoidArea padding        │
└─────────────────────────────────────────┘
```

---

## 2. IR 节点定义

```typescript
// Compiler IR 扩展
interface SafeAreaIRNode extends IRNode {
  kind: 'safe-area'
  area: 'top' | 'bottom' | 'left' | 'right' | 'island' | 'horizontal' | 'all'
  mode: 'constraint' | 'extend' | 'ignore' | 'glass-blend'
  target: Platform
}
```

---

## 3. CSS 属性重写规则

| 输入（SFC） | target=web/skyline | target=ios/android/鸿蒙 |
|---|---|---|
| `padding-top: p-safe-top` | `padding-top: env(safe-area-inset-top)` | 运行时绑定 `useSafeArea().top` |
| `padding-bottom: p-safe-bottom` | `env(safe-area-inset-bottom)` | 运行时绑定 |
| `height: p-safe-island` | `env(safe-area-inset-top)` | iOS→灵动岛高度，其他→0 |
| `margin: p-safe-all` | 四向 `env()` | 运行时绑定四向 |

---

## 4. `<p-safe>` 组件编译

```vue
<p-safe area="top">
  <pg-glass preset="navigationBar" />
</p-safe>
```

编译为：

**iOS：**
```objc
// 生成 AutoLayout 约束代码
[glassView.topAnchor constraintEqualToAnchor:parent.safeAreaLayoutGuide.topAnchor]
```

**Android：**
```kotlin
ViewCompat.setOnApplyWindowInsetsListener(glassView) { v, insets ->
    v.updatePadding(top = insets.getInsets(systemBars).top)
    insets
}
```

**Web：**
```css
.glass-view { padding-top: env(safe-area-inset-top); }
```

---

## 5. `--strict-css` 规则扩展（CSS013-015）

| 规则 | 触发条件 | 级别 | 修复建议 |
|------|---------|------|---------|
| `CSS013` | `position: fixed; top: 0` 未包 `<p-safe>` | warning | 包裹 `<p-safe area="top">` |
| `CSS014` | 硬编码 `44px/59px/88px/34px` 等安全区数值 | error | 改用 `p-safe-top` 等语义 |
| `CSS015` | JS 侧直接读 `safeAreaInsets`（JSI 旁路） | warning | 改用 `useSafeArea()` |

### 自动修复

`CSS014` 可自动修复：
```
padding-top: 59px  →  padding-top: p-safe-top
margin-top: 88px   →  margin-top: calc(p-safe-top * 2)  (需语义确认)
```

---

## 6. TraceBus 集成

安全区方案纳入 `--trace-transform` 输出：

```json
{
  "phase": "safe-area-codegen",
  "node": { "kind": "safe-area", "area": "top", "target": "ios" },
  "output": "[glassView.topAnchor constraintEqualToAnchor:...]"
}
```

---

## 7. CLI 开关

```bash
proteus compile --strict-css          # 开启 CSS013-015
proteus compile --safe-area-report    # 产出安全区使用报告
proteus audit --check-safe-area       # 审计硬编码数值
```

---

## 8. 构建期校验

- **零硬编码**：扫描产物中是否残留 `44/59/88/34` 等 iOS 安全区魔法数字 → 报错
- **viewport-fit**：Web target 产物必须含 `viewport-fit=cover`，否则警告
- **胶囊避让**：Skyline target + 自定义导航栏时，必须包 `<p-safe area="top">`，否则警告

---

## 9. 验证

- [ ] `padding-top: p-safe-top` 在各 target 产物中正确展开
- [ ] `CSS014` 能捕获硬编码 `59px` 并自动修复
- [ ] `--safe-area-report` 产出可读报告
- [ ] TraceBus 含 `safe-area-codegen` 阶段
- [ ] 构建期扫描产物无残留安全区魔法数字
