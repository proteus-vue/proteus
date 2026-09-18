# G-37 架构增量（Architecture Update）

> 本文件定义 G-37 对 `proteus-architecture.md`（原则 + 铁律总表）的增量变更。
> 合并方式：将本文件各节内容按标注位置并入主规约。

---

## 一、原则层增量

### 1.1 原则 #0（PROTEUS-METHODOLOGY）新增投影 #6

**现状**（原则 #0）：

> 「统一语义收敛」方法论有五个投影面：编译层（G-29）、UI 渲染层（G-27）、原生能力层（G-28）、端接入层（G-30）、语义入口层（G-31）。

**增量**：

> **投影 #6：渲染后端层（G-37）**
>
> 渲染可插拔（G-27）的方向必须有可执行契约支撑：任何渲染后端实现 `ProteusRenderBackend` SPI + 跑通 conformance = 合规。
>
> 原则 #0 的五支柱在渲染后端层的具体化：
> - **语义优先** → Backend 基于 `semantic` 分发，禁止标签名（G-37.1）
> - **接口/实现解耦** → 框架只依赖 SPI，不依赖具体后端
> - **验证先于运行** → conformance 测试是准入门槛（G-37.5）
> - **渐进式覆盖** → capabilities 分级（L1 必须 / L2 可选 / L3 降级）
> - **方法论可泛化** → SPI 模式与 G-28 NativeBackend / G-29 CompilerBackend 一致

### 1.2 新增原则 #13：渲染后端可验证性

> **「可插拔」必须有「可验证」支撑。**（★避让：原稿编号 #11 与既有规约 #11「核心能力实现为 Compiler Plugin」冲突，重编号为 #13）
>
> 任何声称「可插拔」的层，必须同时提供：
> 1. 接口定义（SPI）
> 2. Conformance 测试套件
> 3. 参考实现（≥ 2 个，验证接口非过度设计）
>
> **应用范围**：G-27（渲染）/ G-28（能力）/ G-29（编译）/ G-30（端）均已满足或有对应规范。G-37 是此原则在渲染层的最终兑现。

---

## 二、铁律总表增量

### 2.1 新增铁律（G-37.1 ~ G-37.6）

| 编号 | 铁律 | 检查方式 |
|------|------|---------|
| **G-37.1** | Backend 必须基于 `semantic` 字段分发，禁止基于标签名 | conformance C-01 + 静态扫描 |
| **G-37.2** | Backend 对 C-IR 只读消费，不得修改 | code review + 测试 |
| **G-37.3** | `capabilities` 必须诚实声明，未声明 = 不支持 | conformance C-05 |
| **G-37.4** | 所有 SPI 方法必须从同一线程调用 | conformance C-09 |
| **G-37.5** | Conformance 测试必须 0 失败 | `proteus conformance` 退出码 |
| **G-37.6** | 降级必须可见（dev 警告 + prod 日志） | conformance C-07 |

### 2.2 新增补充规则（CMP023 ~ CMP028）

| 编号 | 规则 |
|------|------|
| **CMP023** | 最小接口原则：SPI 方法数 ≤ 20 |
| **CMP024** | NodeHandle 不透明原则：框架不得解读其内容 |
| **CMP025** | 差分完整性原则：updateNode 必须处理所有 IRDiff 类型 |
| **CMP026** | 资源释放原则：dispose() 后方法必须抛错（不崩溃） |
| **CMP027** | 手势映射完备原则：未声明手势返回 no-op binding |
| **CMP028** | 首帧预算原则：≤ 16ms（旗舰）/ 33ms（低端） |

### 2.3 编号避让确认

| 规则集 | 范围 | G-37 避让结果 |
|--------|------|--------------|
| G-27 | G-27.x | ✅ 无冲突 |
| G-28 | G-28.x | ✅ 无冲突 |
| G-29 | G-29.x | ✅ 无冲突 |
| G-30 | G-30.x / NAT00x | ✅ 无冲突 |
| G-31 | G-31.x | ✅ 无冲突 |
| G-32 | G-32.x | ✅ 无冲突 |
| G-36 | G-36.x / CMP017-022 | ✅ 无冲突 |
| **G-37** | **G-37.x / CMP023-028** | **★ 本轮新增** |

---

## 三、全景图增量

### 3.1 渲染层细化

**现状**（G-27 高层）：

```
渲染层（G-27 可插拔）
  ├── VueDomBackend
  ├── iOSUIKitBackend
  ├── AndroidViewBackend
  ├── FlutterBackend
  ├── SkiaBackend
  └── HarmonyBackend
```

**增量**（G-37 具体化）：

