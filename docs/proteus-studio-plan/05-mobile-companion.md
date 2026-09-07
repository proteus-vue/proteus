# G-56 移动端伴侣

> **这是 Studio 相对三个宿主最独特、也是唯一无法被复制的价值。**

---

## 1. 三个宿主的结构性空白

| 宿主 | 移动端 | 原因 |
|------|--------|------|
| VSCode | ❌ | Electron 无移动目标 |
| IntelliJ | ❌ | JVM 桌面端 |
| **Zed** | ❌ | Rust，但架构为桌面设计；官方无移动计划 |

**不是"没做"，是"结构上做不了"。**

而 Tauri 2 **官方支持 iOS / Android 目标**。

---

## 2. 核心价值主张

### 2.1 传统调试的割裂

```
写代码（桌面 IDE）
   ↓ 构建
装到手机
   ↓
看日志（logcat / Console.app）
   ↓ 猜测
回到 IDE 改代码
```

**问题**：你看到的永远只是**日志输出**，不是**运行时状态**。

### 2.2 Studio 伴侣提供的

> **手机装一个 Proteus Studio → 真机上打开你的 App → 直接看到它自己的 SPI 后端、隔离状态、conformance 结果。**

```
┌─────────────────────────────┐
│  手机上的 Proteus Studio     │
│  ┌───────────────────────┐  │
│  │ 当前激活的 SPI 后端     │  │ ← G-54 能力 1
│  │  · render    → WebGL   │  │
│  │  · storage   → SQLite  │  │
│  ├───────────────────────┤  │
│  │ 隔离状态（G-49）        │  │
│  │  · L1 进程隔离  ✓       │  │
│  │  · L2 数据隔离  ✓       │  │
│  ├───────────────────────┤  │
│  │ conformance 结果        │  │
│  │  · G-46 数据一致 12/12  │  │
│  │  · G-49 隔离     8/8   │  │
│  └───────────────────────┘  │
└─────────────────────────────┘
```

**这不是"远程调试"，是"在真机上直接查看运行时自检结果"。**

---

## 3. 三种使用场景

### 场景 A：现场问题定位

用户报"在你的 App 上某个功能坏了"。开发者带着装了 Studio 的手机到现场，**直接看这台设备上 SPI 后端的选择结果和 conformance 状态**——不需要连电脑、不需要看日志。

### 场景 B：真机矩阵验证的补充

G-53 的云真机是"远程控制别人的设备"。
**伴侣是"在真实用户设备上直接自检"**——成本更低，且是真实使用环境。

### 场景 C：QA 自助验证

QA 不需要懂 IDE。装个 Studio，打开 App，看面板全绿即通过——**把 conformance 从开发工具变成验收工具**。

---

## 4. SPI 设计

```typescript
interface CompanionBridge {
  attach(target: AppTarget): Promise<CompanionHandle>
  inspectSPI(handle): Promise<SPIState>
  inspectIsolation(handle): Promise<IsolationState>   // G-49
  runConformance(handle, suite: TestSuite): Promise<Report>
}

interface SPIState {
  backends: { spiName: string; activeImpl: string; level: number }[]
  violations: LayerViolation[]      // G-54 能力 2
}

interface IsolationState {
  level: 0 | 1 | 2 | 3
  breaches: IsolationBreach[]       // G-49 ISOLATION_BREACH
}
```

---

## 5. ⚠️ 诚实边界（重要）

### 5.1 这是推演，无先例

**"手机上查看自己 App 的 SPI 状态"没有可参考的实现。** 本份只给出：

- 接口契约
- 使用场景
- 降级路径

**不包括可行性保证。**

### 5.2 三个未解问题

| # | 问题 | 影响 |
|---|------|------|
| 1 | **iOS 沙盒限制** | App 能否被外部 App inspect？可能需要 App 主动内嵌 companion SDK |
| 2 | **性能开销** | 手机上跑 conformance 是否可接受？需实测 |
| 3 | **Android 版本碎片** | 低版本系统的 API 可用性 |

**问题 1 最关键**——如果 iOS 不允许跨 App inspect，伴侣模式必须改为 **SDK 内嵌**（App 主动引入 companion 库），这会让"零侵入查看"的价值打折扣。

### 5.3 降级路径

```
companion.native   (外部 App inspect)
   ↓ 平台不允许
companion.sdk      (App 内嵌 companion 库)
   ↓ 不愿引入依赖
companion.remote   (手机连桌面 Studio)
```

---

## 6. 与 G-53 云真机的关系

| | 云真机 | 伴侣 |
|--|--------|------|
| 设备来源 | 云端租赁 | **真实用户设备** |
| 成本 | ¥0.5/分钟 | **0**（一次性安装） |
| 场景 | CI 自动化 | **现场定位 / QA 验收** |
| 需要网络 | ✅ | ❌ **可离线** |

**互补，非替代。** 云真机解决"批量覆盖"，伴侣解决"现场可信"。

---

## 7. 建议的实施顺序

**不要一开始做伴侣。** 它是本份风险最高、先例最少的部分。

```
阶段 1：Studio 桌面版（编辑器 + 终端 + 设备嵌入）
阶段 2：Linux 降级链与 PoC 验证
阶段 3：★ 伴侣模式探索（先做 companion.sdk，风险最低）
```

**companion.sdk 先做**——因为它不依赖平台是否允许跨 App inspect，**一定能做成**。
