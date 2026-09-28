# iOS 端内存诊断 Checklist

> 适用：Proteus NativeVapor 后端 iOS 绘制层（CALayer + 手算 frame 方案）
> 症状：渲染性能超过原生，但**内存占用高出原生 78%**
> 目标：定位内存构成 → 执行 P0 修复 → 内存增量降至 ≤ 原生 × 1.15
> 预计耗时：**诊断 0.5 天，P0 修复 + 复测 1 天**
>
> ---
> ### ★本仓已预跑实测（2026-09-29，真机 iPhone 12 / iOS 26.3）——可跳过部分诊断
>
> 用 `hosts/ios/experiments/device/measure-memory.sh`（进程隔离，每次启动只测一个变体）
> 跑了 **11 个变体**，结论如下（完整数据见 `proteus-performance-plan/09-ios-route-validation.md` §2.6）：
>
> | 变体 | 增量内存 | 对应 Checklist 项 |
> |---|---|---|
> | A UIView + AutoLayout | 104.6 MB | 对照基线 |
> | B UIView + 手算 frame | 100.9 MB | |
> | C CALayer + **CATextLayer** | 186.9 MB | ← 你诊断的「78% 症状」就是这条 |
> | **I CALayer 结构 + UILabel 文本** | **96.0 MB** | ⇒ **主因是 CATextLayer 而非 CALayer**（比 B 还省） |
> | **J CATextLayer + `gray8Uint`** | **114.9 MB** | ✅ **§P0-1 证实有效（−39%，省 72MB）** |
> | K CATextLayer + `isOpaque` | 187.0 MB | ❌ **§P0-4 的 opaque 项无效**（与研究一致：只省 alpha，不减分配） |
> | F CALayer 仅色块 | 4.9 MB | ⇒ §P0-2 天然满足（backgroundColor 不进 backing store） |
> | G UIView 仅色块 | 9.8 MB | ⇒ **CALayer 结构比 UIView 更省** |
> | **H ★拍平（一行一 layer）** | **17.7 MB** | ⇒ §5.1「真拍平」，**最优解** |
>
> **对应你文档的判断**：
> - §2.3「backing store 占比 >60% 即主因」→ **已确认**（180MB 差 ≈ 2000 个 CATextLayer 的位图）；
> - §P0-1（`contentsFormat`）→ **已验证有效，降 39%**；
> - §P0-2（纯色背景不进绘制）→ 架构上已满足；
> - §P0-3（`contents` 共享）→ **未测**（无重复图片场景）；
> - §P0-4（`isOpaque` / `shouldRasterize`）→ `isOpaque` 实测**无效**；离屏渲染需 Instruments（未测）；
> - §5.1（真/假拍平）→ **已验证**：H 是「真拍平」（50 块位图而非 4000 块）；
> - §5.2（懒创建 materialize）→ ★**已实现**（2026-09-28：虚拟化只物化可见+预载行，3002 节点 → 44 层）；
>   §5.4（三档状态机）→ **核心已实现 + iOS 宿主已接线 + S2 内存收敛已实测**（`recycle.rs` + Android 落地 + `mountVirtual`/`scrollRows`；真机 `V12` PASS · `V14` 3 个来回净降 1.3MB ⇒ **本节全部闭合**）；
> - §6.1 验收（内存 ≤ 原生 × 1.15）→ **H 路线 −83%、I 路线 −8% 均达标**；
>   C 路线 +79% 不达标。
>
> **性能对照（同批实测）**：A 525ms · B 365ms · C 190ms · **H 130ms**
> ⇒ **拍平同时赢得耗时与内存**（不是此消彼长）。
>
> ---

## 使用说明

**严格按顺序执行，禁止跳步。** 前三步是诊断，拿到数字之后才允许动手改代码。

业界真实教训：曾有实现把三张小图合并绘制到一张大图以优化渲染，结果内存暴涨，最终改回多视图实现。**凭直觉优化内存，大概率做错方向。**

每一步都有「记录」栏，请填入实测数字。没有数字的结论不进入下一步。

---

## 阶段一：准备（≈30 min）

### 1.1 环境与版本

