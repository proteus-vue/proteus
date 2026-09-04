# 10 提审与审核（B2）

> 接续 `09-developer-portal.md`。定义 **SubmissionAPI**：自动扫描、人工审核、双签名。
> **安全关键路径**（依赖 G-49 L3；原则 #13.44 由 G-49 定义，出处见 rules.md §5）。

---

## 1. 审核流水线

```
submit (AppPackageRef, version)
   │
   ▼
① autoScan（自动扫描，必过）
   ├── 签名校验（G-45：开发者签名有效 + 未篡改）
   ├── 静态分析（恶意代码 / 敏感 API 调用 / 隐私合规）
   ├── 权限合规（permissions 与代码调用一致，AUD-01）
   ├── 资源合规（体积/配额，AUD-04）
   └── capability 合规（restricted → 需 rationale + 资质）
   │
   ├─ 失败 → SUBMISSION_REJECTED（含 reason + 可修复建议）
   └─ 通过 ↓
              │
              ▼
② manualReview（仅 restricted 能力 / 高风险触发）
   ├── 人工审核员（RBAC：Reviewer 角色）
   ├── 审核项：内容合规 / 资质 / 用户体验 / 商标
   └── verdict: approve | reject | requestChanges
              │
              ▼
③ approve → 双签名（G-45 扩展）
   ├── 保留开发者签名
   └── **追加平台签名**（platformSignature）
              │
              ▼
④ 进入分发（11-release）
```

---

## 2. 双签名（★ G-45 的扩展）

G-45 定义"**签名同源**"（防篡改、防 MITM）。G-50 扩展为**双签名**：

| 签名 | 签发者 | 校验方 | 含义 |
|------|--------|--------|------|
| `developerSignature` | 开发者（SigningKey） | 平台（autoScan） | 包来自合法开发者、未篡改 |
| `platformSignature` | 平台（审核通过后） | **运行时（G-48 加载）** | 包已通过审核、可运行 |

**运行时校验（见 08 §3）要求两个签名都在**——缺一不可：

- 缺开发者签名 → 来源不明，拒装
- 缺平台签名 → 未审核，拒装

> **诚实边界**：双签名保证"**审核过的包才运行**"，但不保证审核本身无遗漏——
> 审核准确率依赖规则库与人工，属运营能力（plan 只定义机制）。

---

## 3. 自动扫描规则集

| 规则 | 严重度 | 来源 |
|------|:------:|------|
| 签名无效/缺失 | error | G-45 |
| 恶意代码特征 | error | 静态分析 |
| 未声明 capability 调用 | error | G-48 + AUD-01 |
| 隐私 API 无 rationale | error | 本份 |
| 超配额 | error | G-49 |
| 敏感权限过度申请 | warn | 合规 |

---

## 4. 审核状态机

```
pending → scanning → [rejected]
                ↓ (通过)
            reviewed → [changes_requested → pending]
                ↓ (approve)
            approved → 双签名 → 可分发
```

**所有迁移可审计**（GovernanceAPI.auditEvent，见 12）。

---

## 5. conformance 断言

- `REVIEW-01`：未过 autoScan 的包**不得进入 manualReview**
- `REVIEW-02`：approve 后包**必须含双签名**
- `REVIEW-03`：reject 后**不得分发**（即使已生成签名也作废）
- `REVIEW-04`：restricted 能力**强制人工审核**（无 skip）

---

*下一份：`11-distribution-store.md`（B3：分发、灰度、热修复、下架）。*
