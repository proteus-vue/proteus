# G-44 分批落地（B1-B6）

> 与 M1 同步启动，优先级**高于新功能 plan**（先补齐验证能力）。

---

## 依赖关系

```
B1 (SPI 骨架) ──▶ B2 (断点矩阵) ──▶ B3 (跨层集成)
                                        │
              ┌─────────────────────────┘
              ▼
         B4 (CI 门禁) ──▶ B5 (DevTools 可视化) ──▶ B6 (生态推广)
```

---

## B1 — Test IR + SPI 骨架（M1 第 1 批）

**目标**：定义"测试"的语义，不绑定任何运行器。

**交付**：
- `test-ir.ts`（TestIR / AssertionNode / ActOp / Profile3D 类型）
- `test-backend-spi.ts`（ProteusTestBackend 接口 + BackendCaps）
- `assertion-runner.ts`（断言解释器，参考 `testing-reference.js` 的 evalAssertion）
- **DoD**：NodeBackend 跑通 10 个示例用例，断言可序列化/反序列化

**依赖**：G-43（所有权图，供 `notLeak` 断言消费）

---

## B2 — 三维断点矩阵（★ M1 核心）

**目标**：G-25 首次被自动化验证。

**交付**：
- `breakpoint-generator.ts`（参数化生成 100 Test IR）
- `profiles.ts`（W/H/F 断点定义）
- TV / 手表 / 车机 专用模拟器（focus-engine-stub / crown-mock / driving-state-injector）
- **DoD**：100 profiles 全 PASS；边界值（319/320/321）覆盖；鸿蒙跨设备转移用例 PASS

**依赖**：B1、G-25

---

## B3 — 跨层集成套件（★ 体系正确性）

**目标**：验证 Compiler→Render→Host→Carrier→Container→Ownership 组合链路。

**交付**：INT-01 ~ INT-0N（每个交界处一个用例）
- INT-01 Compiler IR → Render 消费
- INT-02 AOT 下所有权检查
- INT-03 引擎切换 Owned 转移
- INT-04 页面销毁五原子 Drop
- INT-05 TV 焦点 / 触摸禁用
- **DoD**：100% 通过（G-44.3 禁止跳过）

**依赖**：B1、G-27~G-43 全部

---

## B4 — CI 门禁

**目标**：把铁律接进工程流。

**交付**：
- GitHub Actions / GitLab CI 配置
- `proteus test` CLI 命令
- 基准值 `.proteus/benchmark.json`
- **DoD**：PR 阶段 < 3min；合并前 < 15min；任一 FAIL 阻断合并

**依赖**：B1、B2、B3

---

## B5 — DevTools 测试可视化

**目标**：失败 trace + 所有权图 + 历史趋势面板。

**交付**：trace 渲染、跨 Backend 差异高亮、泄漏路径定位（复用 G-43 DevTools）

**依赖**：G-43、B1

---

## B6 — 生态推广 + 基准替换

**目标**：每个新 plan 自带测试；用实测替换推算。

**交付**：
- 旧 `proteus-test-framework`（Vitest/Playwright）迁移为 DeviceBackend 实现
- 各 plan 补齐 Test IR
- **DoD**：七套 conformance 可由一个 runner 产出统一报告

---

## 关键提醒

> **B6 的"用实测替换推算"是原则 #11 的兑现要求**——G-27/35 里的"批处理收益 10-18 倍"等推算数据，须由 TestBackend 的基准测试替换。

---

*分批策略。规约增量见 `architecture-update.md`。*
