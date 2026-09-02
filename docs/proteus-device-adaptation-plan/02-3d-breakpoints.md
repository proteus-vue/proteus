# 三维断点模型（W × H × F）

> G-25 核心创新：**把 G-22 的"宽度断点"升级为"容器三维特征"，让柔性框架覆盖车机/TV/手表**

---

## 1. G-22 回顾：为什么二维不够

G-22 的 `p-fluid` / `p-grid` / `p-adaptive` 只用了**宽度（W）**：

```
p-adaptive="sheet(0,600) | dialog(600,840) | popover(840,∞)"
              ↑ 只有 W
```

这在手机/平板/PC 够用，因为三者主要差异就是宽度。
但遇到车机/TV/手表就失灵了：

- **车机**宽度可能比 PC 还大（xl），但交互是触摸+语音、有驾驶安全约束
- **TV**宽度也是 xl，但输入是遥控器（remote）、需要焦点引擎
- **手表**宽度极小（xs），但输入是表冠（dial）+ 触摸

**宽度无法区分这三者 → 必须引入新维度。**

---

## 2. 三维定义

```
┌──────────────────────────────────────────┐
│  容器特征 = (W, H, F)                    │
│                                          │
│  W ∈ {xs, sm, md, lg, xl}  宽度档位     │
│  H ∈ {xs, sm, md, lg, xl}  高度档位     │
│  F ∈ {touch, cursor, remote,│  输入形态  │
│       dial, voice}                       │
└──────────────────────────────────────────┘
```

### 2.1 宽度 W（沿用 G-22）

| 档位 | 范围 (pt) |
|------|-----------|
| xs | 0 – 320 |
| sm | 320 – 600 |
| md | 600 – 900 |
| lg | 900 – 1280 |
| xl | 1280+ |

### 2.2 高度 H（新增）

处理横竖屏、车机矮屏、TV 竖屏等特殊场景：

| 档位 | 范围 (pt) |
|------|-----------|
| xs | 0 – 320 |
| sm | 320 – 500 |
| md | 500 – 800 |
| lg | 800+ |

### 2.3 输入形态 F（核心新增）

| 值 | 含义 | 典型设备 |
|----|------|----------|
| `touch` | 手指触摸 | 手机/平板/车机中控 |
| `cursor` | 鼠标键盘 | PC/Mac/车机副屏 |
| `remote` | 遥控器 5 向 | **TV / 机顶盒** |
| `dial` | 表冠旋转 | **手表** |
| `voice` | 语音 | 车机/智能屏 |

---

## 3. 断点表达式语法

G-22.5 的 `p-adaptive` 扩展为三维：

```
<p-adaptive> ::= <variant> ("|" <variant>)*
<variant>    ::= <name> "(" <w-range> "," <h-range> "," <form> ")"
<w-range>    ::= <n> "," <n> | "∞" | "*"
<h-range>    ::= <n> "," <n> | "∞" | "*"
<form>       ::= "touch" | "cursor" | "remote" | "dial" | "voice" | "*"
```

示例：

```vue
<p-modal
  p-adaptive="
    sheet(0,600,touch) |
    dialog(600,840,touch) |
    popover(840,∞,cursor) |
    confirmation(∞,∞,driving)
  "
/>
```

- `sheet(0,600,touch)` → 宽 0-600 且触摸 → Sheet
- `popover(840,∞,cursor)` → 宽 840+ 且鼠标 → Popover
- `confirmation(∞,∞,driving)` → 任意宽且驾驶模式 → 仅确认

`F` 维度还支持 `driving`（驾驶安全子形态），由车机系统注入。

---

## 4. 组合查询 API

```ts
// 运行时获取当前容器特征
const profile = useContainerProfile()

// profile = { w: 'xl', h: 'sm', f: 'touch', driving: true }

if (profile.f === 'remote') {
  // TV 专属逻辑：启用焦点引擎
}
if (profile.driving) {
  // 车机行驶中：降级复杂交互
}
```

**原则 #10**：框架定义 `ContainerProfile` 语义，各端用原生 API 采集：

| 端 | W/H 来源 | F 来源 |
|----|----------|--------|
| iOS | `UIScreen` + `UITraitCollection` | `UIUserInterfaceIdiom` / `UIFocusSystem` |
| Android | `WindowManager` / Jetpack Window | `InputDevice` / Leanback 判断 |
| 鸿蒙 | `display` / `window` | 输入设备类型 |
| Web | `window.innerWidth/Height` + `matchMedia` | `pointer: coarse/fine` / `any-hover` |
| Skyline | 小程序窗口 API | 触摸事件 |

---

## 5. 与现有断点的兼容

**完全向后兼容 G-22**：当 `p-adaptive` 只写两个数字时，默认 `F=*`：

```
sheet(0,600)   ≡   sheet(0,600,*)   ← G-22 写法依然有效
```

三维是**超集**，不破坏任何已有代码。

---

## 6. 验证要点（B1 单测）

```
✅ resolveProfile(1920, 1080, 'cursor') → { w:'xl', h:'lg', f:'cursor' }
✅ resolveProfile(400, 300, 'touch')   → { w:'sm', h:'xs', f:'touch' }
✅ p-adaptive 匹配：sheet(0,600,touch) 在 (400,'sm','touch') 命中
✅ 二维写法兼容：sheet(0,600) ≡ sheet(0,600,*)
✅ 驾驶模式：driving 作为 F 子形态可覆盖任意 W/H
```

---

## 7. 边界说明

- **三维不是无限扩展**：F 只有 5 个值 + driving 子态，可控
- **大多数业务只用到 W**：`p-grid` / `p-fluid` 仍只依赖 W，不受影响
- **F 主要在系统级组件生效**：`p-modal`(G-22.5)、`<p-nav-cursor>`、`<p-vehicle-*>`、`<p-watch>`
- **降级策略**：无法识别的 F（如未来新输入形态）→ 默认 `touch` + 控制台告警

---

## 8. 严格规则

| 规则 | 级别 | 说明 |
|------|------|------|
| BP001 | error | `p-adaptive` 三维表达式必须含 F 维度（除非二维简写） |
| BP002 | warning | 新增设备适配须登记 F 值到 `ContainerProfile` |
| BP003 | error | 禁止手动 `if (isTV)` → 用 `useContainerProfile().f` |

---

## 9. 小结

三维断点 = **G-22 柔性布局通往全终端的钥匙**。
它让"设备类型"这个离散枚举，变成"容器特征"这个连续空间——
**任何带屏幕的设备都能被描述，Proteus 天然可扩展。**
