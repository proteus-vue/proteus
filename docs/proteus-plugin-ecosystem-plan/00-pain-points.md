# G-59 附录：IDE 插件生态痛点全景（调研输入）

> 本文件是 G-59 的**设计输入**，不是设计产出。
> 按「未调研不设计」纪律：先穷举痛点，再归纳不变量，最后落 SPI。
> 五条取证路径：启动性能 / 兼容性 / 生态治理 / 安全 / 架构。

---

## 路径一：启动性能 —— 用户侧最大的日常抱怨

### 现象

VSCode 把启动拆解为多个阶段，内置 `Developer: Startup Performance` 命令可逐项查看，
其中 `activatePlugins` 阶段会列出**每个扩展的激活耗时**，这是定位慢扩展的第一手资料 [citation:1]。

排查口诀已经形成社区共识：**`activationTime > 300ms` 且 `activationEvents` 为 `*` 或 `onStartup`
的插件，即构成启动瓶颈** [citation:1][citation:6]。

### 实测数据

运行增强类插件普遍声明 `*` 或 `onStartup`，导致启动时强制加载 [citation:16]：

| 插件 | activationTime |
|------|---------------|
| CodeRunner | 380–620 ms（即使没打开任何可执行文件，仍预加载全部语言运行时配置） |
| REST Client | 冷启常超 450 ms（预解析全局环境变量 + 监听 .http 变更） |
| Python Test Explorer | 工作区含 pytest 配置即立即扫描测试目录，触发同步文件 I/O |
| Shell Launcher | `activate()` 内调 `os.homedir()` + `fs.readdirSync()` |

**多个此类插件叠加极易突破 1200 ms 用户感知阈值** [citation:16]。

### ★ 根因：激活时机是契约，不是优化项

`activationEvents` 的声明粒度直接决定启动成本：
- `onLanguage:python` / `onCommand:ext.doSomething` / `workspaceContains:**/*.py` → 精确，按需
- `*` / `onStartup` → **通吃**，启动即付代价

**这本质是个契约问题**：宿主没有把"什么时候允许你跑"写进强制约束，
于是每个插件作者都理性地选择对自己最有利的 `*`——**个体理性导致集体劣化**（公地悲剧）。

### 还有一个隐蔽坑

> 「禁用操作仅卸载 UI 层，不终止已启动的子进程」[citation:16]

禁用插件后 `extensionHost` 仍高 CPU——说明**生命周期回收也是契约的一部分**，
光有激活契约不够，还得有**去激活契约**。

---

## 路径二：兼容性 —— JetBrains 的正面教材

### 官方 Incompatible Changes 列表告诉我们什么

JetBrains 维护着公开的破坏性变更清单 [citation:3][citation:8][citation:13]。2026.x 里的真实条目：

| 版本 | 破坏内容 |
|------|---------|
| 2026.3 | Kotlin UI DSL 1.0 **完全移除**（十余个类集体删除，访问即编译/运行时错误） |
| 2026.3 | `Sdk` 接口改继承 `UserDataHolderEx`，并明确"**Do not implement Sdk: 非可扩展接口**" |
| 2026.2 | PolySymbols 类批量重命名（`PsiSourcedPolySymbol` → `PsiLinkedPolySymbol`，`source` → `linkedElement`） |
| 2026.1.4 | `LspServerManager` → `LspClientManager`，旧名取服务**返回 null** |
| 2026.2 | CLion Classic 引擎不再捆绑，依赖它的插件必须显式声明依赖 |

### ★ 最说明问题的不是破坏本身，是官方建议

JetBrains 官方给插件作者的建议是 [citation:3]：

> "The simplest approach — and our recommended default — is to
> **drop `untilBuild` from your build.gradle.kts altogether**."

**等于官方默认"破坏会持续发生"**，所以干脆别写上限。**这是把兼容性成本外包给了插件作者。**

### 对比 Zed 的做法

WIT 文件按版本**并存**（`since_v0_0_1` → `since_v0_8_0`），新版本新增文件，
老版本文件不删 → **老插件不受新版本影响** [G-58 已引]。

**两种哲学的分野**：JetBrains 是"平台演进，插件跟随"；Zed 是"版本并存，各取所需"。

---

## 路径三：生态治理 —— 插件作者为什么走

### 数据

VSCode 官方 2025 年底生态报告（**二手转述，需以官方原文为准**）：
2024 全年工具类插件新增下载量同比 2023 下滑 **47%**，
近三成老工具类插件超 18 个月未更新 [citation:2]。

### 更具象的一个案例：Webview UI Toolkit 之死

```
2024.05  FAST Foundation 宣布 re-alignment，核心包进入 deprecated 列表
   ↓
2025.01  Webview UI Toolkit（2.1k stars / 157 forks）归档
   ↓         根因：唯一出路是用 FAST Element 完全重写
   ↓         但 "no resources were allocated for it"
   ↓
结果：**没有官方替代品**，开发者只能自己用 CSS 变量 + @vscode/codicons 拼 [citation:7]
```

**这个案例的价值在于它展示了"生态位突然真空"**：
一个被广泛依赖的官方库，因为上游依赖被砍 + 无资源重写，
**留下一个没人填的坑**。

### ★ 平台下场挤压第三方

Roo-Code 停运的主因被归结为："MS 内置 Copilot，第三方能做的越来越少"。
同类事件：微软弃用 Polyglot Notebooks（180 万安装）、JetBrains 终止 Kotlin Notebook。

