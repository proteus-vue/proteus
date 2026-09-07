# Proteus DevTools Suite（G-54）

> **方法论第 18 次泛化**：不绑定 IDE 形态 —— 能力内核唯一（`FrameworkKnowledgeProvider`）+ 协议层可插拔（LSP/DAP/RPC/CLI/raw）+ conformance 验证
> **Status: Draft · 2026-09-05 · 决策 #391 整合入库（G-54=CMP155-162 · 泛化 15→18 修正 · 原稿 G-55→G-54 编号避让，见 rules.md 登记）**

---

## 一句话

既有 DevTools（G-19 运行时 / G-50 构建期）之外，**编码期（authoring-time）是空白区**：框架握有六类第三方 IDE 插件拿不到的独占知识（IR 结构 / 分层规则 / conformance 断言 / SPI 拓扑 / 设备等价类 / 渲染语义），把它们工具化为**内核唯一、前端可换**的查询能力——反馈周期从 CI 分钟级提前到敲键盘毫秒级。

## 依赖

- **G-19**（devtools，运行时诊断）——互补不重叠，G-54 只嵌入口不重新实现
- **G-50**（developer-platform，A 工具链 CLI 流水线，沿 G-17 基础）——复用不重写
- **G-51**（test-ir-runner）——断言执行走 `execute()`；L0/L1/L2 检查项报告内联
- **G-52 / G-53**（跨设备验证 / 移动端验证编排）——设备矩阵报告与等价类清单
- **被假想依赖的「DevTools 加固」未入库**——降级为未编号后续规划（编号避让登记见 rules.md）

## 快速开始

```bash
cd docs/proteus-devtools-suite-plan   # 本目录
node reference-impl.cjs   # 零依赖，self-test 51/51，exit 0
bash verify.sh            # PASS=68 FAIL=0
```

预期输出（node）：
```
OK: INV-DT-03 导航到当前后端实现
...
self-test: 51/51
```

## 文件清单

```
01-problem.md               ★ 问题：编码期空白区 + 六类框架知识垄断区
02-architecture.md          三层解耦（内核唯一 → 协议层 → 适配层薄）+ 降级链
03-spi.md                   ★ SPI：FrameworkKnowledgeProvider 六方法 + ProtocolAdapter + 错误码
04-capabilities.md          六项独占能力详解 + MVP 优先级（②分层守护 + ③断言内联）
05-ide-adapters.md          五档适配器纪律（只做翻译，零业务逻辑）
06-integration.md           与 G-19/G-50/G-51/G-52/G-53 接缝矩阵（消费端非生产端）
conformance.md              ★ INV-DT-01~08 + CMP155-162 映射 + 51 用例覆盖矩阵（实测）
rules.md                    G-54.1-8 铁律 + 反模式 AP-DT-01~07 + 编号避让登记（决策 #391）
architecture-update.md      原则 #13.60-62 + L-1 成熟度 + 编号避让登记
reference-impl.cjs          ★ 可运行参考实现（零依赖，self-test 51/51）
verify.sh                   自包含验证（PASS=68 FAIL=0）
CHECKSUM.sha256             完整性清单（README 入库后已用 shasum -a 256 重算）
```

## 设计核心

- **三层解耦**：能力内核（IDE 无关，单一实现）→ 协议层（LSP 覆盖 70% 需求 + DAP + 自研 RPC 三项框架独占）→ IDE 适配层（薄，换 IDE ≈ 100 行翻译）
- **五档降级链**：LSP → DAP → RPC → CLI → raw；**SKIP ≠ FAIL**（协议不支持是预期事件，降级而非阻断；全不可用退 raw 内核直调——纯函数查询永远可用）
- **MVP = ②分层守护 + ③断言内联**：成本最低、反馈最快、直接减少 code review 往返
- **与 G-19 分工**：运行时诊断（trace/timeline/perf）一律复用 G-19，G-54 只做 IDE 内嵌入口

## 诚实边界

1. 六项能力中的 ⑤设备影响面 / ⑥多形态预览 依赖 G-53/G-27 数据完备，参考实现为 Mock
2. MVP 只交付 VSCode 参考适配 + CLI；JetBrains/Neovim 由 LSP 标准天然支持但**未实测**（G-54.8 禁止把"理论上支持"当"已验证"）
3. 自研 RPC 面板不在 MVP（先用 CLI 承载）；不承诺插件市场上架（运营行为）
4. 六项能力的真实效能收益（省多少 review 往返）**未量化**，需后续实测
5. 计数一律以实测为准：self-test 51/51、verify PASS=68（reference-impl/verify.sh 输出）

---

*规划体系 · G-54（devtools-suite-plan）· CMP-155~162 · 原则 #13.60-62 · 反模式 AP-DT-01~07*
