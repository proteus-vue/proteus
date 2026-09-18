# G-51 实施：从契约到真机

## 1. 实施阶段

```
阶段 1（本份）   InMemoryBackend + NativeAdapter 契约 + 参考实现  ← 已完成
阶段 2          各平台 NativeAdapter 真实现（Android/Harmony/iOS）
阶段 3          CI 集成：门槛机制 + 报告 diff + 回归门禁
```

## 2. 门槛机制（梯度验证）

```
L0 文档自检    ← G-50 selfcheck.js（结构）
L1 IR 模拟     ← TestIRRunner + InMemoryBackend（本份 36/36）
L2 真运行时    ← NativeAdapter 真实现（覆盖率逐步提升）
        ↓
  门槛：L1 必须 100% → L2 覆盖率可渐进
  任何 L2 失败 → 先 DEGRADED 报告，不阻塞 L1 回归
```

**为什么渐进**：真机环境差异大（设备、系统版本、厂商定制），一步到位不现实。先跑通 G-49 sandbox 子集（隔离泄漏检测），再扩到 G-46/47/48/50。

## 3. 阶段 2 真实现清单

### Android
- `android:process=":miniprogram_${appId}"` 独立进程
- `WebView.setDataDirectorySuffix(appId)` 隔离存储
- 崩溃隔离：进程崩溃不影响宿主（G-49 Drop 级联）
- **验证点**：G-49 `ISOLATION_BREACH` 真机可复现

### HarmonyOS
- `ArkRuntime` 多实例（`createArkRuntime`）
- 每个小程序独立 `EcmaVM` 实例
- **验证点**：实例间内存不共享（L4 级，G-50 后置）

### iOS
- WKWebView2 + 独立 `WKProcessPool`
- **诚实边界（CMP-117）**：iOS 无法应用内多进程，靠 WebContent 系统级隔离 → 承诺**语义等价，不承诺机制一致**

## 4. CI 集成设计

```yaml
# 伪代码
stages:
  - L0: node selfcheck.js              # 文档结构
  - L1: node reference-impl.cjs        # IR 模拟 100%
  - L2: ./gradlew connectedAndroidTest # 真机，覆盖率门槛可配置
artifacts:
  - report.json                        # INV-06 可序列化、可 diff
  - coverage.json                      # L2 覆盖率门槛
rules:
  - L1 必须 100%，否则阻断
  - L2 覆盖率 >= 门槛（初始 30%，逐步提至 80%）
  - report.json 与基线 diff，回归自动告警
```

## 5. 报告可 diff（INV-06）

```json
{
  "suite": "G-49-sandbox",
  "total": 2, "passed": 1, "failed": 1, "skipped": 0,
  "results": [
    {"name": "ISOLATION_BREACH-detection", "status": "FAIL", "category": "ISOLATION_BREACH", "loc": "..."}
  ]
}
```

**CI 门槛**：`failed` 字段非零即阻断；与 `runner-regression.gold` 基线 diff，结构变化需显式批准。

## 6. Runner 自身回归（INV-07）

`runner-regression.gold` = 一份固定 TestSuite + 期望报告快照。Runner 改动时：
1. 跑 gold suite
2. 对比报告结构与关键字段（total/passed/failed/category）
3. 不一致 → 阻断，需人工确认是"预期演进"还是"回归"

**这防止了 G-46/G-47 踩过的坑**：验证器自身改动引入静默行为变化。

## 7. 与 G-47 的组合接缝命题

```
G-47 INV-05：接缝切换不影响一致性（combined-conformance-plan）
  + G-51 INV-05：隔离泄漏可被检测
  → 组合命题：接缝切换 + 隔离泄漏检测 在 L1/L2 结果可比
```

该组合命题即本包 INV-08 的验证形态（登记见 conformance.md §1/§4，CMP-139 对应）；跨设备延伸由 G-52 侧以「G-51 INV-08 ∧ G-52 INV-D3」登记（见 `proteus-cross-device-verification-plan` conformance.md 接缝节）。

对应 `backend-switch-no-data-loss-ref` 用例（已在参考实现中）。

## 8. 已知缺口（诚实边界）

- NativeAdapter 真实现**未在本份完成**（仅契约 + 打点）
- 真机超时阈值（默认 5s）需按平台实测校准
- iOS 机制差异（CMP-117）意味着 L2 报告需**平台归一化层**
- 门槛值（30%→80%）是**建议**，由实施期数据决定
