# 手表适配（Wearable）

> 依赖：G-22（Fluid Layout）/ G-25（三维断点 F=dial）
> 目标：**把手表的表冠、并发症、单列导航收敛为语义原语**

---

## 1. 手表的独特性

手表是**最极端的终端**：

| 约束 | 数值 / 规范 |
|------|-------------|
| 极小屏 | 通常 < 200pt 宽（Apple Watch 42mm ≈ 198pt） |
| 单列一屏 | **禁止横滑多页**（Apple Watch 人机规范） |
| 表冠（Digital Crown） | 旋转输入（缩放/滚动/选择） |
| 并发症（Complication） | 表盘上的小组件 |
| 续航敏感 | 避免复杂渲染 |

**宽度 xs + 输入 dial → 三维断点天然描述手表。**

---

## 2. 输入形态：F=dial

```ts
useContainerProfile()
// → { w: 'xs', h: 'xs', f: 'dial' }  // 手表
```

---

## 3. 核心原语

### 3.1 `<p-page p-watch>`

```vue
<p-page p-watch="complication | corner | full">
  <p-stack direction="column" :gap="2">
    <p-text>心率：{{ heartRate }}</p-text>
    <p-button>开始锻炼</p-button>
  </p-stack>
</p-page>
```

| `p-watch` 值 | 含义 |
|---------------|------|
| `complication` | 表盘并发症（极小，单行数据） |
| `corner` | 角标通知 |
| `full` | 全屏页面（默认） |

### 3.2 `<p-complication>` 并发症

```vue
<p-complication
  family="modularLarge"
  :data="{ title: '心率', value: '72', unit: 'bpm' }"
/>
```

映射：

| 端 | 并发症系统 |
|----|-----------|
| Apple Watch | `CLKComplication` + `ComplicationController` |
| Wear OS | `ComplicationData` + `ComplicationProviderService` |
| 鸿蒙穿戴 | 表盘服务 + 数据模板 |

### 3.3 `<p-crown>` 表冠绑定

```vue
<p-crown @rotate="onCrownRotate" @click="onCrownClick" />
```

映射：
- Apple Watch：`WKInterfacePicker` + Digital Crown 绑定
- Wear OS：`RotaryInput` + `OnRotaryInputListener`
- 鸿蒙：`onRotate` 事件

---

## 4. 单列约束（铁律 G-25.3）

手表页面**必须单列一屏**：

```vue
<p-stack direction="column" :gap="2">   ← ✅ 单列
  <p-card />
  <p-button />
</p-stack>

<p-grid :min-col-width="100" />         ← ❌ 手表强制 1 列
```

**Compiler 强制**：`w=xs` 时 `p-grid` 列数 = 1（FLD + WATCH001）。

---

## 5. 与 Fluid Layout（G-22）协同

手表下 `p-fluid` 取**下限**（空间小）：

```vue
<p-text p-fluid="font-size(12, 18)" />   ← 手表取 12pt
```

`p-stack :wrap="true"` 在手表下自动 `wrap=false`（单列堆叠）。

---

## 6. 导航（p-nav 家族适配）

手表导航极简，只用：
- **层级导航**（Push/Pop，对应 `WKInterfaceController.pushController`）
- **页面模态**（present，全屏覆盖）

```vue
<p-nav-stack>
  <p-page title="主页" />
  <p-page title="详情" />   ← 推入
</p-nav-stack>
```

**禁止 TabBar / Drawer / Rail**（手表屏幕装不下）→ Compiler 告警。

---

## 7. 降级策略

| 场景 | 降级 |
|------|------|
| 非手表端使用 `p-watch` | 退化为普通 `p-page` |
| 无表冠能力 | `<p-crown>` 隐藏，改用触摸滚动 |
| 并发症数据过大 | 截断为单行 |

---

## 8. 严格规则

| 规则 | 级别 | 说明 |
|------|------|------|
| **WATCH001** | error | 手表页面必须单列一屏（铁律 G-25.3） |
| WATCH002 | warning | 手表字体建议 12-18pt |
| WATCH003 | error | 禁止手表使用 TabBar / Drawer / Rail |
| WATCH004 | warning | 并发症数据须可截断为单行 |

---

## 9. B4 落地要点

1. 定义 `WatchProfile`（w=xs / h=xs / f=dial）
2. Compiler 强制单列（WATCH001）+ 禁用宽导航（WATCH003）
3. 表冠事件映射（Apple Watch / Wear OS / 鸿蒙）
4. 并发症数据模板（各端表盘服务）
5. 真机验收：Watch Simulator + Wear OS Emulator

---

## 10. 小结

手表是柔性框架方法论的**边界验证**：
- 最极端的 xs×xs → `p-fluid` / `p-grid` 自动收敛
- 独有输入 dial → `p-crown` + F 维度
- 表盘能力 → `p-complication`
- 系统导航 → `p-nav-stack`

**如果 Proteus 能优雅覆盖手表，就证明这套方法论真的"通吃一切带屏设备"。**
