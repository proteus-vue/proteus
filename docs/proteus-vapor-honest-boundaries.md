# Vapor IR 诚实边界盘点（截至 2026-09-28）

> **文档定位**：把散落在 `PROJECT_MEMORY.md` 各阶段条目、方案文档、源码注释里的
> **诚实边界**收成一张表，并**逐条核实当前状态**。
>
> **为什么需要它**：边界散在十几处，且**很多已被后续工作解决**，但原文没同步更新
> ⇒ 后续会话读到过时边界会（a）重复做已完成的工作，或（b）把已闭项当风险重复讨论。
>
> **纪律**：本表每条都标注**判据/证据位置**（可 grep 复现），不写"大概""应该"。
> 新增边界请同时更新本表——**边界不落表 = 下次必重复推导**。

---

## 一、已闭项（曾有边界，现已解决——**不要再当风险讨论**）

| # | 曾经的边界 | 现状 | 证据 |
|---|---|---|---|
| 1 | V1「槽位由调用方手工 `setSlot`（编译器未接）」 | **已闭**：编译器产出 `SubscriptionTable`，运行时 `VaporRuntime` 自动直写 | `packages/compiler/src/vapor/build.ts` · `slot-runtime/src/runtime.ts` |
| 2 | V2「接到 Vue 运行时属 V3」 | **已闭**：真机跑通（`applyOps` + Rust 应用 + 层更新） | `hosts/ios/ProteusHost/selfdraw-scene.swift` 的 `applyOps` |
| 3 | V3「`LIST_UPDATE` 被上报 unsupported（需宿主列表映射）」 | **已闭**：`ListRegistry` 在 JS 侧解析 `itemKey → nodeId`，解析成功即发**普通指令** | `slot-runtime/src/list-registry.ts` · `tests/vapor-list-e2e.test.ts` |
| 4 | V3「`relayout` 段 18ms 未定位」 | **已闭**：分段埋点证明它走的是**全量**（`scopes=[0]` ⇒ 退化保护），非"增量慢" | `PROJECT_MEMORY.md` V5 节「类B 的 relayout 真相」 |
| 5 | V4「类B 无法增量（必然全量）」 | **已闭**：平移传播（6 条前提守卫）⇒ relayout 3.868→0.075ms（≈52×）/ 真机 8.29× | `taffy_engine.rs` 的 `try_translation_relayout` · `scripts/check-vapor-perf.mjs` |
| 6 | V4「`layers` 段 22ms 未定位」 | **已闭**：主因是**自制排序**（sort 18.4ms，非 CA 提交）⇒ 先过滤后排序 ⇒ 1.77ms | `selfdraw-scene.swift` 的 `updateLayersIncremental` 注释 |
| 7 | V4「滚动补刷无端到端验证」 | **已闭**：`V4_scroll_flush` PASS（`stale_cleared=4` / 不变量 `overlap=0`） | `entry-bench.ts` 的 `V4_scroll_flush` |
| 8 | V4「像素级比对未做」 | **已闭**：`V5_pixel_after_scroll` PASS（标定块 + 行色序列逐点一致） | `entry-bench.ts` 的 `V5_pixel_after_scroll` |
| 9 | V4「嵌套 v-for 未验证」 | **已闭**：**三层**打通（`sourceExpr` 改纯字段路径） | `tests/vapor-list-e2e.test.ts` 三层用例 |
| 10 | V4「别名遮蔽未验证」 | **已闭**：遮蔽 2 条用例（外层槽位入图 + 路径不污染） | 同上「别名遮蔽」用例 |
| 11 | V5「无性能门禁」 | **已闭**：`check:vapor-perf`（两层判据 + 接 CI） | `scripts/check-vapor-perf.mjs` |
| 12 | V5「21 个 golden 全是首帧（增量未对拍浏览器）」 | **已闭**：`browser-mutation.json` + Rust 消费端 | `tests/e2e-layout-incremental-conformance.test.ts` · `incremental_browser_conformance.rs` |
| 13 | 「`rowsOfList` 只回溯一层」 | **已闭**：改为**纯按 sourceExpr 逐级求值**（任意层） | `runtime.ts` 的 `rowsOfList` |
| 14 | 「行内槽位求值器未实例化时静默 `continue`」 | **已闭**（改为**上报** `uninstantiatedSlots`） | `runtime.ts` 的 `load()` + `tests/vapor-list-e2e.test.ts` |
| 15 | （附带）祖先行链已注入 `rowCtx` | **已实现**（祖先链 `RowRef.ancestors` + `ancestorScopesOf`） | 同上 |
| 16 | 「无 `:key` 只有提示、拦不住」 | **已闭**：升级为 error + 结构化诊断 + 逃生通道 | `compiler/src/vapor/build.ts` · `tests/vapor-list-e2e.test.ts` |
| 17 | 「`notes` 是自由文本、门禁无法消费」 | **已闭**：新增 `VaporDiagnostic`（severity/code/message/hint） | 同上 |
| 18 | **「注释声明用官方 `bindings` 定语义，实测根本没参与判定」** | **已闭**：真校正（含 `setup-reactive-const` / `setup-maybe-ref` / `setup-ref` 三类实测值）| `compiler/src/vapor/sources.ts` |
| 19 | 「cli 漏声明 `@proteus-vue/slot-runtime` 依赖」 | **已闭**：补声明（此前靠 pnpm 隐式提升才没炸） | `packages/cli/package.json` |
| 20 | 「含运算的表达式落到 `expr` ⇒ 槽位永不更新」 | **已闭**：表达式程序（`form='program'`）| `compiler/src/vapor/expr.ts` · `slot-runtime/src/expr.ts` · `tests/vapor-expr-program.test.ts` |
| 21 | 「`undefined` 被编成 `null` ⇒ `a === undefined` 静默算错」 | **已闭**：独立 `undef` 节点（破坏性验证命中） | 同上 |

