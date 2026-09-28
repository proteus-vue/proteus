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
| 22 | 「核心完全没有结构变更入口（增删行只能重发整树）」 | **核心侧已闭**：`proteus_layout_splice`（追加/摘除 + 等价性判据）| `layout-core-rust/src/ffi.rs` |

---

## 二、仍开项（按我判断的优先级）

### P0 · 会影响正确性或可用性

| # | 边界 | 现状 | 影响面 | 建议 |
|---|---|---|---|---|
| 1 | ~~**无 `:key` 的 `v-for` 用下标兜底**~~ | ✅ **已闭（2026-09-28）**：改为 **error 级结构化诊断**（`VAPOR_VFOR_WITHOUT_KEY`，带可执行 `hint`）⇒ `hasErrors=true`，**调用方应阻断**；逃生通道 `allowIndexKey`（`true` 或 `[listId]`，显式放行）；`proteus explain --vapor` 显眼展示 | — | — |
| 2 | ~~**外层别名在内层表达式被引用**~~ | ✅ **已闭（2026-09-28）**：根因是表达式**含运算** ⇒ 落到 `expr` 形态 ⇒ 不支持求值。⇒ 新增**表达式程序**（方案 §4.3 Step 4）：编译期把表达式编成**可序列化程序**（纯 JSON，跨端免 eval），运行时解释执行。覆盖算术/比较/严格相等/逻辑短路/空值合并/三元/成员/计算成员/对象/数组/模板串；**不支持的构造编译期拒绝 + 上报**（`VAPOR_EXPR_UNSUPPORTED`，warn）| 见右 | ★仍不支持（**刻意**）：函数调用（纯度属 C1）、宽松 `==`/`!=`（语义微妙，宁可拒绝不冒险）、可选链 `?.`、赋值/自增、内联函数 |
| 3 | **结构性列表变更** | ◇ **已打通并真机量化（2026-09-28）**：① 核心 `proteus_layout_splice`（插/删子树）；② 适配器 `takeSplice()` 产出结构 diff（追加 ⇒ 精确 inserts；中间插入/既有节点移动 ⇒ 显式 `'full-required'`，**不静默错序**）；③ 宿主 `splice()` 入口（核心 splice + 层子树增删 + 新文本度量注入）。★**核心判据**：splice 后几何 == 从头全量建树的几何（逐节点比对）+ 坏输入拒绝 + 中间插入显式拒绝；JS 侧 8 用例（含破坏性验证：3 处注入 ⇒ 2 条定向红）。★★**真机 A/B（`--bench --cases=S5` · iPhone 12 · 同起点同幅度 500↔600）**：<br>· 增 100 行：全量 336KB / 176ms → splice **56KB / 94ms**（字节 **6×**）<br>· 删 100 行：全量 280KB / 142ms → splice **526B / 79ms**（字节 **533×**）<br>· 层维护：全量重建 3507→4207 层；splice 只增/删 **700 层** + 更新 138 可见层<br>· ⚠ **诚实标注**：核心 `relayout=4207`（**整树**）——本基准树的行容器不是布局边界（行会被 flex-shrink 重分配）⇒ **省下的是搬运与建层，不是重排**（relayout_ms 仍 9–11ms）。这与全量路径的差别在传输侧，不在布局侧 | `layout-core-rust/src/ffi.rs` · `renderer-app/src/adapters/selfdraw.ts` · `selfdraw-scene.swift` · `tests/selfdraw-structural-diff.test.ts` · `hosts/ios/results/bench-filtered-S5.json` | ★**余项**：① ~~仅支持追加~~ → **中间插入已闭（2026-09-28）**：`build_taffy` 改为**只信 `children` 顺序**（单一事实来源；`parent`↔`children` 一致性由输入图校验强制）⇒ 插入 = 在父的 children 里插一项（O(块大小)，不搬数组）。适配器产出 `{parentId, index, nodes}`（连续区段起点；不连续/移动 ⇒ `'full-required'`）；宿主 `insertLayers` 用 `insertSublayer(at:)` 保持**层序 = children 序**。等价性判据：中间插入后的几何 == 从头全量建树（同顺序）逐节点比对；破坏性验证（退回数组序连父子）⇒ 红「节点 1002 的 y：splice 100 vs 全量 150」② 删除**不做内存回收**（Rust 数组里留孤点；宿主侧层已随 splice 清掉）③ 若要 relayout 也降下来，需让列表行成为布局边界（如行高显式 + 容器已声明尺寸，即类A 形态）——属场景规格调整，非核心缺口 |
| 4 | **★★增量重排丢文本度量（静默错几何）** | ✅ **已闭（2026-09-28，实测发现并修复）**：`update`/`apply_ops`/`splice` 的重排引擎此前用 `NullTextMeasurer` ⇒ **任何范围含文本的增量更新都把文本塌成 0 高**（现象：文字消失；首帧正确、更新后错 ⇒ 静态用例发现不了）。实测证据：`增量重排后文本高 0.0（应 19）`。⇒ 修法：度量表**随句柄持久化**（`TreeEntry::measures`）+ 新 FFI `proteus_layout_set_text_measures`（文本内容变化时宿主推新度量）+ `splice` 请求带 `textMeasures`（插入行的文本就地度量，规则与全量路径逐字一致 `fontSize ?? 14`） | `ffi.rs` 的 `TreeEntry::measures` / `splice` · `ops_apply.rs` 的 `relayout_multi_with_measures` · `selfdraw-scene.swift` 的 `splice()` · `ffi.rs` 测试 `incremental_relayout_preserves_text_measure` + `splice_insert_row_with_text_keeps_measure` | ★**仍存边界**：改**文本字面量**时宿主须在该次 update 前调 `set_text_measures` 注入新尺寸（**显式接口**，不猜）；此时若漏调 ⇒ 用旧尺寸算（不崩、不塌，但几何偏） |
| 6 | **★★全量 SFC → 端上渲染（V4 最后一项遗留）** | ✅ **已闭（2026-09-28）**：新增两件产物 —— ① 编译期 `buildLayoutTemplate`（模板 → 静态结构：引擎字段样式/文本/v-for 行模板；**字符串 style 此前完全没进过 IR**）② 运行时 `instantiateTemplate`（模板 + 数据 → 引擎就绪节点树，含**初始值回填**与 `ListRegistry` 回填）。★**真机判据**（`--bench --cases=V6`）：11 节点树由 SFC 生成 → 挂载 11 层 → 改行数据发 2 条指令 → 几何变 11 处 + **文本落层 1 处**，`unsupported=0`、`verdict=PASS`。**破坏性验证**：关掉宿主文本落层 ⇒ 报 `FAIL`（text_updates=1 / applied=0） | `compiler/src/vapor/template.ts` · `slot-runtime/src/{layout-template,instantiate}.ts` · `tests/vapor-sfc-to-tree.test.ts`（10 用例）· `entry-bench.ts` 的 `V6_sfc_full_tree` | ★**本版边界**：单层 v-for（嵌套/混合文本 ⇒ 诊断 + 建议走 L0）；id 空间与订阅表同源（有专项断言 + tag 语义判据——`+1 偏移` 破坏性验证能抓到） |
| 8 | **★★文本变更只能走全量（S4 = 281KB / 150ms）** | ✅ **已闭（2026-09-28）**：① 适配器 `setElementText` 改为**复用同一文本节点**（id 稳定 ⇒ 内容更新而非结构变更）；② 核心 update 路径改**多范围重排**（此前只重排最后一个脏节点 ⇒ 多补丁时其余几何静默过期）；③ update 路径回报 `text_updates`；④ 宿主先度量再 `set_text_measures` 再发补丁，并把更新落到 `CATextLayer.string`。<br>★★**真机 A/B（`--cases=S4` · 500 行页面改 300 行文案）**：全量 **281KB / 150ms** → 补丁 **15KB / 71ms**（字节 **18×** · 时间 2.1×）；`measures_injected=300 · text_updates=300 · text_layers_applied=300 · relayout=2102`（≈300 行 × 7 节点 ⇒ 行边界在起作用） | `renderer-app/src/adapters/selfdraw.ts` · `layout-core-rust/src/ffi.rs` · `selfdraw-scene.swift` · `tests/selfdraw-text-patch.test.ts`（5 用例）· `hosts/ios/results/bench-filtered-S4.json` | ★**仍存边界**：跨行文本尺寸变化会带动后续行移位 ⇒ relayout 随行数增长（本例 2102 节点）；若要压到常数需行级平移传播（类B 同一课题） |
| 9 | **★★形状分叉是静默的（`text` 在 `style` 内 vs 顶层）** | ✅ **已闭（2026-09-28，实测两次踩到）**：① 适配器曾发顶层 `{id,text}` ⇒ Rust `StylePatch` 只认 `{id,style:{...}}` ⇒ serde 忽略未知字段、`applied` 照数 300 而**改动为零**（设备读数 `text_patches=300 / text_updates=0`）；② 修适配器后**宿主**仍在找顶层 `text` ⇒ `measures_injected=0` ⇒ 核心按旧尺寸算几何（字变长、盒子没变 ⇒ 字被裁）。⇒ 三处（适配器产出 / Rust 契约 / 宿主消费）统一为 `{id, style:{text}}`，并加**双向判据**：Rust `text_field_must_be_inside_style`（顶层不生效 + style 内生效）+ 设备侧不变量 `measure_invariant_ok`（有文本补丁 ⇒ 度量注入不得为 0） | `ffi.rs` 的测试 · `entry-bench.ts` 的 `measure_invariant_ok` | ★**纪律（新增）**：跨语言形状契约必须在**两端**各留一条判据——单端测试只能证明"自己那一半" |
| 7 | **★★增量路径不改文本 ⇒ 屏幕文字停留旧值（静默错显示）** | ✅ **已闭（2026-09-28，V6 暴露）**：增量路径此前只改 layer 的 **frame**，而文本内容在 `CATextLayer.string` 上 ⇒ 改文案后**核心几何已变、屏幕还是旧字**，且几何断言全绿（只有肉眼能发现）。全量重建路径不受影响（重建层时带新文本）⇒ 只改样式的用例一直发现不了。⇒ 修法：Rust `ApplyOutcome.text_updates` 回报（仅真的变了才记）+ FFI 序列化 + 宿主 `applyTextUpdates()` 落层 | `layout-core-rust/src/{ops_apply,ffi}.rs` · `selfdraw-scene.swift` · Rust 测试 `apply_ops_reports_text_updates` | — |
| 5 | **★S5 用例 fixture 失效（从未增删过一行）** | ✅ **已修（2026-09-28）**：`setCount` 只改 `count/size` 两个 ref，而 render 的行集是 `items.slice(0, Math.max(count, items.length))` ⇒ **缩小方向被整条抹平**。实测证据：grow_600 与 shrink_400 两条结果 `nodes` 都是 **3507**、字节都是 **279820** ⇒ 两次"结构变更"其实是**同一棵树的两次全量重发**。⇒ 改为 `setItems` 真正改行集 + 同用例 A/B 对照（同起点同幅度：500↔600 各跑 FULL 与 splice） | `hosts/ios/bridge/entry-bench.ts` 的 `S5_structure_change` | — |

