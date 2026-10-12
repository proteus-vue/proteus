// packages/shader/src/spi.ts
// ★★★G-62 ShaderBackend SPI（决策 #834）——材质着色器的**可插拔落地层**接口唯一事实源。
//
// 【它解决什么】旧架构里"玻璃算法"在每个宿主各手写一份（Android AGSL / iOS CoreImage / 鸿蒙各一份）
//   ⇒ 漂移、且强依赖平台原生材质 API（随系统版本变）。新架构：**算法真源 = Rust 的 WGSL**
//   （`packages/shader-codegen-rust`，经 naga 落地）⇒ 各端只是"把生成物编译并跑 pass"的**落地后端**。
//
// 【SPI 形态对齐 G-27/G-29/G-39（原则 #13：SPI + Conformance + ≥2 参考实现）】
//   · 声明 id/version/capabilities；
//   · 核心方法 `land(material)`：给定材质规格 → 返回该端可直接编译的着色器源 + uniform 描述；
//   · 落地后端不得含算法（算法只在 WGSL 真源里）——本接口的 `land` 是**纯落地**（编译/打包/取值）。
//
// 【与内核的分工】内核（`layout-core-rust`）只透传材质**参数**（`LStyle.glass` 等）；算法与落地在
//   本层。宿主拿到 `land()` 的产物后编译、设 uniform、跑 pass。

/** 落地目标端（= 真实 GPU 语言/承载）。 */
export type ShaderTarget = 'msl' | 'agsl' | 'glsl' | 'harmony'

/** 材质 id（与 Rust `materials::MaterialSpec.id` 同源；见 catalog）。 */
export type MaterialId = string

/** uniform 字段的字节布局（宿主据此写常量缓冲 / setFloatUniform）。 */
export interface UniformField {
  name: string
  /** 字节偏移（与 Rust `#[repr(C)]` 一致）。 */
  offset: number
  /** 字节长度（4/8/16…）。 */
  size: number
}

/** 一种材质在某目标的**落地产物**（宿主据此编译 + 设值）。 */
export interface LandedShader {
  /** 片元着色器源码（AGSL 必填；MSL/GLSL 亦有）。 */
  fragment: string
  /** 顶点着色器源码（MSL/GLSL 需要；AGSL 由框架提供几何 ⇒ 可空）。 */
  vertex?: string
  /** 片元入口名（MSL/GLSL）。 */
  entry: string
  /** uniform 结构名 + 布局（宿主据此设值）。 */
  uniformStruct: string
  uniformLayout: UniformField[]
  uniformSize: number
}

/** 能力声明（宿主/框架按能力降级，不按平台 if/else——对齐 G-27 的 BackendCapabilities）。 */
export interface ShaderCapabilities {
  target: ShaderTarget
  /** 是否支持运行时自定义着色器（`false` ⇒ 只能走系统材质或降级）。 */
  customShader: boolean
  /** 支持的最高玻璃层级（'L3' 系统材质 / 'L2' 自绘 shader / 'L1' 基础 / 'none'）。 */
  glass: 'L3' | 'L2' | 'L1' | 'none'
  /** 最低系统版本（如 Android API 31；低于则降级）。 */
  minSystemVersion?: string
}

/** ★G-62 核心：着色器落地后端。实现者只需实现本接口即可让某端支持材质着色器。 */
export interface ProteusShaderBackend {
  readonly id: string
  readonly version: string
  readonly capabilities: ShaderCapabilities
  /** 把某材质落地成该端可直接编译的着色器（纯落地，不含算法）。 */
  land(materialId: MaterialId): LandedShader
  /** 该端是否可用（版本门/驱动门）——false ⇒ 框架按其 capabilities 降级。 */
  isAvailable(): boolean
}
