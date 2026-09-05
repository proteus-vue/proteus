# G-57 架构：三层数据模型

## 1. 三层模型

```
┌─────────────────────────────────────────────┐
│ L2  框架语义数据                              │
│     SPI 后端拓扑 / 分层违规 / 隔离域 / conformance │
│     来源：框架独占知识                          │
├─────────────────────────────────────────────┤
│ L1  ★语义增强运行时数据                        │
│     L0 的每个指标 + {backend, layer, domain}   │
│     来源：L0 × 框架拓扑                        │
├─────────────────────────────────────────────┤
│ L0  通用运行时数据                              │
│     内存 / CPU / 帧率 / 网络 / widget 树        │
│     来源：宿主或系统（VM Service / Flipper / CDP）│
└─────────────────────────────────────────────┘
```

## 2. 为什么 L1 是核心增量

**L0 是"数字"，L1 是"带结构的数字"。**

```
L0:  memory.delta = +50MB
L1:  memory.delta = +50MB
       ├─ backend:  render-skia        ← 走的哪个 SPI 后端
       ├─ layer:    L2                 ← 属于哪一层
       └─ domain:   mp-sandbox-7       ← 哪个隔离域
```

**同一个数字，L1 直接把排查范围从"整个 App"缩小到"某个隔离域的某个后端"。**

这个映射关系**只有框架自己知道**——第三方工具再强也拿不到，
因为它们不知道你的 SPI 拓扑和分层规则。

> **这就是 G-54「框架独占能力」从编码期延伸到运行时的形态。**

## 3. 协议扩展，不是协议替换

**核心机制：在宿主已有协议上注册自定义扩展。**

| 宿主协议 | 扩展机制 | 官方依据 |
|---------|---------|---------|
| Dart VM Service | `registerExtension('ext.package.command')` | `dart:developer` 官方 API |
| Flipper | 自定义 Desktop Plugin + Client Plugin | `flipper-plugin` SDK |
| CDP | 自定义 domain（需 patch Chromium） | PDL 定义 + Agent 注册 |
| 自起服务 | HTTP + WebSocket（如 serve-sim） | GCDWebServer 等 |

**命名规范（Dart 官方强制）：**

- 必须以 `ext.` 开头
- 格式 `ext.<package>.<command>`，避免包间冲突
- **每个 isolate 单独注册**
- 调用时**必须带 `isolateId` 参数**

**实证**：Flutter 的 Hot Reload / Hot Restart **本身就是 VM Service extension**；
`bloc_devtools_extension` 用 `ext.bloc_devtools.getState` 暴露状态。
**这条路是标准做法，不是野路子。**

## 4. 降级链

```
L0 始终可用（不依赖框架插桩）
  ↓ 拓扑未加载
L1 降级：返回未标注的 L0（degraded，不崩溃）
  ↓ introspector 缺失
L2 降级：返回 null（degraded，不崩溃）
```

**铁律：L1/L2 的任何失效都不得影响 L0。**
L0 是团队原本就在用的工具数据，**叠加层只能增益，不能减损**。

## 5. 覆盖率诚实模型

```
L1 覆盖率 = 可被语义标注的指标数 / 总指标数
```

- **空样本 → 覆盖率 0，不是 1**（防止"没采到任何数据"被算作"100% 已标注"）
- 覆盖率低时**如实显示**，不粉饰
- L2 缺失时明确标 `degraded + reason`

## 6. 与 G-19 的分工

| | G-19 | G-57 |
|--|------|------|
| 数据 | 运行时 trace/timeline/state | **同一份数据** |
| 视角 | 框架内部面板 | **对外协议化暴露** |
| 消费端 | App 内 | 桌面 Studio / IDE / Companion |

**G-19 是数据源，G-57 是出口协议。** 不重复造，只做标准化。