---

## 二、仍开项（按我判断的优先级）

### P0 · 会影响正确性或可用性

| # | 边界 | 现状 | 影响面 | 建议 |
|---|---|---|---|---|
| 1 | ~~**无 `:key` 的 `v-for` 用下标兜底**~~ | ✅ **已闭（2026-09-28）**：改为 **error 级结构化诊断**（`VAPOR_VFOR_WITHOUT_KEY`，带可执行 `hint`）⇒ `hasErrors=true`，**调用方应阻断**；逃生通道 `allowIndexKey`（`true` 或 `[listId]`，显式放行）；`proteus explain --vapor` 显眼展示 | — | — |
| 2 | ~~**外层别名在内层表达式被引用**~~ | ✅ **已闭（2026-09-28）**：根因是表达式**含运算** ⇒ 落到 `expr` 形态 ⇒ 不支持求值。⇒ 新增**表达式程序**（方案 §4.3 Step 4）：编译期把表达式编成**可序列化程序**（纯 JSON，跨端免 eval），运行时解释执行。覆盖算术/比较/严格相等/逻辑短路/空值合并/三元/成员/计算成员/对象/数组/模板串；**不支持的构造编译期拒绝 + 上报**（`VAPOR_EXPR_UNSUPPORTED`，warn）| 见右 | ★仍不支持（**刻意**）：函数调用（纯度属 C1）、宽松 `==`/`!=`（语义微妙，宁可拒绝不冒险）、可选链 `?.`、赋值/自增、内联函数 |
| 3 | **结构性列表变更未实现** | `LIST_SET`/`LIST_SPLICE` 在运行时**显式跳过**（`kind === 'list-data'` 的 continue） | 增删行/整表替换**不会更新**（静默）；当前只支持行内字段更新 | 需「数据源引用协议」——独立课题 |

### P1 · 影响覆盖可信度（不影响正确性）

| # | 边界 | 现状 | 建议 |
|---|---|---|---|
| 4 | ~~**Vue 版本兼容只测了 3.5.42**~~ | ✅ **已闭（2026-09-28）**：解析器做成**可注入** + 新增 `tests/vapor-vue-compat.test.ts`（5 个 SFC 样本 × 3 版 = 12 用例）⇒ **3.4.38 / 3.5.42 / 3.6.0-rc.9 产物逐字节相同**；并断言诊断（如无 `:key`）不因版本而异。★3.6 目前是 **RC**（非最终稳定版） | — | — |
| 5 | **宿主侧列表映射未接**（真实滚动列表） | `ListRegistry` 已就绪，但**演示里没有真实长列表**驱动它 | 用真实列表场景验证（也顺带验证复用池） |
| 6 | **`layers` 段在类A 极小场景仍有常数开销** | 类A `layers` 0.02–0.5ms（可见层少）⇒ 属固定成本，非瓶颈 | 观察即可；如需再优化需 profile |

