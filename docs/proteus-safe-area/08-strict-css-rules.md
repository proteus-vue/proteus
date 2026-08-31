# `--strict-css` 规则扩展：安全区相关（CSS013-015）

> 归入 CSS Compat plan（G-21）的 lint 规则集

---

## 规则总览

| 规则 | 触发条件 | 级别 | 修复 |
|------|---------|------|------|
| **CSS013** | `position: fixed; top: 0` 未包 `<p-safe>` | warning | 包裹 `<p-safe area="top">` |
| **CSS014** | 硬编码安全区魔法数字 | error | 改用 `p-safe-*` 语义 |
| **CSS015** | JS 直接读 `safeAreaInsets`（JSI 旁路） | warning | 改用 `useSafeArea()` |

---

## CSS013：`position: fixed` 顶部未避让

**问题**：`position: fixed; top: 0` 的导航栏在刘海/灵动岛设备上会叠到岛下。

**检测**：
```css
/* ❌ 触发 CSS013 */
.nav-bar { position: fixed; top: 0; }
```

**修复**：
```vue
<!-- ✅ 包裹 p-safe -->
<p-safe area="top">
  <p-view class="nav-bar">...</p-view>
</p-safe>
```

---

## CSS014：硬编码安全区数值

**魔法数字清单**（iOS 常见值）：
- `44px` — 状态栏高度（旧 iPhone）
- `59px` — 状态栏 + 灵动岛余量
- `88px` — 导航栏总高（44+44）
- `34px` — Home Indicator
- `20px` / `24px` / `48px` — 各种状态栏变体

**检测**：
```css
/* ❌ 触发 CSS014 */
.nav-bar { padding-top: 59px; }
.content { margin-top: 88px; }
```

**修复**：
```css
/* ✅ 语义化 */
.nav-bar { padding-top: p-safe-top; }
.content { margin-top: calc(p-safe-top + 44px); }  /* 44 是导航栏内容高，非安全区 */
```

### 自动修复

`CSS014` 支持 `--fix` 自动修复：
```
padding-top: 59px  →  padding-top: p-safe-top
margin-top: 88px   →  margin-top: calc(p-safe-top + 44px)
padding-bottom: 34px → padding-bottom: p-safe-bottom
```

**注意**：自动修复仅处理"数值=安全区"的明确映射，复合数值（如 `88 = 44+44`）需人工确认并加注释。

---

## CSS015：JSI 旁路读安全区

**问题**：JS 侧绕过 `useSafeArea()` 直接读原生安全区，违反封装 + 内存管理约束。

**检测**：
```typescript
// ❌ 触发 CSS015
const insets = nativeModule.getSafeAreaInsets()
// ❌ 直接持有原生对象引用（违反 Memory plan 的 JSI ownership）
```

**修复**：
```typescript
// ✅ 走统一 API
import { useSafeArea } from '@proteus-vue/platform'
const safe = useSafeArea()
```

---

## 配置

```json
// .proteus/config.json
{
  "css": {
    "strict": true,
    "rules": {
      "CSS013": "warning",
      "CSS014": "error",
      "CSS015": "warning"
    },
    "autoFix": ["CSS014"]
  }
}
```

---

## CI 集成

```yaml
# consistency.yml
- name: CSS Strict Check
  run: pnpm proteus css:check --strict
```

**门禁**：`CSS014` 为 error 时构建失败。

---

## 反例（明确允许的数值）

以下**不触发** CSS014（业务尺寸，非安全区）：
- 组件内容高度（`44px` 导航栏按钮、`56px` tabBar 项）
- 间距 token（`8px`/`16px`/`24px`）
- 边框/圆角（`1px`/`8px`/`16px`）

**检测逻辑**：仅当属性为 `padding/margin/top/bottom/left/right` + 值为已知安全区数字时触发。

---

## 验证

- [ ] CSS014 捕获 `padding-top: 59px` → error
- [ ] `--fix` 自动修复为 `p-safe-top`
- [ ] CSS013 捕获 `position: fixed; top: 0` 未包 `<p-safe>` → warning
- [ ] CSS015 捕获直接 `getSafeAreaInsets()` → warning
- [ ] 业务尺寸 `44px`（非安全区属性）不误报
