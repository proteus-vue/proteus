# G-44 铁律与补充规则

> 配套：`G-44-testing-framework.md` §6

---

## 1. 铁律（G-44.1 ~ G-44.6）

| 编号 | 铁律 | 依据 |
|------|------|------|
| **G-44.1** | 断言必须可序列化为 AssertionNode；禁止把逻辑塞进测试运行器闭包 | 保证跨 Backend / 跨进程 |
| **G-44.2** | 任一 Backend 的 conformance FAIL → 阻断合并 | 体系正确性 |
| **G-44.3** | 跨层集成测试必须 100% 通过（无"暂时跳过"） | INT-01~05 是链路正确性核心 |
| **G-44.4** | 同一份 Test IR 必须在 ≥2 个 Backend 上可执行 | 可插拔的可验证性 |
| **G-44.5** | 性能基准退化 > 5% → 阻断 | 见 `ci-pipeline.md` |
| **G-44.6** | 失败报告必须含 trace 链，定位到 IR 节点 + 源码行 | 可调试性 |

---

## 2. 补充规则（CMP）

> 编号从 CMP074 起（G-43 所有权用到 CMP067-073——本 plan 原稿误判 CMP067 空闲，避让后修正），无冲突。

| 编号 | 规则 |
|------|------|
| **CMP074** | 每个 Backend 对同一语义必须产出**结构一致的 state**（G-44.4 的可检查形式） |
| **CMP075** | Test IR 文件（`.tir.json`）必须进 git，可 review、可复现 |
| **CMP076** | `arrange` / `act` / `assert` 必须 JSON 可序列化；函数须注册 MatcherId |
| **CMP077** | 跨 Backend 结果不一致 → 高优先级 bug（语义分歧信号） |
| **CMP078** | 三维断点矩阵（G-25）必须有自动化覆盖，禁止仅文档断言 |
| **CMP079** | 新 plan 落地时必须同步提供对应 Test IR，纳入 conformance |
| **CMP080** | Agent（G-23）产物须通过 TestBackend 门禁（AI005） |
| **CMP081** | 性能基准值固化在 `.proteus/benchmark.json`，改动须 Owner 审批 |

---

## 3. 编号避让登记

```
G-43 用到：G-43.1-6 + CMP059-066
G-44 起 ：G-44.1-6 + CMP074-074   ← 无冲突
```

---

## 4. 与既有规则的关系

| 既有规则 | 与 G-44 的关系 |
|---------|---------------|
| FLD001-006 | 由 TestBackend 的 `assert: 'match'` 自动化检查 |
| AI001-005 | AI005 → TestBackend 门禁（本文件 CMP080） |
| GLS001-006 | 由渲染 conformance 覆盖 |
| **RND001-005** | 绕过 SPI 的代码 → TestBackend 必测不到 → 间接约束 |
| G-43.3 (禁止静默失败) | Test IR 必须断言明确结果，禁止隐式通过 |

---

## 5. 机器检查项（verify.sh 实施）

```
[ ] 所有 .tir.json 可被 JSON.parse
[ ] 每个 layer 至少 2 个 Backend 可执行其用例（G-44.4）
[ ] 跨层集成套件 100% 通过（G-44.3）
[ ] 负向用例（故意失败）确实失败（校验器有牙齿）
[ ] 报告含 trace 字段（G-44.6）
```

---

*铁律清单。分批落地见 `batches.md`，规约增量见 `architecture-update.md`。*
