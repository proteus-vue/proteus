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
| 鸿蒙 | `platform/harmony/proteus-platform/src/main/cpp/` | `proteus_text_platform.h`（OH_Drawing Typography 度量：单行/折行 + 字体角色/字重） | ✅ **已抽取（B5-1 · 2026-10-07）**：helpers 移除 4 函数改 include；函数体**逐字一致**、真机无回归 |

★**HA0.5 三端（iOS/Android/鸿蒙）已收口**。门禁 C 判据要求"**必须有平台适配层**"（`PLATFORM_ADAPTATION`：ios=`ProteusTextAdapter` / android=`dev/proteus/platform/` / harmony=`proteus_text_platform`，删文件即红）+ 结构契约测试 `tests/host-platform-extraction.test.ts`（三端，钉住"平台层拥有实现、宿主只委托"）。
★**诚实边界**：**绘制执行**（`mkCmd`/Canvas 上屏）**三端都在宿主**——绘制载体是平台 View/layer，抽取收益低；**度量/字形**已全部抽到 `platform/`。
