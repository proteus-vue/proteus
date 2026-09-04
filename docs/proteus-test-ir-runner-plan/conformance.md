# G-51 Conformance

## 1. 八条不变量

| ID | 不变量 | 验证层 | 映射 |
|----|--------|--------|------|
| INV-01 | 同一 TestSuite 在 L1/L2 结果可比 | L1+L2 | CMP-132 |
| INV-02 | 能力缺失 → 降级(DEGRADED) ≠ 崩溃 | L1 | CMP-133 / G-46 RSC-01 |
| INV-03 | FAIL 必有 category + loc | L1 | 铁律 G-51.4 纪律化（rules.md）；无独立 CMP，验证用例 `throw-case-FAIL-with-loc` |
| INV-04 | 超时 / 资源超限可恢复 | L1 | CMP-135 |
| INV-05 | 真运行时隔离泄漏可被检测 | L2 | CMP-136 / G-49 ISOLATION_BREACH |
| INV-06 | 报告可序列化、可 diff（CI 门槛） | L1+L2 | CMP-134（Report 必有 total）+ CMP-137（可 JSON 序列化） |
| INV-07 | Runner 自身有回归（runner-regression.gold） | L0+L1 | CMP-138 |
| INV-08 | 接缝切换 + 隔离检测 组合命题 | L1+L2 | CMP-139 / G-47 INV-05 |

## 2. CMP 映射

| CMP | 内容 | 验证方式 |
|-----|------|---------|
| CMP-132 | TestIRRunner.execute 存在且返回 Report | `execute() interface` 用例 |
| CMP-133 | requireNative=false → DEGRADED，不抛 | `requireNative-false-DEGRADED-not-crash` |
| CMP-134 | Report 必有 total 字段 | `execute-returns-report` / `summary-has-total` |
| CMP-135 | 超时(threshold<100 & slow) → TIMEOUT | `slow-case-TIMEOUT-when-threshold-low` |
| CMP-136 | breach 异常 → category=ISOLATION_BREACH | `ISOLATION_BREACH-categorized` |
| CMP-137 | Report 可 JSON.stringify，含 total | `report-serializable` / `report-diffable` |
| CMP-138 | Runner 类与 execute 方法存在（gold） | `runner-regression-gold` |
| CMP-139 | 接缝切换 + 隔离组合命题 | `backend-switch-no-data-loss-ref` |

## 3. 参考实现覆盖矩阵

| Plan | Suite | cases | 覆盖命题 |
|------|-------|-------|---------|
| G-46 | G-46-data | 2 | 登录态持久 / 跨页所有权 |
| G-47 | G-47-combined | 1 | 后端切换数据不丢 |
| G-48 | G-48-runtime | 2 | 小程序加载 / 兼容矩阵（requireNative） |
| G-49 | G-49-sandbox | 2 | ISOLATION_BREACH / 配额 |
| G-50 | G-50-platform | 2 | 双签名 / 发布流水线 |
| — | negative | 1 | **负向自检（NEG-01，预期 FAIL）** |
| — | runner-regression | 2 | Runner 自身回归（INV-07） |
| — | 自断言组 | 36 | 执行正确性 20 + 覆盖/结构自检 16（self-test 36/36） |
| **suite 合计** | 7 suites | **12** | G-46~G-50 收编 9 + 负向 1 + 回归 2 |

> 覆盖矩阵收编自 G-46~G-50 各 plan 的 doc-level conformance（本包取其代表性用例落地为 suite）；**suite 用例数与自断言分开计数，不互相叠加**。
> 参考实现实测：7 suites · 12 用例执行 + self-test **36/36**，`exit 0`（其中 negative 1、ISOLATION_BREACH 1 为**预期 FAIL**——验证器判别力自检，计入 G-49 sandbox 的 breach 检测链路）。

## 4. 接缝断言（与 G-47 互校）

```
G-47 INV-05：接缝切换不影响一致性
G-51 INV-05：隔离泄漏可被检测
INV-08 = G-47 INV-05 ∧ G-51 INV-05：组合命题在 L1/L2 结果可比
```

## 5. 负向自检（NEG-01）

`negative` suite 故意包含 `NEG-01-failure-is-reported`（`run: () => false`）→ 产生 FAIL。

**目的**：确认 runner 真的会报告失败（验证"验证器有牙齿"）。若删除此用例后仍显示"全部通过"，说明断言链路失效——**这是 G-44（testing-framework-plan）方法论的核心纪律**。

## 6. 三平台验证场景

| 场景 | L1 模拟 | L2 真机 |
|------|---------|---------|
| ISOLATION_BREACH 检测 | ✅ 异常分类 | Android 独立进程 / Harmony EcmaVM |
| 配额超限 | ✅ QUOTA_EXCEEDED recoverable | 真机内存/存储配额 |
| requireNative 降级 | ✅ DEGRADED | 无原生能力设备/模拟器 |
| 超时 | ✅ TIMEOUT | 真机慢设备 |

## 7. 断言计数（诚实值）

**实测**：参考实现 self-test 36/36 + 7 suites · 12 用例执行，`exit 0`。**文档宣称一律以实测为准，不估、不预留未实测数字**——承 G-40 CMP046「未实测禁对外宣称」纪律（execution-carrier-plan）。
