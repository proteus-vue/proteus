# G-30：任意端接入能力（Universal Backend）

> **Status**: Draft（待评审）
> **Layer**: L1 方法论层（与 G-27/G-28/G-29 同级，四层可插拔的"泛化证明"）
> **Depends on**: G-27（渲染 SPI）、G-28（能力 SPI）、G-29（编译 SPI）、原则 #10
> **Prerequisite**: 原则 #10（统一语义 + 后端实现）

---

## 0. 一句话定义

> **Proteus 的"任意端"不是一句口号，而是一条可被形式化验证的工程断言：**
>
> **只要一个平台能提供「渲染宿主」+「原生能力宿主」+「JS 运行时」三者之一，它就可以通过实现一个 Backend 接入 Proteus；三者全有则该端"一等公民"，缺一则该端"受限可用"。**

**这就是 Proteus 与传统框架"小程序 API 映射"的本质分水岭**（详见 §8 对标）：

- 传统框架的隐含假设：**"小程序是标准，其他端向小程序靠拢"** —— 所以鸿蒙来了、车机来了、Flutter 来了，它们就得一直加 ifdef。
- Proteus 的隐含假设：**"没有任何单一平台的 API 应成为标准；真正的标准是框架自己的语义 IR，各端来适配我"** —— 所以新端 = 实现一个 Backend，不是加一层翻译。

---

## 1. 核心断言：任意端接入的形式化定义

### 1.1 端的"最小完备三元组"

Proteus 将一个"端（Platform）"定义为三元组：

```
Platform = (R, C, J)

R: 渲染宿主（Render Host）—— 能否把 IR 画出来
C: 能力宿主（Capability Host）—— 能否提供原生能力
J: JS 运行时（JS Runtime）—— 能否跑 Vue/JS 逻辑
```

| 维度 | 职责 | 对应 SPI |
|------|------|----------|
| R 渲染宿主 | 消费 Render IR → 输出像素/控件树 | `ProteusRenderBackend`（G-27） |
| C 能力宿主 | 实现 `ProteusNativeBackend` 语义接口 | `ProteusNativeBackend`（G-28） |
| J JS 运行时 | 执行 Vue SFC 逻辑、响应式、JSI 通信 | JSI（Hermes/JSC/V8） |

### 1.2 接入等级（Tier）

不是所有端都"全功能"，这很正常。**关键是：框架承认这种差异，并在编译期显式处理，而不是运行时崩溃。**

| 等级 | 条件 | 典型端 | 开发者代价 |
|------|------|--------|-----------|
| **Tier 1 一等公民** | R ✓ + C ✓ + J ✓ | iOS / Android / Harmony / Web / 小程序 Skyline | **零** |
| **Tier 2 受限可用** | 缺 J（无 JS 运行时）或 缺 C（无原生能力） | 嵌入式屏 / 电视盒子 / 部分 IoT | 受限 API 编译期报错 |
| **Tier 3 纯渲染** | 仅 R ✓ | Flutter Embedder / Skia Canvas / 游戏引擎 / VR | 只用 UI，不用原生能力 |
| **Tier 4 纯计算/Headless** | 仅 J ✓ | SSR / 测试 / AI Agent / CI | 无 UI、无原生，逻辑可跑 |

**关键设计**：Tier 2/3/4 **不是"不支持"，而是"显式降级"**。开发者写一份代码，Compiler 根据目标端的 Tier **自动裁剪**可用 API 集合。

### 1.3 接入门槛（Backend 需要实现多少东西？）

> **争议点澄清**："任意端"不等于"每个端都要实现全部 API"。这正是传统框架的误区——它们要求每端都对齐小程序 API 全集，做不到就 ifdef。

Proteus 的门槛是**分层的**：

```
Backend 接入最小集（Tier 3 起步）：
  ┌─ ProteusRenderBackend
  │    createElement / insert / remove / patchProp / setText
  │    + BackendCapabilities.layout 声明
  └─ 实现约 10-15 个方法  →  即可渲染

Backend 完整集（Tier 1 升级）：
  ┌─ + ProteusNativeBackend（G-28，Top 30 能力）
  └─ + JSI 绑定层
```