- [ ] 使用 **release 包**（Debug 模式的内存与性能数据均无效）
- [ ] 记录设备型号、iOS 版本、屏幕 scale（2x / 3x）
- [ ] 记录基础库 / 引擎版本

设备：`______________`  iOS：`______________`  scale：`______________`

### 1.2 对照组

- [ ] 准备**原生 UIKit 实现**的同一测试页面（对照组）
- [ ] 准备 **Proteus NativeVapor** 实现（实验组）
- [ ] 两者业务内容、数据量、交互路径完全一致

### 1.3 测试场景（三个都要测）

| 场景 | 说明 | 用途 |
|---|---|---|
| S1 静态页 | 4050 元素（2050 view + 2000 text），不定宽高 | 测 backing store 基线 |
| S2 长列表 | 4000 行，滚到底部再回滚到顶部 | 测复用与增长 |
| S3 真实业务页 | 含图片、圆角、阴影 | 测离屏渲染与图片内存 |

---

## 阶段二：拿到三个数字（≈2 h）

### 2.1 Allocations → Dirty Size

操作：Instruments → Allocations → 勾选 `Record reference counts` → 筛选 `Dirty Size`

- [ ] 记录 S1 稳定后实验组 Dirty Size
- [ ] 记录 S1 稳定后对照组 Dirty Size
- [ ] 记录差值

| 场景 | 原生（对照） | Proteus（实验） | 增量 |
|---|---|---|---|
| S1 静态页 | 104.6 MB（UIView+AutoLayout） | 186.9 MB（CALayer+CATextLayer）→ **17.7 MB（拍平）** | +79% → **−83%** |
| S2 长列表滚动后 | 未测 | 未测 | — |
| S3 真实业务页 | 未测 | 未测 | — |

> 注：上表的「原生对照」用的是本仓 A 变体（UIView + AutoLayout），
> 与严格意义的「手写 UIKit 最优实现」可能有差距——这是本仓数据的诚实边界。

**判断**：若 S1 增量就已接近 78%，说明是**结构性**问题（每个 layer 都贵），直接进阶段三。
若 S1 增量小但 S2 持续增长，说明是**复用/回收**问题，跳到 §5.4。

### 2.2 Layer 总数

操作：运行时打点统计 CALayer 实例数（建议在绘制层加计数器）

- [x] S1 场景 layer 总数：`50`（拍平路线）/ `4000+`（未拍平）
- [x] 节点树节点总数：`4050`
- [x] 拍平率 = (节点数 − layer 数) / 节点数：`98.8 %`（拍平路线）

**判断**：拍平率 < 50% 说明 flatten 判定未生效，先查 §5.3，再继续内存诊断。

### 2.3 Backing Store 占用（关键）

估算公式：`backing store 尺寸 = bounds 宽 × scale × bounds 高 × scale × 每像素字节数`

每像素 4 字节（RGBA）。参考值：iPhone 6 全屏一块约 **3.4 MB**。

- [x] 统计所有 layer 的 `bounds` 总和，估算理论 backing store 占用：`≈180 MB`
      （2000 个 CATextLayer，各约 90KB：`w×3 × h×3 × 4B`）
- [x] 与 §2.1 实测 Dirty Size 对比，估算 backing store 占比：`≈96 %`
      （186.9 − 4.9 = 182MB 差 / 186.9MB 总）

**判断**：若 backing store 占 Dirty Size 的 **60% 以上**，确认主因在此，执行阶段四 P0-1 / P0-2。

---

## 阶段三：离屏渲染定位（≈1 h）

操作：Xcode → Debug → View Debugging → Rendering，或 Instruments Core Animation，打开以下开关：

- [ ] **Color Offscreen-Rendered Yellow** → 黄色区域数：`______________`
- [ ] **Color Blended Layers** → 红色混合区域数：`______________`
- [ ] **Color Misaligned Images** → 非像素对齐数：`______________`
- [ ] **Color Hits Green and Misses Red** → 红色（缓存未命中）数：`______________`

### 判定规则

