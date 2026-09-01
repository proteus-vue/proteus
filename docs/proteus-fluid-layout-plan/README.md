# Proteus 柔性布局（Fluid Layout）方案

> 执行位：**G-22** · 优先级：**P0** · 依赖：Compiler (G-02)、CSS 矩阵 (G-06)、Style Safety (G-16)

## 核心主张

> **开发者写一次语义布局，框架自动适配任意屏幕。**
> 无需手写媒体查询、无需手动算 flex、无需 `Dimensions.get()`。

## 文档清单

| 文件 | 内容 |
|------|------|
| [01-fluid-layout.md](./01-fluid-layout.md) | ★ 主文档：问题 / 四原语 / 语义 API / 对标 / 严格规则 |
| [02-compiler-implementation.md](./02-compiler-implementation.md) | Compiler 实现：LayoutConstraint AST / clamp 算法 / 断点推导 / Plugin 协同 |
| [03-api-strict-rules.md](./03-api-strict-rules.md) | API 设计 + FLD001-006 规则 + 自动修复 |
| [04-five-end-runtime.md](./04-five-end-runtime.md) | 五端原生映射 + 运行时容器监听 + 折叠屏 |
| [05-benchmark-batches.md](./05-benchmark-batches.md) | 性能预算 + 验收矩阵 + B1-B5 分批 + 可单测用例 |
| [architecture-update.md](./architecture-update.md) | 规约更新：G-22 + 原则 #10 补充 + 铁律 |

## 四核心原语

```vue
<p-grid :min-col-width="160">        <!-- 自适应列数：320→1, 768→4, 1440→8 -->
  <p-card v-for="item in items" />
</p-grid>

<h1 p-fluid="font-size(20, 32)">      <!-- 流式尺寸：自动 clamp -->
  标题
</h1>

<p-stack direction="row" :wrap="true"> <!-- 弹性栈：空间不足自动换行 -->
  <p-tag v-for="tag in tags" />
</p-stack>
```

## 可行性验证

```
✅ 断点推导    — deriveBreakpoints(375) → sm(188)/md(328)/lg(469)/xl(609)
✅ 网格密度    — 320→1, 768→4, 1440→8 列（自动）
✅ 流式 clamp  — clamp(20px, calc(15.77px + 1.1268vw), 32px)
✅ Flex 求解   — 400px / 3项 basis=100 / grow=1 → 各 133.33px
```

详见 [验证脚本](../../fluid-layout-verify.js) 运行结果。

## 关键设计决策

1. **布局 = 约束求解**，框架负责求解，开发者只声明意图
2. **编译期推导为主**（clamp 生成、断点推导），运行时监听为辅（仅 App 端容器变化）
3. **Web/Skyline 零 JS 开销**（`clamp()` + `vw` 原生响应式）
4. **对齐原则 #10**：框架定义语义，各端用原生方式求解
5. **实现为 Compiler Plugin**（G-21 dogfooding）

## 严格规则

| 规则 | 级别 | 说明 |
|------|------|------|
| FLD001 | error | 禁止手写 `@media` 断点 |
| FLD002 | error | 禁止硬编码断点值 |
| FLD003 | warning | `p-fluid` 须提供 min/max |
| FLD004 | error | `p-grid` 须声明 min-col-width |
| FLD005 | warning | 避免固定死尺寸 |
| FLD006 | error | 禁止 `Dimensions.get()` 手动算 |

## 下一步

建议 B1 与 Compiler Plugin (G-21) B1 **同期启动**：
- `generateClamp()` + `deriveBreakpoints()` + `calcColumns()` 三个纯函数
- 零依赖、可单测、验证通过 → 最快出"自动适配" demo
