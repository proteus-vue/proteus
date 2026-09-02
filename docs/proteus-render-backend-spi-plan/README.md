# Proteus RenderBackend SPI 规范（G-37）

> **一句话**：G-27 定义了「渲染可插拔」的方向，G-37 定义「插拔的插头长什么样」——任何渲染后端只要实现本规范接口 + 跑通 conformance，即可接入 Proteus。
> ★编号避让：规划文档（website-v3 G-34 内容）入库时 G-34 已被 devtools-plus（HMR/DevTools）占用，按规约编号避让纪律重编号为 **G-37**；本文档内部引用以 G-37 为准。

---

## 目录

| 文件 | 内容 | 角色 |
|------|------|------|
| **[01-render-backend-spi.md](./01-render-backend-spi.md)** | ★ 主文档：动机 / 架构定位 / 核心接口 / 生命周期 / C-IR 消费契约 / 布局分工 / 手势桥接 / 线程模型 / 错误处理 / conformance / 实现指南 / 协同矩阵 | 规范正文 |
| **[06-rules.md](./06-rules.md)** | ★ 铁律 G-37.1-6 + 补充规则 CMP023-028（编号已避让 G-27~G-36） | 硬约束 |
| **[02-conformance-suite.md](./02-conformance-suite.md)** | ★ Conformance 测试套件（42 测试，C-01~C-10）+ 运行方式 + 跳过规则 | 验证门槛 |
| **[03-implementation-guide.md](./03-implementation-guide.md)** | ★ 实现指南（5 步，3 天可写出最小 Backend）+ Step 1-5 代码 + 降级处理 | 落地手册 |
| **[04-quick-reference.md](./04-quick-reference.md)** | 一页速查卡（核心接口 / 生命周期 / 常见错误） | 速查 |
| **[05-batches.md](./05-batches.md)** | B1-B5 分批落地 + DoD + 跨 plan 协同 + 风险缓解 | 执行计划 |
| **[00-architecture-update.md](./00-architecture-update.md)** | 规约增量（原则 #13 + 铁律总表 + 全景图 + 51 份 + M1/M2/M3 落点） | 合并入口 |

---

## 快速理解

### 核心接口（18 方法 + 1 可选）

```typescript
interface ProteusRenderBackend {
  // 身份
  readonly id: string
  readonly version: string
  readonly capabilities: RenderCapabilities

  // 生命周期
  initialize(ctx): Promise<void>
  dispose(): void

  // 节点操作
  createNode(ir: ComponentIRNode): NodeHandle
  updateNode(handle, changes: IRDiff[]): void
  deleteNode(handle): void
  insertChild(parent, child, at): void
  removeChild(parent, child): void
  clearChildren(parent): void

  // 属性 / 样式
  setAttribute(handle, key, value): void
  removeAttribute(handle, key): void
  setStyle(handle, style: StyleIR): void

  // 文本
  setText(handle, text): void

  // 布局（可选）
  applyLayout?(handle, layout: LayoutConstraintIR): void

  // 手势
  bindGesture(handle, gesture: GestureIR): GestureBinding

  // 挂载
  getRootContainer(): NodeHandle
  attachToHost(host): void
}
```

### 5 步写出 Backend

```
Step 1  声明（id / version / capabilities）  → 0.5 天
Step 2  实现节点操作（createNode / updateNode） → 1 天
Step 3  实现手势映射（bindGesture）            → 0.5 天
Step 4  处理降级（degradation / StubBackend）  → 0.5 天
Step 5  跑 Conformance + 性能调优              → 0.5 天
                                   合计：3 天
```

详见 [03-implementation-guide.md](./03-implementation-guide.md)。

---

## 与既有体系关系

```
G-27 渲染可插拔（方向）  →  G-37 SPI（契约）  ← ★ 本模块
G-29 编译层（C-IR 生产者） → G-37 消费 C-IR
G-30 端接入（Tier）       → G-37 capabilities.tier
G-31 语义入口（<p-grid>） → G-37 消费 semantic
G-32 原语（128）          → G-37 semantic 命名空间
G-36 AI Agent             → Agent 生成符合 IR 的代码 → G-37 渲染
```

---

## 校验

本模块独立于 website-v3 的 `verify.sh`（那是官网打包脚本）。本 plan 的机器化校验 = 规约一致性门禁（编号避让）+ conformance 套件（`02-conformance-suite.md`）：

- 7 份 md 齐全非空
- 核心概念在位（SPI / Conformance / NodeHandle / semantic / capabilities / degradation / StubBackend / applyLayout）
- 铁律 G-37.1-6 + CMP023-028 齐全
- 闭环论证（SPI → 参考实现 → Conformance → 真实 Backend → 柔性框架六端）

---

> **Design principle**：`PROTEUS-METHODOLOGY` 原则 #0（统一语义收敛）+ 五支柱
>
> **Related**：G-27（渲染可插拔）· G-29（编译层）· G-30（端接入）· G-31（语义入口）· G-32（原语）· G-36（AI Agent）