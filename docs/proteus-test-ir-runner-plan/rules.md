# G-51 铁律（G-51.1 - G-51.6）+ CMP 映射

## 铁律

**G-51.1（execute 唯一入口）** TestIRRunner 只暴露 `execute(suite): report` 一个核心方法。禁止绕过 runner 直接执行用例。

**G-51.2（降级不崩溃）** 后端缺少原生能力时，必须返回 `DEGRADED`，**禁止抛异常退出**（INV-02 / G-46 RSC-01 精神贯穿测试基础设施）。

**G-51.3（报告必有 total）** 任何 TestReport 都必须含 `total` / `passed` / `failed` 字段（CMP-134）。

**G-51.4（FAIL 必有分类与定位）** 每个 FAIL 必须带 `category`（ASSERTION | ISOLATION_BREACH）+ `loc`（INV-03）。

**G-51.5（可序列化）** Report 必须可被 `JSON.stringify` 且无字段丢失（INV-06，CI diff 前提）。

**G-51.6（Runner 有回归基线）** `runner-regression.gold` 必须随 runner 改动同步更新；结构变化需显式批准（INV-07）。

## CMP 映射

| CMP | 内容 | 铁律 |
|-----|------|------|
| CMP-132 | execute 存在且返回 Report | G-51.1 |
| CMP-133 | 能力缺失 → DEGRADED | G-51.2 |
| CMP-134 | Report 有 total | G-51.3 |
| CMP-135 | 超时可恢复 | — |
| CMP-136 | ISOLATION_BREACH 分类 | G-51.4（FAIL 必有 category 纪律） |
| CMP-137 | Report 可序列化 | G-51.5 |
| CMP-138 | Runner 有回归基线 | G-51.6 |
| CMP-139 | 接缝+隔离组合命题 | —（组合命题：G-47 INV-05 ∧ G-51 INV-05，见 conformance.md §1 INV-08） |

## 反模式（AP-18 ~ AP-21）

| ID | 反模式 | 后果 |
|----|--------|------|
| AP-18 | runner 内部吞掉异常（不转 FAIL） | 静默假绿 |
| AP-19 | 硬编码断言计数（"31/31"） | 计数漂移后自检失灵 |
| AP-20 | requireNative 时抛错退出 | 违反降级不崩溃 |
| AP-21 | 跳过 runner-regression.gold | runner 改动引入静默回归 |

> AP-19 是本次实施的真实教训：初版 verify 硬编码"31/31"，实际改为 36 后若不清算会假 PASS。**现 verify.sh 已改为动态抓取实测计数。**

## 全局编号对齐

- **本份编号**：G-51.1-6、CMP-132~139、原则 #13.51-53
- **与 G-44 关系**：G-44（testing-framework-plan）定义 Test IR + AssertionNode 断言语义（G-44.1：断言可序列化、禁止把逻辑塞进运行器闭包）；G-51 **只负责执行环境（L1 InMemory / L2 NativeAdapter）插拔与门槛**，断言载体 = G-44 Test IR。**不重写、不改动 G-44 编号、不引入第二套 IR**；`TestCase.run(adapter)` 是 L2 真机适配的过渡执行描述（见 03-spi.md §7）
- **是否需要扩展 G-44 的 IR**：由 G-51 实施期结论决定（若 NativeAdapter 需新字段，再提案更新 G-44）
- **与 G-46/47/48/49/50 关系**：G-51 是这些 plan conformance 的**执行引擎**，不改动其编号

## 诚实边界

- G-51 ≠ 完整 Conformance 框架（G-44 才是），仅是可运行种子 + 真验证入口
- NativeAdapter 真实现（真进程/真引擎/真签名）**不在本份**，属阶段 2
- 不承诺真机可跑通所有 G-46/47/48/50 用例——门槛机制（渐进覆盖率）即为此

## 编号避让登记（决策 #385）

- **泛化序**：本包为方法论第 15 次泛化（官方链 G-46=10、G-47=11、G-48=12、G-49=13、G-50=14、G-51=15）。历史稿按「沿 testing-framework-plan 第 8 次计数再 +4」自述泛化序 12，与 G-48 撞号且漏计 G-49/G-50，已修正清零。
- **编号段**：G-51.1-6 + CMP-132~139 + 原则 #13.51-53，承接 G-50 的 CMP-118~131 与 #13.46-50，全库连续无重叠（G-46=089-096、G-47=097-102、G-48=103-109、G-49=110-117、G-50=118-131）。
- **与 G-44 并存的铁律语义**：G-44.1 = 断言可序列化（禁闭包）；G-51.x = 执行环境铁律，两者指向不同层，无编号冲突。
- **唯一 G 表纪律**：一律以 facade 全局 G 表为编号来源（G-01~G-45 + 本批 G-46~G-52 同表延续），**不搞双轨**；对 testing-framework-plan 目录细节的引用一律使用其目录名 `proteus-testing-framework-plan`。
- **决策 #385**：G-51（test-ir-runner-plan）与 G-52（cross-device-verification-plan）以本泛化序（G-51=CMP132-139、G-52=CMP140-146）整合入库。
