# G-48 兼容式小程序运行容器

> **一句话**：把**微信小程序标准当事实标准**，做「标准运行时内核 + 各平台 Adapter」的兼容容器——让任意标准小程序在自有 App 宿主里跑起来，能力调用走统一桥接 + G-46 凭证共享。

> **方法论定位**：原则 #0「不绑定」系列第 12 次投影——**不绑定小程序运行时形态**。

详见 `01-problem.md`（动机与竞品）+ `02-architecture.md`（三层架构）。

## 快速开始

```bash
# 看演示（标准运行时 + 微信/鸿蒙双 Adapter + 沙箱 + 兼容矩阵）
node reference-impl.cjs

# 机器自检（13 项 + 负向自检）
bash verify.sh
```

## 文件清单

| 文件 | 内容 |
|------|------|
| `01-problem.md` | ★ 痛点 + 竞品横向 + G-48/49/50 路线 |
| `02-architecture.md` | ★ 三层架构 + 双线程 + setData + 与既有体系集成 |
| `03-spi.md` | ★ Runtime SPI + PlatformAdapter SPI |
| `04-standard-runtime.md` | ★ 标准运行时内核（AppService/PageFrame/生命周期/代码包） |
| `05-adapter-pattern.md` | ★ Adapter 规范 + **兼容矩阵**（L0/L1/L2/L3） |
| `06-capability-bridge.md` | 能力桥接（Capability IR：login/pay/share...） |
| `07-sandbox-isolation.md` | **L1 基线**：AppID 级逻辑隔离（凭证派生 / 存储分桶 / 销毁级联） |
| `08-security.md` | 第三方小程序信任模型 + 攻击树 |
| `conformance.md` | CMP + 标准符合性 + 兼容矩阵验证 |
| `reference-impl.cjs` | ★ 可运行参考实现（26/26 PASS，零依赖） |
| `verify.sh` | 自包含验证（完整性 + 负向自检 + 运行实现） |
| `rules.md` | G-48.1-8 + CMP-103-109 + 反模式 |
| `architecture-update.md` | 原则 #13.37-40 + 全局 G 表对齐 + 诚实边界 |
| `MANIFEST` / `pack.sh` | 清单 + 安全打包（`CHECKSUM` 不存在于目录：由 `pack.sh` 生成，完整性断言可选） |

## 核心设计

```
标准小程序（微信语法）
       ↓ ① 标准运行时内核（寄宿 G-39 HostRuntime）
  AppService（逻辑层）←→ PageFrame（视图层）  via setData
       ↓ ② Platform Adapter SPI（G-28 特化）
  微信 / 支付宝 / 抖音 / 鸿蒙
       ↓ 凭证走 G-46 ResourcePool（按 AppID 派生 scopedToken）
```

> **术语消歧（三组 L，勿混读）**：① 兼容级别 **L0-L3**（运行时，`05-adapter-pattern.md`）；② 信任级别 **L1-L3**（第三方来源，`08-security.md`）；③ 隔离强度 **L1-L4**（G-49 分层，本包 07 = **L1 基线**：AppID 级逻辑隔离）。

**关键**：运行时**只认标准接口**，平台差异**全部封装在 Adapter**——换平台只需新 Adapter，**内核零改动**。

## 诚实边界

- ✅ **可宣称**：自有 + 受控第三方，AppID 级逻辑隔离；兼容微信标准小程序，90%+ API 一致
- ❌ **不可宣称**（需 G-49）：任意第三方代码安全运行、进程级隔离、资源完全隔离

详见 `08-security.md` + `architecture-update.md`。

## 依赖关系

```
G-27 渲染后端 ← 小程序组件
G-28 NativeBackend ← Platform Adapter 即其特化
G-39 宿主运行时 ← 标准运行时寄宿
G-42 容器/安全网关 ← 能力调用过网关 + 第三方小程序信任模型
G-43 所有权/Drop ← 小程序生命周期 = 所有权根（销毁级联）
G-44 Test IR ← conformance 统一 runner
G-45 动态装载 ← 代码包 = DynamicBackendModule
G-46 资源池 ← 凭证/存储按 AppID 隔离
G-47 组合一致 ← 运行时 × 资源池接缝
```

## 验证状态

```
reference-impl.cjs → 26/26 PASS
verify.sh          → 13/13 + 负向自检 1（EXIT 0）
```
