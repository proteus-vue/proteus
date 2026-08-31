# 编译期 `:style` 静态推导与代码生成

> 目标：让 Runtime Validator 的调用频率趋近于零。

---

## 1. 核心思路

```
:style 表达式 AST
    ↓ 静态分析
可达值集（Reachable Values）
    ↓
├─ 完全静态 → 生成 _validated() 内联（值硬编码，查表级开销）
└─ 含动态源 → 保留为 _runtimeValidate() 调用
```

---

## 2. 可达值集推导

```typescript
// Compiler / style-safety / reachability.ts
interface ReachableSet {
  values: Set<unknown>     // 该表达式所有可能取值
  isFullyStatic: boolean   // 是否完全静态
  dynamicSources: string[] // 动态来源（如 apiData.width）
}

function deriveReachableValues(expr: Expression): ReachableSet {
  switch (expr.type) {
    case 'Literal':
      return { values: new Set([expr.value]), isFullyStatic: true, dynamicSources: [] }

    case 'Identifier':
      // 来自 <script> 的响应式变量 → 尝试常量折叠
      return lookupConstantValue(expr.name) ?? dynamic(expr.name)

    case 'ConditionalExpression': {
      const a = deriveReachableValues(expr.consequent)
      const b = deriveReachableValues(expr.alternate)
      return {
        values: union(a.values, b.values),
        isFullyStatic: a.isFullyStatic && b.isFullyStatic,
        dynamicSources: [...a.dynamicSources, ...b.dynamicSources],
      }
    }

    case 'BinaryExpression': {
      // width: base + 10 → 若 base 静态可达则折叠
      const l = deriveReachableValues(expr.left)
      const r = deriveReachableValues(expr.right)
      if (l.isFullyStatic && r.isFullyStatic) {
        return { values: new Set([evalConstant(expr)]), isFullyStatic: true, dynamicSources: [] }
      }
      return dynamic('binary')
    }

    default:
      return dynamic('unknown')
  }
}
```

---

## 3. 代码生成

### 完全静态 → 内联校验

```vue
<!-- 源码 -->
<div :style="{ width: isLarge ? '100px' : '50px', opacity: 0.5 }" />
```

```javascript
// 编译产物
_patchStyle(el, {
  // 值集 = {'100px','50px'}，均合法 → 直接内联字面量
  width: _validated('width', isLarge ? '100px' : '50px'),
  opacity: 0.5  // 编译期确认合法，零开销
})
```

`_validated` 实现（编译期已知值合法，仅做断言级检查）：

```typescript
// 开发模式：断言 + warn；生产模式：直接返回（dead code 消除）
export function _validated(prop: string, value: unknown): unknown {
  if (__DEV__) {
    const guard = PROP_TYPES[prop]
    if (!guard(value)) warnStyleRejected(prop, value)
  }
  return value
}
```

### 含动态源 → 运行时校验

```vue
<!-- API 返回值，编译期不可知 -->
<div :style="{ width: apiData.width + 'px' }" />
```

```javascript
// 编译产物
_patchStyle(el, _runtimeValidate({
  width: apiData.width + 'px'
}))
```

`_runtimeValidate` 走完整 Runtime Validator（见 `06-runtime-validator.md`）。

---

## 4. 覆盖率目标

| 场景 | 推导结果 | 运行时开销 |
|------|---------|-----------|
| 字面量 / 三元常量 | 完全静态 | ≈0 |
| `v-bind` 响应式常量 | 常量折叠后静态 | ≈0 |
| 简单算术（静态操作数） | 折叠 | ≈0 |
| API / 用户输入 | 动态 | O(n) |
| 复杂函数调用 | 动态 | O(n) |

**目标：静态推导覆盖率 > 80%**（即运行时 Validator 调用 < 20%）。

---

## 5. 常量折叠示例

```vue
<!-- 源码 -->
<div :style="{ width: baseWidth * 2 + offset }" />
```

```typescript
// 若 baseWidth=100, offset=10 在编译期已知（<script> 顶层 const）
// → 折叠为 210
<div :style="{ width: 210 }" />
```

**配合 Vue 的 `<script>` 静态分析**（Vite/Rollup 已具备），大部分业务场景可达完全静态。

---

## 6. 与 HMR 的协同

- 开发模式：`_validated` 保留 warn，HMR 时即时反馈非法值
- 生产模式：`__DEV__` 分支被 tree-shake，`_validated` → identity

---

## 7. 限制与边界

| 无法静态推导 | 原因 | 处理 |
|-------------|------|------|
| `Math.random()` | 运行时不确定 | → 运行时校验 |
| `fetch()` 返回值 | 异步动态 | → 运行时校验 |
| `$refs` 读取 | 运行时 DOM | → 运行时校验 |
| 复杂递归函数 | 不可判定 | → 运行时校验 |

**无法推导 ≠ 不安全**：只是退化为运行时 Validator，依然有保证。

---

## 8. 报错码（编译期）

| 码 | 含义 | 处理 |
|----|------|------|
| STS001 | 属性不在白名单 | 报错 + 引导改用 p-* |
| STS002 | 静态值类型非法 | 报错 + 定位源码 |
| STS003 | 语义组件属性裸写 | 报错 + 自动修复 → p-* |
| STS004 | `display: inline/float` 禁用 | 报错 + 自动修复 → p-flex |
| STS005 | `!important` 禁用 | 报错 |

详见 `08-strict-style-cli.md`。