| 10 | **★★relayout：每帧重建整棵 taffy 树（真增量的最大浪费）** | ✅ **已闭（2026-09-28）**：基准探针（`examples/taffy-floor-bench.rs`）证明**纯 taffy 求解同形状 2001 节点只要 0.015ms**，而本仓整树重排 3.15ms（**200×**）；逐层二分定位到：`relayout_multi` **每次调用都 `TaffyEngine::new()`** ⇒ 每帧重建整棵 taffy 树并**丢失其内部缓存**。<br>实测基准（同形状 2001 节点）：每轮新建 **2.96ms** → 复用引擎 + 只同步变更节点 **0.065ms**（**45×**）。<br>⇒ 引擎按**句柄**持久（线程局部 `ENGINES`——taffy 非 `Send`，不能进 `Mutex` 注册表），三入口（update/apply_ops/splice）共用；结构变更按 `taffy_id_len()` 判失效并重建。 | `layout-core-rust/src/ffi.rs` 的 `with_engine` · `taffy_engine.rs` 的 `persistent_taffy` · `ops_apply.rs` 的 `relayout_multi_in` · 基准 `examples/{taffy-floor-bench,relayout-multi-bench}.rs` | ★**仍存边界**：**范围**求解仍走"拷贝子树 + 独立子引擎"（实测比"在大树上解子树"快得多——taffy 的脏标记会向上传播到根，见 `layout_subtree_cached` 注释）⇒ 多范围形态下每范围仍有一次拷贝（`copy_ms` 0.13ms/300 范围，已很小） |
| 11 | **★测量纪律：性能断言进单测会因并发抖动假红** | ◐ **已标注（2026-09-28）**：`blob_scales_to_real_size_and_decodes_fast` 比较两次墙钟计时，`cargo test` 并行时偶发红（单独跑稳定 4.3×）⇒ 失败信息里已加"并发抖动 vs 实现退化"的判别提示 | `layout-core-rust/src/blob.rs` | 后续性能类断言建议**打上串行标记**（`#[serial]`）或改为"结构性判据"（如调用次数）而非墙钟比较 |

