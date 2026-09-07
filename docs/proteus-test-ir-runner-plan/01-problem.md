# G-51：TestIRRunner 与真运行时验证

> 方法论第 15 次泛化 · 原则 #0「不绑定」投影到**验证执行环境**（沿本批官方链：G-46=10、G-47=11、G-48=12、G-49=13、G-50=14、G-51=15）
> 编号：G-51 · 依赖：G-44（Test IR / TestSuite 基座，testing-framework-plan）、G-46、G-47、G-48、G-49、G-50

## 1. 问题：为什么 G-46~G-50 的 conformance 还不够

G-46（数据一致）、G-47（组合一致）、G-48（运行时）、G-49（沙箱）、G-50（平台）
各自定义了 conformance：CMP、INV、断言清单。**但这些断言至今只存在于文档里。**

- G-50 有 `selfcheck.js`，只验证**文档结构完整性**（编号、交叉引用、文件齐全）
- 没有任何机制验证：**同一份 TestSuite 在模拟器和真机上结果是否一致**
- **截至 G-50，G-46~G-50 各自的 conformance（CMP / INV / 断言清单）全部只停留在文档层**——本批 reference-impl 从其中收编 suite 用例（G-46 2 + G-47 1 + G-48 2 + G-49 2 + G-50 2 = 9 项），作为可运行种子

**核心漏洞**：模拟器永远无法验证"真进程隔离生效"。
G-49 的 `ISOLATION_BREACH` 检测、G-48 的双线程语义、G-46 的跨页所有权——
这些**必须真跑才能断言**的命题，目前全靠文档宣称。

## 2. 三层验证体系

```
L0  文档自检     selfcheck.js        结构完整性（G-50 已有）
L1  IR 模拟      TestIRRunner       不依赖原生后端，验证 IR 语义
L2  真运行时     NativeAdapters     真进程 / 真引擎 / 真签名
        ↓
  三阶梯度（文档 → 模拟 → 真机）：
  每一阶门槛递增，前一阶是后一阶的回归测试
```

**任何一层都不可替代**：
- 文档自检只能证明"写了"
- 模拟能证明 IR 语义正确，但无法验证真隔离
- 真机才能验证 G-49 的进程级隔离真的生效

## 3. 核心接口

```typescript
interface TestIRRunner {
  execute(suite: TestSuite, opts?: RunOptions): Promise<TestReport>
}
```

就这一个方法。G-51 的全部工作围绕它展开：
- `TestSuite` / `TestCase` / `TestReport` 结构（复用 G-44）
- `NativeAdapter`：真运行时适配契约
- 三阶梯度执行策略
- 门槛机制：模拟 100% → 真机逐步提升覆盖率

## 4. 八条不变量（与 conformance.md INV-01~08 一致）

```
INV-01  同一 TestSuite 在 L1/L2 结果可比
INV-02  能力缺失 → 降级 ≠ 崩溃
INV-03  断言 FAIL 必有定位 + 分类
INV-04  超时 / 资源超限可恢复
INV-05  真运行时隔离泄漏可被检测（G-49 ISOLATION_BREACH）
INV-06  报告可序列化、可 diff（CI 门槛）
INV-07  Runner 自身有回归（runner-regression.gold）
INV-08  接缝切换 + 隔离检测 组合命题（G-47 INV-05）
```

## 5. 与 G-44 的精确分工

| | G-44 Test IR | G-51（本份） |
|--|--|--|
| 关注 | IR 结构与协议 | 执行引擎 + 真运行时验证 |
| 新增 | — | execute()、三阶梯度、NativeAdapter、门槛 |
| 关系 | G-44 ⊂ G-51 | 扩展，不重写 |

G-51 **不重写 G-44**，只在它上面加执行层。断言载体始终是 G-44 Test IR（可序列化，G-44.1）；G-51 只负责执行环境（L1 InMemory / L2 NativeAdapter）的插拔与门槛，`TestCase.run(adapter)` 是 L2 真机适配期的过渡执行描述（详见 03-spi.md §7）。

## 6. 诚实边界

- G-51 ≠ 完整的 Conformance 框架（G-44 才是），只是**可运行的种子**
- NativeAdapter 是契约 + 参考实现，真进程/引擎/签名待各平台实装
- 不承诺真机能跑通所有 G-46/47/48/50 用例——门槛机制就是为此

## 7. 全局编号

原则 #13.51-53 · CMP-132~139 · G-51.1-6
