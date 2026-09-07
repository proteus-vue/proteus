# Architecture 规约更新说明

> 本次把「统一语义 + 原生实现」作为**全局第 10 条设计原则**显式化。

---

## 更新内容

### 新增原则 #10

在 Architecture 规约的「设计原则」章节新增：

```markdown
## 原则 #10：统一语义 + 原生实现 (Semantics Unified, Implementation Native)

Proteus 不自己实现任何端的能力，只定义"统一语义"，再映射到各端最强原生实现。

- 语义层：定义跨端一致的语义契约（p-flex / pg-glass / api/*）
- 映射层：Compiler IR → 平台 API 调用
- 原生层：平台系统完成渲染

适用范围：布局、玻璃、导航、主题、动画、手势、字体、无障碍——全部能力域。

反例（禁止）：
- 引入 Skia/Canvas 自绘 UI
- 引入 Yoga 做跨端布局
- 用 WebView 套壳渲染 App
- 自己实现系统能力（手势/导航/无障碍）
- 硬编码像素值追求像素一致
```

### 新增全局铁律 #10（对齐 Memory 文档体系）

```
铁律 #10：框架定义统一布局语义，各端用原生方式实现。
      不允许引入跨端自绘布局引擎。
      语义一致优先于像素一致。
```

### 全景图更新（Layer 6: 语义层）

```
Layer 0: 业务层 (SFC + p-* 组件 + Vue 响应式)
Layer 1: 语义层 (LayoutSemantics / API Semantics / GlassSemantics) ← 本次新增
Layer 2: Compiler (SFC → IR + AOT)
Layer 3: 运行时 (Renderer + Reactivity + Scheduler)
Layer 4: 平台适配 (Web DOM / Skyline WXML / App Native View)
Layer 5: 宿主环境 (Browser / WeChat / iOS / Harmony / Android)
Layer 6: 基建 (CLI / DevTools / Testing / CI)
Layer 7: 横切 (Security / i18n / Glass / Memory / Performance)
```

---

## 影响范围

| Plan | 变更 |
|------|------|
| Architecture | 新增原则 #10 + 铁律 #10 + 全景图语义层 |
| App Renderer | 新增「布局引擎归属」章节（见 app-renderer-layout.md） |
| Component | 新增布局语义规范（见 component-layout-semantics.md） |
| Glass | 已对齐（preset → 系统 API），无需修改 |
| Platform | 已对齐（L1/L2/L3 分层 = 语义分层），无需修改 |
| Memory | 已对齐（销毁语义），无需修改 |

---

> 本次是**架构自洽性更新**：把隐含哲学显式化，不产生新代码，不产生新依赖。
