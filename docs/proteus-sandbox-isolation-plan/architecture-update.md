# G-49 架构增量（architecture-update）

> 对 Proteus 总规约（architecture.md）的增量。合并时追加到对应章节。

---

## 1. 新增原则（原则 #13 续）

### 原则 #13.41 — 不绑定隔离强度
> 隔离以 **能力声明**（`IsolationLevel`）呈现，后端按平台返回可达级别（L1~L4）。
> 上层 Runtime **只依赖接口，不依赖具体级别**。

### 原则 #13.42 — 机制强制优于规范约定
> 跨小程序隔离、权限控制 **由运行时机制保证**，不由文档/约定约束。
> 对应：G-49.3（ISOLATION_BREACH）、G-49.2（CapabilityBridge）。

### 原则 #13.43 — 隔离语义等价，实现允许不同（CMP-117）
> 各平台 **隔离强度语义等价**（一个崩溃不影响其他），**实现机制允许不同**。
> iOS（系统 WebContent）≠ Android/鸿蒙（应用内多进程）—— 这是诚实边界，非缺陷。

### 原则 #13.44 — 开放平台以进程隔离为前提
> G-50（开发者平台）的"运行任意第三方代码"资格，**以 G-49 L3 落地为硬前置**。

### 原则 #13.45 — 配额拒绝是业务错误，非异常
> 资源配额超限 → 走 CapabilityBridge 拒绝通道，**不得未捕获抛出**。

---

## 2. 能力成熟度分级（L0-L6，新增层级）

| 级别 | 含义 | 落地 plan |
|------|------|----------|
| L0 | 无隔离 | — |
| **L1** | 逻辑隔离（独立 Context） | G-48 |
| **L2** | 存储 + 权限隔离（网关） | **G-49** |
| **L3** | 进程隔离（崩溃隔离） | **G-49** |
| L4 | 运行时隔离（V8 Isolate/microVM） | **G-50** |
| L5 | 分布式/多设备 | （未来） |
| L6 | 可信执行环境（TEE） | （未来） |

---

## 3. 与既有体系的互校（无冲突）

| 体系 | G-49 增量 | 关系 |
|------|----------|------|
| G-42 容器/安全网关 | CapabilityBridge 是网关的**小程序特化**（崩溃隔离 / 配额语义承接 G-42 host-container） | 复用 + 细化 |
| G-43 所有权/Drop | `destroyContext` = Drop 级联（五阶段已落地） | 复用（DROP-01~03 已验证） |
| G-45 签名同源 | manifest 签名校验复用 | 复用 |
| G-46 资源池 | Cookie/Token **按 appId 隔离**（复用 origin 命名空间） | 扩展 |
| G-47 组合一致 | 新增 INV-07/08（接缝测试层） | 扩展 |
| G-48 Runtime | PageFrame → IsolatedPageFrame（含进程归属） | 扩展 |

> **崩溃隔离 / 配额 / Drop 级联语义承接**：G-42（host-container）与 G-43（ownership）——本包以引用不重述，不另起新 SPI。

---

## 4. 已知缺口（诚实边界）

1. **WebBackend 仅用于 conformance 测试**，其"隔离"是逻辑模拟，**不能用于生产运行不可信代码** —— 真隔离需平台原生 API
2. **L4（V8 Isolate / microVM）未落地** —— 留给 G-50
3. **多进程场景下的跨进程资源池协调**（G-46 缺口）仍待 G-50
4. **B 落地项（诚实缺口）**：SBX-03（篡改 manifest → MANIFEST_INVALID）参考实现暂不注入 manifest 篡改场景；`CapabilityBridge.requestPermission`（动态授权弹窗）暂无机器参考实现 —— 两者均为 B 落地项，见 rules.md 编号避让登记

---

## 5. 参考实现验证

```
reference-impl.cjs：30/30 PASS
verify.sh         ：14/14 PASS（含负向自检 NEG-01）
```

验证覆盖：SBX-01~08（conformance.md）+ 负向自检。
