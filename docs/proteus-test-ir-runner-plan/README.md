# Proteus TestIRRunner 与真运行时验证（G-51）

> **方法论第 15 次泛化**：不绑定验证执行环境 —— 定义执行引擎（`TestIRRunner`）+ 执行环境插拔（L1 InMemory / L2 NativeAdapter）+ conformance 验证
> **Status: Draft · 2026-09-04 · 决策 #385 整合入库（G-51=CMP132-139 · 泛化 12→15 修正）**

---

## 一句话

**G-46~G-50 的 conformance 不再只是文档**——同一份 TestSuite 可在 L1 模拟 / L2 真运行时上执行并产出可比、可 diff 的报告；断言载体始终是 G-44 Test IR（G-44.1 可序列化），TestIRRunner 只负责执行环境的插拔与门槛。

## 依赖

- **G-44** Test IR / TestSuite 基座（`proteus-testing-framework-plan`）——断言载体 + G-44.1 纪律
- **G-46 / G-47 / G-48 / G-49 / G-50** ——覆盖矩阵收编对象（conformance 由本 runner 执行）
- **被依赖**：G-52（跨设备一致性验证，`proteus-cross-device-verification-plan`）

## 快速开始

```bash
cd docs/proteus-test-ir-runner-plan   # 本目录
node reference-impl.cjs   # 零依赖，self-test 36/36，exit 0
bash verify.sh            # 14/14 PASS
```

预期输出（node）：
```
[G-46-data] 2/2
...
=== reference-impl self-test: 36/36 ===
RESULT: ALL PASS
```

## 文件清单

```
01-problem.md               ★ 问题：为什么 G-46~G-50 的 conformance 还不够
02-architecture.md          三层验证体系 + NativeAdapter 矩阵 + 门槛
03-spi.md                   ★ SPI：TestIRRunner / TestCase / Backend / NativeAdapter 契约
04-implementation-gates.md  阶段 2 真实现清单 + CI 集成 + 报告可 diff
conformance.md              ★ INV-01~08 + CMP132-139 映射 + 参考实现覆盖矩阵
rules.md                    G-51.1-6 铁律 + AP-18~21 + 编号避让登记（决策 #385）
architecture-update.md      原则 #13.51-53 + L0-L6 成熟度（统一口径）+ 编号避让登记
reference-impl.cjs          ★ 可运行参考实现（零依赖，self-test 36/36）
verify.sh                   自包含验证（14 项 PASS）
CHECKSUM.sha256             完整性清单（README 入库后已用 shasum -a 256 重算）
```

## 设计核心

- **三层验证体系**：L0 文档自检（G-50 selfcheck）→ L1 IR 模拟（TestIRRunner + InMemoryBackend）→ L2 真运行时（NativeAdapter，三平台契约）
- **八条不变量**（INV-01~08）：L1/L2 结果可比、降级≠崩溃、FAIL 必有分类+定位、超时可恢复、隔离泄漏可检测、报告可序列化可 diff、runner 自身回归、接缝组合命题（G-47 INV-05）
- **门槛机制**：L1 必须 100%；L2 覆盖率渐进（30%→80% 为建议），L2 失败先 DEGRADED、不阻塞 L1 回归
- **与 G-44 分工**：断言载体 = G-44 Test IR（G-44.1）；`TestCase.run(adapter)` 是 L2 真机适配期的过渡执行描述，不引入第二套 IR

## 诚实边界

1. G-51 ≠ 完整 Conformance 框架（G-44 才是），是可运行种子 + 真验证入口
2. NativeAdapter 真实现（真进程/真引擎/真签名）不在本份，属阶段 2
3. 不承诺真机跑通所有 G-46/47/48/50 用例——门槛机制即为此
4. 计数一律以实测为准：self-test 36/36（reference-impl 输出）；suite 用例数与自断言分开叙述

---

*规划体系 · G-51（test-ir-runner-plan）· CMP132-139 · 原则 #13.51-53*
