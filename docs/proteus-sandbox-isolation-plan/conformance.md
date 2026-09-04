# G-49 Conformance（一致性验证规范）

> 每个 `SandboxBackend` 实现 **必须** 通过同一份测试（G-44 Test IR 精神）
> 参考实现：`reference-impl.cjs`（30/30 PASS，WebBackend 模拟 L1/L2/L3 语义）

---

## 1. 不变量清单

| 编号 | 不变量（机器可验证） | 参考实现测试 |
|------|---------------------|-------------|
| **SBX-01** | 跨小程序读取对方存储 → 拒绝 | L2-02 / L2-02b |
| **SBX-02** | 未声明权限的 API 调用 → PERMISSION_DENIED（deny-by-default） | L2-05 |
| **SBX-03** | 篡改/伪造 manifest 权限 → MANIFEST_INVALID | （B 落地项：参考实现暂不注入 manifest 篡改，诚实缺口——见 rules/architecture-update） |
| **SBX-04** | 一个小程序崩溃 → 宿主与其他小程序不受影响 | L3-01~04 |
| **SBX-05** | `destroyContext` → 存储 + 权限 + 配额全部释放（Drop 级联，G-43） | DROP-01~03 |
| **SBX-06** | 资源配额超限 → QUOTA_EXCEEDED，宿主不抛异常 | L2-06 |
| **SBX-07** | appId 规范化 + 路径无碰撞 + 穿越拦截 | ID-01~06 |
| **SBX-08** | `ISOLATION_BREACH` 检测 → 终止小程序 + 审计日志 | BREACH-01 |

---

## 2. 错误码映射（→ CMP）

| 错误码 | CMP | 严重级 | 处理 |
|--------|-----|--------|------|
| MANIFEST_INVALID | CMP-110 | 高 | 拒绝加载小程序包 |
| PERMISSION_DENIED | CMP-111 | 中 | 拒绝调用，记审计 |
| QUOTA_EXCEEDED | CMP-112 | 中 | 拒绝调用，**不抛到宿主** |
| INVALID_APP_ID | CMP-113 | 高 | 拒绝创建上下文 |
| ISOLATION_BREACH | CMP-114 | **严重** | 终止小程序 + 上报审计 |
| TOKEN_EXPIRED | CMP-115 | 中 | 拒绝调用 |
| SANDBOX_CRASHED | CMP-116 | 高 | 回调崩溃处理器 |
| —（平台差异）| CMP-117 | — | 诚实边界（iOS ≠ Android） |

---

## 3. 负向自检（★ 验证器本身也要被验证）

**问题**：如果 conformance runner 的断言永远返回 true，"30/30 PASS" 就是空话。

**自检项**：注入故障，确认 runner **确实会报告失败**。

| 自检 | 注入 | 预期 |
|------|------|------|
| NEG-01 | 临时把 L2-02 的 `breached` 改为 `false` | runner 报告 FAIL |
| NEG-02 | 临时把 SBX-02 权限白名单改为包含全部 | runner 报告 FAIL |
| NEG-03 | 临时把配额判断 `>=` 改为 `<=` | runner 报告 FAIL |

> 每次 CI 运行 conformance **必须先跑负向自检**，通过后才认可正式结果。
> （G-46 NEG 系列、G-47 INV 系列沿用同一机制。）

---

## 4. 三平台 Backend 矩阵

| Backend | L1 | L2 | L3 | 备注 |
|---------|:--:|:--:|:--:|------|
| **AndroidBackend** | ✅ | ✅ | ✅ | `android:process` + `setDataDirectorySuffix` |
| **IOSBackend** | ✅ | ✅ | ⚠️ 系统级 | `WKProcessPool` 单例 + `WKWebsiteDataStore` 分桶；**进程隔离靠 WebContent，不由应用控制（CMP-117）** |
| **HarmonyOSBackend** | ✅ | ✅ | ✅ | 独立 UIAbility / ServiceExtensionAbility + `EcmaVM` 独立堆 |
| **WebBackend**（本参考实现） | ✅ | ✅（模拟） | ❌ | **仅用于 conformance 测试，不承诺真实隔离** |

---

## 5. 与既有 conformance 的集成（G-47 接缝）

G-47 定义了"渲染后端 × 资源池"的组合不变量（INV-01~06）。G-49 新增：

- **INV-07**：切换渲染后端时，小程序隔离级别不降级
- **INV-08**：小程序崩溃重启后，宿主资源池（G-46）状态不丢失

> 这两条属于 G-47 的接缝测试层扩展，**实现见 G-47 conformance 增量（G-50 阶段补齐）**。