| 12 | **★★relayout 真凶：`build_taffy` 产物未存进 `persistent_taffy`** | ✅ **已闭（2026-09-28，真机 11.3×）**：诊断铁证 `engine_diag={"has_persistent":false,"cache_len":0,"taffy_len_before":5002}` ⇒ 每次增量重排都重建整棵 taffy 树 + 度量缓存为空。真机（V0_header · 5002 节点整树重排）：**relayout_ms 17.16 → 1.52**、**measure_calls 6003 → 0**、host_ms 52–58 → 36–38；三档（plain/memo/comp）读数恢复一致（1.52/1.55/1.52，此前 plain 恒慢 11× 被误读为"首轮成本"） | `taffy_engine.rs` 的 `layout()` · `ffi.rs` 的 `with_engine`/预建 · 真机 `bench-filtered-V0.json` | — |
| 13 | **★结构变更的引擎失效判据不能只看长度** | ✅ **已闭（2026-09-28，测试抓到）**：splice **摘除只断链不删节点** ⇒ `tree.len()` 不变 ⇒ 长度判据抓不到拓扑变化 ⇒ 引擎用"还连着被摘子树"的旧 taffy ⇒ 几何错。⇒ 由知道结构变了的调用方**显式 `invalidate_persistent()`** | `ffi.rs` 的 splice 路径 · 测试 `splice_remove_detaches_subtree` | — |
| 14 | **★内容寻址把"同文本不同字号"错误合并** | ✅ **已闭（2026-09-28，自查发现）**：缓存键原为 `(text_hash, max_w)`，而 `TableTextMeasurer` 是**按 nodeId 查表**（尺寸可因字号而异）⇒ 同文本 + 同宽约束但不同字号会被合并 ⇒ 其中一个尺寸错（实测：字号 16/28 两节点都算 16 高，差 12dp、**无报错**）。⇒ `style_key == 0`（字体不可区分）时**回退节点寻址**（正确 > 复用）；两条测试锁两个方向 | `taffy_engine.rs` 的 `compute_text_hashes` · 测试 `same_text_different_font_size_must_not_share_cache` + `same_literal_without_style_key_falls_back_to_node_addressing` | ★仍存边界：跨节点复用需宿主把字号编成 `style_key`（当前恒 0 ⇒ 复用关闭，属**保守取值**） |

