# Proteus 设计原则补充文档

> 全局设计原则 #10：**统一语义 + 原生实现**

---

## 文档清单

| 文件 | 内容 | 归属 |
|------|------|------|
| `architecture-principle.md` | 原则 #10 完整定义 + 决策背景 + 适用范围 + 对外话术 | Architecture 规约 |
| `app-renderer-layout.md` | 布局引擎归属决策 + LayoutSemantics + 映射示例 + 里程碑 | App Renderer plan |
| `component-layout-semantics.md` | 布局组件语义规范 (p-flex/p-stack/p-grid) + 映射表 | Component plan |
| `config-update.md` | Architecture 规约更新说明（原则 #10 + 铁律 + 全景图） | 基建 |

---

## 核心结论

**Proteus 不追求"一套 UI 跑三端"（像素一致），而是追求"一份语义，三端各自最美"（语义一致）。**

```
统一语义层 (Semantics)
    ↓ Compiler IR
各端原生实现 (Native)
    ↓
系统渲染管线（原生质感 + 无障碍 + 系统新特性）
```

**这条原则贯穿全部能力域**：布局、玻璃、导航、主题、动画、手势、字体、无障碍。

---

## 关键决策

- ❌ 不引入 Skia/Canvas 自绘
- ❌ 不引入 Yoga 跨端布局引擎
- ✅ 定义语义契约 → 映射系统最强原生 API
- ✅ 语义一致优先于像素一致
- ✅ 系统新特性即时可用（如 iOS 26 液态玻璃）

---

## 使用方式

1. 将 `architecture-principle.md` 内容合并进 `Architecture.md` 的原则章节
2. 将 `app-renderer-layout.md` 作为附录加入 `proteus-app-renderer-plan`
3. 将 `component-layout-semantics.md` 合并进 Component plan 的布局章节
4. `config-update.md` 作为 PR 描述参考

---

## 验证清单

- [x] 原则 #10 与 Glass plan 对齐（preset → 系统 API）
- [x] 原则 #10 与 App Renderer 对齐（JSI → Native）
- [x] 原则 #10 与 Platform 分层对齐（L1/L2/L3 = 语义分层）
- [x] 原则 #10 与 Memory plan 对齐（销毁语义）
- [x] 原则 #10 与 Performance plan 对齐（AOT/IFR 不违反原生优先）

---

> **这不是新架构，而是把隐含哲学显式化——让整个 23 份 plan 体系有一个贯穿始终的"灵魂"。**
