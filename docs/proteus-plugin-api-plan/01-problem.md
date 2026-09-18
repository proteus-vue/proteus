# G-58 插件 API 与扩展生态

> 原则 #0「不绑定」系列，第 21 次泛化。
> **不绑定扩展来源**：内置功能、官方插件、第三方插件，
> 通过**同一套 API 与权限模型**接入，无一例外。

---

## 1. 问题的由来

G-56 明确了 Studio **不兼容 VSCode 插件生态**（技术地基不同 + 许可禁止），
语言智能走 LSP/DAP。

但这立刻引出一个必须回答的问题：

> **Studio 自己的插件生态怎么做？**

一个 IDE 没有扩展能力，等于放弃了生态复利。而插件 API 一旦发布，
**就成为一份长期契约**——改一次，所有插件跟着改。

**所以这份不是"功能设计"，是"契约设计"。**

---

## 2. VSCode 插件模型的两个真相

设计前必须先看清标杆：**VSCode 的插件模型既极其成功，又有结构性缺陷。**

### 2.1 成功之处（必须学）

VSCode 官方文档明确写道：

> "In fact, **many core features of VS Code are built as extensions**
> and use the same Extension API."

**内置功能与第三方插件同路**——这是 VSCode 插件 API 保持高质量的
根本原因：自己做的功能如果 API 不好用，自己先难受。

**这条必须抄，而且要做成可断言的架构试金石。**

### 2.2 结构性缺陷（必须修正）

VSCode 扩展主机（Extension Host）**是一个 Node.js 进程，且拥有与 IDE 相同的权限**。

安全研究机构 Tanium 的原文：

> "The Extension Host has **the same permissions as the IDE**, so any action
> that can be taken by the IDE can also be taken by an extension.
> This includes reading and writing files, making network requests,
> running external processes, and modifying IDE settings."

后果不是理论风险：

| 事件 | 内容 |
|------|------|
| 2025 初 | ReversingLabs 发现恶意扩展**利用已下架扩展名重新发布**，含勒索组件 |
| 持续 | OpenVSX（开源市场）**扫描非自动化**，治理能力弱于官方市场 |

> **插件 = 用户完整权限**，这是 VSCode 模型的结构性缺陷，
> 不是"加强审核"能根治的。

**这是 Studio 的相对优势所在，而非劣势。**

---

## 3. 核心抉择：插件运行时

| 方案 | 优势 | 致命问题 |
|------|------|---------|
| Node.js 进程（VSCode 模式） | 生态最大、开发者最多 | **权限即用户权限**（上述缺陷）；且 Studio 无 Node |
| Rust 动态库（cdylib） | 性能最好 | **ABI 不稳定**，跨平台噩梦，插件作者门槛极高 |
| **WASM 组件** | 沙箱安全、跨语言、Rust 原生契合 | 需编译工具链 |
| WebView iframe | 上手最快 | 隔离差，性能不可控 |

### 3.1 决定：WASM 组件

**工业实证——Zed 就是这么做的**：

- 扩展编译目标 `wasm32-wasip2`
- 用 `extension.toml` 清单 + `register_extension!` 宏
- **API 用 WIT 文件版本化**（`since_v0_0_1` → `since_v0_8_0`），
  官方说明："ensures backward compatibility for older extensions
  while allowing the API to evolve"
- 源码中存在 `capability_granter.rs`（能力授予器）

**关键细节（Zed 官方文档）**：

> "**most extensions will work properly without any Rust code present.**
> In particular, only language server, context server and debugger
> extensions require the presence of custom Rust."

> **声明式优先，代码只是少数派。** 这条直接决定了本份的架构分层。

### 3.2 WASM 的真实代价（必须知道）

Zed 文档点了两个坑：

```
cfg 指令不工作
std::env::var 不返回预期结果
```

**沙箱不是免费的**——它剥夺了插件对环境的隐式假设。
这恰恰是好事：**隐式假设正是安全漏洞与不可复现行为的温床。**

---

## 4. 本份要解决的五个问题

| # | 问题 | 答案所在 |
|---|------|---------|
| 1 | 内置功能与插件如何同权？ | INV-EX-01（架构试金石） |
| 2 | 权限怎么给才不像 VSCode 那样失控？ | INV-EX-02（capability） |
| 3 | 简单插件为什么不该写代码？ | INV-EX-03（声明式优先） |
| 4 | API 演进如何不破坏老插件？ | INV-EX-04（WIT 版本化） |
| 5 | 插件崩溃/失控怎么办？ | INV-EX-05/06（隔离 + 限额） |

---

## 5. 诚实边界

- **WASM 生态 ≠ VSCode 生态**：新生态从零建设，这是 G-56.9 承认的真实损失
- **Extension Host 路径未核实**：Microsoft 开源了扩展主机，
  但需 WebView2 + .NET，跨平台性存疑，本份**不采纳、不否认**，待核实
- **Zed 的 WIT 版本化是成熟实践**，但 Studio 的具体 API 面尚未设计完，
  本份只定**机制**，不定**全部接口**
- 参考实现的插件加载是**模拟**的，真实 wasmtime 集成属阶段 2
