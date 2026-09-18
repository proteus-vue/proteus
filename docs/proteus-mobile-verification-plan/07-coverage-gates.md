# G-53 · 覆盖率门槛

> ★ 独有增量。让"要不要跑真机"变成**自动决策**，而非开发者负担。

## 1. 核心理念

传统做法的问题是**二元判断**：要么全跑（贵、慢），要么不跑（有风险）。

G-53 用**覆盖率指标**替代二元判断：

```
score = 加权市场份额 × 执行率
```

- **加权市场份额** = 等价类代表机型覆盖的真实用户比例（上限 1）
- **执行率** = 非 SKIP 用例占比
- **score ≥ 门槛** → 放行；否则阻断或告警

**这样"没 Mac 的开发者"不再是阻碍**：他跑出的 score 会低，但 CI 照样通过，只是标注覆盖率下降——**由团队按阶段决定门槛值**。

## 2. 为什么这样设计

| 传统做法 | G-53 |
|---------|------|
| 没设备 → CI 红 | 没设备 → SKIP + 覆盖率下降，CI 绿但标注 |
| 强制每人装 Xcode | 共享池 / 云真机，按需 |
| 覆盖率是感觉 | 覆盖率是**可计算、可 diff 的数字** |

**这与 G-51 门槛机制一脉相承**：渐进覆盖率，不一刀切。

## 3. 门槛的分阶段设定

| 阶段 | 门槛 | 说明 |
|------|------|------|
| MVP | 0.3 | 只要求主流机型部分覆盖 |
| 成长期 | 0.6 | 覆盖过半用户 |
| 成熟期 | 0.8 | 覆盖 80% 用户 |
| 发布前 | 0.9 | 关键版本 |

**门槛应随项目成熟度上调**，而不是一开始就设 0.9 导致处处受阻。

## 4. 计算示例

```javascript
const gate = new CoverageGate(0.8);

// 8 台代表机型，覆盖 97% 用户，全部执行通过
gate.evaluate([clsPhones, clsFold], [
  { status: 'PASS' }, { status: 'PASS' },
]);
// → { share: 0.97, execRate: 1, score: 0.97, pass: true }

// 一半设备不可用（没 Mac / 额度耗尽）
gate.evaluate([clsPhones], [
  { status: 'PASS' }, { status: 'SKIP' },
]);
// → { share: 0.82, execRate: 0.5, score: 0.41, pass: false }
```

**注意第二种情况**：目标是阻断，但**不是因为"失败"，而是因为"覆盖不足"**——这个区别很重要：

- 失败 = 代码有问题，必须修
- 覆盖不足 = 验证不充分，可以**补充设备**或**降低门槛**

## 5. 报告中的覆盖率标注

每次执行必须在报告中携带：

```json
{
  "status": "PASS",
  "tier": "in-memory",
  "coverage": 1,
  "gate": {
    "share": 0.97,
    "execRate": 1,
    "score": 0.97,
    "pass": true
  },
  "skipped": [
    { "device": "mate80", "reason": "quota-exceeded" },
    { "device": "iphone17", "reason": "platform-unavailable" }
  ]
}
```

**★ `skipped` 列表必须存在**——否则"覆盖率 0.97"是个黑盒，团队不知道哪部分没验证。

## 6. 防虚报的三条硬约束

### 6.1 份额加权取上限 1

```javascript
weightedShare(classes) {
  return Math.min(1, classes.reduce((s,c) => s + c.coveredShare(), 0));
}
```

折叠屏用户同时属于品牌类，简单相加会 >100%。**不取上限会让覆盖率指标失去意义。**

### 6.2 空等价类必须阻断

```javascript
const g = gate.evaluate([emptyClass], []);
// → { share: 0, execRate: 0, score: 0, pass: false }
```

**严禁**：空输入返回 `pass: true`（"没测任何东西 = 通过"是致命反模式）。

### 6.3 SKIP 不计入 PASS

```javascript
execRate = (executed.filter(e => e.status === 'PASS').length) / executed.length;
```

SKIP 分子分母都不算 PASS，**必须拉低 execRate**——否则"全 SKIP"会显示覆盖率 100%。

## 7. 与 CI 的集成

```yaml
# 每次 PR
- run: node verify.js --gate 0.3     # 开发期低门槛，快速反馈
  continue-on-error: false

# 每日构建
- run: node verify.js --gate 0.6     # 日常回归

# 发布前
- run: node verify.js --gate 0.9     # 严卡
```

**不同阶段用不同门槛**，而非一刀切。

## 8. 诚实边界

- **"覆盖 95% 用户"是加权估算**，不是精确统计——**不得作为对外 SLA 承诺**
- 覆盖率**不等于质量**：覆盖 97% 用户但断言写得烂，仍然测不出问题
- 门槛值是**团队策略**，不是技术常量——本份给的是建议起点（0.3），需按项目调整
- **"95% 断言不需真机"这个数字本身待验证**——需实际统计 G-46~52 的 L1/L2 用例分布才能确认（G-37 未实测不宣称）
- SKIP 会拉低覆盖率，但**不阻断 CI**——团队可能长期容忍低覆盖率而忽视风险，建议**定期检查 skipped 列表**
