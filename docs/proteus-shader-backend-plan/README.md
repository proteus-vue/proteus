# Proteus ShaderBackend（材质着色器可插拔落地层）

> 归属：基建层 / 横切能力（与 RenderBackend / CompilerBackend / HostRuntime 并列的**第五类可插拔层**）
> 执行位：G-29 邻域（材质着色器）——★**不占 G 序**（沿 G-08/G-22/G-61 领域引擎先例；G 表编号由 `check-consistency.js` 守，本 plan 为"方法论第 24 次泛化"，见 `docs/spi-first-methodology/`）
> 状态：**B1–B4 已落地（真机取证）；B6 像素等价门禁已落地**；B5 规划中
> 决策：#833（立项）

## 一句话定位

**框架内部的"材质算法"只写一次（Rust 的 WGSL 真源），各平台只做机械落地（编译生成物 + 设 uniform + 跑 pass）。**
框架出品的玻璃/模糊/渐变等材质服务是 **OS 级**——不依赖任何平台原生材质 API（`UIGlassEffect` / ArkUI `BlurStyle` 等随系统版本变），底层 GPU（Metal / AGSL / GLES）确定性落地同一份源。

## 为什么需要（旧架构的病）

- 玻璃算法**逐端手写**：Android `GlassMaterial.GLASS_AGSL`（AGSL 串）+ iOS CoreImage kernel，**逐行同模型**却各存一份 ⇒ N 份漂移源（违反"同一语义一处实现"）。
- 强依赖**平台原生材质 API**：`UIGlassEffect`（iOS 26+ 才有）、ArkUI `BlurStyle`——**系统版本一变就不可用**。
- 观感只能"各端逐轮回调"（#827–#832 的真机逐轮迭代史）。

## 架构（三层）

```
[真源] packages/shader-codegen-rust/          ← 算法唯一定义（Rust 拥有）
   materials/*.wgsl     材质算法（WGSL 单源）
   land/{msl,agsl,glsl}.rs   naga 落地：WGSL → MSL / AGSL / GLSL
   reference.rs          CPU 参考实现（像素等价门禁的 oracle）
   bin proteus-shader-gen   构建期生成器
        │  （构建期，经 scripts/gen-shaders.mjs）
        ▼
[SPI]  packages/shader/  @proteus-vue/shader   ← 落地后端 SPI（可插拔）
   spi.ts        ProteusShaderBackend{ id, version, capabilities, land(material) }
   conformance.ts   一致性套件（原则 #13）
   backends/{agsl,msl,glsl,headless}.ts   ≥2 参考实现
   generated/materials.ts   生成物（TS 常量 + 材质目录/ uniform 布局）
        │
        ▼
[落地] 宿主薄层（只编译生成物 + 设 uniform + 跑 pass）
   hosts/android/.../GeneratedMaterials.java   AGSL 源常量（gen-shaders 产出）
   hosts/android/.../GlassMaterial.java        RuntimeShader(生成物) + 设 uniform
   hosts/ios/.../generated-materials.swift     MSL 源常量（gen-shaders 产出）
   hosts/ios/.../glass-metal.swift             MTLDevice.makeLibrary(生成物) + 离屏渲染
   （鸿蒙：待接入 —— 需 XComponent+GLES/Vulkan 承载）
```

## 铁律

1. **算法只在真源**：任何宿主**不得**再写着色器算法；门禁 `check:shader-capability` 扫宿主源码里的算法指纹（`sd_round_rect`/`sdRoundRect`/…），命中即红（防复辟到"各端手写"）。
2. **生成物与真源不漂移**：`node scripts/gen-shaders.mjs` 产出全部落地物；门禁 `check:shader-generated` 重生成并比对，手改即红。
3. **不依赖平台原生材质 API**：材质走底层 GPU（Metal/AGSL/GLES）。系统材质（`UIGlassEffect` 等）仅可用于**壳 chrome**（真实视图层次），且不得作为内容节点材质的唯一路径。
4. **降级不崩溃**：任一端不可用（如 Android API<31 无 AGSL）⇒ 半透明实色回退，绝不白屏/黑块。
5. **可插拔可验证**（原则 #13）：SPI + Conformance + ≥2 参考实现齐备。
6. **像素等价是门禁**：设备 GPU 输出须与 Rust CPU oracle 在容差内相等（B6）。

## 落地目标

| 目标 | 端 | 承载 | 备注 |
|---|---|---|---|
| `msl` | iOS（+ 鸿蒙 Metal，若可达） | `MTLDevice` 离屏渲染 | 版本无关（Metal 平台稳定） |
| `agsl` | Android | `android.graphics.RuntimeShader` | 需 API 31+；<31 框架降级。★**AGSL 不支持 `while`**（只支持 `for`）⇒ 算法中固定次数的循环**必须展开**（naga 会把 WGSL 循环出成 `while`；landers 有"输出不得含 while"断言）。 |
| `glsl` | GLES3（鸿蒙承载 / 调试） | GLSurfaceView | 鸿蒙待接 |
| `headless` | 无 GPU（CI / 参考） | — | 不出可编译源（不假装成功） |

