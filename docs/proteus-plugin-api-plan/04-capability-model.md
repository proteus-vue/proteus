# G-58 能力与权限模型

> **这是 Studio 相对 VSCode 的结构性优势，不是追赶项。**

---

## 1. 要修正的是什么

VSCode 扩展主机的权限模型（Tanium 安全研究原文）：

> "The Extension Host has **the same permissions as the IDE**.
> This includes reading and writing files, **making network requests**,
> **running external processes**, and modifying IDE settings."

翻译成人话：**装一个主题插件，等于把用户完整权限交给它。**

这不是"审核不严"的问题，是**模型问题**：

```
VSCode 模型：  插件 ⊂ IDE 进程 ⇒ 插件权限 = 用户权限
```

只要还在这个模型里，加强审核只能降低概率，不能消除风险。

---

## 2. 本份的模型：Capability-based Security

```
Proteus 模型：  插件 ⊂ WASM 沙箱 ⇒ 默认零权限
                            ⇒ 逐项 capability 显式授予
```

**WASM 沙箱天然契合这个模型**：模块默认无法访问任何宿主资源，
必须宿主**显式 link 导入函数**才能做事。

> 这正是 capability-based security 的标准实现路径。
> Zed 源码里那个 `capability_granter.rs` 干的就是这件事。

### 2.1 三条硬规则

| 规则 | 内容 |
|------|------|
| **默认零权限** | 未声明的 capability 一律拒绝，**不存在"默认允许"清单** |
| **白名单强制** | `network` / `spawnProcess` 必须带参数，不带即非法清单 |
| **越权不终止** | 越权返回 `denied`，记录日志，**宿主继续运行** |

### 2.2 为什么"越权不终止"

越权有两种可能：

1. **恶意插件**试探边界 → 应被拒绝并记录
2. **正常插件**的边界条件没处理好 → 杀掉它是过度反应

**统一按"拒绝 + 记录"处理，两种情形都安全。**
而"崩溃"会让第二种情形的用户体验极差，还会掩盖真实问题。

延续 G-51 INV-02「能力缺失 → 降级 ≠ 崩溃」。

---

## 3. ★ 网络能力的设计细节

VSCode 模型最危险的一点：**扩展可任意发起网络请求**。
数据外泄是 IDE 供应链攻击的主要出口。

本份的模型：

```typescript
// ❌ 非法：无白名单，清单校验期即拒绝
{ kind: 'network' }

// ✅ 合法：必须指定 hosts
{ kind: 'network'; hosts: ['api.anthropic.com', '*.github.com'] }
```

**校验在清单加载期完成**，不是运行时才发现。
非法清单 → 安装失败，**不会装上一个"能联网但没人知道"的插件**。

### 通配符限制

```
允许：*.example.com     （子域）
禁止：*                 （任意域 = 等于没限制）
禁止：*.*.example.com   （多级通配，难以审计）
```

---

## 4. 文件系统：不直连，走宿主代理

Extism 的做法（官方博客）：

> "we've decided to **hold off on enabling direct disk/filesystem access**
> from plug-ins, and instead opt for a more explicit requirement to
> **pass file data in and out** of a plug-in directly."

本份采纳同一策略：

```
插件 ──请求──→ 宿主代理 ──→ 文件系统
      ←──数据──           ←──
```

**好处**：
- 宿主可审计所有文件访问
- `writeWorkspace` 可限制到具体 paths
- 沙箱内不存在"路径"概念，杜绝路径穿越

---

## 5. Tier 2（外部进程）的诚实标注

LSP/DAP 服务器是**原生进程，不在 WASM 沙箱内**。

它的权限本质上等同于"用户运行了一个可执行文件"——
**和 VSCode 扩展主机的风险等级相同。**

所以本份的做法是**如实标注，而非假装安全**：

| Tier | 沙箱 | 安装时提示 |
|------|------|-----------|
| Tier 0 | N/A | 无代码，无需警示 |
| Tier 1 | ✅ | 列出所需 capability |
| **Tier 2** | ❌ | **明确警示："将运行外部可执行程序"** |

> **把风险等级如实告诉用户，比统一宣称"沙箱安全"更专业。**
> 延续 G-56.4「平台风险如实上报，禁止乐观默认」。

---

## 6. 权限授予的用户体验

```
安装插件「proteus-device-hub」
├─ Tier: WASM (Tier 1)
├─ API:  v0.4.0 (stable)
│
├─ 需要以下权限：
│   ☑ 读取工作区文件
│   ☑ 连接设备（runtimes: ios-sim, android-emu）
│   ☑ 访问网络（hosts: api.expo.dev）
│   ☐ 输入注入        ← 未勾选，默认拒绝
│
└─ 资源限额：内存 64MB / 单次调用 50ms / 超时 5s
```

**默认全部不勾选**，用户逐项授权。
未授权的能力 → 运行时返回 `denied`，插件应自行降级。

---

## 7. 与 G-54 六项能力的关系

框架独占能力**对第三方插件开放**：

| Capability | 暴露的 G-54 能力 |
|-----------|-----------------|
| `kernel.spiTopology` | SPI 依赖图、循环检测 |
| `kernel.layerRules` | 分层违规检查 |
| `kernel.conformance` | 断言执行与结果 |
| `kernel.deviceImpact` | 改动影响的等价类 |

**这正是"框架自己做工具最顺手"的复利外溢**——
第三方也能用，但**只能通过 API，且需授权**。

### 一个必须守住的边界

**插件获得的是"查询结果"，不是"内核控制权"。**

```
✅ 插件问：当前激活了哪些后端？
❌ 插件命令：把渲染后端换成 skia
```

**只读查询默认开放，写操作默认禁止。**
这条写进 G-58.2。

---

## 8. 尚未解决（诚实标注）

| 问题 | 现状 |
|------|------|
| **插件供应链完整性** | 清单支持 sha256，但**市场侧签名体系未设计** |
| **插件间权限传递** | 阶段 1 禁止插件互调，规避该问题 |
| **Tier 2 进程的逃逸风险** | 等同运行外部程序，无沙箱，仅靠用户授权 |
| **权限变更的增量提示** | 更新时新增权限如何提示，未定 |
