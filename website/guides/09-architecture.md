---
title: 可插拔架构
order: 9
group: 参考
---

# 可插拔架构

Proteus 的架构只有一个母题：**不绑定**。「不绑定任何单一平台」不是一句口号，而是同一个设计动作在全部架构维度上的重复应用：

> 任何跨端问题 = 语义定义（框架做） + 后端实现（平台做）
>
> 框架定义「你要什么」（语义接口 / IR）和「怎么验证做对了」（conformance），平台提供「怎么做」（Backend 实现）。业务开发者只消费语义接口，对后端零感知。

## 「不绑定」维度总表（G 系列）

| 维度（G 系列） | 语义层接口（框架定义） | 后端 SPI（可插拔实现） | 状态 |
|---|---|---|---|
| 平台 API（G-31/32） | p-* 语义组件 + 128 原语 SSOT + 50 Capability Hook | 各端语义实现；小程序组件集 = Layer 1 兼容层 | ✅ |
| 渲染引擎（G-27/37） | VNode / Component IR / LayoutConstraint IR | RenderBackend：VueDom / Native×3 / Flutter / Headless | ✅ |
| 编译器（G-29/38） | CompilerIR：`SourceFile → ProgramIR → IRModule` | CompilerBackend：Node ✅ / Rust ✅ / WASM | 🟡 |
| 柔性布局（G-22） | p-fluid / p-grid / p-stack / p-fit / p-adaptive 声明式原语 | `@proteus-vue/fluid` + FLD001-013 门禁 | ✅ |
| 桌面与系统原语（G-24） | p-hover / p-shortcut / p-notify / p-master-detail 等 17 模块 | `@proteus-vue/desktop`（Pure logic 双端接线） | ✅ |
| AI 生成（G-36） | IR 契约 + 三层护栏（IR Schema / 风格 / conformance） | MCP Server / Agent Kit / Skill | ✅ |
| 宿主接入（G-41） | 三方正交（框架 × 渲染引擎 × 宿主）+ nodeOps Dispatcher | 6 宿主 × 6 引擎 = 36 组合矩阵 | ✅ |
| 容器形态（G-42） | 页面生命周期状态机 + IR 单一 Owner | 六容器策略：Stack / SuperApp / Window / MiniProgram / Embedded / SinglePage | ✅ |
| 资源所有权（G-43） | Owned / Borrow / Weak + Drop 五阶段协议 | 借用检查器（PSS 编译期完备） | ✅ |
| 测试（G-44） | Test IR（可序列化断言，跨后端复用） | TestBackend × 5：Node / JSI / AOT / Host / Device | 🟡 |
| 宿主运行时（G-39） | ProteusHostRuntime SPI（生命周期 / 线程 / 原生桥唯一拥有者） | Web / Terminal 参考实现已备 | 📋 |
| 执行载体（G-40） | ExecutionCarrier SPI（批处理差分 / 零拷贝 / 实时原生闭环） | JSI（默认实现）/ AOT 双参考实现 | 📋 |
| 原生能力（G-28） | NativeBackend SPI + Top30 能力目录 | iOS / Android / 鸿蒙官方后端 | 📋 |
| 端接入（G-30） | Platform = (R, C, J) 三元组 + Tier 1-4 | 任意能提供渲染宿主 / 能力宿主 / JS 运行时之一的端 | 📋 |

状态口径：**✅** 已落地可验证 · **🟡** 部分落地 · **📋** 规划已入库（plan + 参考实现，无可运行集成）。其中渲染后端五官方实现里 Native×3 / Flutter 当前为原型映射（widget 级），原生工程接线随 G-37 分批推进——升级节奏见 [一致性验证](/docs/26-conformance)。

## SPI-First 三件套

每一个「可插拔」维度都由同样的三件套构成，缺一件就是假 SPI：

1. **语义接口**：接口用业务语言描述「做什么」，禁止出现厂商 / 技术名词。例如玻璃是 `<pg-glass>` 而不是 `backdrop-filter`，所有权是 `Owned<T>` 而不是 `Rc`——换了后端，接口本身一个字都不用改。
2. **后端实现（≥2 个）**：至少两个后端，其中一个必须是 Headless / Mock。**单后端 SPI 是假 SPI**——可替换性从未被验证过的接口，等到真要换时一定会漏。
3. **conformance 验证**：任何后端实现必须通过同一套契约测试才能接入。测试不测实现细节、只测语义契约——同一份用例对所有后端跑，结果机器可判定。

这正是原则 #13 的原文要求：任何声称「可插拔」的层，必须同时提供 **SPI + Conformance + ≥2 参考实现**。反过来它也给出反模式自检：接口含厂商名词、只有单一实现、没有 conformance、业务绕过接口直调底层——命中任何一条，抽象就只是把耦合点藏得更深。

