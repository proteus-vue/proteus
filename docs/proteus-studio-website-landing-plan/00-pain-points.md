# 调研输入：官网与文档站痛点全景

> 本文件**先于一切设计产出**。
> 上一份（G-58）的教训：方向先定、再找证据支撑，会系统性地漏掉"不在预设方向里"的痛点。
> 本次改为：**先调研 → 再归纳 → 最后落 SPI**。
> 每条痛点标注来源与证据强度，弱证据明确标出，不得当作强证据使用。

---

## P1 · 文档与代码漂移是默认结局，不是意外

**证据强度：中高（厂商内容，需谨慎引用）**

Fern（API 文档工具厂商）2026-05 文章给出：

> 75% of production APIs don't match their specs

该数字出自工具厂商自身内容，**属营销性数据，不得直接对外引用**（G-37）。
但其 mechanisms 描述与第三方一致，可信度较高：

- 认证方式被错误描述
- 已废弃的端点仍留在文档里
- spec 改了、文档没改 → 破坏性变更无声发布

**更硬的一条（非厂商内容）**：datadef.io 的流程分析指出，三种工作流的分野是

| 工作流 | 结果 |
|--------|------|
| spec-first | ✅ 可行 |
| code-first（注解生成 spec） | ✅ 可行 |
| **docs-first** | ❌ **必然漂移** |

原话：

> The wiki page describing the API has no such mechanism. It drifts the day after it is written.

**关键不变量**：spec 必须与代码**在同一个 PR** 内生成或评审，使其无法静默滞后。

**对我们的直接含义**：插件 API 文档**不能手写在 markdown 里**。
G-58 的 WIT 定义是唯一数据源，文档页是它的 **renderer**，不是 copy。

---

## P2 · 版本化文档有一整套反模式，且都已被实证

**证据强度：高（Docsie，多条实操规范，互相印证）**

### P2.1 快照时机不能人工决定

> ✗ Don't: Don't manually decide when to snapshot documentation based on team availability or arbitrary milestones — this causes version drift where docs for v2.1 actually describe v2.0 behavior because the snapshot was taken too early.

✓ 正解：**在 release tag 打出的同一时刻**，由 CI 触发快照并发布。

### P2.2 跨版本复制内容必然产生矛盾

> Don't copy-paste conceptual overview pages or glossary entries into each version branch — a correction to a term definition will need to be manually applied N times and will inevitably be missed in at least one version.

✓ 正解：`/shared` 或 `/common` 目录存放版本无关内容，各版本构建时 **transclusion 引入**（RST includes / MDX imports / Docusaurus partials）。

> **这条与我们的原则 #0「不绑定」同源** —— 复制 N 份就是绑定 N 次。

### P2.3 只靠 URL 和下落框传达版本是失败的

> Users in a reading flow rarely check the URL bar and will miss subtle indicators.

✓ 正解：每页顶部**醒目横幅**（sticky），三要素齐全：
① 版本号 ② 支持状态（active / LTS / deprecated）③ 指向**最新版等价页**的深链。
废弃版本用黄色警告，旧但仍受支持用蓝色信息条。

### P2.4 废弃标记必须元数据驱动，不能手改

> Don't manually edit individual Markdown files to add deprecation notices ... you will miss pages, create inconsistent messaging.

✓ 正解：`versions.json` / `versions.yaml` 集中存版本状态，**构建系统按元数据自动注入**横幅与 `noindex`。

> 这又是一次"**元数据驱动 vs 手工编辑**"—— 与 G-59「用元数据自动化废弃警告」完全同构。

### P2.5 必须发布显式的版本支持策略

> Don't leave version support ambiguous by keeping all historical versions online with no status indicators — users will assume that the presence of docs implies active support.

✓ 正解：发布"文档支持策略"页，明确：同时维护几个版本、进入 maintenance 的判据、EOL 流程。
业界通行做法：**当前版本 + 前两个 major**。

### P2.6 SEO：canonical 必须指向 latest

> Use canonical URLs. Point search engines to the latest version of each page to avoid SEO dilution from duplicate content across versions.

---

## P3 · 只有 Docusaurus 把版本化做成核心特性

**证据强度：中（选型调研，两个来源数据冲突，已标注）**

| 框架 | 底座 | 版本化 | 本地搜索 | i18n | Blog | 周下载 |
|------|------|--------|---------|------|------|--------|
| **Docusaurus** | React/MDX | ✅ **内置（自 v1 起核心特性）** | 需插件 | ✅ 内置 | ✅ 内置 | 500K ~ 3M ⚠️ |
| VitePress | Vue 3 | ❌ 需自定义内容结构，无等价插件 | ✅ 内置 | ✅ | ❌ | 500K ~ 2M ⚠️ |
| Starlight | Astro | ⚠️ 社区插件 `starlight-versions` | ✅ Pagefind 内置 | ✅ | 需插件 | 100K ~ 200K ⚠️ |
| Nextra | Next.js | ❌ | Flexsearch | 有限 | ❌ | 100K ~ 800K ⚠️ |