| 现象 | 根因 | 修复项 |
|---|---|---|
| 大量黄色 | 离屏渲染 | P0-4 |
| 红色 miss 多于绿色 hit | `shouldRasterize` 用错（内容频繁变动） | 关闭光栅化 |
| 大量红色混合层 | 存在不必要透明层 | 设 `opaque = YES` + 不透明 `backgroundColor` |
| 大量 misaligned | 尺寸非整数或 scale 不匹配 | P2 |

**注意**：黄色区域每处都对应一块额外的 Offscreen Buffer，这是内存大户。

---

## 阶段四：P0 修复（按此顺序，逐个验证）

> **每做完一项立刻复测 §2.1 的 S1 数字**，记录下降幅度。这样可以精确定位哪一项是主因。

### P0-1 · 显式设置 contentsFormat（预期收益最大）

**原理**：系统 `UILabel` 对单色 string 做了优化，**可节省约 75% 的 Backing Store**。iOS 12 起系统会按实际色彩空间动态调整 backing store 大小；若自绘路径默认走 sRGB 全通道，则**每个文本 layer 比系统 UILabel 多消耗约 4 倍内存**。

- [ ] 对**纯色文本**、**纯色块**等单通道内容，设置紧凑 `contentsFormat`
- [ ] 确认设置生效（复测 §2.1 的 S1）

S1 修复后：`114.9 MB`（较修复前下降 `39 %`）✅ **已验证有效**

### P0-2 · 纯色背景绝不进绘制流程

**原理**：`backgroundColor` **不需要绘制到 backing store**，它直接画到 frameBuffer。若为了统一走自绘而把纯色背景也画进 backing store，**每个背景节点都在白白分配一块位图**。

- [ ] 审计绘制层：纯色背景是否走了 `drawRect` / 自定义绘制路径
- [ ] 改为直接设置 layer 的 `backgroundColor`

S1 修复后：`4.9 MB`（仅色块变体，架构上天然满足：`backgroundColor` 不进 backing store）

### P0-3 · 用 contents 替代 drawRect

**原理**：将 image 设为 `contents` 可**阻止图层为 backing store 申请内存**——图层直接使用该 image 作为 backing store。多个 layer 使用同一 image 时**共享内存**，而非各自开辟一份。

- [ ] 图标、重复装饰元素改为设置 `contents`
- [ ] 建立 image 缓存池，相同资源复用同一 CGImage

S1 修复后：`______________ MB`（较修复前下降 `______________ %`）

### P0-4 · 消灭离屏渲染

- [ ] 阴影**必须**设 `shadowPath`（Core Animation 据此缓存阴影，形状不变时大幅减少重复渲染）
- [ ] 避免 `cornerRadius` + `masksToBounds` **同时**开启
- [ ] 避免 `layer.mask`

**`shouldRasterize` 硬性约束**（默认关闭，仅在满足全部条件时启用）：

| 约束 | 说明 |
|---|---|
| 至少触发一次离屏渲染 | 内容简单的 layer 开启反而更差 |
| 缓存上限 = 屏幕总像素 **2.5 倍** | 超限即失效 |
| 有失效时间 | 业界资料口径 100ms～1000ms 不等，短时未使用即丢弃 |
| 内容必须静态 | resize / 动画会导致缓存失效，回到每帧离屏 |
| 必须设 `rasterizationScale` | = `UIScreen.main.scale`，否则 Retina 下模糊 |

S1 修复后：`187.0 MB`（`isOpaque` 实测**无效**——与研究一致：只省 alpha 通道，不减分配；离屏渲染需 Instruments，未测）

---

## 阶段五：结构性问题（仅当阶段四后仍不达标）

### 5.1 ⚠️ 先排查拍平是否是"假拍平"

**这是最容易踩的反直觉陷阱**：拍平有两种实现，只有一种是优化。

| 实现 | layer 数 | 内存 | 结论 |
|---|---|---|---|
| **真拍平**：不创建 layer，绘制到**父 layer 已有的** backing store | ↓ | ↓ | ✅ |
| **假拍平**：合并多个节点到**一张新建位图** | ↓ | **↑↑ 暴涨** | ❌ 禁止 |

- [ ] 审计绘制层：拍平是否新建了合成位图
- [ ] 若是，改为复用父级 backing store

