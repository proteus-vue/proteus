# G-51 架构增量（原则 #13.51 - #13.53）

## 新增原则

**原则 #13.51（三层验证体系）** 任何 SPI 的 conformance 必须可在 L0（文档自检）/ L1（IR 模拟）/ L2（真运行时）三阶梯度上验证；前一阶是后一阶的回归测试。

**原则 #13.52（验证不绑定执行环境）** TestSuite 对后端无感知，通过统一 `Backend` 接口注入；L1/L2 替换不修改用例代码。

**原则 #13.53（门槛机制）** L1 必须 100%；L2 覆盖率可渐进（初始 30% → 80%）。任何 L2 失败先 DEGRADED，不阻塞 L1 回归。

## L0-L6 成熟度模型（统一口径）

```
L0 文档自检     ← G-50 selfcheck
L1 IR 模拟      ← G-51（InMemory 后端，本份 self-test 36/36）
L2 真运行时     ← G-51 + G-52（设备矩阵）
L3 跨设备云端   ← G-52（接口定义，调度留 G-53）
L4 开放生态     ← G-50（依赖 G-49 L3）
L5 开发者门户   ← G-50
L6 治理与分佣   ← G-50
```

> 注：成熟度模型以 G-52 `architecture-update` 版为统一口径（与白皮书 §4.8 / §9.1 一致）；本包不再单列 L4「跨设备一致」/ L6「生态治理」等旧行，相关语义分别并入统一表的 L2/L3 与 L4-L6。

G-51 将体系整体从 **L0/L1** 推至 **L2 入口**。

## 与既有体系互校

| 既有 | G-51 关系 |
|------|----------|
| G-44 Test IR | 扩展执行层，**不重写** |
| G-46 数据一致 | conformance 由 G-51 runner 执行（CMP-132~139） |
| G-47 组合一致 | INV-05 + INV-08 接缝组合命题 |
| G-48 运行时 | requireNative 降级链 |
| G-49 沙箱 | ISOLATION_BREACH 分类 + 真进程验证点 |
| G-50 平台 | dual-signature / publish 用例；L2 由门户触发 |

## 验证覆盖（截至 G-51，参考实现实测）

suite 执行（7 suites · 12 用例）：
```
G-46  data       2 cases
G-47  combined   1 case
G-48  runtime    2 cases
G-49  sandbox    2 cases
G-50  platform   2 cases
+ negative       1 case（负向自检 NEG-01）
+ runner-regression  2 cases（runner 自身，INV-07）
```
自断言（self-test）：**36/36**（执行正确性 20 + 覆盖/结构自检 16）

实测：`node reference-impl.cjs` → self-test 36/36，exit 0（其中 negative / ISOLATION_BREACH 2 项为预期 FAIL，属判别力自检）。suite 用例数与自断言分开计数，不互相叠加。

## 已知缺口

1. NativeAdapter 真实现（Android `android:process` / Harmony `EcmaVM` / iOS WKWebView2）
2. 真机超时阈值校准（默认 5s 为建议值）
3. iOS 机制差异归一化层（CMP-117）
4. CI 报告 diff / gold 基线工具链
5. L3（跨设备云端调度）接口已由 G-52 定义、实现待 G-53；L4-L6 依赖 G-49 L3 与 G-50 落地（见统一成熟度表）

## 编号避让登记

- G-46 ~ G-51 连续，无重叠；CMP-132~139 承接既有 CMP-001~131（G-46=089-096、G-47=097-102、G-48=103-109、G-49=110-117、G-50=118-131）连续无冲突；原则 #13.51-53 承接 G-50 的 #13.46-50，连续无重叠
- **泛化序修正**：本包为方法论第 15 次泛化（沿本批官方链 G-46=10、G-47=11、G-48=12、G-49=13、G-50=14、G-51=15）；历史稿自述泛化序 12（与 G-48 撞号、漏计 G-49/G-50）已修正清零
- **执行模型对齐**：断言载体 = G-44 Test IR（G-44.1 可序列化、禁止把逻辑塞进运行器闭包，见 `proteus-testing-framework-plan`）；TestIRRunner 只负责执行环境（L1 InMemory / L2 NativeAdapter）插拔与门槛，`TestCase.run(adapter)` 为 L2 真机适配的过渡执行描述（见 03-spi.md §7）
- **唯一 G 表纪律**：一律以 facade 全局 G 表为编号来源；G-51/G-52 与既有 G-01~G-45 是**同表延续，非双轨并存**
- **决策 #385**：本包（test-ir-runner-plan）+ G-52（cross-device-verification-plan）以此编号序列整合入库（详见 rules.md「编号避让登记」）
