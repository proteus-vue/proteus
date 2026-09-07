# 集成与协同

> 本方案不是孤立模块，而是串联 CSS 矩阵 / Memory / Theme / HMR / DevTools 的枢纽。

---

## 1. 与 CSS 四级矩阵的关系

```
CSS 兼容矩阵（proteus-css-compat）
    ├─ ✅ 直映射 → 进入白名单（本方案 03-semantic-token-layer）
    ├─ 🔶 语义组件 → SEMANTIC_ONLY（本方案）
    ├─ ⚠️ 编译期重写 → Compiler 处理后进入白名单
    └─ ❌ 禁止 → FORBIDDEN（本方案）
            ↓
Style Runtime Safety（本方案）
    ↓ 保证非法值到不了原生
App Renderer → JSI → 五端原生
```

**本方案 = CSS 矩阵的"运行时执行层"。**

---

## 2. 与 Memory Plan 的协同

| Memory 机制 | Style Safety 应用 |
|-------------|------------------|
| `Owner` 作用域 | Validator 内部对象随页面销毁 |
| `Disposer` | 样式缓存注册销毁 |
| `Budget` | 样式对象数 + 字节预算 |
| LeakRegistry | 检测样式引用泄漏 |

→ **Style Safety 的对象零原生引用持有 → 无 JSI 循环引用风险。**

---

## 3. 与 Theme / FontScale 的协同

```vue
<!-- Theme token 编译期展开为 CSS 变量，GPU 联动，不走 JSI -->
<div :style="{ color: theme.colors.primary, fontSize: fontScale(16) }" />
```

- Theme token → CSS 变量 → **不走 Runtime Validator**（值由框架保证），零开销
- FontScale → `rem` 联动 → GPU 缩放，**不进 JS 线程**

详见 `proteus-app-capabilities` 02-theme / 03-font-scale。

---

## 4. 与 HMR 的协同

- 开发模式：`_validated` 保留 warn，HMR 即时反馈
- 生产模式：`__DEV__` 分支 tree-shake，`_validated` → identity

---

## 5. 与 DevTools 的协同

```
DevTools Panel
├─ Style Safety
│  ├─ 实时拦截日志（开发模式）
│  ├─ 降级统计（哪些属性被丢弃）
│  ├─ 静态推导覆盖率
│  └─ 逐平台类型收窄可视化
└─ ...
```

**对接 App Renderer 的 TraceBus**（已有 `--trace-transform`），样式校验事件统一上报。

---

## 6. 与 Glass L3 的协同

```vue
<!-- <p-glass> 内部：blur 值走语义组件安全路径，不走裸 :style -->
<p-glass :blur="theme.glassBlur" preset="navigationBar" />
```

→ **语义组件是"安全通道"**：开发者通过 `p-*` 传入的值由组件内部保证合法，绕过白名单限制（组件已审计）。

---

## 7. 与 Safe Area 的协同

```vue
<!-- p-safe-* 编译期为 CSS 变量 + 原生 insets，不走 JSI 动态校验 -->
<p-safe top :island-glass="true" />
```

→ **语义组件 + Theme + Safe Area = 三条"零运行时校验"的快路径。**

---

## 8. 架构全景更新

```
┌─────────────────────────────────────────────────────┐
│  SFC <style> + :style + p-* 语义组件                │
└────────────────────┬────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────┐
│  Style Runtime Safety (G-31)                        │
│  ├─ ① 编译期静态校验（CSS 矩阵联动）                 │
│  ├─ ② 编译期代码生成                                │
│  ├─ ③ 运行时 Validator                              │
│  └─ ④ 五端原生闸门                                  │
└────────────────────┬────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────┐
│  App Renderer (Custom Renderer patchStyle)          │
│  → JSI → 五端原生渲染                               │
└─────────────────────────────────────────────────────┘
```

---

## 9. 变更影响面（无破坏性）

| 模块 | 变更 |
|------|------|
| Architecture 规约 | 新增 G-31 + 原则 #10 补充 |
| CSS 兼容矩阵 | 无变更（本方案消费矩阵） |
| App Renderer | `patchStyle` 接入 Validator |
| Compiler | 新增 style-safety transform |
| Runtime | 新增 style-safety 包 |
| DevTools | 新增 Style Safety 面板 |

**全部为新增/接入，无破坏性改动。**
