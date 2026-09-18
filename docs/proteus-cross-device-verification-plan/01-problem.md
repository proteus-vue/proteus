# G-52 跨设备一致性验证

> 原则 #0「不绑定」系列，方法论第 16 次泛化（沿本批官方链：G-46=10、G-47=11、G-48=12、G-49=13、G-50=14、G-51=15、G-52=16）。
> 编号：G-52 · 主依赖：G-51（TestIRRunner，test-ir-runner-plan）· 依赖：G-44（Test IR / TestSuite 基座，testing-framework-plan）、G-25（三维断点先例：G-44 已自动化 100 profiles）、G-46~G-50（覆盖矩阵引用对象）· 被依赖：G-53+

## 1. 问题

G-51 解决了"验证执行环境可插拔"（L0 文档 / L1 模拟 / L2 真机），但
**同一份 TestSuite 在不同设备上仍会产生不同结果**。

漂移来自四个维度：

| 维度 | 变量 |
|------|------|
| 屏幕 | dp / density / foldable / safe area |
| 系统 | API level / JS engine / permission model |
| 输入 | touch / mouse / keyboard / pen |
| 环境 | language / timezone / dark mode / a11y |

四维笛卡尔积 → 组合爆炸（100+ 设备 × 10 场景 = 不可穷举）。

**不做穷举，做划分 + 代表采样 + 指纹比对。**

## 2. 核心概念

- **DeviceEquivalenceClass**：等价类，每类取代表设备
- **DriftFingerprint**：四维指纹，用于跨设备 FAIL 归因
- **ε 阈值**：允许轻微浮动（渲染/触摸天然有误差）
- **归一化**：报告去噪后可 diff

## 3. 五条不变量

- **INV-D1** 同一设备、同一快照 → 结果稳定（幂等）
- **INV-D2** 等价类内代表偏差 ≤ ε
- **INV-D3** 跨设备 FAIL 可归因到四维之一（漂移指纹）
- **INV-D4** 报告归一化后可 diff（CI 门槛）
- **INV-D5** 本地优先 → 云端补充（不强制联网）

## 4. 与 G-51 的分工

| | G-51 TestIRRunner | G-52 |
|--|--|--|
| 维度 | 执行环境（文档/模拟/真机） | 设备形态（屏幕/系统/输入/环境） |
| 接口 | execute() | executeOn() |
| 关系 | G-51 ⊂ G-52 | G-52 扩展 G-51，不重写 |

## 5. 诚实边界

- G-52 ≠ 完整设备云（云端调度、真机农场、视觉 diff 不在本份）
- ε 阈值是启发式，需按场景调校（首次运行基线校准）
- 云端"按需补充"，不强制联网
- 真实设备 profile 数据库不在本份（属运营数据）