| 15 | **★★文本的 `fontSize` 从未发给宿主（全部按 14pt 度量+绘制）** | ✅ **已闭（2026-09-28，实测发现）**：适配器 `fillSpec` 的**文本分支提前 `return`** ⇒ 只有元素分支透传 paint 字段。而 `h('p-text', {style:{fontSize:24}}, 'X')` 在 Vue 语义下渲染成 **`p-text` 元素 + 文本子节点** ⇒ 文本叶子拿不到字号 ⇒ 宿主 `?? 14` 兜底 ⇒ **16pt 标题与 13pt 说明长得一样**，且**两侧口径一致 ⇒ 不报错、几何自洽 ⇒ 长期隐身**。⇒ 文本叶子**继承父元素的 `fontSize`/`color`**（CSS 继承语义）。判据：V8 两条用例（fontSize 必须透传 / 不同字号必须不同 key） | `renderer-app/src/adapters/selfdraw.ts` · `tests/selfdraw-text-patch.test.ts` 的 V8 | — |
| 16 | **★★跨节点度量复用曾被关闭（同文本每行都真实度量）** | ✅ **已闭（2026-09-28）**：因"同文本不同字号被错误合并"（上条 #14）核心曾保守关闭内容寻址。修复方式：适配器按 `fontSize` 算出 **`textStyleKey`** 下发 ⇒ 字体维度**真的进键**后，内容寻址既安全又生效。<br>**真机证据（S1 挂载档）**：<br>· 1000 行：文本 2002，真实度量 **1004** / 命中 998（49.8%）<br>· 2000 行：文本 4002，真实度量 **1001** / 命中 3001（75.0%）<br>· 4000 行：文本 8002，真实度量 **2001** / 命中 6001（**75.0%**）<br>★`misses` 恰为「行数 + 1」⇒ **同文案只真实度量一次**（CoreText 调用量降 4×） | `adapters/selfdraw.ts` · `taffy_engine.rs` · `ffi.rs` 的 `text_style_key_enables_safe_content_addressing` | ★仍存边界：键目前只覆盖 `fontSize`（字重/字族未建模）——扩展时必须**同时**改适配器与宿主度量处 |