**一个端的维护者只需要实现 ~15 个核心方法就能让 Proteus 跑起来。** 这是"任意端"可被工程化的关键——门槛低到单个平台团队（甚至社区）就能完成。

---

## 2. 任意端的理论边界（什么"端"接不进来？）

**诚实比口号重要。** 必须明确声明 Proteus 的"任意"是有边界的：

### 2.1 可接入（满足三元组之一）

| 类别 | 举例 | 接入路径 |
|------|------|----------|
| 移动 OS | iOS / Android / Harmony / 鸿蒙 Next | NativeBackend + Native SPI |
| 桌面 OS | Windows / macOS / Linux | NativeBackend（Flutter/Skia 亦可） |
| Web 体系 | Web / H5 / PWA / Electron | VueDomBackend（nodeOps 零成本） |
| 小程序 | 微信 / 支付宝 / 抖音 / 百度 / 快应用 | MiniProgramBackend（Skyline 优先） |
| 跨端自绘 | Flutter / Skia / Canvas | FlutterBackend（Embedder C ABI） |
| 新兴设备 | 车机 / 手表 / TV / 折叠屏 / VR/AR | NativeBackend 或 SkiaBackend |
| IoT/嵌入式 | 智能屏 / 带屏音箱 / 工控屏 | Tier 2/3（受限可用） |
| 非视觉 | SSR / 测试 / CI / AI Agent | HeadlessBackend（G-27 B6） |

### 2.2 不可接入（或需特殊路径）

| 情况 | 原因 | 处置 |
|------|------|------|
| **纯后端服务**（无 UI 无交互） | 不是"端"，是服务 | 用 Node/Go 等，不进 Proteus |
| **无 JS 运行时且无渲染宿主**（裸 MCU） | 三元组全缺 | 不在 scope，建议走原生开发 |
| **强实时/强安全隔离**（航空航天、医疗） | 需确定性执行，JS 不合适 | 走原生，Proteus 不承诺 |
| **已有封闭生态且不允许嵌入 JS**（部分游戏引擎默认） | J 维度缺失 | Tier 3 纯渲染（作为 UI 层嵌入） |

**结论**：在"需要 UI + 有计算能力 + 允许 JS/嵌入"的范围内，Proteus 是**真正任意端**。这个范围覆盖了 99% 的业务场景。

---

## 3. Backend 实现者指南（"写一个 Backend"的最小流程）

> 这一节直接服务于"任意端"——**让一个新端的接入变成一份可照做的 recipe**，而不是框架团队的事。

### 3.1 五步接入法

```
Step 1  声明 capabilities     →  backend.config.ts（我能做什么）
Step 2  实现 RenderBackend    →  nodeOps 10-15 个方法
Step 3  实现 NativeBackend    →  原生能力（按需，Tier 1 才需要）
Step 4  跑 conformance test   →  pnpm test:backend
Step 5  发布为独立包           →  @proteus/backend-xxx
```

### 3.2 Step 1：声明 capabilities（关键创新）

```ts
// backend.config.ts
export default defineBackend({
  name: 'my-platform',
  tier: 3,  // 起步：纯渲染
  capabilities: {
    render: {
      layout: 'yoga',          // 或 'native' / 'none'
      supportsShadow: true,
      supportsBlur: false,     // 明确声明不支持
    },
    native: {
      scanQR: { supported: false, reason: 'no camera SDK yet' },
      share: { supported: true },
      location: { supported: false },
    },
    compiler: {
      target: 'wasm',          // 该端用什么编译后端
    }
  }
})
```

**Compiler 读这个文件 → 自动裁剪该端可用 API + 自动生成降级/报错。** 这就是"显式降级"的工程落地。

### 3.3 Step 2：实现 RenderBackend（最小集）

```ts
// backend.ts —— 仅需实现 nodeOps
import { defineRenderBackend } from '@proteus/core'

export const MyPlatformBackend = defineRenderBackend({
  createElement(type, props) {
    // type: 'p-grid' / 'p-button' ...
    // 映射到你平台的 UI 原语
    return MyPlatform.createElement(mapType(type), props)
  },
  insert(child, parent, anchor) { /* ... */ },
  remove(child) { /* ... */ },
  patchProp(el, key, prev, next) { /* ... */ },
  setText(el, text) { /* ... */ },
  // ... 约 10-15 个方法
})
```

