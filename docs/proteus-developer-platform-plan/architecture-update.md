# G-50 架构增量（architecture-update）

> 对 Proteus 总规约（architecture.md）的增量。**合并时追加到对应章节。**

---

## 1. 新增原则（原则 #13 续）

### 原则 #13.46 — 平台以应用包为原子
> 开发者平台的最小可治理单元是 **AppPackage**（manifest + 代码 + 双签名），
> 非单个文件、非单个页面。

### 原则 #13.47 — 工具链与生态解耦（A 可独立用）
> A（工具链）可**完全独立使用**（不依赖 B 生态）；
> B（生态）的关键路径（运行第三方）**依赖 G-49 L3**。

### 原则 #13.48 — 审核过的包才可运行（双签名）
> 运行时**只加载双签名包**（开发者 + 平台）；
> 未审核包、自签名包一律拒装。

### 原则 #13.49 — 撤销是级联销毁的应用级投影
> `revoke(packageId)` = G-46（清凭证）+ G-43（Drop 级联）的**应用级推广**：
> 清凭证 → 清存储 → terminate 实例，**无泄漏**。

### 原则 #13.50 — 平台能力声明式（不绑定审核策略）
> 审核/风控/结算以 **SPI** 暴露，后端可替换（自动/人工/第三方）；
> 框架只定义机制，不绑定运营策略。

---

## 2. 能力成熟度分级（更新）

| 级别 | 含义 | 落地 plan |
|------|------|----------|
| L0 | 无隔离 | — |
| L1 | 逻辑隔离（独立 Context） | G-48 |
| L2 | 存储 + 权限隔离（网关） | G-49 |
| **L3** | **进程隔离（崩溃隔离）** | **G-49**（**G-50 B 的硬前置**） |
| **L4** | **运行时隔离（V8 Isolate/microVM）** | **G-50（本份，开放生态目标）** |
| L5 | 分布式/多设备 | （未来） |
| L6 | 可信执行环境（TEE） | （未来） |

> **G-50 把 L4 从"未来"推进到"开放生态目标"**：以 **L3 落地为前提**（原则 #13.44 → #13.47），向 L4 演进。
>
> **维度说明（防与 G-49 漂移）**：本表 L0-L6 与 G-49 的 L0-L6 同轴同义，L4 = **隔离强度 L4**
> （运行时隔离技术：V8 Isolate / microVM，承接 G-49 定义并留给 G-50 落地）；本份的"开放生态目标"另指
> **能力成熟度模型 L4**（运行任意第三方代码的业务资格）——**隔离强度（技术）**与**能力成熟度（业务）**
> 是两个维度，注意区分，避免与 G-49 的 L4 单义混读。

---

## 3. 与既有体系的互校（无冲突）

| 体系 | G-50 增量 | 关系 |
|------|----------|------|
| devtools（G-34） | TraceBus / 调试协议 | **复用**（底座） |
| cli-plus（G-33） | `defineProteus` + publish/submit | **扩展** |
| G-42 安全网关 | 开发者 API 网关 | 复用 + 细化 |
| G-45 签名同源 | **双签名（developer + platform）** | **扩展** |
| G-46 资源池 | **developer/package 二级隔离** | 扩展 |
| G-47 组合一致 | **工具链 × 运行时 接缝（INT-A1/B1）** | 扩展 |
| G-48 Runtime | AppPackage 加载输入 | 复用 |
| G-49 Sandbox | **多租户隔离 + 全局配额池** | 复用（核心依赖） |

---

## 4. 已知缺口（诚实边界）

1. **本份为 plan only**：不含参考实现、不含 verify.sh、不含打包（用户明确要求）
2. **真原生后端不在范围**：依赖 G-49 L3 真后端落地（Android `android:process` / 鸿蒙 `EcmaVM`）
3. **运营能力（风控准确率/审核 SLA/客服）非机器可验证**，属长期运营
4. **结算/打款属业务层**，仅提供 SettlementSPI（原则 #0 不绑定渠道）
5. **Phase 3（运营后台/数据平台/插件市场）非阻塞**，仅占位

---

## 5. 验证覆盖（conformance.md 映射）

| 维度 | 断言数 | 验证方式 |
|------|:------:|---------|
| A 工具链（CLI/SCAFF/DBG/GEN/PUB，04–08） | 18 | G-44 Test IR（InMemory） |
| B 生态（PORTAL/REVIEW/DIST/GOV，09–12） | 17 | G-44 Test IR（InMemory） |
| 接缝（INT） | 2 | G-47 接缝测试层 |
| 负向（NEG） | 2 | 自检判别力 |
| **合计（核心 35 + 接缝 2 + 负向 2）** | **39** | — |

> **本份不执行验证**（plan only）。运行时验证须：
> ① 实现 G-44 Test IR runner（InMemory 后端）
> ② G-49 L3 真原生后端落地（B 生态资格）

---

## 6. 本次交付清单

```
G-50-developer-platform/
├── 01-problem.md            ★ 定位 / A+B scope / 竞品 / 诚实边界
├── 02-architecture.md       平台全景（三条主线 + 分层）
├── 03-spi.md                ★ DeveloperPlatform SPI（A + B）
├── 04-cli-pipeline.md       ★ A1 CLI（create/dev/build/audit/publish）
├── 05-project-scaffold.md   ★ A2 脚手架 + capability-manifest
├── 06-debug-protocol.md     ★ A3 调试（复用 devtools（G-34）TraceBus）
├── 07-component-toolkit.md  ★ A4 能力生成（G-48 Capability IR）
├── 08-publish-runtime.md    ★ A5 发布（A→B 桥接）
├── 09-developer-portal.md   ★ B1 门户（注册/密钥/成员）
├── 10-submission-review.md  ★ B2 审核（双签名，G-45 扩展）
├── 11-distribution-store.md ★ B3 分发（CDN/灰度/热修复/下架）
├── 12-governance-monetization.md ★ B4 治理（配额/风控/审计/结算）
├── conformance.md            ★ 39 条断言清单（核心 35 = A 18 + B 17 + 接缝 2 + 负向 2，文档化）
├── rules.md                 ★ G-50.1-8 + CMP-118~131 + 反模式
└── architecture-update.md   ★ 本份（原则 #13.46-50 + L0-L6）
```

**★ = 独有增量**（A 工具链 5 份 A1–A5 + B 生态 4 份 B1–B4 = **9 份** = G-50 真正新增价值；03-spi 为 A+B 共用 SPI，不重复计数）。

---

*G-50 是小程序系列（G-48/49/50）的收官篇，也是 Proteus 从"框架"走向"平台"的关键一步。*
*全套 plan 落地完成（仅文档，按用户要求）。*