| 17 | **★★宿主层序自行推导（与核心分叉）** | ✅ **已闭（2026-09-28）**：宿主 `childrenById` 原为**自行**按各节点 `parentId` 归类（`buildLayers`）⇒ 与核心的 `children` 序分叉（实测 `首个差异@51: 宿主 6 vs 核心 5260`）。⇒ 新增 `applyChildOrder()`：**以核心 `child_order` 为单一事实来源**重建簿记 + 按核心顺序依次 `addSublayer` 重排层（`addSublayer` 对已在层的子层是"移到末尾" ⇒ 依次调用即得目标序）。<br>★**判据升级（关键）**：从"对自报簿记"改为**对真实 CALayer 子层序**——对自报簿记比较是**空判据**（刚被写过，必然相等）。<br>**破坏性验证**：关掉 `applyChildOrder` ⇒ 层序 `FAIL` + 精确复现 `差异@51`（证明：① 判据有牙齿 ② 该差异是**真实的层序错误**，此前被掩盖） | `selfdraw-scene.swift` 的 `applyChildOrder`/`reconcileChildOrderLegacy` · 真机 `bench-filtered-S5.json` | — |
| 18 | **★核心 splice 后缺少内部一致性自检** | ✅ **已补（2026-09-28）**：输入图校验只覆盖 **create 时**的输入；而 splice **改核心内部状态**（children 里 insert / 断链）⇒ 若漏改一侧，后续 build_taffy/收集/命中测试都在不一致的树上工作（无报错）。⇒ 新增 splice 后自检（children↔parent 双向）。**实测结论**：核心内部一致（100 项测试 + 真机三档全过）⇒ 差异@51 确为**宿主侧**问题，已由 #17 收口 | `ffi.rs` 的 splice 自检 | — |

| 19 | **★★删除不做内存回收（孤点在 Rust 数组里积压）** | ✅ **已闭（2026-09-28）**：摘除只断链（孤点留数组，功能正确但占内存）⇒ 新增 `compact_reachable()`（可达性重建 + 索引重映射）+ `TreeEntry::compact()`。<br>★**为什么可以安全重排数组下标**（依赖梳理）：所有外部引用都走**稳定 id**（指令流 `nodeId` / `last_scopes` / `changed_roots`），`id_to_idx` 是映射（重建即可），引擎 `taffy_ids` 按下标对齐 ⇒ 显式失效。<br>★**触发策略（amortized）**：孤点 ≥ 256 **且** > 存活的 1/8。均摊论证：触发时 `orphans > live/8` ⇒ 回收量 ≥ `live/8` ⇒ O(live) 的压实成本由"至少 live/8 次摘除"分摊 ⇒ **均摊 O(1)/次摘除**。<br>**真机判据（`S5_churn_cycles` · 10 轮「插 50 行/删 50 行」）**：压实 **5 次**、末轮**孤点 0**、峰值节点 **4909**（有界 ≈ 基准 3507 + 插入量）。<br>**破坏性验证**：关掉压实 ⇒ 测试红「最终 1701 节点（基线 101）」 | `node.rs` 的 `compact_reachable` · `ffi.rs` 的 `compact`/触发 · 测试 `splice_compacts_orphans_and_keeps_geometry_correct` · 真机 `S5_churn_cycles` | ★阈值按真机读数调过一轮：首版"孤点 > 存活一半"在 10 轮 churn 下**只触发 1 次**（末轮仍积 1050 孤点）⇒ 改为 1/8 |