### 3.4 Step 4：conformance test（强制，铁律）

```bash
$ pnpm test:backend --backend=my-platform

  ✓ createElement: p-grid → 正确产出网格容器
  ✓ insert / remove / patchProp 语义一致
  ✓ 同一 IR 在三端 Backend 产出等价结果 (IR Golden Test)
  ✓ capabilities 声明与实际实现一致 (无虚假声明)
  ✗ scanQR: 声明 supported:false 但业务代码调用了 → 编译期报错 ✓
```

**这是"任意端"可信的根本**：不是"你声称实现了就行"，而是 **conformance test 自动验证**，过不了 CI 红。

---

## 4. 编译期裁剪（Tier-aware Compilation）

> 这是 G-29（编译可插拔）+ G-28（能力 SPI）的联合产物，也是"任意端"的落地引擎。

### 4.1 工作原理

```ts
// 开发者写一份代码
const native = useNative()
const result = await native.scanQR()   // ← 用到了相机能力

// 编译目标：车机（Tier 2，无相机）
// Compiler 读 backend.config.ts → scanQR.supported: false
// → 编译期直接报错：
//
//  [Proteus] Error: `scanQR` is not supported on target "car-infotainment"
//          (declared in backend.config.ts).
//          Fallback options:
//            1. Provide a custom implementation via defineCapability('scanQR', ...)
//            2. Use @conditional('scanQR') to supply a fallback UI
//            3. Remove this capability requirement
```

**而不是运行时崩溃。** 这就是与传统框架的本质差异（详见 §8）。

### 4.2 降级原语（给开发者的逃生舱）

```vue
<!-- 用 @conditional 提供降级 UI -->
<p-conditional capability="scanQR" :fallback="manualInput">
  <template #default>
    <p-button @click="scan">扫码</p-button>
  </template>
  <template #fallback>
    <p-input v-model="code" placeholder="请手动输入" />
  </template>
</p-conditional>
```

**Compiler 根据目标端的 capabilities 自动选择分支。** 一份代码、多端各自合理表现。

---

## 5. 与既有四层的协同矩阵

> G-30 不是新造一层，而是**对 G-27/G-28/G-29 的泛化证明**——证明这套方法论对"任意端"成立。

| 维度 | SPI | G-30 的角色 |
|------|-----|-------------|
| 编译 | `ProteusCompilerBackend`（G-29） | 为每个端选择编译后端 + Tier-aware 裁剪 |
| 逻辑 | JSI | 任意端只要有 JS 运行时即可接入 |
| UI | `ProteusRenderBackend`（G-27） | **任意端的最小接入门槛（~15 方法）** |
| 能力 | `ProteusNativeBackend`（G-28） | 按需实现，capabilities 显式声明 |

**铁律（原则 #10 泛化至"任意端"）：**

- **G-30.1**：所有端必须通过同一份 IR → 同一份 conformance test，**禁止"某端特例化"**。
- **G-30.2**：新增端 = 新增 Backend 包，**禁止修改框架核心代码**（开放封闭原则）。
- **G-30.3**：capabilities 必须**显式声明**（supported/unsupported + reason），禁止隐式假设。
- **G-30.4**：Tier 2/3/4 的降级路径必须在编译期可用，禁止"该端默默失败"。

---

## 6. 落地分批

| 批次 | 目标 | 交付 |
|------|------|------|
| **B1** | 形式化定义 + Tier 模型 + capabilities schema | 本文档 + JSON Schema |
| **B2** | conformance test 框架 | `proteus test:backend` CLI |
| **B3** | 首个"冷启动新端"演练：**车机 Backend**（验证 Tier 2） | `@proteus/backend-car` 原型 |
| **B4** | 降级原语 `@conditional` + 编译期裁剪 | Compiler Plugin |
| **B5** | 文档化 "Write a Backend" 官方指南 + 模板工程 | `create-proteus-backend` |

**B3 是关键证据**：只有当一个**框架团队之外的人**能在**几天内**接入一个**全新的、没人预研过的端**，才证明"任意端"是真的。B1-B2 是论证，B3 是验证。