### 5.2 懒创建（materialize）

**原理**：Texture 的 `ASDisplayNode` 创建时**不会立即新建 UIView / CALayer**，直到主线程第一次访问时才生成。

- [ ] 仅 Display / Visible 状态的节点 materialize 成 CALayer
- [ ] C++ 节点树与 CALayer 完全解耦（Proteus 架构天然支持）

layer 数：`______________` → `______________`

### 5.3 IR 层 paint-hint 校验

- [ ] `isMonochrome` 是否正确推导（纯色内容 → 紧凑格式）
- [ ] `isPureBackground` 是否正确推导（纯色背景 → 不分配 backing store）
- [ ] `shareableContent` 是否正确推导（可共享图形 → contents 共享）
- [ ] `staticSubtree` 是否正确推导（完全静态 → 允许拍平）

**验证方法**：随机抽查 20 个节点的 paint-hint 推导结果与人工判断的一致性。
一致率：`______________ %`

### 5.4 生命周期状态机（复用与回收）

借鉴 Texture `ASRangeController` 三档状态：

| 状态 | 行为 | 内存策略 |
|---|---|---|
| Preload | 异步加载数据 | 缓存显示数据 |
| Display | 开始渲染（文本光栅化、图片解码） | 保持渲染缓存 |
| Visible | 维持高质量资源 | 保持高质量缓存 |
| 退出可见 | 逐步降级 | **释放资源 / 回收 layer** |

- [x] 实现三档状态机 —— ✅ **已实现**（⚠ 本节曾在 2026-09-28 核实中修正：原文标未做，实际已有）
      `packages/layout-core-rust/src/recycle.rs`（`Lifecycle::{Preload,Display,Visible}` + 退出可见降级 +
      `RecyclePool`）+ `lib.rs` 导出 + `ffi.rs` 的 `proteus_recycle_bench`；Android 执行侧
      `hosts/android/.../MainActivity.java` 的 recycle 路径
- [x] **滚动方向变化时动态交换前后预加载区域**（leading 区域 >> following 区域）—— ✅ **已实现**
      （同文件：方向敏感窗口）⇒ 真机证据 `hosts/android/results/layout-recycle.json`
      （4000 行 **reuse_ratio 0.9947**）
- [x] ★**接进 iOS 自绘宿主（2026-09-28）** —— ✅ `ffi.rs` 的 `proteus_recycle_{create,update,stats,destroy}`
      （**核心只给决策**：本帧 acquire/release 哪些行 + 方向；**平台只执行动作**）+ `selfdraw-scene.swift`
      的 `mountVirtual`/`scrollRows`（虚拟化：3002 节点 → 只物化 **14 行/44 层** · 建层 **74** / 复用 **1554**
      · 层数恒定 · 真机 **`V12_scroll_recycle` PASS**）。**破坏性验证**：池容量置 0 ⇒ 复用增量 0、建层增量 174
      ⇒ 同时闭合了 §5.2 的**懒创建 materialize**（只物化可见+预载行，见该节）
- [x] **复测 S2 内存收敛** —— ✅ **已闭（2026-09-29）**
- [x] 复测 S2：滚动到底再回滚，内存应**收敛**，不持续增长

S2 滚动 3 个来回后内存：**18.0 MB**（首轮 19.3 · 峰 19.4 · **净降 1.3** ⇒ 收敛：**是**）

★**判据设计（"收敛"是趋势，不是单点）**：单点读数无法判定收敛——一个每轮增长 2MB 的实现
在第 1 轮也可能"很低"。⇒ 用 `V14_s2_memory_convergence` 跑 **3 个完整来回**逐步采样
`phys_footprint`（`mem_mb` 由宿主在滚动动作的**同一处**取，保证读数与该步层状态同源）：

    19.3 → 19.3 → 19.4 → 19.4 → 17.9 → 18.0 MB

★**反向判据**（防"什么都没做"）：滚动期间必须有**真实层增删**（实测 churn **7134** 次、
`layers_reused` 持续增长）——否则"内存没涨"只是因为**根本没在滚动**（本仓见过的空判据形态）。
另两条守边界：层数恒定 **44**（虚拟化未退化成全量物化）· 复用率 > 0.5。

