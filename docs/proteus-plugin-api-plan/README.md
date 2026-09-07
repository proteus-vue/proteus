# Proteus Studio 插件 API 与扩展生态（G-58）

> 原则 #0「不绑定」系列，**第 21 次泛化**（官方链：…G-54=18、G-56=19、G-57=20，G-55 落地不占序；#395 修正，原稿误作 18）。
> **不绑定扩展来源**：内置功能、官方插件、第三方插件，
> 通过**同一套 API 与权限模型**接入，无一例外。

---

## 核心判断

**插件 API 不是功能设计，是契约设计。**
一旦发布，改一次所有插件跟着改。

所以本份的价值不在"设计了多少接口"，而在**定下让契约可演进的机制**。

### 两个标杆，各学一半

| 来源 | 机制 | 学什么 |
|------|------|--------|
| **Zed** | WIT 文件按版本并存 | **版本化路由**（演进不破坏） |
| **VSCode** | `enabledApiProposals` | **提案 opt-in + 禁止发布** |

---

## ★ 相对 VSCode 的结构性优势

VSCode 扩展主机是 **Node.js 进程，拥有与 IDE 相同的权限**
（Tanium 安全研究原文）：

> "The Extension Host has the same permissions as the IDE...
> reading and writing files, making network requests,
> running external processes"

**这不是"审核不严"，是模型问题。**

Proteus 的模型：

```
插件 ⊂ WASM 沙箱 ⇒ 默认零权限 ⇒ 逐项 capability 授予
```

关键差异：

| | VSCode | Proteus |
|--|--------|---------|
| 默认权限 | 用户完整权限 | **零权限** |
| 网络访问 | 任意 | **host 白名单强制** |
| 文件系统 | 直接读写 | **宿主代理，无路径概念** |
| 越权处理 | N/A（没有越权概念） | **denied + 审计，不终止** |

> **这是优势，不是追赶项。** 但也别高估——
> Tier 2（LSP/DAP 外部进程）仍无沙箱，已如实标注。

---

## 八条不变量

```
INV-EX-01  内置功能与插件同权（架构试金石，红线）
INV-EX-02  默认零权限，越权返回 denied 不崩溃
INV-EX-03  声明式插件零 WASM 实例
INV-EX-04  API 版本化，老插件向后兼容
INV-EX-05  插件崩溃隔离，宿主不受影响
INV-EX-06  资源限额强制执行
INV-EX-07  supports() 元数据查询，零副作用
INV-EX-08  提案 API 不得用于发布
```

---

## 三层插件形态

| Tier | 形态 | 沙箱 | 授权 |
|------|------|------|------|
| **0** | 声明式（JSON） | N/A | 无需 |
| **1** | WASM 组件 | ✅ | capability 逐项 |
| **2** | 外部进程（LSP/DAP） | ❌ | **显式高权限警示** |

> **声明式优先**——Zed 官方实证：
> "most extensions will work properly without any Rust code present"

---

## 文档导航

| 文件 | 内容 |
|------|------|
| **01-problem.md** | VSCode 模型的成功与缺陷；为什么选 WASM |
| **02-architecture.md** | 三层形态 + PluginHost + 架构试金石 |
| **03-spi.md** | 4 个新增类型；贡献点；capability 清单 |
| **04-capability-model.md** | ★ 权限模型（相对 VSCode 的优势） |
| **05-api-versioning.md** | ★ WIT 版本化 + 提案 API 机制 |
| **06-risks-degradation.md** | 八条风险与降级 |
| **conformance.md** | INV-EX-01~08 / CMP-187~194 / **104 cases** |
| **rules.md** | G-58.1~8 铁律 + AP-EX-01~07 |
| **architecture-update.md** | 原则 #13.72~74；第 21 次泛化 |
| **reference-impl.cjs** | ★ 零依赖参考实现，**104/104 通过** |

---

## 快速验证

```bash
node reference-impl.cjs   # → self-test: 104/104
bash verify.sh             # → PASS=N FAIL=0
shasum -a 256 -c CHECKSUM.sha256
```

---

## 实测抓到的两个问题

| # | 问题 | 性质 |
|---|------|------|
| 1 | `0.4.0` 的 exports 声明了 `device.attach`，capabilities 里却没有 | **设计不一致**（实测暴露） |
| 2 | 测试混淆了 `skipped`（未激活）与 `denied`（已激活越权） | **测试写法错误** |

第 2 个已固化为断言——**未激活返回 skipped，已激活越权返回 denied**，
两者语义不同。

---

## ⚠️ 诚实边界

1. **参考实现的 WASM 沙箱是模拟的** —— 真实 wasmtime 集成属阶段 2
2. **WIT 版本化是 JS 对象查表模拟** —— 非真实 Component Model
3. **插件市场签名体系未设计** —— 仅支持清单 sha256
4. **具体 API 面未定完** —— 本份只定机制，不定全部接口
5. **不兼容 VSCode 插件生态** —— 详见 G-56 `07-ecosystem-compat.md`

---

## 建议实施顺序

```
阶段 1  声明式插件（Tier 0）+ 内置功能插件化改造   ← 验证 G-58.1 红线
阶段 2  wasmtime 集成 + Tier 1 真实沙箱
阶段 3  WIT 版本化真实落地 + 提案流程
阶段 4  Tier 2（LSP/DAP）+ 市场侧签名
```

**阶段 1 最关键**：把内置面板改写成插件实现，
是检验整套 API 是否真的可用的**唯一手段**。
