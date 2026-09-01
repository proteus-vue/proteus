# Compiler 实现细节

> 补充 G-22 主文档第 4 章：柔性布局在 Compiler 中的具体实现。

## 1. LayoutConstraint AST

Compiler 将 `p-*` 语义编译为**布局约束 AST**（与 CSS 四级矩阵的 IR 并列）：

```typescript
type LayoutConstraint =
  | { kind: 'fluid'; property: string; min: number; max: number; unit: 'px' | 'rem' }
  | { kind: 'grid'; minColWidth: number; gap: number }
  | { kind: 'stack'; direction: 'row' | 'column'; wrap: boolean; gap: number }
  | { kind: 'fit'; maxRatio?: number }
```

## 2. clamp 生成算法（已验证）

```typescript
function generateClamp(
  min: number, max: number,
  designWidth: number, viewportRange: [number, number]
): string {
  const [minVw, maxVw] = viewportRange
  const slope = (max - min) / (maxVw - minVw)
  const intercept = min - slope * minVw
  const preferred = `calc(${intercept.toFixed(2)}px + ${(slope * 100).toFixed(4)}vw)`
  return `clamp(${min}px, ${preferred}, ${max}px)`
}
```

**验证输出**：
```
fluidClamp(20, 32, 375, 1440)
→ "clamp(20px, calc(15.77px + 1.1268vw), 32px)"  ✅
```

## 3. 网格列数求解（已验证）

```typescript
function calcColumns(viewportWidth: number, minColWidth: number, gap: number): number {
  return Math.max(1, Math.floor((viewportWidth + gap) / (minColWidth + gap)))
}
```

**验证输出**：
```
320px  → 1 列
375px  → 2 列
768px  → 4 列
1024px → 6 列
1440px → 8 列
```

## 4. 编译期优化

- **常量折叠**：设计稿尺寸 + 断点 = 编译期可确定的值 → 直接内联
- **死代码消除**：未使用的断点区间 → 不生成 CSS
- **CSS 变量提取**：`p-fluid` 值提取为 `--p-fluid-{hash}`，便于运行时覆盖

## 5. 与 Compiler Plugin (G-21) 的协同

柔性布局的编译逻辑**本身实现为 Compiler Plugin**：

```typescript
// 官方插件：@proteus/plugin-fluid-layout
export default definePlugin({
  name: 'fluid-layout',
  transform(node) {
    if (node.hasDirective('p-fluid')) {
      return generateFluidConstraints(node, compilerContext)
    }
  },
})
```

> 这符合 G-21 的 dogfooding 原则：**核心能力 = 官方插件**。