★**诚实边界**：只测了**虚拟化路径**；非虚拟化（全量物化）路径的内存收敛未测；
`phys_footprint` 是**整进程**口径，未做 backing store / 光栅缓存的 Instruments 级细分。

### 5.5 图片与几何

- [ ] 图片按显示尺寸 **downsample**（几十像素的头像不得持有几千像素解码位图）
- [ ] 异步解码 + 缓存位图
- [ ] layer 宽高设**整数**，减少抗锯齿开销
- [ ] 非文本内容使用与显示匹配的 `contentsScale`，不必强上 3x

---

## 阶段六：复测与门禁

### 6.1 验收标准

| 指标 | 合格线 | 目标 | 实测 |
|---|---|---|---|
| **iOS 端内存增量 vs 原生** | **≤ 原生 × 1.15** | ≤ 原生 × 1.0 | **拍平 −83% ✅ / I 路线 −8% ✅ / C 路线 +79% ❌** |
| 离屏渲染 layer 数 | 0 | 0 | 未测（需 Instruments） |
| 拍平率（4050 场景） | ≥ 50% | ≥ 70% | **98.8% ✅** |
| S2 滚动后内存增长 | 收敛 | 完全持平 | 未测（需长列表滚动场景） |
| **渲染性能（不得回退）** | 仍优于原生 | 保持修复前水平 | **拍平 130ms vs 原生 AutoLayout 525ms ✅** |

> ⚠️ **渲染性能与内存必须同时满足**。不允许以牺牲内存换取渲染性能的方式通过验收。

### 6.2 纳入 perf-ratchet

- [ ] 上述指标全部纳入 ⚠ **`@proteus-vue/perf-ratchet`（该包不存在——2026-09-28 核实）**；实际门禁为三个：
`scripts/check-vapor-perf.mjs`（`check:vapor-perf`，Vapor 性能棘轮）· `hosts/ios/bench.mjs`（`check:ios-perf`）·
`scripts/check-ios-experiment-docs.mjs`（文档数字↔`summary.json` 对账）。**内存尚未纳入任何棘轮**（缺口） CI 门禁
- [ ] 内存回退超过阈值即阻断合并

---

## 快速归因决策树

```
S1 增量是否 > 50%？
├─ 是 → backing store 占 Dirty Size > 60%？
│       ├─ 是 → 【主因】执行 P0-1 → P0-2 → P0-3
│       └─ 否 → 查离屏渲染（阶段三）→ P0-4
└─ 否 → S2 滚动后是否持续增长？
        ├─ 是 → 【主因】复用/回收 → §5.2 懒创建 + §5.4 状态机
        └─ 否 → 查图片内存 → §5.5 downsample
```

---

## 常见错误（执行前必读）

| # | 错误 | 后果 |
|---|---|---|
| 1 | 跳过诊断直接优化 | 方向错，白干数天 |
| 2 | 用 Debug 包测内存 | 数据完全无效 |
| 3 | 把合并绘制当成拍平 | 内存暴涨（已有多起真实案例） |
| 4 | 滥用 `shouldRasterize` | 缓存频繁失效，比不开更差 |
| 5 | 纯色背景走自绘 | 每个背景节点白分配一块位图 |
| 6 | 只测 S1 不测 S2 | 漏掉复用问题 |
| 7 | 只优化内存不看渲染性能 | 违反验收标准，需返工 |

---

## 记录表（汇总）

| 阶段 | 指标 | 初始 | 最终 | 降幅 |
|---|---|---|---|---|
| S1 静态页 Dirty Size | MB | | | |
| S2 长列表 Dirty Size | MB | | | |
| S3 业务页 Dirty Size | MB | | | |
| Layer 总数 | 个 | | | |
| 离屏渲染数 | 处 | | | |
| 渲染耗时（4050） | ms | | | |

**主因结论**：`______________________________________________`

**修复项有效性排序**（按实测降幅）：
1. `______________________`（降 `______%`）
2. `______________________`（降 `______%`）
3. `______________________`（降 `______%`）