## 深入实例：宿主层三件套（G-41/42/43）

宿主层是「可插拔」最集中的展示区，三条铁律各管一层：

**宿主接入（G-41）——三方正交**。框架 × 渲染引擎 × 宿主三方独立演进，职责边界由铁律划定：框架不碰线程 / 原生 View / 平台 SDK；宿主不解析 IR、不干预 Diff；引擎不感知 Vue（不 import 任何前端框架）；业务无平台判断。nodeOps Dispatcher 让「切换渲染引擎 = 一次赋值」，热切换 / 混合渲染 / 组合矩阵全部由 host-conformance（H-01~H-08）验证。

**宿主容器（G-42）——六容器策略**。页面组织方式是可插拔策略，不是硬编码：

| 容器 | 适用 |
|---|---|
| Stack | 常规页面栈 |
| SuperApp | 超级应用：业务沙箱 + 崩溃隔离 + 自动重启 + 签名 / 白名单网关 |
| Window | 多窗口（PC / 折叠屏） |
| MiniProgram | 小程序宿主 |
| Embedded | 嵌入宿主 App |
| SinglePage | 单页 |

IR 是页面唯一真相（单一 Owner），页面销毁走五原子协议：unmount→unbindEvents→releaseResources→destroyIR→releaseQuota，不可部分执行。宿主仓库**严禁 fork 框架源码**，`proteus conformance --repo` 一键扫描。

**资源所有权（G-43）——GC 管可达性，所有权管意图**：

```ts
const file = new Owned(openFile(path))   // 边界资源创建即登记所有权图
file.transferTo(pool)                    // Move 语义：原所有者再访问 → 编译期拦截
```

借用检查器（PSS strict 编译期完备）把 use-after-move / double-move / 借用逃逸全部拦在编译期；Drop 五阶段协议保证释放时机确定，不依赖 GC；所有权图 100% 可观测，DevTools 所有权视图可定位泄漏路径。

## 架构决策原则

| 原则 | 一句话 | 落地 |
|---|---|---|
| 统一语义收敛（#0） | 不做跨端翻译，平台差异全部下沉为后端实现细节 | 四投影 + G-31/32 书写面 |
| 语义收敛，原生实现（#2/#10） | 框架定义做什么，后端决定怎么做 | p-* 原语 + Backend SPI |
| 语义一致 ≠ 像素一致 | 各端对语义的理解一致，视觉遵循该平台规范 | `p-flex justify="space-between"` → UIStackView / ArkUI Flex / ConstraintLayout |
| 验证先于运行（#7） | 能编译期发现的问题绝不留到运行时 | IR + conformance + Golden Test |
| 降级不崩溃（#4） | 不支持的能力走 L3→L2→L1→solid 降级链，不崩溃 | BackendCapabilities 能力协商 |
| 显式声明 > 隐式假设（#9） | 能力必须诚实声明，未声明 = 不支持 | capabilities 表 + 编译期拦截 |
| 确定性（G-38.6 等） | 同一输入任何后端产出行为一致的产物 | IR Golden Test + 可复现构建 |

## Dogfooding：官网即实证

Proteus 官网（你正在看的这个站点）用框架自身构建——竞品官网自己往往不是用自家框架写的，他们的能力只能「描述」；Proteus 官网的能力是**正在渲染你眼前这个页面的东西**：

- **文档引擎 `@proteus-vue/docs`**：本站全部指南由它在 vite 构建期编译成 Docs IR 再渲染——文档也是编译产物，运行时零解析
- **柔性框架优先**：全站响应式走 `v-p-fluid` clamp 表达式 + 柔性网格，**零 @media 断点**（机器门禁强制）；侧边栏 / 双栏分屏用 `p-sidebar` / `p-split` 按容器求解
- **Mini Playground**：同一套 `@proteus-vue/compiler` 在浏览器内实时编译（证明编译器零 node 依赖），并可真跑五官方渲染后端切换同一棵语义树
- **系统级玻璃 `<pg-glass>`**：导航栏与卡片走玻璃原语，`prefers-reduced-transparency` 自动降级实色

诚实边界同样公开：路由当前仍用 vue-router（差距已登记评估）、SSG/sitemap 归后续批次、p-table / p-code-block 等原语未实现处用语义化 HTML 过渡。

## 相关页面

- [语义模型](/docs/03-semantic-model)：语义定义 + 后端实现的核心公式
- [渲染后端](/docs/04-render-backend)：RenderBackend SPI 与五官方后端
- [一致性验证](/docs/26-conformance)：conformance 如何锚定每层可插拔