## 材质清单（覆盖所有材质面）

| 材质 | 状态 | 说明 |
|---|---|---|
| `glass` | ✅ 已迁（B2/B3） | 边缘倒角厚板：真圆角 SDF + 外法线边缘折射 + 边键控模糊 + Fresnel 高光 + 磨砂白 |
| `backdropBlur` | ✅ 入材质（B4） | 玻璃基座（纯高斯近似模糊 + tint，无折射）——已落 MSL/AGSL/GLSL |
| `gradient` | ✅ 几何单源（B4） | **保留原生图元**（CAGradientLayer / LinearGradient）；**CSS 端点式下沉内核** `proteus_layout_gradient_endpoints`（此前 4 份手写副本） |
| `glow` | ✅ 曲线单源（B4） | **保留分层描边**（形状跟随，不适用盒填充 shader）；**分层曲线下沉内核** `proteus_layout_glow_layers`（此前 TS/Swift/Kotlin 手写） |
| `mask` | ✅ 曲线单源（B4） | **保留原生遮罩**（CAGradientLayer-as-mask / PorterDuff）；**揭示色标**已在内核 `reveal_stops`（宿主改用 `proteus_layout_mask_stops`） |

> ★B4 的关键判断（**已取证**）：gradient/mask 已是**原生图元**（强行做自定义 shader = 向下降级）；glow 是**形状跟随**（不适用盒填充 shader）。⇒ 真正需要"单一真源"的是**重复的几何/曲线数学**，它下沉到**内核**（`GlowSpec::layers` / `style::linear_endpoints` / `MaskSpec::reveal_stops` = 唯一实现），宿主读结果——这可能比塞进 WGSL 更贴"一处实现"。

## 分批

- **B1 基建** ✅：crate + naga 落地(MSL/AGSL/GLSL) + CPU oracle + SPI 包 + 生成器 + `check:shader-capability`/`check:shader-generated` + CI/verify 接线。
- **B2 Android 竖切** ✅：`GlassMaterial` 改引生成物 AGSL；真机（真机 glass 面 + 滚动钉住）。
- **B3 iOS 竖切** ✅：删 CoreImage；`glass-metal.swift`（Metal）；真机 `Metal 管线就绪（真源=WGSL）`。
- **B4 前景材质** ✅：backdropBlur 入 WGSL；gradient/glow/mask 的**几何/曲线数学下沉内核单源**（宿主读结果）；真机验证三块渲染（`hosts/ios/results/glass-ios.png`）。
- **B5 鸿蒙** 📋：XComponent+GLES/Vulkan 承载研究 → 实现。
- **B6 收口** ✅（像素等价部分）：**玻璃像素等价门禁** `check:glass-pixel-parity`——本机 macOS Metal 渲染生成物 MSL vs Rust CPU oracle 逐像素比对（半纹素对齐后平均差 0.33/255、超差 <3% 上限；**破坏性验证**：故意错 20px 折射深度 ⇒ 11.5% 超差判红）。性能基线待补。

## 诚实边界

- **鸿蒙未落地**（B5）：无自定义片段着色器运行时，需 XComponent+GLES/Vulkan 承载（工作量最大）。
- **像素等价门禁**（B6）：CI 无 GPU ⇒ 属**设备/模拟器**门禁（本机 macOS Metal 可作为离线上位校验）；**AGSL 侧**目前靠真机日志+截图旁证（尚无 AGSL 离线等比）。
- **性能**：每玻璃节点一次离屏渲染（Metal）/ 每帧 backdrop 捕获——待真机性能基线核。
- ★★**教训（#835，真机复验才暴露）**：**"OS 级" = 真机验，不是 javac 验**——B2 的"Android 玻璃已验"实为仅在 javac 层；AGSL 因 `while` 一直编译失败、玻璃静默降级成半透明实色。⇒ 涉及宿主/着色器的改动**必须以真机截图 + 日志为准**。且**新接缝（Rust 写 → 宿主用的 JNI/AGSL）需要新门禁**（javac-only 覆盖不到）。

## 工具链

- **构建期生成**：`node scripts/gen-shaders.mjs`（调 Rust 发生器；本地 `--offline` 优先，CI 设 `PROTEUS_CARGO_OFFLINE=0`）。
- **抽取出图（离线编译/门禁）**：`node scripts/extract-generated-shader.mjs ts <material> <target> <out>`。
- **门禁**：`pnpm check:shader-capability` · `pnpm check:shader-generated` · `tests/shader-backend.test.ts`。
- **零设备编译**：`bash hosts/android/check-host-compile.sh` · `bash hosts/ios/check-selfdraw-compile.sh` · `xcrun -sdk iphoneos metal -c <gen.metal>`。

## 相关

- 决策 #833（立项 + B1–B3）· #818/#827–#832（玻璃算法的观感演进，现为新真源的"行为金标准"）。
- 同族 SPI：G-27 RenderBackend · G-29 CompilerBackend · G-39 HostRuntime（本层是它们之外的**材质着色器**维度）。
- 方法论：`docs/spi-first-methodology/`（本层 = 第 24 次泛化："不绑着色器落地语言/工具链"）。
