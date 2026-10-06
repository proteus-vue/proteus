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
| Android | `platform/android/proteus-platform/src/dev/proteus/platform/` | `ProteusTextPlatform`（字体角色映射 Typeface + 自定义字体注册 + 文本度量：单行/折行/断词/行高） | ✅ **已抽取（B5-1 · 2026-10-07）**：字形 + **度量**均抽；宿主委托、真机渲染**逐像素一致** |
| 鸿蒙 | — | — | 未开始 |

★**诚实边界**：① **绘制执行**（`mkCmd` 的 StaticLayout/Canvas 上屏）**仍在宿主**——与 iOS 同构（两端绘制载体都是平台 View/layer，抽取收益低）；② **度量**已抽（`measureSingle`/`measureWrapped`/`applyWordBreak`/`isUnbreakableToken`/`lineHeightPx`），宿主 `VaporRenderHost` 委托。门禁 C 判据已收紧为"**必须是 `dev/proteus/platform/` 包**"（防把 SDK/AAR 当"抽取完成"）+ 结构契约测试 `tests/host-platform-extraction.test.ts`（钉住"平台层拥有实现、宿主只委托"）。