**⚠️ 数据冲突声明**：两个来源给出的周下载量差异达 6 倍（Docusaurus 3M vs 500K）。
原因可能是统计口径不同（`docusaurus` 聚合包 vs `@docusaurus/core`）。
**下载量不作为选型依据**，仅作生态规模粗略参考。

**决定性判据是版本化**：一份第三方选型记录（larsbarkman.com，来源权威性低但推理链完整）写道：

> Of the remaining options, only Docusaurus provides formal versioning out of the box.
> For VitePress ... versioning is an unsupported custom content structure with no equivalent plugin.

**这条对我们格外重要**，因为它与我们自己在 G-59 的论证同构：
G-59 认为**最关键的契约应当是平台级能力，不应依赖社区插件**。
既然插件 API 版本并存（G-58）是硬需求，官网文档站的版本化就**不能**押在社区插件上。

**结论**：选 **Docusaurus**——不是因为它最流行，而是因为**版本化是内置核心特性**。

---

## P4 · API 参考页应当是 renderer，不是副本

**证据强度：高**

> The reference portal should be a renderer, not a copy. Redoc and Stoplight Elements render an OpenAPI document directly, so deploying the spec is deploying the docs.

关键推论：

> Once the portal renders the spec, the only prose left to maintain by hand is the part machines cannot know: guides, auth walkthroughs, **the reasons behind rate limits**.
> That is a small enough surface to keep honest with ordinary review.

**两个 CI 闸门（可直接移植到我们的插件 API）**：

| 工具 | 作用 | 类比到 Proteus |
|------|------|---------------|
| **Spectral** | lint spec：缺描述、缺 error schema、命名不一致 | `wit-lint` |
| **oasdiff** | 对比 PR spec 与 base spec，**breaking 模式**下移除端点 / 收窄枚举 / 新增必填参数 → FAIL | `wit-diff --breaking` |

原话：

> Together they turn API docs review into a diff review. The reviewer no longer reads the whole reference looking for lies; they read a machine-produced changelog of what this PR does to the contract.

**"reviewer 不再通读参考页找谎言，而是读机器生成的契约变更日志"** ——
这句话应作为我们插件 API 评审流程的设计目标。

---

## P5 · Tauri 分发的私钥是不可恢复的单点

**证据强度：极高（官方文档）**

Tauri v1 官方文档原文：

> The private key ... should NEVER be shared with anyone. Also, **if you lose this key, you will NOT be able to publish new updates to your current user base.**

**这是一条不可降级的风险**——不是"会很麻烦"，是**永久失去向已安装用户推送更新的能力**。

其余官方要点：

- updater endpoint 支持变量：`{{current_version}}` / `{{target}}`（linux|windows|darwin）/ `{{arch}}`（x86_64|i686|aarch64|armv7）
- **生产模式强制 TLS**
- v2 由 `tauri-plugin-updater` 提供，私钥应存为 CI 加密 secret，构建时自动签名
- macOS 必须 notarization，否则 Gatekeeper 拦截安装
- GitHub Releases：manifest JSON 含版本号、平台下载 URL、签名、release notes

**对我们的含义**：官网下载页不是"放几个链接"，而是**一条带签名验证的更新通道**，
其私钥管理流程必须写进运维手册，且**必须离线备份**。

---

## 归纳：五条痛点 → 设计约束

| # | 痛点 | 设计约束 |
|---|------|---------|
| P1 | 文档漂移是默认结局 | 插件 API 文档**从 WIT 生成**，漂移即 CI 失败 |
| P2 | 版本化有完整反模式清单 | 全部六条逐条对应落为不变量 |
| P3 | 只有 Docusaurus 内置版本化 | 选 Docusaurus，**不押社区插件** |
| P4 | 参考页应是 renderer | 双闸门：lint + breaking diff |
| P5 | 更新私钥不可恢复 | 私钥管理写入运维铁律，离线备份 |

---

## 本次调研的局限（诚实边界）

1. **75% 那个数字是厂商营销内容**，本文件已标注，不得对外引用
2. **周下载量两个来源差 6 倍**，已标注冲突，未用作判据
3. **未真实构建过任何站点**——选型基于文档与第三方记录，非实测
4. **Docusaurus 插件生态的具体能力未逐一验证**，仅确认版本化/i18n/blog 为内置
5. 本文件所有"最佳实践"来自文档站领域，**迁移到 IDE 插件 API 文档是否完全适用，需阶段 2 实证**
