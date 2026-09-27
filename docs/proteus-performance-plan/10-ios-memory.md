# iOS 内存专项：诊断与结论汇总

> **本文回答**：iOS 侧「CALayer 方案内存高出原生 78%」的**真正主因是什么、怎么修、实测收益多少**。
> 源自两份调研文档（用户提供）经**本仓真机实测**验证后的结论综合：
> `docs/Proteus_App端高性能渲染落地方案.md` §12（技术规格）· `docs/iOS端内存诊断Checklist.md`（诊断流程）。
> **实验代码**：`hosts/ios/experiments/device/`（`bash hosts/ios/experiments/device/measure-memory.sh` 可复跑）
> **数据文件**：`hosts/ios/experiments/results/summary.json`（权威口径，入库）
> **环境**：真机 iPhone 12（iPhone13,2）· iOS 26.3 · 4050 元素场景（2050 view + 2000 text + 50 行）

---

## 0. 结论速览

| # | 问题 | 结论 |
|---|---|---|
| 1 | 「CALayer 比 UIView 费内存」？ | ❌ **错误**——仅色块对照：CALayer **4.9MB** 反而**比** UIView **9.9MB** 省 |
| 2 | 那 78% 的差距从哪来？ | ✅ **CATextLayer 的 backing store 走 sRGB 全通道**（每个文本层约 90KB 位图 × 2000 = 180MB） |
| 3 | 怎么修（按实测收益） | ① **拍平**：186.7 → **17.7MB（−91%）** ② **`gray8Uint`**：−39% ③ **结构用 layer + 文本用系统 label**：−49% |
| 4 | 哪个是**主路径**？ | ✅ **拍平**——且它**同时**最优：耗时 **129.9ms**（比 CALayer 快 32%）+ 内存 **17.7MB** |
| 5 | `isOpaque` 有用吗？ | ❌ **实测无效**（187.0 ≈ 186.9）——只省 alpha 通道，不减分配 |

---

## 1. 三层隔离：怎么把主因一步步逼出来的

初版结论「CALayer 比 UIView 多 78%」**有两个混淆变量**，必须逐层拆开才能定位真因：

| 层 | 被隔离的变量 | 对照设计 |
|---|---|---|
| ① | **view vs layer**（结构对象类型） | 只放色块、不放文本：F（CALayer）vs G（UIView） |
| ② | **文本渲染器**（谁在绘制文本） | 同一 CALayer 结构下：CATextLayer（C）vs 系统 UILabel（I） |
| ③ | **backing store 格式**（怎么分配位图） | 同一 CATextLayer 下：默认 sRGB（C）vs `gray8Uint`（J）· 加 `isOpaque`（K） |

### 1.1 完整矩阵（11 变体，进程隔离测量，各轮波动 <0.5%）

| 变体 | 构造 | 增量内存 | 隔离出的结论 |
|---|---|---|---|
| A | UIView + AutoLayout（共享文本） | 104.7 MB | 原生基线 |
| B | UIView + 手算 frame（共享文本） | 100.9 MB | 去掉 AutoLayout：−4% |
| C | CALayer + **CATextLayer**（共享文本） | 186.9 MB | ← 症状复现（+79%） |
| D | UIView + 手算（**唯一文本**） | 101.0 MB | 文本唯一化对 UIView 几乎无影响 |
| E | CALayer + **CATextLayer**（**唯一文本**） | 221.7 MB | 文本唯一化只让 layer 组多 35MB |
| **F** | **CALayer 仅色块（无文本）** | **4.9 MB** | ★ **layer 结构本身极省** |
| **G** | **UIView 仅色块（无文本）** | **9.8 MB** | ★ CALayer **比 UIView 省一半** |
| **H** | **★ 拍平：一行一 layer（文本绘制进父级）** | **17.7 MB** | ★ **最优解** |
| **I** | **CALayer 结构 + UILabel 文本** | **96.0 MB** | ★ **主因是 CATextLayer，不是 CALayer** |
| **J** | CATextLayer + **`contentsFormat = .gray8Uint`** | **114.9 MB** | ★ **−39%（省 72MB）** |
| K | CATextLayer + **`isOpaque`** | 187.0 MB | ❌ **无效** |

### 1.2 三个决定性判读

