# Proteus 小程序开发者平台（G-50）

> **Status: Draft · 决策 #385 整合入库（编号 G-50；CMP118-131 承接 G-49 的 CMP110-117）**
>
> **一句话定位**：G-48 让小程序**能跑**、G-49 让不可信小程序**安全跑**之后，本包补齐 **「开发 → 审核 → 发布 → 治理」生态闭环**——
> 分 **A 开发者工具链平台**（工具链，04–08）+ **B 开放生态平台**（生态，09–12）两册。
>
> **方法论定位**：原则 #0「不绑定」系列 **第 14 次应用**——**不绑定开发者平台/生态形态**：
> A/B 共用 `AppPackage` 契约 + `DeveloperPlatform` SPI，后端（本地 CLI / 云端构建 / 门户 / 审核 / 分发 / 治理）可插拔。
> （沿小程序系列计数：G-46=10 / G-47=11 / G-48=12 / G-49=13。）

---

## 为什么需要它

- **G-48（兼容式小程序运行容器）**：标准小程序能跑（AppID 级逻辑隔离）
- **G-49（进程级沙箱隔离）**：不可信小程序安全运行（L1 逻辑 / L2 存储权限 / L3 进程）
- **缺口**：两者都没定义「谁来开发、怎么发布、怎么治理」。一个能安全运行第三方小程序的容器，
  缺了 **注册 → 提审 → 上架 → 运行 → 治理** 的闭环，就只是 SDK，不是平台 —— **G-50 补齐这条闭环**。

## 文件清单

| 文件 | 内容 |
|------|------|
| `01-problem.md` | 定位 / A+B scope / 与既有体系互校 / 诚实边界 |
| `02-architecture.md` | 平台全景：三条主线（门户/工具链/运行时）+ 治理 + AppPackage 核心工件 |
| `03-spi.md` | ★ DeveloperPlatform SPI（A 工具链 + B 生态**共用**）+ AppPackage 规范 |
| `04-cli-pipeline.md` | ★ A1 CLI 流水线（create/dev/build/audit/publish） |
| `05-project-scaffold.md` | ★ A2 项目脚手架 + capability-manifest |
| `06-debug-protocol.md` | ★ A3 调试协议（复用 devtools TraceBus + 桥接 G-49 诊断） |
| `07-component-toolkit.md` | ★ A4 能力/组件脚手架（基于 G-48 Capability IR 生成） |
| `08-publish-runtime.md` | ★ A5 发布与运行（A→B 桥接点：产物 → G-48 运行时 + 双签名） |
| `09-developer-portal.md` | ★ B1 开发者门户（注册/应用管理/密钥/成员） |
| `10-submission-review.md` | ★ B2 提审与审核（自动扫描 + 人工 + 双签名） |
| `11-distribution-store.md` | ★ B3 分发与运行（CDN/灰度/热修复/下架） |
| `12-governance-monetization.md` | ★ B4 治理与分佣（配额/风控/审计/撤销/结算 SPI） |
| `conformance.md` | 文档化断言清单（39 条 = 核心 35：A18+B17 + 接缝 2 + 负向 2，不写 runner） |
| `rules.md` | 铁律 G-50.1-8 + CMP118-131 + 编号避让登记 |
| `architecture-update.md` | 原则 #13.46-50 + 能力成熟度更新 |
| `CHECKSUM.md` / `CHECKSUM.sha256` | 完整性清单 + 哈希校验（`shasum -a 256 -c`） |
| `selfcheck.cjs` | ★ 结构自检（零依赖，见下） |

## A / B 分册说明

| 册 | 范围 | 文档 | 依赖 |
|----|------|------|------|
| **A 开发者工具链平台** | 让开发者高效开发/调试/构建/发布 | 04–08（**A1–A5 五份**） | 可立即启动，不依赖 G-49 L3 |
| **B 开放生态平台** | 任意第三方注册/提审/上架/被使用 | 09–12（**B1–B4 四份**） | 关键路径（运行第三方代码）以 **G-49 L3** 为硬前置 |

- `03-spi.md` = A+B **共用** SPI（`DeveloperPlatform`：toolchain / portal / submission / distribution / governance）
- 后端矩阵见 `03-spi.md` §7：本地（LocalCLI）↔ 平台（REST/CDN）↔ conformance（InMemory）三列可替换

## 快速开始（结构自检）

```bash
cd docs/proteus-developer-platform-plan
node selfcheck.cjs   # 零依赖结构自检 → exit 0
shasum -a 256 -c CHECKSUM.sha256   # 哈希完整性 → OK
```

## 与体系的关系

| 依赖 | 关系 |
|------|------|
| **G-48**（`docs/proteus-miniprogram-runtime-plan`） | 平台运行时 = G-48 运行时 + 多租户；AppPackage 是其加载输入 |
| **G-49**（`docs/proteus-sandbox-isolation-plan`） | 多租户隔离 = G-49 隔离的规模化；**G-49 L3 为 B 生态硬前置**（原则 #13.44，由 G-49 定义） |
| **G-44**（`docs/proteus-testing-framework-plan`） | conformance 断言在 G-44 Test IR 上实现 runner（InMemory 模式） |
| **G-45**（签名链/`proteus-dev-host-plan`） | 开发者签名 + 平台审核签名「双签名」（G-45.7/8 同源；G-45.9 仅限开发态） |
| **G-42 / G-43** | 安全网关（host-container）/ Drop 级联（ownership）复用 |
| **cli-plus（G-33）/ router-plus（G-32）/ devtools-plus（G-34）** | A 册底座：CLI 扩展、预览路由、TraceBus/调试协议复用 |

## 诚实边界

1. **本包为纯 plan**：无参考实现、无 verify.sh、无打包——结构自检由 `selfcheck.cjs` 承担（仅核对文档清单/编号/计数/哈希），**非运行语义验证**
2. **B 的运行安全依赖 G-49 L3 真原生后端**；L3 未落地前，B 的「运行第三方」环节为受限灰度
3. **审核 / 风控 / 治理是长期运营能力**，本包只定义机制与 SPI，不承诺审核准确率
4. **分佣 / 结算涉及资金合规**，属业务层；本包只提供对账数据 SPI（SettlementSPI），不内置支付结算
5. **开发者门户 UI/UX 不在范围**，只定义 API 与数据模型
6. 不承诺微信级生态规模（依赖运营与网络效应）

---

*规划体系 · G-50 = 小程序系列（G-48/49/50）收官篇：从「框架」走向「平台」。*