```
渲染层（G-27 方向 + G-37 契约）
  │
  ├── ProteusRenderBackend SPI  ★ G-37 定义
  │     ├── createNode / updateNode / deleteNode
  │     ├── insertChild / removeChild / clearChildren
  │     ├── setAttribute / removeAttribute / setStyle / setText
  │     ├── applyLayout?（可选）
  │     ├── bindGesture
  │     ├── initialize / dispose
  │     ├── getRootContainer / attachToHost
  │     └── capabilities（RenderCapabilities）
  │
  ├── Conformance 测试套件  ★ G-37 定义（42 测试，C-01 ~ C-10）
  │
  ├── 参考实现
  │     ├── vue-dom-backend    （framework 布局，Tier 1）
  │     └── terminal-backend   （backend 布局，Tier 3，conformance 用）
  │
  ├── 官方 Backend（B4-B5 落地）
  │     ├── ios-uikit           （Tier 1）
  │     ├── android-view         （Tier 1）
  │     ├── flutter              （Tier 1）
  │     ├── skia                 （Tier 1）
  │     ├── harmony-arkui        （Tier 1）
  │     ├── tv-10ft              （Tier 2）
  │     └── watch-os             （Tier 2）
  │
  └── 降级链
        ├── StubBackend（初始化失败兜底）
        └── 占位节点（dev 红色框 / prod 静默）
```

### 3.2 数据流细化

```
SFC 源码
  ↓ [G-29 CompilerBackend]
Component IR (C-IR)
  │  - semantic: 'layout.grid'
  │  - props: { columns: 3, gap: 8 }
  │  - degradation?: { ... }
  ↓ [G-29 优化]
RenderIR
  │  - nodes[]
  │  - diffs[]（IRDiff）
  │  - layout?: LayoutConstraintIR（framework 模式）
  ↓ [ProteusRenderBackend 接口]  ★ G-37
具体 Backend 实现
  │  - createNode(ir) → UIView / ViewGroup / Widget / Canvas / DOM
  │  - updateNode(handle, diffs)
  │  - bindGesture(handle, gesture) → 语义手势
  ↓ [原生渲染管线]
像素 / GPU 帧
```

---

## 四、文档体系增量

### 4.1 规划文档计数

**现状**：50 份 plan

**增量**：+3 份（G-36 AI Agent + G-37 RenderBackend SPI + G-38 CompilerBackend SPI，同期入库）

**新计数**：**55 份 plan**

### 4.2 分层归属

| 文档 | 层级 | 说明 |
|------|------|------|
| `01-render-backend-spi.md` | L1 方法论层（规范） | 主文档 |
| `06-rules.md` | L1 方法论层（规则） | 铁律 + 补充规则 |
| `02-conformance-suite.md` | L2 执行层（测试） | 42 测试规范 |
| `03-implementation-guide.md` | L2 执行层（指南） | 5 步实现 |
| `05-batches.md` | L2 执行层（计划） | B1-B5 |

---

## 五、路线图落点

### 5.1 M1（与 G-27/29/30/31/32/33 B1 同批）

| 项 | 内容 | 里程碑 |
|----|------|--------|
| G-37 B1 | SPI 接口定义（`.d.ts`）+ vue-dom / terminal 参考实现 | M1 末 |
| G-37 B2 | Conformance 测试套件（42 测试） | M1 末 |

**理由**：G-37 依赖 G-29（C-IR schema）和 G-32（原语表），两者在 M1 已稳定。SPI 是后续所有 Backend 的前置，必须尽早定义。

### 5.2 M2

| 项 | 内容 |
|----|------|
| G-37 B3 | 实现指南 + terminal Backend 完整示例（新人 3 天可用） |
| G-37 B4 起 | iOS / Android Backend 开发启动 |

### 5.3 M3

| 项 | 内容 |
|----|------|
| G-37 B4 完 | iOS / Android / Flutter conformance 全 PASS |
| G-37 B5 | Skia / Harmony / TV / Watch conformance 全 PASS |

---

## 六、风险与边界

### 6.1 明确不承诺

| 不承诺 | 原因 |
|--------|------|
| 自动适配任意绘图 API | Backend 仍需手动实现（SPI 定义契约，不生成实现） |
| 零性能损耗 | 跨层调用有开销，C-10 定义预算 |
| 已有原生项目零改造接入 | 需按 SPI 封装已有渲染代码 |

### 6.2 与 G-27 的关系澄清

**G-27** = 「渲染可插拔」的**方向声明**（高层原则）

**G-37** = 「渲染可插拔」的**工程契约**（接口 + conformance）

**G-37 不替代 G-27，而是 G-27 的可执行落地。** G-27 保留架构定位描述，G-37 补充实现规范。

---

> **Related**：01-render-backend-spi.md（主文档）· rules.md · 02-conformance-suite.md · 03-implementation-guide.md · batches.md
>
> **Merge into**：`proteus-architecture.md`
> - 原则层 → §"核心原则" 新增 #13
> - 铁律总表 → 新增 G-37.1-6 + CMP023-028
> - 全景图 → "渲染层" 细化为含 SPI + Conformance
> - 文档计数 → 50 → 51
> - 路线图 → M1 新增 G-37 B1/B2
