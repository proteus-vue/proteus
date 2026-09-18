# 12 治理与分佣（B4，收官）

> 接续 `11-distribution-store.md`。定义 **GovernanceAPI**：配额、风控、审计、撤销、结算对账。
> **G-50 的"运营闭环"**——让平台**长期安全运行第三方代码**。

---

## 1. 四大职责

```
┌─────────────────────────────────────────────┐
│  ① 配额（Quota）    运行时资源限制            │  ← G-49 ResourceQuota 扩展
│  ② 风控（Risk）     违规/恶意/异常检测        │
│  ③ 审计（Audit）    不可篡改日志              │  ← G-49 ISOLATION_BREACH 风格
│  ④ 结算（Settlement）分佣对账（SPI 层）       │
└─────────────────────────────────────────────┘
        ↑ 均由运行时上报（见 02 §4.3 接口 ③→④）
```

---

## 2. 配额（①）：从单实例到全局池

G-49 定义**单小程序** ResourceQuota。G-50 扩展为**全局配额池**：

| 维度 | 单实例（G-49） | 全局池（G-50） |
|------|:--------------:|:-------------:|
| 内存 | 256MB/包 | **宿主总内存上限**（如 2GB）+ 单包上限 |
| 存储 | 100MB/包 | 全局存储上限 + 单包上限 |
| CPU | 20%/包 | **全局 CPU 调度**（防单租户耗尽） |
| 并发 | 单帧 | 全局并发上限 |

**策略**：单包超限 → QUOTA_EXCEEDED（业务错误，G-49.6）；**全局超限 → 拒绝新包加载 + 告警**。

---

## 3. 风控（②）：违规检测

| 信号 | 检测 | 处置 |
|------|------|------|
| ISOLATION_BREACH | G-49 检测 | 立即 terminate + 审计 |
| 异常资源增长 | 运行时上报 | 限流 / 封禁 |
| 恶意行为（爬取/作弊） | 规则 + ML | 降级 / 下架 |
| 投诉 | 用户/开发者 | 人工复核 |

**处置动作**：`warn → rate_limit → suspend → revoke`（递进）。

---

## 4. 审计（③）：不可篡改日志

```typescript
interface GovernanceEvent {
  readonly id: string;            // 唯一
  readonly packageId: string;     // 租户
  readonly type: 'quota' | 'breach' | 'review' | 'revoke' | 'settlement';
  readonly payload: unknown;      // JSON-safe
  readonly timestamp: number;
  readonly traceId: string;       // 关联 TraceBus（devtools 系列，官方 G-34）
}
```

**审计用途**：申诉复核、合规举证、攻击溯源。

---

## 5. 撤销（revoke，04 接口）

```typescript
revoke(packageId, reason) →
  ① 从分发索引移除（11）
  ② 清凭证（G-46：按 packageId 清 Cookie/Token）
  ③ 清存储（G-46 L3：packageId 命名空间）
  ④ terminate 运行实例（G-43 Drop 级联，无泄漏）
  ⑤ 审计记录
```

**撤销 = G-46 登出清理 + G-43 Drop 级联的"应用级"推广**——又一次方法论泛化，
即原则 #0「不绑定」的**第 14 次应用**（沿小程序系列计数：G-46=10 / G-47=11 / G-48=12 / G-49=13）。

---

## 6. 结算（④）：分佣 SPI（仅定义接口，不内置）

```typescript
interface SettlementSPI {
  /** 对账数据（平台 → 开发者） */
  getReconciliation(developerId: string, period: Period): Promise<Statement>;
  /** 结算触发（业务层实现：打款/发票） */
  settle(statementId: string): Promise<SettlementResult>;
}
```

> **诚实边界**：分佣/打款涉及**资金合规**，属业务层；G-50 **只提供对账数据 SPI**，
> 不内置支付结算（原则 #0 不绑定结算渠道）。

---

## 7. conformance 断言

- `GOV-01`：单包资源超限 → QUOTA_EXCEEDED（结构化，非异常）
- `GOV-02`：ISOLATION_BREACH → 立即 terminate + 审计记录
- `GOV-03`：revoke 后凭证/存储**全部清除**（G-46 验证）
- `GOV-04`：审计日志**不可篡改**（append-only，校验链）
- `GOV-05`：全局配额池超限 → 新包加载拒绝

---

## 8. Phase 3（长期，非阻塞）

| 能力 | 说明 |
|------|------|
| 运营后台 | 审核/风控/客服工作台 |
| 数据平台 | 漏斗/留存/性能监控（APM） |
| 开放 API | 第三方系统集成 |
| 插件市场 | 07 预留的 PluginMarketplace |

**Phase 3 不在本 plan 验证范围**（依赖运营规模），仅占位。

---

*G-50 核心文档到此完成。剩余：`conformance.md`、`rules.md`、`architecture-update.md`。*