**① F(4.9) < G(9.8)：CALayer 结构本身更省**
⇒ 原结论「CALayer 费内存」**方向就错了**。UIView 额外承担事件处理、布局管理、Responder Chain，
而 layer 是纯渲染对象。这与方案文档 §附「CALayer 较 UIView 轻量」的表述一致，但**本仓此前误把
文本渲染器的开销归给了 layer 结构**。

**② I(96.0) ≈ B(100.9) ≪ C(186.9)：主因是文本渲染器**
同一 CALayer 结构下，文本用系统 `UILabel` 只花 **96.0MB**（甚至**比纯 UIView 方案还省 5%**）；
换成 `CATextLayer` 就涨到 **186.9MB**。⇒ **90MB 的差值来自 CATextLayer 的位图分配策略**。

**③ J(−39%) 有效、K(0%) 无效：修复点在 `contentsFormat`**
这**证实了 Checklist §P0-1 的假设**：
> 系统 `UILabel` 对单色 string 做了优化，可节省约 75% 的 Backing Store；
> 若自绘路径默认走 sRGB 全通道，则**每个文本 layer 比系统 UILabel 多消耗约 4 倍内存**。

`isOpaque` 无效也符合原理：它只让 backing store **省略 alpha 通道**，并不减少分配动作。

---

## 2. 修复路径（按实测收益排序，可直接执行）

| 序 | 措施 | 实测收益 | 适用面 | 代价 / 约束 |
|---|---|---|---|---|
| **1** | **拍平**：不创建子 layer，文本绘制进**父级已有**的 backing store | 186.7 → **17.7 MB（−91%）**<br>耗时 190.5 → **129.9 ms（−32%）** | 静态子树（无事件/无 transform/非动画目标） | **拍平节点不支持事件、截图 API、z-index**——须 IR 层判定 + 编译期报错 |
| **2** | **`contentsFormat = .gray8Uint`** | −39%（省 72MB） | 单色文本 / 单色块 | 需在 IR 层推导 `isMonochrome`；彩色内容不可用 |
| **3** | **结构用 CALayer + 文本用系统 label** | 186.9 → 96.0 MB（−49%） | 所有文本节点 | 需宿主视图承载 label（CALayer 不能直接持有 UILabel）⇒ 与纯 layer 方案混用 |
| 4 | `contents` 共享（同图多层） | 未测（无重复图片场景） | 重复图标/装饰 | 需 image 缓存池 |
| 5 | `backgroundColor` 直设（不进绘制流程） | ✅ **架构上天然满足**（F 变体 4.9MB 佐证） | 所有纯色背景 | 无 |
| — | `isOpaque` | ❌ **无效** | — | — |
| — | `shouldRasterize` | 未测；文档警告缓存上限 2.5× 屏幕、~100ms 淘汰 | 结构复杂且**完全静态** | 用错比不开更差，**默认关闭** |

### 2.1 ★「真拍平 vs 假拍平」——判据（重要）

方案文档 §12.3 的警告经本仓实测**验证成立**，并补出一条可执行判据：

| 实现 | layer 数 | **backing store 总数** | 内存 | 结论 |
|---|---|---|---|---|
| **真拍平**：不创建子 layer，绘制到**父级已有的** backing store | ↓ | **↓** | ↓ | ✅ 本仓 H 变体即此形态（4050 元素 → **50 块**位图） |
| **假拍平**：为合并而**新建一张合成位图** | ↓ | **↑** | ↑↑ | ❌ 禁止 |

> **判据**：验证拍平是否有效——**看 backing store 总数是降了还是涨了**，
> 不能只看 layer 数（假拍平同样减少 layer 数，但位图总量反而上升）。
> 业内真实教训：曾有实现把三张小图合并绘制到一张大图，内存暴涨，最终改回多视图。

---

## 3. 最终路线对比（耗时 × 内存，真机实测）

| 路线 | 耗时 | 增量内存 | 与基线比 |
|---|---|---|---|
| A UIView + AutoLayout | 525.1 ms | 104.7 MB | 基线 |
| B UIView + 手算 frame | 365.2 ms | 100.9 MB | 耗时 −30% · 内存 −4% |
| C CALayer + CATextLayer | 190.5 ms | 186.9 MB | 耗时 −64% · 内存 **+79%** ❌ |
| I CALayer 结构 + UILabel 文本 | 未测耗时 | 96.0 MB | 内存 **−8%** ✅ |
| **H ★ 拍平（一行一 layer）** | **129.9 ms** | **17.7 MB** | 耗时 **−75%** · 内存 **−83%** ✅ |

