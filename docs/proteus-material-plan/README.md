# Proteus 材质目录（Material Catalog）

> 归属：基建层 / 横切能力（ShaderBackend · G-29 邻域）——**材质 = 框架出品的 GPU 材质服务**
> SSOT：**材质定义**在 `packages/shader-codegen-rust/src/materials/mod.rs`（`MATERIALS`）+ 各 `.wgsl`；
>   下游（TS 目录 / 三端生成物 / 宿主管线）由 `node scripts/gen-shaders.mjs` **自动派生**，本文件**只做索引与选用指南**，不复制 uniform 布局（那会漂移）。
> 决策：#833（ShaderBackend 立项）· #900（材质派发 + 扩容）

## 一句话定位

**框架内部的"材质算法"只写一次（Rust WGSL 真源），各端只做机械落地**（编译生成物 + 设 uniform + 跑 pass）。
材质目录**数据驱动**：加一个 `MaterialSpec` 条目 + 一份 `.wgsl`，再跑 `gen-shaders.mjs` ⇒ TS 目录 / conformance /
三端生成物 / **宿主管线派发**全自动纳入（`check:shader-generated` / `check:shader-capability` 防漂移）。

## 材质清单（选用指南）

| 材质 id | 观感 | 适用 | uniform |
|---|---|---|---|
| `glass` | 边缘倒角厚板：**真折射** + 边键控模糊 + Fresnel 高光 + 磨砂白 | 主材质（卡片/导航/弹层的"液态玻璃"） | `GlassUniforms` 80B |
| `backdropBlur` | 纯高斯近似模糊 + tint（**无折射/高光**） | 只需"背后糊"、不要折射的场合 | `BlurUniforms` 64B |
| `frosted` | 模糊 + **程序化颗粒**（磨砂砂质） | 磨砂面板/毛玻璃卡片 | `BlurUniforms` 64B |
| `vibrancy` | 模糊 + **大幅提饱和**（通透有颜色） | 让背后色彩"活"起来的通透层 | `BlurUniforms` 64B |

> **业务视角**：正常写 `<pg-glass>`（默认 = `glass`，真折射）。需要别的材质写 `<pg-glass material="frosted">`——
> App 端折进 `style.glass.material`，宿主按 id 派发管线；Web/MP 端按 id 映射 CSS 近似（`cssSaturateForMaterial`，**无折射**，见下边界）。

## 平台边界（诚实）

- **App（iOS / Android / 鸿蒙）**：四材质**全支持**（自绘玻璃遍 / AGSL / Vulkan SPIR-V——同一份 WGSL 真源）。`glass` 有真折射，其余三者为纯模糊族（无折射）。
- **Web / 小程序**：**无 GPU 材质**——`<pg-glass>` 走 CSS `backdrop-filter`（blur + saturate）。`material` 仅影响 `saturate` 近似（`backdropBlur`≈1.1 / `frosted`≈1.3 / `vibrancy`≈2.4 / `glass`≈1.8），**均无折射**（决策 #877 边界）。

## 加一个材质（步骤）

1. `packages/shader-codegen-rust/src/materials/<id>.wgsl`（复用 `sample_backdrop` 骨架、**无循环**——AGSL 无 `while`）；
2. `materials/mod.rs` 加 `MaterialSpec` 条目（id / entry / wgsl / uniform_struct / uniform_layout）+ 加进 `MATERIALS`；
3. `node scripts/gen-shaders.mjs`（产出 TS 目录 + Android/iOS/鸿蒙 生成物）；
4. `packages/glass/src/types.ts` 的 `GlassMaterialId` 与 `resolve.ts` 白名单、`cli/app-component-registry.ts` 的 `KNOWN_MATERIALS` 加该 id；
5. `tests/shader-backend.test.ts` 的 id 集更新；门禁全绿。

> 若新材质**复用既有 uniform 布局**（如 `BlurUniforms`）⇒ 三端宿主**零改**（自动多一条管线）。

## 消费者 / 工具

- 业务单入口：`<pg-glass material="...">`（Web/MP 运行时 · App 编译期折叠 `style.glass.material`）。
- 宿主派发：iOS `glass-metal.swift`（每材质一 pipeline）· Android `GlassMaterial.java`（按 id 选 AGSL 源 + uniform）· 鸿蒙 `glass_vk.cpp`（每材质一 VkPipeline）。
- 门禁：`check:shader-generated`（无漂移）· `check:shader-capability`（真源可落地 · 宿主无手写算法）· `check:shader-generation`（TS conformance）。
- 像素等价：`check:glass-pixel-parity`（Metal ⇄ Rust oracle，**目前只覆盖 `glass`**——其余材质待扩，见「待办」）。

## 待办 / 边界

- 像素等价门禁（`check:glass-pixel-parity`）**仅覆盖 `glass`**；`backdropBlur`/`frosted`/`vibrancy` 尚无离线像素比对（靠真机截图旁证）——待扩。
- 性能基线（每材质离屏渲染开销）待补。
- 更多材质候选（金属/噪声/…）**未立项**——按需再加（本目录即扩容入口）。
