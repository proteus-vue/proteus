# G-28 原生能力可插拔架构

> 目标：**99% 的业务场景不需要开发者手写原生插件。**

## 1. 问题：传统跨端框架的原生插件痛点

uni-app / RN / Flutter 接入一个原生能力（如扫码）的真实流程：

1. 去插件市场找 → 不一定有、不一定维护、API 不统一
2. 找不到就自己写原生插件：
   - iOS：Swift/ObjC 模块 + 注册 bridge
   - Android：Java/Kotlin 模块 + 注册 bridge
   - 框架层：JS/TS 胶水代码调 bridge
3. 三端各写一份 → 维护三套代码
4. 版本升级 → bridge 碎了 → 重新适配

**本质：开发者被迫从"业务开发"降级成"框架基础设施开发"。** 扫码业务逻辑 10 行，原生封装 200 行。

## 2. 核心思路：原生能力 = 语义原语 + Backend SPI

框架已有前提：

- 原则 #10：统一语义 + 原生实现
- G-27：`ProteusRenderBackend` SPI（渲染后端可插拔）
- G-24：系统集成原语（`p-notify` / `p-permission` / `p-clipboard`）

缺的只是把 G-27 的 SPI 模式**泛化到非渲染领域**：

> 渲染有 `ProteusRenderBackend`，原生能力就有 `ProteusNativeBackend`。

```
SFC → Compiler → Semantic IR → ProteusNativeBackend SPI
                                        ↓
              ┌─────────┬─────────┬─────────┬─────────┐
              iOS       Android   Harmony   Mock/Web
              ↓         ↓         ↓         ↓
            AVCapture  CameraX   @ohos…camera  WebRTC
            CLLocation FusedLoc  geoLocation  GeolocationAPI
            …         …         …         …
```

开发者只调语义接口：

```ts
const native = useNative()
const { text } = await native.scanQR()   // ← 完了
```

## 3. 四层能力模型（帕累托 + 长尾封闭）

| 层 | 覆盖 | 开发者写原生代码？ |
|----|------|-------------------|
| **L1 框架内置**（Top 30，生命周期内置） | 80% 场景 | ❌ 零 |
| **L2 官方 Backend**（平台 SDK 直映射，独立包按需安装） | +18% | ❌ 零 |
| **L3 社区包**（生态贡献，签名审计） | +1.9% | ⚠️ 社区写，业务不用 |
| **L4 自定义 Backend**（仅 0.1%） | 长尾 | ✅ 兜底 |

**99% = L1 + L2 + L3。**

关键洞察：**L2 官方 Backend 把"开发者自己封装原生插件"转移给"平台 SDK 维护者"**——相机 SDK 作者本来就要维护三端实现，让他们出 `proteus-camera-backend` 比让每个业务开发者各写一遍合理得多。

## 4. 编译期自动化

```ts
// app.config.ts
export default defineAppConfig({
  capabilities: { camera: { reason: '扫码登录' }, location: 'when-in-use' }
})
```

Compiler 扫描 → 自动生成：

- iOS `Info.plist` 权限声明
- Android `AndroidManifest.xml`
- 鸿蒙 `module.json5`
- 各端原生模块注册代码

**杜绝运行时才发现漏配权限**（uni-app/RN 最痛的点）。

## 5. 与传统方案对照

| 维度 | uni-app 插件 | RN Native Module | Flutter Plugin | **Proteus Native SPI** |
|------|-------------|-----------------|---------------|----------------------|
| 开发者写原生代码 | 找插件不用，自己写要 | 必须写 | 必须写 | **不用** |
| API 统一 | 各作者随意 | 各库随意 | 各包随意 | **框架统一定义** |
| 三端一致 | 可能缺端 | 可能缺端 | 可能缺端 | **SPI 强制三端** |
| 版本升级 | 插件可能不维护 | Bridge 可能变 | 可能 breaking | **接口版本化，Compiler 适配** |
| 新平台扩展 | 重写插件 | 重写 Module | 重写 Plugin | **实现 SPI 即可** |
| AI 可介入 | ❌ | ❌ | ❌ | **✅ Agent 操作 IR** |

## 6. 三条铁律（防倒退）

- **G-28.1**：业务代码禁止平台判断或原生 SDK 直接调用 → 一律走 `useNative()`
- **G-28.2**：官方 Backend 必须三端 + 语义版本化（任一端缺失 = CI 红）
- **G-28.3**：新增常用能力须有 ≥3 端真实实现才进 L1

## 7. 可达性论证

1. 架构前提已具备：G-27 证 SPI 可行；G-24 已定义系统能力语义；G-21 Compiler Plugin 可扫描生成代码
2. 业界有类似尝试：Flutter `platform_channels`、expo-modules，但它们要求开发者定义 Channel + 写原生代码；Proteus 预置常用能力语义 + 官方 Backend
3. 范围可控：第一版只覆盖 Top 20–30 能力，其余走 L3/L4 扩展机制

详见 `02-native-backend-spi.md`（SPI 定义）、`03-capability-catalog.md`（Top 30 清单）、`04-compiler-automation.md`（编译期生成）。