**⇒ 拍平是唯一**在两项指标上同时最优的方案**（不是此消彼长）**：
4000 个元素 → **50 个绘制对象** ⇒ backing store 总量降两个数量级，
同时省掉大量独立 layer 的合成开销（这解释了它为何也更快）。

**验收对照（方案 §9.2 合格线「增量内存 ≤ 原生」）**：
- ✅ H 拍平：×0.17（大幅达标）
- ✅ I 混合：×0.92（达标）
- ✅ B 手算 frame：×0.96（达标）
- ❌ C 纯 CATextLayer：×1.79（不达标，须先做 §2 的 1/2/3 修复）

---

## 4. 与业界做法的一致性（调研核实，均带来源）

| 框架/方案 | 机制 | 与本文的关系 |
|---|---|---|
| **uni-app x 蒸汽模式** | `flatten`＝「**不创建独立元素，而是绘制在父上**」；路线为「原生渲染管线 + 自研 UI 框架」，**非自绘** | 与 H 变体同构；其官方 benchmark 亦声称拍平后内存低于原生 view |
| **Texture（Pinterest）** | `shouldRasterizeDescendants` / 子树光栅化：**不创建**子 view/layer；`interfaceState`（Preload/Display/Visible）驱动 contents 释放 | 对应 §2 措施 1 与未测的「滚动回收」 |
| **ArkUI（鸿蒙）** | `markNodeGroup` 子树合并绘制；`RenderNode` 轻量节点 | 同「拍平」思路 |
| **RN Fabric** | View Flattening（diff 阶段合并纯布局节点） | 同「拍平」思路，但 RN 未做文本级合并 |
| **Apple 官方** | `contents` 共享可「prevent the layer from allocating memory for a backing store」；`contentsFormat` 支持 `gray8Uint` | 对应 §2 措施 2 / 4 |

> **未找到**：公开的「UIView vs 裸 CALayer」同内容内存对比数据（本文 F/G 变体是该对比的**自有基线**）。

---

## 5. 未测项（诚实边界，勿当已完成）

| 项 | 为什么未测 | 何时补 |
|---|---|---|
| **S2 长列表滚动内存收敛性** | 本文场景是静态页（4050 元素）；滚动需 `list-view` 复用池实现 | M3（列表复用）+ §12.6 生命周期状态机落地后 |
| **离屏渲染占比** | 需 Instruments 的 Color Offscreen-Rendered（无法代码自动跑） | M4 首轮真机调试 |
| **S3 真实业务页**（含图片/圆角/阴影） | 需真实页面素材 | M4 |
| **`contents` 共享收益** | 本文无重复图片场景 | 有图标/装饰复用场景时 |
| **原生对照严格性** | 「原生」用本仓 A 变体（UIView + AutoLayout）实现，**非**手写 UIKit 最优实现 | 需严格对外宣称时 |

> **不得对外宣称**：本文数字均为**本仓等价实现**间的对照（真机 iPhone 12）。
> 「比原生快/省」的表述须限定为「比 UIView + AutoLayout 基线」，
> 且**不得作为对外性能宣称**（方案文档 §9.2 的诚实边界同样适用）。

---

## 6. 与两份来源文档的关系

| 文档 | 定位 | 本文的作用 |
|---|---|---|
| `Proteus_App端高性能渲染落地方案.md` §12 | **技术规格**（M4 阶段要实现的 paint-hint / materialize / 状态机等） | 本文为其 §12.1–12.3 提供**实测验证与修正**（尤其「主因不是 CALayer」） |
| `iOS端内存诊断Checklist.md` | **诊断流程 SOP**（六阶段 + 决策树） | 本文跑完了其 §2 的三个数字（S1 部分）与 §P0-1/2/4；**结论已回填该 Checklist** |
| 本文 | **结论汇总**（诊断结果 + 修复排序 + 路线对比） | —— |

**执行顺序建议**：读 Checklist 了解方法 → 读本文拿结论 → 按方案 §12 实现 M4。
