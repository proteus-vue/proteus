# Proteus 自动化测试框架（G-44）

> **第八次泛化**：不绑测试实现 —— 定义测试语义（Test IR）+ 后端执行（TestBackend SPI）+ conformance 验证
> **Status: Draft · 2026-09-03 · 决策 #364 整合入库（编号避让 G-41→G-44，CMP074-081）**

---

## 一句话

**测试代码不再绑定具体断言库、运行器或设备**——同一份 Test IR，可在 Node、JSI、AOT、真机、TV 模拟器上跑，报告格式完全一致。

---

## 快速开始

```bash
cd docs/proteus-testing-framework-plan（本目录）
node testing-reference.js   # 零依赖，跑全部验证
```

预期输出：
```
断点矩阵: 100/100 pass
跨层集成: 14/14 pass  (具体数量随套件变化)
★ 全部 PASS
```

---

## 目录结构

```
G-44 核心（方法论层，本目录）：
├── G-44-testing-framework.md   ★ 主文档：八次泛化 + Test IR + SPI
├── test-ir.md                   测试语义定义（AssertionNode / ActOp / Profile3D）
├── test-backend-spi.md           TestBackend 接口 + 五官方后端 + conformance runner
├── breakpoint-3d-testing.md      ★ G-25 三维断点自动化（100 profiles）
├── ci-pipeline.md                质量门禁 + 分层执行
├── rules.md                      G-44.1-6 + CMP074-081
├── batches.md                    B1-B6 分批 + DoD
├── architecture-update.md        原则 #13.25-13.27 + 八次泛化全景
└── testing-reference.js          ★ 可运行参考实现（零依赖）

执行层参考（既有，降格为 DeviceBackend 实现）：
└── ../proteus-test-framework-plan/   L1-L4 分层策略（Vitest/Playwright/automator——已落地批次见 PROJECT_MEMORY #154-#210）
```

---

## 设计核心

### Test IR（可序列化的测试语义）

```ts
interface TestIR {
  id: string                    // T-{layer}-{seq}
  arrange: IRNode               // 被测输入
  act: ActOp[]                 // 操作序列
  assert: AssertionNode[]      // ★ 断言语义，非代码
  profile?: Profile3D          // W × H × F
  backend?: string             // 指定后端；缺省=兼容后端
}
```

### TestBackend SPI（可插拔）

```ts
interface ProteusTestBackend {
  readonly id: string
  supports(target: TestIR): boolean
  run(ir: TestIR): Promise<TestReport>
}
```

五个官方后端：`node | jsi | aot | host | device`

---

## 与体系的关系

| 文档 | 关系 |
|------|------|
| G-25 三维断点 | ★ G-44 是它**首次被自动化验证**的载体 |
| G-27~G-43 | G-44 提供统一 runner，串成"全套验证" |
| G-23 AI Agent | Agent 产物须通过 TestBackend 门禁 |
| G-43 DevTools | 注入泄漏场景，断言 DevTools 能检出 |

---

## 诚实边界

1. Test IR 不替代所有测试：DOM 交互、视觉回归仍需 Playwright/screenshot（作为 DeviceBackend）
2. 跨进程 trace 有损耗：headless 验证语义，真机验证性能
3. 参数化矩阵采用等价类裁剪，非全组合

---

*规划体系：60 份 plan + 1 哲学 + 1 规约 + 1 官网*
