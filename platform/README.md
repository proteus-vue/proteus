# platform/ —— 平台适配层（HA0.5）

> **本目录是什么**：各端**平台适配**代码——各端各写一份是**正确设计**（Host ABI 方案 §0.4.8），
> 不抽进 Host ABI。

## 边界（判断标准：这段代码换到同平台的另一个 App 里，需要改吗？）

| 需要改？ | 归类 | 落点 |
|---|---|---|
| **不用改**（同平台内通用） | **平台适配** | **本目录**（文本度量 / 字体映射 / 绘制执行 / 图片解码 / 原生组件挂载） |
| 需要改（每个宿主不同） | 宿主集成 | `hosts/`（Surface / 生命周期 / 输入 / 调度 / 能力注册 / 路由栈挂钩） |

## 硬性依赖方向（`pnpm check:platform-layering` 机器化，违反即红）

```
hosts/*      ──→  platform/*      ✅ 允许（宿主调用平台能力）
platform/*   ──→  hosts/*         ❌ 禁止
platform/*   ──→  Host ABI        ❌ 禁止（平台层不感知宿主契约）
```

★**为什么这条必须机器化**：分层只写在文档里必然漂移——某人为了让平台层"顺手"拿到宿主的一个
工具函数而 import 一下，分层就塌了，而**编译照过**。与「三条红线要工具层管」同源。

## 现状

| 端 | 目录 | 内容 | 状态 |
|---|---|---|---|
| iOS | `platform/ios/ProteusPlatform/` | `ProteusTextAdapter`（文本度量 CoreText + 字体角色映射 + 自定义字体注册） | ✅ 已抽取（HA0.5） |
| Android | `platform/android/proteus-platform/src/dev/proteus/platform/` | `ProteusTextPlatform`（字体角色映射 Typeface + 自定义字体注册） | 🟡 **部分抽取（B5-1 · 2026-10-07）**：**字形层**已抽（换壳不改）；**文本度量/绘制执行**仍在 `hosts/android/.../runtime/` 待续 |
| 鸿蒙 | — | — | 未开始 |

★**诚实边界**：HA0.5 分两步——① iOS 侧已全抽（度量 + 字体）；② Android 侧本轮（B5-1）**先抽字形层**（`ProteusTextPlatform`，与 iOS `ProteusTextAdapter` 的字体段对称），**度量/绘制执行待续**（与宿主耦合更深，逐文件迁）。门禁 C 判据已收紧为"**必须是 `dev/proteus/platform/` 包**"（防把 SDK/AAR 当"抽取完成"），见 `check-platform-layering`。
