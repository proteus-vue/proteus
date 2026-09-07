# G-53 移动端验证编排

> 原则 #0「不绑定」系列，**第 17 次泛化**（沿官方链：G-51=15、G-52=16；决策 #391 修正，原稿误作第 15 次）：不绑定设备供给方式。
> **Status: Draft · 决策 #391 补登记（原随 #390ii 批次顺带入库未登记——board-inventory/facade/规约/spi-first 映射四路同步补齐）**

## 一句话

**解决"机型众多买不起"——不是找到免 Xcode 的模拟器，而是把一台 Mac 上的模拟器池化、服务化，接进 G-51/G-52 的验证矩阵，并用覆盖率门槛让"要不要跑真机"变成自动决策。**

## 快速验证

```bash
cd docs/proteus-mobile-verification-plan
node reference-impl.cjs   # → self-test: 41/41
bash verify.sh             # → PASS=58 FAIL=0
```

## 文件导航

| 文档 | 内容 | 优先级 |
|------|------|-------|
| **01-problem.md** | 机型碎片化是伪命题 / 三个真问题 / iOS 模拟器无法独立 / Codex 启示 | ★ 先读 |
| **02-architecture.md** | 三层分工 / 四档降级链 / 与 G-51·52 关系 / 框架选型 | ★ |
| **03-spi.md** | MobileDeviceProfile / SimulatorBackend / Orchestrator / CoverageGate | ★ |
| **04-equivalence-classes.md** | ★ 8 个等价类清单（含市场份额）/ 代表选择 / 防虚报 | ★ |
| **05-simulator-pool.md** | ★ 模拟器池化与远程共享 / serve-sim / Apple EULA 边界 | ★ |
| **06-cloud-device-farm.md** | ★ 云真机平台对比 / 成本测算 / 硬件盲区 | ★ |
| **07-coverage-gates.md** | ★ 覆盖率模型 / 分阶段门槛 / 防虚报三约束 | ★ |
| conformance.md | INV-M1~M8 / CMP-147~154 / 41 用例 / NEG-01~04 | |
| rules.md | G-53.1-8 铁律 / 反模式 AP-26~30 | |
| architecture-update.md | 原则 #13.57-59 / 三维验证空间 / 已知缺口 | |

## 核心设计

### 四档降级链

```
in-memory (零依赖,秒级)      ← 默认
   ↓ 需要渲染
web / DOM 模拟
   ↓ 需要真引擎
ios-sim 本地                 ← 没装 Xcode → SKIP，不崩
   ↓ 本机没有 Mac
ios-sim 远程（共享 Mac 池）  ← ★ 解决"买不起机型"
   ↓ 需要真硬件/国产 ROM
cloud-device（云真机）       ← ¥0.5/分钟
```

### 关键纪律

| 情况 | 返回 |
|------|------|
| 平台不可用 | `SKIP` + reason（**绝不 FAIL**） |
| 能力缺失 | `DEGRADED` + missing[] |
| 额度耗尽 | 降级/SKIP，**不阻断 CI** |
| 空覆盖 | `pass: false`（**不得静默通过**） |

### 覆盖率模型

```
score = 加权市场份额 × 执行率
门槛：MVP 0.3 → 成长期 0.6 → 成熟期 0.8 → 发布前 0.9
```

## 八个等价类（2026 Q1 中国）

| 等价类 | 代表 | 份额 |
|--------|------|------|
| 鸿蒙 NEXT | Mate 80 | 20% |
| iOS 高端 | iPhone 17 | 19% |
| ColorOS | Find X9 | 16% |
| OriginOS | vivo X300 | 15% |
| HyperOS | 小米 17 | 12% |
| MagicOS | 荣耀 | 11% |
| **折叠屏** | Mate X | 15% |
| 低端长尾 | Redmi Note | — |

覆盖 ≈ 95% 真实用户。

## 嵌入方式

本份是 **plan + 参考实现**，非运行时组件。集成路径：

1. 实现各档 `SimulatorBackend`（in-memory 已有参考实现）
2. 在 G-51 `TestIRRunner` 中注册后端链
3. `CoverageGate` 接入 CI，按阶段设门槛

## 诚实边界

- iOS 模拟器**无法脱离 Xcode**——不存在合规的免 Xcode 路径
- 模拟器**测不了硬件**（摄像头/蓝牙/Face ID/真实性能）
- 份额数据是**季度快照**，非架构常量，需定期更新
- Apple EULA：共享**仅限内部团队与 CI**，对外提供云模拟器服务需法务确认
- **"95% 断言不需真机"为估算**，需统计 G-46~52 用例分布才能确认
- 共享 Mac 并发上限**未实测**，不得承诺具体数字

## 编号

G-53 · CMP-147~154 · 原则 #13.57-59 · 反模式 AP-26~30（泛化序 15→17 修正，决策 #391）
