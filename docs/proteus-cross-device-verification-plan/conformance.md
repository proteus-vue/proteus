# G-52 Conformance

## 不变量（INV-D1 ~ INV-D5）

| ID | 命题 | 验证方式 |
|----|------|----------|
| INV-D1 | 同设备同快照 → 幂等 | reference-impl `run()` 二次执行比对 |
| INV-D2 | 等价类内偏差 ≤ ε | `checkEquivalence(cls, ε)` |
| INV-D3 | 跨设备 FAIL 归因到四维 | `attribution()` ∈ {screen,os,input,env} |
| INV-D4 | 归一化可 diff | `JSON.stringify(normalizeReport())` |
| INV-D5 | 本地优先 | runner 无需网络即可 `executeOn` |

## 编号映射

- CMP-140 → INV-D1
- CMP-141 → INV-D2
- CMP-142 → INV-D3
- CMP-143 → INV-D4
- CMP-144 → INV-D5
- CMP-145 → AP-22（穷举反模式）
- CMP-146 → 接缝命题（G-51 INV-06 ∧ G-52 INV-D4）

## 覆盖矩阵

| 来源 | 覆盖 |
|------|------|
| G-46 数据一致 | 通过等价类去噪 |
| G-47 组合一致 | 接缝命题 |
| G-48 运行时 | 设备矩阵 |
| G-49 隔离 | 跨进程指纹 |
| G-50 平台 | 发布前矩阵验证 |
| G-51 验证 | INV-06 序列化 |
| G-52 本份 | INV-D1~D5 + 负向 4 |

**参考实现 self-test：44/44（实测，exit 0）**

## 负向自检（NEG-01 ~ NEG-04）

- NEG-01：ε 过小 → 本该通过也失败（验证阈值敏感性）
- NEG-02：空设备列表 → 不崩溃，0 entries
- NEG-03：浮点用 ε 比对，不用 ===
- NEG-04：density 取整 → 2.75 ≡ 3.0 同指纹

## 接缝命题（统一登记）

接缝命题在 G-52 侧统一登记为两条：

**① CMP-146（登记式）**：G-51 INV-06（报告可序列化）∧ G-52 INV-D4（归一化可 diff）
→ 跨设备报告可序列化 + 可 diff = CI 可消费（见 05-appendix §C）。

**② 隔离泄漏跨设备归因（承 G-51 INV-08 延伸，不重复编号）**：G-51 INV-08（= G-47 INV-05 ∧ G-51 INV-05，已由 G-51 CMP-139 登记）∧ G-52 INV-D3（归因）
→ 接缝切换 + 隔离泄漏检测在跨设备维度可被检测并归因到四维之一。

> 与验证体系衔接：设备矩阵 = G-44 Device 后端 + G-25 三维断点（G-44 已自动化 100 profiles）→ G-52 四维等价类（screen/os/input/env）。