---

## 7. 风险与边界（必须诚实）

| 风险 | 缓解 |
|------|------|
| "任意端"被误解为"每端体验一样好" | 明确 Tier 模型：**一等公民 vs 受限可用**，体验差异是设计事实 |
| Backend 生态质量参差 | conformance test 是硬门槛 + 官方审计签名（沿用 G-28 生态治理） |
| 极低份额端不值得维护 | Tier 2/3 降级 + 社区维护模式，不要求官方全包 |
| 性能下限不可控 | 每端 Backend 有性能基准测试（沿用 G-27 性能矩阵） |
| 抽象泄漏（开发者仍感知到端差异） | `@conditional` + 语义收敛（原则 #10），但承认复杂端必有少量差异 |

---

## 8. 对标：小程序 API 映射 vs 语义 IR（FAQ 素材）

> 这是对外讲"降维打击"的核心话术，建议同步进 `proteus-positioning-v3.md` FAQ。

| | 传统框架（uni-app / Taro / Rax） | **Proteus** |
|--|----------------------------------|-------------|
| 核心思路 | **API 翻译**：小程序 API = 标准，翻译到其他端 | **语义收敛**：框架 IR = 标准，各端 Backend 实现 |
| "标准"归属 | 微信定义的小程序 API | **Proteus 自己定义的语义层** |
| 跨端方式 | 条件编译 `#ifdef` + 映射表 | **SPI + conformance test** |
| 新端扩展 | 重写映射表（工作量大、易漏） | **实现 ~15 方法 + 跑 test** |
| 缺失能力 | **运行时才发现**（崩溃/空返回） | **编译期 capabilities 报错** |
| API 风格 | 跟随微信（回调、无类型） | **框架定义（Promise、全类型）** |
| 版本绑定 | 跟着微信 API 版本走 | **框架独立演进** |
| 组合能力 | 开发者手写 ifdef | **语义层组合，`@conditional` 降级** |
| 端的能力差异 | 隐藏 → 运行时爆炸 | **显式 Tier + 编译期裁剪** |
| 调试 | 翻译后代码，报错在原生层 | **IR 层校验，错误在语义层** |

**一句话总结**：

> 传统框架说："**小程序是中心，大家来适配小程序。**"
> Proteus 说："**没有中心，只有语义；任何端只要实现 Backend，就是一等公民。**"

---

## 9. 结论

**"任意端"不是一个 marketing 词，而是可以被以下三者共同证明的工程断言：**

1. **形式化**：Tier 模型 + 三元组定义，明确边界（§1, §2）
2. **可操作**：Backend 实现者五步法 + ~15 方法门槛（§3）
3. **可验证**：conformance test 强制，CI 自动校验（§3.4, §6 B3）

**G-30 + G-27 + G-28 + G-29 共同构成"四层任意端"的完整论证**——Proteus 在编译、逻辑、UI、能力四个维度全部可插拔，因此**对任意端开放，对任意端收敛**。

---

## Appendix A：目标端全景图（规划中）

```
移动端       iOS / Android / Harmony        →  Tier 1（官方）
桌面         Windows / macOS / Linux        →  Tier 1（官方/社区）
Web          H5 / PWA / Electron            →  Tier 1（VueDom 零成本）
小程序       Skyline / 微信 / 支付宝 / 抖音  →  Tier 1（Skyline 优先）
自绘         Flutter / Skia / Canvas        →  Tier 3 → Tier 1
车机/IoT     车机 / 智能屏 / 工控           →  Tier 2（B3 验证）
穿戴         手表 / 手环                    →  Tier 2/3
大屏         TV / 广告屏 / 会议屏           →  Tier 2/3
沉浸         VR / AR                        →  Tier 3（SkiaBackend）
非视觉       SSR / Headless / AI Agent      →  Tier 4
```

## Appendix B：与原则 #10 的关系

> **原则 #10（统一语义 + 后端实现）的终极兑现 = "任意端"。**
>
> 只要后端实现是"可插拔的、可验证的、可被收敛的"，那么"任意端"就是这套原则的必然推论——不是额外特性，而是方法论的边界条件。