### P2 · 已知限制（接受为边界，不打算补）

| # | 边界 | 为什么接受 |
|---|---|---|
| 7 | **平移传播前提不满足时回退全量** | 正确性优先；回退是"不变慢"，不是"出错" |
| 8 | **`INSERT_BLOCK`/`MOVE_NODE`/`CALL_COMPONENT_UPDATE` unsupported** | 需编译期块实例 / 组件边界调度，属后续里程碑；**上报而非静默**（这点是达标的） |
| 9 | **真机绝对读数受热降频影响** | 已用同轮 A/B + 三轮中位缓解；**比值可信、绝对值不可跨轮比** |
| 10 | **`bytes → JSON 数组` 跨边界形态**（JSExport 妥协） | 指令流极小（45 字节）；ARM 侧 JSI 直传属优化项 |
| 11 | **`proteus explain` 的 L1 覆盖率是单页读数** | 需在真实项目集上持续度量才代表整体 |

---

## 三、纪律清单（本阶段累积——都来自实测踩坑）

| # | 纪律 | 来源 |
|---|---|---|
| 1 | **测量装置本身必须先被验证** | 5 次同类（未挂载 / 脏标记 / 计数器 / 微任务排空 / 时钟分辨率） |
| 2 | **任何 >5ms 的分段都必须再拆** | `layers` 只报总数时把"不是瓶颈"当瓶颈查了两轮 |
| 3 | **用例必须通过破坏性验证才算数** | 写过"击不倒任何东西"的用例；守卫未被触发过 |
| 4 | **计时必须配「变化量」自检** | 基准树缺 `flexShrink` ⇒ 改行高不产生几何变化却照报耗时 |
| 5 | **「恰好为 0 的偏移」会让坐标类错误隐身** | 潜伏坐标缺陷存活至今（目标都在偏移 0 处） |
| 6 | **树 id 必须等于模板序元素序号** | 指令写到错误节点，且症状伪装成坐标错 |
| 7 | **绝对/相对坐标在断言里必须标明口径** | `rects`=绝对 · `node.rect`=相对父 · 重排后子节点=相对范围根 |
| 8 | **连续两次猜测未果 ⇒ 转确定性诊断** | 三层嵌套试错四轮，打印内部状态一次定位 |
| 9 | **标定实验优先于推断** | 字节序我猜 BGRA，纯色标定一次测出是 RGBA |
| 10 | **跨用例共享的视图状态必须在新树建立时归零** | `contentOffset` 泄漏 ⇒ "几何对但屏幕错" |
| 11 | **守卫必须可观测**（记下"被哪条拒绝"） | 否则"有守卫"与"守卫生效"无法区分 |
| 12 | **同一语义一处实现** | `apply_ops` 重复实现被收敛为 `apply_ops_impl` |

---

## 四、验证体系现状（四层独立证据）

| 层 | 判据 | 位置 |
|---|---|---|
| 单元 | 指令编解码 / 跨语言 golden / 槽位 / 分层 | `tests/slot-runtime-v1.test.ts` 等 |
| 不变式 | **增量 ≡ 全量**（含连续多次变更） | `layout-core-rust/tests/incremental_equivalence.rs` |
| **浏览器对拍** | 全量 ⇄ 浏览器（21 用例）· **增量 ⇄ 浏览器** | `browser-layout.json` · `browser-mutation.json` |
| **像素级** | 屏幕颜色序列 = 应显示内容（含滚动补刷） | `entry-bench.ts` 的 `V5_pixel_after_scroll` |
| 性能 | 棘轮（只降不升 + **路径生效反向判据**） | `scripts/check-vapor-perf.mjs` |

**当前规模**：Rust **88 项** · TS vapor 六套 **98+ 项** · CI 覆盖 **25 个门禁**。
