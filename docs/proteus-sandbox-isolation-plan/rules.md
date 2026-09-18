# G-49 铁律与编号（rules）

> 依赖：G-42 安全网关/容器、G-43 所有权（Drop）、G-45 签名同源、G-46 资源池、G-48 运行时
> CMP 全局编号延续：G-48 分配 CMP103-109 → **G-49 从 CMP-110 起**（原稿 CMP109-117 含冗余 CMP-115，去重后 8 条语义赋 110~117）

---

## 一、铁律（必须遵守，无例外）

### G-49.1 — deny-by-default（默认拒绝）
> 任何小程序 API 调用，**未在其 manifest 声明即拒绝**。不得"先放行、后审计"。

### G-49.2 — 无开放 bridge（禁止 addJavascriptInterface 式暴露）
> 原生能力**只通过 CapabilityBridge 消息通道**暴露，**绝不暴露原生对象引用**。
> 违反即等同于把 XSS 升级为任意原生调用（业界 9/10 审计踩坑点）。

### G-49.3 — 跨小程序零共享（ISOLATION_BREACH）
> 一个小程序的存储、全局对象、闭包，**对其他小程序不可见**。任何跨域访问尝试 →
> `ISOLATION_BREACH` → 终止该小程序 + 审计日志。

### G-49.4 — Drop 级联（G-43 复用）
> `destroyContext` 必须释放：存储 + 权限 + 配额计数。销毁后重建必须得到**全新空状态**。

### G-49.5 — 配额超限不抛到宿主
> `QUOTA_EXCEEDED` 是**业务错误**，走 CapabilityBridge 拒绝通道，**不得抛出未捕获异常拖垮宿主**。

### G-49.6 — 诚实边界（CMP-117）
> **不承诺三平台机制一致，只承诺隔离语义等价。**
> iOS 进程隔离靠系统 WebContent（不由应用控制），Android/鸿蒙可做到应用内多进程。

---

## 二、CMP 编号映射

| CMP | 名称 | 严重级 | 对应 |
|-----|------|:------:|------|
| CMP-110 | `MANIFEST_INVALID` | 高 | 签名/权限清单校验失败 |
| CMP-111 | `PERMISSION_DENIED` | 中 | G-49.1 |
| CMP-112 | `QUOTA_EXCEEDED` | 中 | G-49.5 |
| CMP-113 | `INVALID_APP_ID` | 高 | appId 规范化 |
| CMP-114 | `ISOLATION_BREACH` | **严重** | G-49.3 |
| CMP-115 | `TOKEN_EXPIRED` | 中 | ScopedToken 校验 |
| CMP-116 | `SANDBOX_CRASHED` | 高 | 崩溃处理 |
| CMP-117 | 平台差异诚实边界 | — | G-49.6 |

> 注：原稿 CMP-109/CMP-115（`MANIFEST_INVALID` 语义重复）已合并为单一 **CMP-110**；去重后语义条目 8 条按序赋 **CMP110-117**（见文末编号避让登记）。

---

## 三、全局编号对齐说明

**正式编号**：本包 = **G-49** —— 原则 #0「不绑定」第 13 次泛化（不绑定隔离强度）。本批 G-46~G-52 统一入库，编号以 facade G 表为准（决策 #385）；CMP110-117 处全库连续段（G-48=CMP103-109），无冲突。

与相邻 plan 的关系：
- **G-48**（运行时容器）← G-49 扩展其 `PageFrame` → `IsolatedPageFrame`；G-48 提供 L1 逻辑隔离基线（SBX-L1 集），G-49 在其上做 L2 存储权限 / L3 进程
- **G-50**（开发者平台）← **依赖 G-49 L3 落地**。G-50 的"运行任意第三方代码"资格，**以 G-49 的进程级隔离为前提**（L4 运行时隔离留给 G-50）

**方法论第 13 次泛化**：「不绑定隔离强度」——`IsolationLevel` 作为能力声明，后端按平台返回 L1~L4。

---

## 四、反模式（AP）

| 编号 | 反模式 | 后果 |
|------|--------|------|
| AP-09 | `addJavascriptInterface` 暴露原生对象 | XSS → 任意原生调用 |
| AP-10 | 用"规范约定"代替机制强制隔离 | 跨小程序数据泄漏 |
| AP-11 | 配额超限抛未捕获异常 | 一个恶意小程序拖垮宿主 |
| AP-12 | 宣称"三平台机制一致" | 误导上层，iOS 实际做不到应用内多进程 |

详见 `01-problem.md` §1 与 `03-spi.md`。

---

## 五、编号避让登记

```
■ CMP 平移：本包全局 CMP 由原稿 CMP109-117 重排为 CMP110-117。
    合并说明：原稿 CMP-115 与 CMP-109 语义重复（均指 MANIFEST_INVALID），先按去重合并为一条，
    去重后 8 条语义条目按序赋 110~117：MANIFEST_INVALID=110 / PERMISSION_DENIED=111 /
    QUOTA_EXCEEDED=112 / INVALID_APP_ID=113 / ISOLATION_BREACH=114 / TOKEN_EXPIRED=115 /
    SANDBOX_CRASHED=116 / 平台差异诚实边界=117（与 G-50 起点 CMP118 衔接）
■ 老号重指向（execution-carrier 旧编号体系，按语境逐个改）：
    G-36 宿主运行时 → G-39（host-runtime）
    G-39 容器/安全网关 → G-42（host-container）
    G-40 所有权/Drop 级联 → G-43（ownership）
    G-34/G-41 精神（旧式提法）→ 正文"同一份测试"语义一律以 G-44（Test IR / 统一 runner）表述
■ SBX 权威集区分：SBX-01~08 是本包（G-49）的 L1-L3 全层不变量权威集；
    G-48 的 SBX-L1-01~08 是 L1 逻辑隔离集（不同义）——文档内引用本包 SBX 均指权威集
■ G-42/G-43 承接（引用不重述）：崩溃隔离 / 配额 / 安全网关语义承接 G-42（host-container）；
    销毁级联（destroyContext / Drop）承接 G-43（ownership，Drop 五阶段已落地）
■ 诚实缺口（B 落地项）：SBX-03（manifest 篡改 → MANIFEST_INVALID）与
    CapabilityBridge.requestPermission 暂无机器参考实现——见 architecture-update §4
■ 泛化自洽：原则 #0「不绑定」第 13 次泛化（不绑定隔离强度）
■ 决策：#385 整合入库（本批 G-46~G-52 统一编号，以 facade G 表为准）
```
