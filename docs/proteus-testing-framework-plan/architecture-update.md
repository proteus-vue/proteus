# 规约增量 —— G-44

> 合并进 `docs/proteus-architecture.md`（L0 真理来源）

---

## 1. 原则 #13 新增条款（可插拔可验证子原则）

```
既有（宿主层 #13.15-13.24）：
#13.18  宿主容器形态可插拔（G-42）
#13.21  资源所有权可插拔（G-43）

★ 新增（本 plan）：
#13.25  测试语义可插拔（G-44）——Test IR 描述期望行为，TestBackend 可插拔执行
#13.26  跨层组合正确性必须被自动化验证（G-44）——INT 跨层集成套件
#13.27  任一 Backend conformance FAIL 即阻断（G-44.2）
```

> 原稿 #11.21-11.23 系旧原则编号体系（与既有 #13.x 撞号）——按现行规约重编为 #13.25-13.27；
> 原稿列出的 #11.18-11.20（容器/所有权/分布式）分别已由 #13.18-20/#13.21-24 落地/待 B6。

---

## 2. 八次泛化全景（原则 #0 统一语义收敛的同构性）

```
能力        语义原语          后端映射              plan
渲染        Render IR        → VueDom/Flutter/...  G-27
宿主运行时  Runtime IR       → iOS/Android/鸿蒙    G-39
编译        Compiler IR      → Node/Rust/SWC       G-29
执行载体    Carrier SPI      → JSI/AOT/WASM        G-40
容器        Container SPI    → Stack/SuperApp/...  G-42
所有权      Ownership IR     → GC + 边界资源       G-43
★ 测试     Test IR           → Node/JSI/AOT/Host/Device  G-44
```

> 原稿称「第七次泛化」漏计所有权（G-43 已于决策 #341 落地）——修正为第八次。

**G-44 是原则 #0（统一语义收敛）在「验证层」的终极兑现。**

---

## 3. 分层图更新（L0-L6）

```
L0  应用层        SFC / 路由 / 状态
L1  语义层        p-* 原语 / LayoutConstraint IR / Ownership IR
L2  编译层        Compiler + Plugin API
L3  后端抽象层    RenderBackend / CapabilityBackend / HostRuntime
                 / Carrier / Container / ★ TestBackend (G-44)
L4  宿主/容器层   SinglePage / Stack / SuperApp / MiniProgram / Window
L5  执行载体层    JSI / AOT / WASM
L6  ★ 验证层      Test IR + TestBackend + conformance runner (G-44)
```

---

## 4. 跨层调用规则补充

> 见 G-39 CMP036 / G-42。G-44 新增：

- **CMP074**：测试代码不得直接调用 Backend 内部方法，须通过 TestBackend SPI
- **CMP077**：跨 Backend 结果不一致 = 语义分歧，须修复而非忽略

---

## 5. G-25 三维断点的验证承诺

此前 G-25 仅文档断言 `resolveProfile(W,H,F)`。G-44 起：

> **W×H×F 矩阵必须有自动化覆盖（CMP078），禁止仅文档断言。**

这是 G-44 对 G-25 的**反向约束**——新机制反哺旧 plan，要求补齐测试。

---

## 6. 编号避让确认

```
G-43 所有权: G-43.1-6 + CMP067-073（既有——原稿 CMP067-074 撞号，避让后修正）
G-44 测试:    G-44.1-6 + CMP074-081 ← 无冲突（避让后机器已检查）
```

---

*规约增量。主文档见 `G-44-testing-framework.md`。*
