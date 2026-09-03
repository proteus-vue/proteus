# Proteus 九次泛化 → SPI-First 五步法映射

> 本文证明：Proteus 的九次"不绑 X"泛化，全部是 SPI-First 五步法的实例。
> 阅读本文 = 同时理解"方法论"与"它的第一性证明"。

---

## 映射总表

| 泛化 | 不绑什么 | SPI 名称 | Step2 语义接口 | Step3 后端 | Step4 conformance | Step5 诚实边界 |
|------|---------|---------|---------------|----------|------------------|--------------|
| G-27/37 | 渲染引擎 | `ProteusRenderBackend` | nodeOps / IR | VueDom, Flutter, Native, Skia, Headless | G-27 conformance 同 shape（RND002） | CMP046 性能数据须实测 |
| G-29/38 | 编译器 | CompilerBackend | IR Transformer | Node, Rust, WASM（规划） | G-29.1 IR Golden / G-38.2 语义等价 | 编译期能力有上限 |
| G-31/32 | 平台 API | 语义原语 + Capability Hook | p-* / useXxx | iOS, Android, Harmony, Web, MP | audit coverage + 语义 conformance 门禁（45 implemented × 6 后端） | 系统能力不齐须降级 |
| G-39 | 宿主运行时 | `HostRuntime` | 生命周期/事件/线程 | Web, Terminal（参考实现） | G-39 运行时契约（C-01~C-10） | jsi::Runtime 线程亲和 |
| G-40 | 执行载体 | `ExecutionCarrier` | 执行环境 | JSI, AOT, WASM | G-40 conformance（C-01~C-10） | AOT 路径语义等价未全证 |
| G-42 | 容器形态 | `HostContainer` | 页面生命周期 | SinglePage, Stack, SuperApp, MiniProgram, Window | G-42 五原子销毁（C-01~C-08） | 崩溃隔离有宿主依赖 |
| G-43 | 内存管理范式 | Ownership SPI | `Owned<T>`/`Borrow<T>` | JS GC + 边界资源 | use-after-move 等 | JS 无法全编译期检查（PSS 分级） |
| G-44 | 测试实现 | TestBackend | Test IR | Node, JSI, AOT, Host, Device | G-44 跨层 INT 套件（INT-01~05） | 模拟器 ≠ 真机（需 Device 后端） |
| G-45 | 基座形态 | DevHost / DynamicBackendModule | 装载协议 | 静态链接 / 动态模块 | NAT-C 快检 | **Install-Once 仅开发态，非线上热更新** |

---

## 逐条拆解：以 G-45 为例演示五步法

**Step 1｜找耦合点**：
传统基座把"运行时壳 + 原生插件 + 业务页面"打包成一个 APK/IPA → 改任何一边都要重打整个基座。**耦合点是"基座形态"本身**——它被硬编码成了"构建产物"。

**Step 2｜语义收敛**：
- ❌ 含技术名词：`CustomBaseApk`、`cloudPackage`、`re-sign IPA`
- ✅ 语义接口：`DevHost`（装载协议）+ `DynamicBackendModule`（manifest + factory）

**Step 3｜可插拔后端**：

| 后端 | 适用 |
|------|------|
| 静态链接后端 | 发布态（App Store 合规） |
| 动态模块后端 | 开发态 / 内部分发 |
| Mock 后端 | conformance 快检 |

**Step 4｜conformance**：
NAT-C 套件 —— 动态模块装载时跑快检，**同能力必须产出同 shape 结果**，不过门禁 → 拒绝装载 + 降级后端兜底。

**Step 5｜诚实边界**：
**Install-Once 是开发调试 + 内部分发语义，不是线上热更新**。App Store 2.5.2 禁止下载可执行代码；鸿蒙 HSP 须随宿主打包。这条边界若不声明，方法论会被包装成"能热更新"的银弹，最终踩合规红线。

---

## 方法论的复利效应

G-44（测试框架）落地后，后续所有 SPI 的 conformance **自动复用 TestBackend**：

```
G-27 渲染 conformance → 跑在 TestBackend Node/JSI/AOT/Device
G-40 载体 conformance → 同上
G-45 NAT-C 快检        → 同上
```

**这是"先有方法论、再有实例"的红利**：新 SPI 不需重新发明验证手段，直接套五步法即可。这也是为什么我们说 ——

> **九次泛化不是九份独立设计，而是同一套五步法重复执行九次。**

---

## 反向校验：用映射表找缺口

映射表有一个用途：**逐行检查，缺哪格就是缺口**。

例如 G-43 Ownership 那行：
- Step4 列写着"JS 无法全编译期检查（PSS 分级）" → **说明 conformance 尚未完备**，是已知缺口（G-43 borrow-checker 的 loose 模式）
- 这比"觉得哪里不太对"精确一万倍 —— **缺口被显式化为一行表格**。

建议每次新增泛化后，回填此表。

---

*本映射表是"方法论 ↔ 实例"的双向索引，应随 Proteus 演进持续更新。*
