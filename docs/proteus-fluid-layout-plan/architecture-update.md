# Architecture 规约更新（G-22）

## 1. 新增执行位

**G-22：柔性布局（Fluid Layout）** · 优先级 P0

## 2. 原则 #10 补充

> **框架定义布局语义（`p-fluid` / `p-grid` / `p-stack` / `p-fit`），Compiler + 各端运行时用各自最优方式求解约束。**

柔性布局是原则 #10 在"布局"维度的直接应用——与传统框架"把求解过程丢给开发者"相反，Proteus 把求解过程**下沉到框架 + Compiler**。

## 3. 铁律新增

- **G-22.1**：禁止手写 `@media (min-width: Xpx)` 做布局适配——改用 `p-fluid` / `p-grid`（FLD001）
- **G-22.2**：禁止硬编码像素断点值——统一从 `app.config.layout.breakpoints` 读取（FLD002）
- **G-22.3**：`p-grid` 必须声明 `min-col-width`，框架据此自动算列数（FLD004）

## 4. 全景图更新

```
基础设施  G-01~G-06, G-21        Compiler / IR / AOT / Memory / Plugin
渲染平台  G-07~G-10, G-20         App Renderer / Glass / i18n / Safe / App Config
应用能力  G-11~G-16               Memorial / Skeleton / Theme / Font / Cache / Style Safety
工程化    G-17~G-19               Router / CLI / DevTools
布局      G-22 ★                  柔性布局（Fluid Layout）
```

## 5. 与既有体系的协同

| 体系 | 协同点 |
|------|--------|
| CSS 兼容矩阵 (G-06) | `clamp()` / `grid-template` = ✅ 直映射 |
| Style Safety (G-16) | 柔性布局产物自动经 Validator |
| Compiler Plugin (G-21) | 柔性布局编译逻辑实现为官方插件（dogfooding） |
| App Config (G-20) | 断点 / 设计稿宽度走 `app.config.layout` |
| Safe Area | 柔性布局需避让安全区（padding 合并） |