| 20 | **★★事件系统未接线（自绘场景完全不能交互）** | ✅ **已闭（2026-09-28）**：核心 `hit.rs` 与 FFI `proteus_layout_hit_test`（返回 `target` + **冒泡链 chain**）**早已存在且跨端验证过**，但自绘场景**从未接线**——适配器 `patchProp` 对 `onXxx` **只计数不登记**（注释写"由核心命中测试 + 平台手势承担"，而那条链不存在）⇒ 屏幕上点任何东西都没反应。<br>⇒ 三段补齐：① 适配器**处理器表**（`nodeId → 语义事件名 → 处理器`）+ `normalizeEventType`（`onClick ≡ tap`、全小写归一）+ `dispatchEvent`（沿**核心给的 chain** 冒泡，支持 `stopPropagation`，异常**上报不吞**）；② 宿主 `SelfDrawView` 触摸（`touchesBegan/Ended` → **内容坐标** + tap 时序判定）+ 桥接层 `emitGesture`（调核心命中）+ `onDispatchToJS`（JSContext 直呼）；③ JS 侧 `__proteus_dispatch` 落点。<br>**判据（分两层）**：TS 10 条（归一化 4 + 派发/冒泡/停止传播/异常上报/移除清理 6，含破坏性验证 4 红）· **真机 `V9_event_dispatch` PASS**（注入 3 次 tap → 命中第 1/2/3 行 id 6/15/22 → JS 收到 3 次，**坐标与目标逐一匹配**）<br>**★诚实边界**：`tapAt` **绕过 UITouch**（复用 `emitGesture`）⇒ 覆盖「核心命中 → 外壳派发」；「UITouch → 内容坐标换算 + tap 时序判定」需人手/XCUITest（已在用例里标注 `not_covered`）。<br>**附带修复**：`onLongPress` 归一成 `longPress`（而 gesture 层发 `longpress`）⇒ **两边不匹配、事件静默不触发**；已统一全小写 | `renderer-app/src/adapters/selfdraw.ts` · `selfdraw-scene.swift` · `tests/selfdraw-event-dispatch.test.ts` · 真机 `bench-filtered-V9.json` | — |

| 21 | **★启动白闪（`UILaunchScreen` 空 dict ⇒ 系统背景色 = 白）** | ✅ **已闭（2026-09-28，用户观察驱动）**：用户反馈"应用启动会白屏一下"。排查：`Info.plist` 的 `UILaunchScreen` 是**空 dict** ⇒ iOS 用**系统背景色**（浅色模式 = **白**），而本应用是硬编码深色（`#101020` / 黑）⇒ 时序上出现 **白（启动屏）→ 黑（`viewDidLoad`）→ 深色内容** 的闪烁。<br>⇒ 修法：`UIUserInterfaceStyle = Dark`（**7 个 runner 脚本**一并修）。**为什么不塞启动图**：应用所有颜色都是硬编码深色 ⇒ 强制深色**语义正确**，且系统背景色随之变黑 ⇒ 启动屏与首帧连续。<br>**设备验证**：新增 `launch_diag` 读数 ⇒ `forced_style=Dark` · `interface_style=Dark` · `launch_screen_keys=[]`（证明外观已强制，系统背景=黑） | `hosts/ios/run-*.sh`（7 处）· `selfdraw-scene.swift` 的 `launchDiag` · 真机 `bench-filtered-V9.json` | ★**仍存边界**：`first_frame_ms` 读数当前为 0（`processStart` 初始化时机太晚——静态量在首次访问时才初始化，而非进程启动时）⇒ 要量"启动到首帧"需在 `main.swift` 或 `didFinishLaunching` 里打点（属后续） |

