# G-50 Conformance（断言清单）

> **本文档化断言清单，不写 runner**（G-50 = plan only）。
> 每个断言对应一份核心文档的具体规则；**命名规则**：`<DOC>-<NN>`。
> 运行时验证复用 **G-44 Test IR** + **G-47 接缝测试思想**（工具链 × 运行时）。

---

## 1. 断言总表

### A 工具链（04-08）

| 编号 | 来源 | 断言 |
|------|------|------|
| CLI-01 | 04 | `proteus create` 产物可被 `proteus build` 产出有效 AppPackage |
| CLI-02 | 04 | 未声明 capability 的使用被 `audit` 拦截（AUD-01） |
| CLI-03 | 04 | 审计失败的产物被 `publish` 拒绝 |
| CLI-04 | 04 | `publish` 产物可被 G-48 Runtime 加载（**桥接**） |
| SCAFF-01 | 05 | 生成 manifest 可被 build 解析为有效 AppManifest |
| SCAFF-02 | 05 | 缺 `rationale` 的 restricted capability → 审计失败 |
| SCAFF-03 | 05 | manifest capabilities 与源码调用一致 |
| DBG-01 | 06 | TraceBus 事件可被 DevTools 完整订阅 |
| DBG-02 | 06 | G-49 ISOLATION_BREACH 可追溯到 packageId |
| DBG-03 | 06 | 生产模式下调试通道默认关闭 |
| GEN-01 | 07 | 生成 Adapter 可通过 G-48 CapabilityRegistry 校验 |
| GEN-02 | 07 | 生成 manifest 条目与源码一致 |
| GEN-03 | 07 | `audit --matrix` 覆盖所有 capability×adapter |
| PUB-01 | 08 | CLI AppPackage 可被 G-48 Runtime 加载 |
| PUB-02 | 08 | **缺平台签名** → 运行时拒装 |
| PUB-03 | 08 | permissions 与实际调用不一致 → 拒绝 |
| PUB-04 | 08 | 资源超限 → QUOTA_EXCEEDED（结构化，非异常） |
| PUB-05 | 08 | revoke → 优雅终止（G-43 Drop，无泄漏） |

### B 生态（09-12）

| 编号 | 来源 | 断言 |
|------|------|------|
| PORTAL-01 | 09 | 注册 → 创建应用 → 获取密钥闭环 |
| PORTAL-02 | 09 | 密钥轮换后旧密钥立即失效 |
| PORTAL-03 | 09 | 成员移除后立即失权 |
| PORTAL-04 | 09 | 开发者应用数上限（防滥用） |
| REVIEW-01 | 10 | 未过 autoScan 不得进 manualReview |
| REVIEW-02 | 10 | approve 后包**必含双签名** |
| REVIEW-03 | 10 | reject 后不得分发 |
| REVIEW-04 | 10 | restricted 能力强制人工审核 |
| DIST-01 | 11 | 运行时仅加载 manifest 中已签名版本 |
| DIST-02 | 11 | 灰度规则外用户看不到灰度版 |
| DIST-03 | 11 | unpublish → 新用户不可下载 |
| DIST-04 | 11 | hotfix 不得新增 capability |
| GOV-01 | 12 | 单包超限 → QUOTA_EXCEEDED |
| GOV-02 | 12 | ISOLATION_BREACH → terminate + 审计 |
| GOV-03 | 12 | revoke 后凭证/存储全清（G-46） |
| GOV-04 | 12 | 审计日志不可篡改 |
| GOV-05 | 12 | 全局配额池超限 → 新包拒绝 |

**合计：39 条**（核心断言 35 = A 工具链 18 + B 生态 17；接缝 INT 2 + 负向 NEG 2，以表格实际行数为准）。

> 注：编号采用 `分组-NN` 形式——A 工具链（04–08）18 条：CLI/SCAFF/DBG/GEN/PUB；
> B 生态（09–12）17 条：PORTAL/REVIEW/DIST/GOV；
> 接缝用 `INT-A1`/`INT-B1`，负向用 `NEG-01`/`NEG-02`（见 §2/§3）。

---

## 2. 组合一致（G-47 接缝测试层扩展）

| 编号 | 场景 | 含义 |
|------|------|------|
| INT-A1 | `proteus publish` → 审核 → 分发 → G-48 加载 | **工具链 × 运行时 全链路** |
| INT-B1 | 运行时加载 → GOV 配额超限 → revoke → 重新发布 | **运行时 × 治理 闭环** |

> 接缝测试思想来自 G-47（G-27 × G-46 组合）。G-50 新增**工具链/生态**这一侧的接缝。

---

## 3. 负向自检（NEG，验证 runner 确实会报 FAIL）

沿用 G-46/G-47/G-49 风格：**断言列表本身须有判别力**——

- **NEG-01**：故意构造"缺平台签名"的 AppPackage，验证 PUB-02 **确实失败**
- **NEG-02**：故意越权调用未声明 capability，验证 CLI-02 **确实拦截**

> 若负向用例 PASS（未失败），说明断言缺失 → conformance 自检失败。
> （参考 G-46 的"XSS 读取 HttpOnly"、G-47 的"verify grep 盲区"教训。）

---

## 4. 三平台后端矩阵（验证场景，非真后端）

| 场景 | 后端 | 覆盖 |
|------|------|------|
| 本地开发 | LocalCLI + InMemory | CLI-01~04、SCAFF、GEN |
| 平台审核 | InMemoryPortal + AutoReject | PORTAL、REVIEW、DIST |
| 运行时 | **G-48 WebBackend（模拟）** | PUB、GOV、INT |

> **真原生后端（Android/iOS/鸿蒙）不在本 plan 范围**——依赖 **G-49 L3 真原生隔离后端落地**。

---

## 5. 诚实边界（验证范围）

- **本 conformance 为文档化清单**，不含可执行 runner（G-50 = plan only）
- **runner 应在 G-44 Test IR 上实现**（沿用 G-48/G-49 的 InMemory 模式）
- **真多进程隔离验证需 G-49 L3 真后端**——本份只定义断言，不验证
- **运营/风控准确率不在机器验证范围**（属长期运营能力）

---

*下一份：`rules.md`（铁律 + CMP 编号 + 全局对齐）。*
