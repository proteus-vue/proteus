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

> **✅ B1 已落地（决策 #367）**：新包 **`@proteus-vue/test-ir`**（37 包，零依赖）——**① 类型层** `types.ts`：TestIR（id/target/arrange/act/assert/profile/backend/tags/xfail——JSON 可序列化，G-44.1 禁闭包）/ AssertionNode（eq/match/exists/count/throws/notLeak/conforms/and·or 八种）/ ActOp 十操作（render/update/destroy/transfer/borrow/press/injectState/resize/setFormFactor/callNative）/ Profile3D / TestReport（含 trace 链 G-44.6）/ BackendCaps / ProteusTestBackend SPI 接口；**② 断言解释器** `assertion-runner.ts`：getPath（JSONPath 子集：点 + [n] 索引）/ evalAssertion（八种 + and·or 组合；**eq 宽松相等——null≈undefined 对齐 moved 资源语义**）/ applyAct（transfer=Move 语义模拟、destroy=五原子清零、setFormFactor/resize/injectState）——**★run() 先 arrange 合并（深拷贝——多后端复用同一 Test IR 不突变 arrange）→ base 状态补缺 → act → 断言**；**③ 五官方后端** `backends.ts`：Node/JSCarrier/AOT/Host/Device（**supports 门控：Device 专属 breakpoint 层，其余后端排除**；Device buildState 按宽度档位求解 p-adaptive form）+ renderState 统一状态工厂（CMP074 跨后端结构一致）+ officialBackends() 实例集；**④ ConformanceRunner** `conformance-runner.ts`：逐后端筛选兼容用例执行 + merge byBackend 汇总（G-44.4 多后端覆盖统计）；**⑤ 断点矩阵** `breakpoint.ts`：W/H/F 常量 + formForWidth 档位求解 + **generateBreakpointSuite 参数化 100 个 Test IR**；**⑥ 跨层集成套件** `integration.ts`：INT-01~05（Compiler→Render 交界/AOT 下所有权/引擎切换转移/五原子 Drop/TV 焦点）。**验证（DoD）**：NodeBackend 10 示例用例全 PASS + **JSON 序列化往返后执行语义不变**（可序列化机器证据）+ 断点矩阵 100/100（边界档位 320/840/1200 形态正确）+ INT-01~05 零失败 + 负向用例失败含 trace（G-44.6）；测试 `tests/test-ir.test.ts` 14 用例；全量 1923/183 无回归。

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
