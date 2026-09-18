# G-50 铁律（rules）

> **编号**：G-50.1 ~ G-50.8
> **CMP**：CMP-118 ~ CMP-131（14 条，承接 G-49 的 CMP110-117，见 §3）
> **风格**：沿用 G-46（RSC）、G-49（G-49.x）的"铁律 + CMP"双轨。

---

## 1. 八条铁律

### G-50.1 — 审计是发布的硬前置
> 未过审计（04-audit）的产物**不得**进入分发链路。
> 对应：CLI-03、AUD-01~06。

### G-50.2 — 一个 packageId 的资源仅该 packageId 的代码可访问
> 宿主凭证与小程序凭证**永不通透**；隔离语义对齐 G-46（按 appId）+ G-49（跨小程序零共享）。
> 对应：PUB-03、GOV-03。

### G-50.3 — 配额/审核拒绝是业务错误，非异常
> 沿用 G-49.6：QUOTA_EXCEEDED 走结构化返回，**不得未捕获抛出**。
> 对应：PUB-04、GOV-01。

### G-50.4 — 运行时仅信任双签名 + manifest 索引
> 缺开发者签名或平台签名 → 拒装；CDN 被劫持不影响（G-45 防 MITM）。
> 对应：PUB-02、DIST-01、REVIEW-02。

### G-50.5 — restricted 能力强制人工审核
> 无 `rationale` / 无资质的 restricted capability **一律驳回**，无 skip 路径。
> 对应：REVIEW-04、SCAFF-02。

### G-50.6 — 撤销是优雅终止，非崩溃
> revoke 走 G-43 Drop 级联：清凭证（G-46）+ 清存储 + terminate，**无泄漏**。
> 对应：PUB-05、GOV-03。

### G-50.7 — 审计日志不可篡改（append-only）
> 所有状态迁移（审核/撤销/结算）须可举证；对齐 G-49 ISOLATION_BREACH 审计风格。
> 对应：GOV-04。

### G-50.8 — B 生态以 G-49 L3 为硬前置
> 运行**任意第三方代码**的资格，**以 G-49 L3 真原生隔离后端落地为必要条件**；
> L3 未落地前，B 的"运行第三方"环节为**受限灰度**。
> 对应：原则 #13.44（由 G-49 定义，出处见 §5 避让登记）。

---

## 2. CMP 编号（G-50 范围）

| CMP | 铁律 | 内容 |
|-----|------|------|
| CMP-118 | G-50.1 | 审计失败阻断 publish |
| CMP-119 | G-50.2 | packageId 资源隔离 |
| CMP-120 | G-50.3 | 配额拒绝是业务错误 |
| CMP-121 | G-50.4 | 双签名必填 |
| CMP-122 | G-50.5 | restricted 强制人工审核 |
| CMP-123 | G-50.6 | 撤销优雅终止 |
| CMP-124 | G-50.7 | 审计 append-only |
| CMP-125 | G-50.8 | B 生态需 G-49 L3 |
| CMP-126 | — | 密钥轮换立即失效（PORTAL-02） |
| CMP-127 | — | 灰度规则严格隔离（DIST-02） |
| CMP-128 | — | hotfix 不得新增 capability（DIST-04） |
| CMP-129 | — | 全局配额池上限（GOV-05） |
| CMP-130 | — | manifest 能力与源码一致（SCAFF-03） |
| CMP-131 | — | 负向自检必须有判别力（NEG） |

---

## 3. 全局 G 表对齐

> **编号以 facade G 表为准**（`docs/proteus-architecture-facade-plan/00-architecture.md`）：
> 本包 = **G-50**（CMP-118 ~ CMP-131，承接 G-49 的 CMP110-117），**不占用其它编号、不自拟重映射**。
>
> **老号澄清**：既有 plan 文档中沿用过 execution-carrier 原稿编号体系（宿主运行时 G-36、执行载体 G-37、
> 容器/安全网关 G-39、所有权/Drop G-40 等），facade v3.5/v3.6/v3.8 已全量重指向官方位。本份引用既有体系时
> 一律以官方位/目录名为准：CLI → **cli-plus（G-33）**、DevTools → **proteus-devtools-plan /
> proteus-devtools-plus-plan（G-34）**、Router → **router-plus（G-32）**、宿主运行时 → **G-39**、
> 容器/安全网关 → **G-42**、所有权/Drop → **G-43**。完整对照见 §5「编号避让登记」。

### 与既有铁律的关系（无冲突）

| 既有 | G-50 扩展 |
|------|----------|
| G-45 签名链（证书链同源 G-45.7 / manifest 哈希防 MITM G-45.8） | → **双签名**（G-50.4 / CMP-121） |
| G-46 凭证按 appId 隔离 | → **developer/package 二级隔离**（G-50.2） |
| G-47 组合一致 | → **工具链 × 运行时 接缝**（INT-A1/B1） |
| G-49.6 配额拒绝是业务错误 | → 复用（G-50.3 / CMP-120） |
| G-49 deny-by-default | → 复用（PUB-03） |

---

## 4. 反模式（AP，须避免）

| 反模式 | 后果 | 正解 |
|--------|------|------|
| AP-13 跳过审计直接 publish | 未声明能力进入生产 | G-50.1 |
| AP-14 单签名运行 | 未审核包可运行 | G-50.4（双签名） |
| AP-15 撤销时强杀进程 | 数据丢失、泄漏 | G-50.6（优雅终止） |
| AP-16 密钥长期不轮换 | 泄漏后无法止损 | CMP-126 |
| AP-17 L3 未落地即开放第三方 | 平台级安全事故 | G-50.8 |

---

## 5. 编号避让登记（本包定案）

| 条目 | 登记 |
|------|------|
| 老号 G-19（DevTools） | DevTools 本体 = 目录 `proteus-devtools-plan`（board 老行记 G-19）；官方位 = **G-34**（`proteus-devtools-plus-plan`，DevTools 协议/HMR）。本包正文一律写目录名或 G-34，不再写"G-19 DevTools" |
| 老号 G-18（CLI） | → cli-plus（**G-33**，老 G-18 CLI 同义） |
| 老号 G-17（Router） | → router-plus（**G-32**，老 G-17 Router 同义） |
| 老号 G-36（宿主运行时） | → **G-39**（host-runtime-plan） |
| 老号 G-39（容器/安全网关） | → **G-42**（host-container-plan） |
| 老号 G-40（Drop/所有权） | → **G-43**（ownership-plan；Drop 级联即其五阶段销毁协议） |
| 老号 G-37（执行载体） | → **G-40**（execution-carrier-plan；"未实测不宣称" = CMP046） |
| CMP-118~131 | 承接 **G-49 的 CMP110-117**（全库连续段：G-46=089-096 / G-47=097-102 / G-48=103-109 / G-49=110-117，均已定） |
| 原则 #13.44 | 由 **G-49 定义**，出处：`docs/proteus-sandbox-isolation-plan/architecture-update.md`；整合入库后并入总规约 |
| 原则 #0 第 14 次应用 | 本包 = **第 14 次**「不绑定」（A/B 共用 AppPackage 契约 + DeveloperPlatform SPI，后端可插拔）；沿 G-46=10 / G-47=11 / G-48=12 / G-49=13 计数 |
| 整合决策 | 决策 **#385**：本包（G-50，纯 plan）整合入库 |

---

*下一份（收官）：`architecture-update.md`。*
