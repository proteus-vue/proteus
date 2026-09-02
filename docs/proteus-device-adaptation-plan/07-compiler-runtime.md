# Compiler & 运行时：设备能力映射

> 依赖：G-21（Compiler Plugin）/ G-22（Layout IR）/ G-25（三维断点）
> 目标：**把设备能力语义编译为各端原生声明**

---

## 1. 整体流程

```
SFC 模板
  ↓ (G-21 Compiler Plugin)
AST → LayoutConstraint IR（+ DeviceProfile IR）
  ↓
各端 nodeOps
  ↓
iOS / Android / 鸿蒙 / Web / Skyline 原生 API
```

**关键**：设备能力语义（焦点、驾驶安全、表冠、并发症）走**同一条 IR 管线**，
与 G-22 的布局语义完全一致 → **原则 #10 统一落地**。

---

## 2. DeviceProfile IR

```ts
interface DeviceProfile {
  w: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  h: 'xs' | 'sm' | 'md' | 'lg'
  f: 'touch' | 'cursor' | 'remote' | 'dial' | 'voice'
  driving?: boolean       // 车机专属
  capabilities: {
    focus: boolean        // TV
    crown: boolean        // 手表
    complication: boolean // 手表
    voice: boolean        // 车机
  }
}
```

Compiler 在编译期根据**目标端**生成静态 profile，运行时可动态更新（窗口拖拽、分屏）。

---

## 3. 编译期转换示例

### 3.1 p-adaptive → 各端原生

```vue
<p-modal p-adaptive="sheet(0,600,touch) | popover(840,∞,cursor)" />
```

**Compiler 生成**：

| 端 | 产物 |
|----|------|
| iOS | `UISheetPresentationController` / `UIPopoverPresentationController` |
| Android | `BottomSheetDialog` / `PopupWindow` |
| 鸿蒙 | `Sheet` / `Popup` |
| Web | `position:fixed` bottom / center + anchor |
| Skyline | 半屏页面栈 / 浮层 |

### 3.2 p-focus-scope → 焦点声明

```vue
<p-focus-scope mode="grid" :wrap="true" />
```

| 端 | 产物 |
|----|------|
| Android TV | `RecyclerView` + `FocusFinder` + Leanback |
| Apple TV | `UIFocusSystem` + `UIFocusEnvironment` |
| Web | `tabindex` + `:focus` + 键盘事件 |

### 3.3 p-vehicle-* → 车机模板

```vue
<p-vehicle-group :lazy="true" />
```

| 端 | 产物 |
|----|------|
| CarPlay | `CPTabBarTemplate` + `CPListTemplate` |
| Android Auto | `TabTemplate` + `ListTemplate` |

---

## 4. 运行时：Profile 采集

```ts
// 各端实现 useContainerProfile()
function useContainerProfile(): DeviceProfile {
  // iOS: UITraitCollection + UIScreen
  // Android: WindowManager + InputDevice
  // 鸿蒙: display + input
  // Web: matchMedia + pointer:coarse/fine
}
```

**窗口/分屏变化 → 响应式更新 profile → Vue 重新渲染 → 形态自动切换。**

---

## 5. 降级策略（Compiler 内置）

```
能力检测：
  focus 支持？ → 否 → p-focus-scope 退化为 p-stack
  crown 支持？ → 否 → p-crown 隐藏
  voice 支持？ → 否 → p-nav-voice 隐藏
  driving 可检测？ → 否 → 默认 driving=false
```

**原则**：宁可降级也不崩溃（对齐 Style Safety G-16 / App Config G-20）。

---

## 6. 与 Compiler Plugin（G-21）协同

设备能力映射**实现为官方 Plugin**（dogfooding 原则 #11）：

```ts
// @proteus/plugin-device
export default definePlugin({
  name: 'proteus:device',
  transformIR(ir) {
    // 识别 p-focus-scope / p-vehicle-* / p-watch
    // 注入 DeviceProfile 采集代码
    // 生成各端原生声明
  },
})
```

→ 开发者按需引入，核心包不膨胀。

---

## 7. 与 Style Safety（G-16）协同

设备相关样式经 Style Safety Validator 拦截：

```css
/* ❌ 禁止手动媒体查询设备类型 */
@media (tv) { ... }

/* ✅ 用 p-adaptive 语义 */
<p-grid p-adaptive="*(0,∞,remote)" />
```

---

## 8. 严格规则（Compiler 强制）

| 规则 | 级别 | 说明 |
|------|------|------|
| DEV001 | error | 禁止手动 `if (isTV)` → `useContainerProfile().f` |
| DEV002 | error | 设备能力须通过 `p-*` 语义声明 |
| DEV003 | warning | 新增设备须登记到 DeviceProfile |
| DEV004 | error | Compiler 须为每端生成对应原生声明 |

---

## 9. 性能预算

| 指标 | 预算 |
|------|------|
| Profile 采集耗时 | < 2ms |
| 断点切换 reflow | < 16ms（1 帧） |
| 焦点状态机内存 | < 50KB |
| TV 焦点导航帧率 | ≥ 60fps |

---

## 10. 小结

Compiler + 运行时 = **设备能力语义的落地层**。
它复用 G-21 IR 管线、G-22 LayoutConstraint、G-16 校验——
**证明 G-25 不是"新一套系统"，而是现有架构的自然延伸。**