**这构成一个治理悖论**：
> 平台越成功，越有动力把热门插件内置；
> 而每内置一个，就摧毁一个第三方作者的生存空间；
> 长期看，谁还愿意为这个生态写插件？

**新生态必须在架构层就回答这个问题，而不是等它发生。**

---

## 路径四：安全 —— 三个层层递进的发现

### 4.1 规模

2024 年初以来，150+ 恶意/违规扩展被从两大市场下架 [citation:15]；
2024 年末一次扫描发现 200+ 扩展在窃凭证、挖矿或投放远控。

### 4.2 「影子依赖」——供应链层的结构性漏洞

Bloom Security 发现扩展包（Extension Pack）可引用**并不存在**的扩展，
攻击者抢注该命名空间即可让恶意扩展被"合法包"顺带装走 [citation:5]：

| 市场 | 含 shadow dependency 的包 |
|------|--------------------------|
| Open VSX | 94 / 321 |
| VS Code Marketplace | 677 / 4179 |

其中 60 个受影响包的 shadow dependency 属于**未注册 publisher**（可直接抢注）。
受影响包总下载量 **50 万+**。

**放大机制**：扩展包引用 bundled extensions **按 ID 不 pin 版本**，
且自动更新默认开启 → 用户装了合法包，之后可能静默收到新发布的恶意扩展 [citation:5]。

### 4.3 ★★ 最关键的一条：第一方「无害」API 也能致命

`ethdevtools.solidity-language-support` 伪装成 Solidity 语言支持，
用 **延迟激活的剪贴板窃取器**刮取 BIP-39 助记词、以太坊私钥。

它的实现手法值得逐字看 [citation:10]：

> "swapped clipboard addresses with attacker-controlled ones using
> **`vscode.env.clipboard.writeText`**, a **first-party API call** that
> **requires no `child_process`, network access, or file writes**,
> thus **evading static scanners that only look for dangerous Node imports**."

**这一条直接击穿了"危险 API 清单"式的权限模型。**

因为：
- `clipboard.writeText` 不在任何"危险 API"清单里——它是第一方、无副作用假象、常规功能
- 但它触及的数据（剪贴板）**可能是助记词、私钥、密码**
- 静态扫描只看 import 危险模块，对第一方 API 组合**完全无感**

**结论：权限的粒度必须建在"数据敏感度"上，而不是"API 危险度"上。**

### 4.4 「延迟激活」绕过信任建立期

多个 campaign 的做法是：先发布**干净扩展**积累安装量和好评，
数周或数月后推送武器化更新，且恶意代码在**安装后数小时或数天**才运行——
此时用户已认定扩展有用，自动扫描器也已移开 [citation:10][citation:15]。

---

## 路径五：架构 —— Atom 的死亡解剖

### 表面原因 vs 深层原因

官方说法是"社区参与和功能开发停滞"。但真正的病灶在架构 [citation:14]：

> "Packages ran with **full access to the DOM and to Node's runtime**,
> which was also the thing that made Atom feel so hackable."

**让 Atom 好用的那个特性，也正是杀死它的那个特性。**

### 故障模式

> "Two packages might both assume they were the first to touch a given buffer.
> **Neither was wrong on its own.** Together, loaded in whatever order the user
> happened to install them, they'd produce a bug that only existed because of the
> combination, and **no one owned the combination**."
>
> "Removing one plugin 'fixes' the bug, and **nobody on the team can explain why
> beyond a shrug**. The system still runs. Nobody quite trusts it anymore."

### ★ 一句话总结，值得刻在墙上

> **"Power dressed up as flexibility"**
> —— 暴露权力（power）而非接口（interface），却称之为灵活性。

中文技术社区也从另一角度佐证了同一结论：Atom 插件 API
**未暴露 `spawn()` 安全沙箱**，所有插件逻辑运行于主渲染进程 [citation:9]。

---

## 归纳：五条痛点 → 五条不变量

| # | 痛点 | 根因 | G-59 对策 |
|---|------|------|----------|
| P1 | 启动被 `*` 插件拖垮 | 激活时机无强制契约 | **INV-ECO-01 激活契约 + 启动预算硬约束** |
| P2 | 升级即破坏 | 版本不并存，成本外包 | **INV-ECO-03 版本并存 + ECO-04 破坏率可度量** |
| P3 | 作者流失、平台下场 | 生态位可被官方挤占 | **INV-ECO-06 官方不下场（可断言）** |
| P4 | 第一方 API 也能致命 | 权限建在 API 危险度上 | **INV-ECO-05 数据敏感度分级** |
| P5 | 插件互相污染，无人负责 | 暴露权力而非接口 | **INV-ECO-02 声明式优先 + ECO-07 废弃必有替代** |

外加一条跨领域对策：
**INV-ECO-08 更新即重新授权** —— 直接针对 4.4「干净版本建信任→后续推送武器化更新」。

---

## 调研纪律说明

本文档中的数字分三类，**已在文中逐条标注**：

1. **官方/一手**：JetBrains Incompatible Changes 列表、Bloom Security 原始数据、Safeguard 报告——可直接引用
2. **社区实测**：activationTime 具体数值、1200ms 感知阈值——量级可信，具体数字随环境浮动
3. **二手转述**：-47% 生态萎缩数据——**需以 VSCode 官方原文为准，不得直接对外宣称**

按 G-37「未实测不宣称」：第 3 类在对外材料中必须标注来源与不确定性。
