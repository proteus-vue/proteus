# Proteus Testing Infrastructure — 落地执行文档

> 版本：v1.0（对齐 proteus-compiler / cli / types 的规格）
> 定位：Proteus 七运行时层（Platform/Lifecycle/Module/Pinia/Router/API/Component）+ Compiler/Cli/Types 的**统一测试基础设施**
> 目标：让"透明编译 + AI 可读 + 产物可审计"落到可验证的工程质量

---

## 0. 为什么需要独立测试基建

前面 10 份计划（Pinia/Router/API/Component/Platform/Module/Lifecycle/Compiler/Cli/Types）每份都写了"测试矩阵 + 四层测试"，但没有一份定义**测试框架本身**：

- 用 vitest 还是 jest？
- 小程序怎么跑单测（没有 DOM、没有 `wx`）？
- 编译产物快照怎么管？
- 真机 E2E 怎么触发？
- 10 份计划的接口怎么互相验证？

**这份文档就是答案。** 它是"横切基建"，和 Compiler/Cli/Types 同级。

---

## 1. 四层测试金字塔

```
                    ┌─────────────┐
   L4 E2E (5%)      │  真机 + Web  │  Playwright + miniprogram-ci
                    └──────┬──────┘
                  ┌────────┴────────┐
   L3 编译快照(5%) │  dist/ 产物 diff │  Compiler codegen 输出
                  └────────┬────────┘
              ┌────────────┴────────────┐
   L2 组件(20%)│  @vue/test-utils + SFC │  组件 + Route IR + Transform
              └──────────┬─────────────┘
          ┌──────────────┴──────────────┐
   L1 单元(70%)│  vitest + capability mock │  Store / Util / Adapter
              └─────────────────────────┘
```

| 层 | 占比 | 跑什么 | 速度 | 是否依赖 Compiler |
|----|------|--------|------|---------|
| L1 单元 | 70% | store、util、adapter、capability | ms | 否 |
| L2 组件 | 20% | SFC、Route IR、Transform 规则 | s | 否 |
| L3 编译快照 | 5% | `dist/mp` `dist/web` 产物 diff | s | **是（B5+）** |
| L4 E2E | 5% | Web Playwright + 小程序真机 | min | **是（B7+）** |

---

## 2. 三端测试矩阵

| 能力 | Web | Skyline (小程序) | App (Native) |
|------|-----|---------|-----|
| 单元测试 (L1) | ✅ happy-dom | ✅ jsdom + wx mock | ✅ node host |
| 组件测试 (L2) | ✅ jsdom | ✅ glass-easel test adapter | ⚠️ 受限 |
| 编译快照 (L3) | ✅ | ✅ | ✅ |
| E2E (L4) | ✅ Playwright | ⚠️ miniprogram-ci 真机 | ❌ 外置 |

**关键约束**：小程序无 DOM → 用 `@proteus-vue/test-utils` 提供的 `createMockContext()` 模拟 `wx` + 页面节点树。

---

## 3. 设计原则（铁律）

1. **测试不依赖真实平台 SDK**：所有 `wx.*` / `window.*` 走 mock，CI 无需微信开发者工具
2. **快照即契约**：`dist/mp/**/*.{wxml,wxss,js}` 进 git，`--update-snapshots` 显式更新
3. **跨层契约测试优先**：B5 是核心，验证"Lifecycle → Pinia → Router → API → Component"接口联动
4. **一条命令全跑**：`proteus test` = L1+L2+L3；`proteus test:e2e` = L4
5. **失败可复现**：traceId + fixture 序列化 + 失败录制包

---

## 4. 与现有计划的关系

| 计划 | 引用了本计划的什么 |
|------|---------|
| Compiler | L3 编译快照 = codegen 输出验证 |
| Cli | `proteus test` 命令 + audit 门禁 |
| Types | Registry 类型推断测试 |
| Pinia | store 单测 + SSR 隔离测试 |
| Router | `<route>` 解析 + 导航测试 |
| API | request mock + 拦截器测试 |
| Component | SFC 组件测试 + Worklet mock |
| Platform | capability mock + 降级测试 |
| Lifecycle | 阶段钩子调用顺序测试 |
| Module | 依赖图 + 循环检测测试 |

---

## 5. 里程碑

| 里程碑 | 内容 | 批次 |
|--------|------|------|
| M1 单元测试 | vitest + capability mock + store/util 测试 | B1 |
| M2 组件测试 | SFC + Route IR + Transform | B2 |
| M3 编译快照 | codegen 产物 diff | B3 |
| M4 E2E 真机 | Web + 小程序真机 | B4 |
| M5 跨层契约 | 10 份计划接口联动 | B5 |
| M6 超级应用 | stress / 内存 / 稳定性 | B6 |
| M7 可观测 | traceId + 失败录制 | B7 |
| M8 审计门禁 | audit --fix + CI | B8 |

详见 `11-execution-batches.md`。

---

## 6. 验收标准

- [ ] `proteus test` 一条命令跑完 L1-L3，CI < 5min
- [ ] 每个 capability 有 mock + 降级测试
- [ ] 每个 transform 规则有 snapshot
- [ ] 跨层契约测试覆盖所有层间接口
- [ ] 真机 E2E 可在 CI 触发（或显式降级 + 本地可跑）
- [ ] 失败用例附带 traceId + fixture 复现包
- [ ] `proteus audit` 门禁阻断违规代码

---

## 7. 依赖关系

```
Compiler(✅) ──→ L3 编译快照 (B3+)
Cli(✅)     ──→ proteus test 命令 (B1+)
Types(✅)   ──→ Registry 类型测试 (B1+)
                      ↓
               【Testing 本次】
                      ↓
              DevTools → Build Pipeline
```

**B1-B4 可立即启动**（不依赖其他层）；B5-B9 需下层稳定。