| 22 | **★★绘制属性变更无任何通道（颜色/圆角/字重改了不生效）** | ✅ **已闭（2026-09-28）**：`takePatches()` 只发布**布局**补丁（`layoutStyleOf` 只留 LAYOUT_KEYS）⇒ 纯绘制变更（颜色/圆角/字重/字号/透明度）**两边都不收**：布局补丁为空 + 宿主拿不到信息 ⇒ **层上颜色停留旧值**（静默错显示；几何断言全绿）。<br>⇒ 新增**第二条通道**：适配器 `takePaintPatches()`（输出**该节点的完整绘制快照**，缺省键为 `null` ⇒ 宿主可清除旧值）→ 宿主 `paintPatches()`（**不经核心**：paint 与几何无关，送核心是纯粹的多余）。<br>**判据**：TS 9 条（含"颜色不改几何 ⇒ 布局补丁必须为空"）+ **真机 `V10_paint_channel` PASS**（改行底色 → 布局补丁 **0** 条 · paint **1** 条 → 宿主应用 **1** 层 → 像素 **#00FF00**，`paint_ms=0.05`） | `renderer-app/src/adapters/selfdraw.ts` · `selfdraw-scene.swift` 的 `applyPaintPatches` · `tests/selfdraw-paint-patch.test.ts` · 真机 `bench-filtered-V10.json` | — |
| 23 | **★★fontWeight 端到端缺失（粗体按常规体渲染+度量）** | ✅ **已闭（2026-09-28）**：IR 层早已建模（`component-ir/pnode.ts` 的 `fontWeight`）但适配器 `PAINT_KEYS` **不含它** ⇒ 不下发；宿主又恒用 `UIFont.systemFont` / `CGFont("Helvetica")`。本仓已有真实用例（`packages/components/p-heading` 用 `fontWeight: 'bold'`）。<br>⇒ ① 适配器 `normalizeFontWeight`（`'normal'→400` · `'bold'→700` · 数字直传）+ **从父元素继承** + `textStyleKey` 改含字重（`fs*100*10000 + weight`）；② 宿主 `SelfDrawBridge.font(size:weight:)` **唯一字体构造**（绘制与度量同源）+ `measureText` 缓存键含字重。<br>**判据**：TS 2 条（透传 / 不同字重不同 key）+ Rust `different_font_weight_must_not_share_cache`（粗体 72 宽 vs 常规 60 宽不得共用缓存） | `adapters/selfdraw.ts` · `selfdraw-scene.swift` · `tests/selfdraw-paint-patch.test.ts` · `ffi.rs` | ★**仍存边界**：`fontFamily` 仍是 `L4_PASSTHROUGH`（仅 IR 透传，未接字体选择——需平台字体库映射，属后续）；字重的**像素级**对照（两支字体渲染同一文本）未做 |

### P1 · 影响覆盖可信度（不影响正确性）

| # | 边界 | 现状 | 建议 |
|---|---|---|---|
| 4 | ~~**Vue 版本兼容只测了 3.5.42**~~ | ✅ **已闭（2026-09-28）**：解析器做成**可注入** + 新增 `tests/vapor-vue-compat.test.ts`（5 个 SFC 样本 × 3 版 = 12 用例）⇒ **3.4.38 / 3.5.42 / 3.6.0-rc.9 产物逐字节相同**；并断言诊断（如无 `:key`）不因版本而异。★3.6 目前是 **RC**（非最终稳定版） | — |
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
| 13 | **★加读数时先确认端到端能读到非空** | 本轮为拿一条 `engine_diag` 折腾 4 轮（内联副本绕过统一入口 → 侧信道没写 → 宿主没透传 → JS 取错路径） |
| 14 | **★★"建了但没存"是静默的**（跨调用复用点必须验证状态真的留下） | `build_taffy` 产物未存 ⇒ 无报错，只表现为"优化没效果"（与度量表/文本回报同族） |
| 15 | **结构变更的失效判据不能只看长度**（splice 只断链不删节点） | `splice_remove_detaches_subtree` 抓到引擎用了旧树 |
| 16 | **跨语言/跨层形状契约两端各留判据** | `text` 顶层 vs `style` 内：单端测试只能证明自己那一半 |

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
