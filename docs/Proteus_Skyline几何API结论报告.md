# Proteus Skyline 几何 API 结论报告（VC0）

> 卡片：`docs/Proteus_一致性校验任务卡清单.md` · 卡 VC0（优先级 ⭐ 一票否决）
> 装置：`spike/vc0-skyline-geom/`（最小变量——原生小程序，不经 Proteus 编译）
> 原始证据：`spike/vc0-skyline-geom/results/*.txt`（automation_evaluate 完整回执留档）
> 日期：2026-10-02 · 环境：微信开发者工具（macOS）· 基础库 3.0.0 / 3.4.6 / 3.6.6

---

## 0. 结论（先读这里）

| 问题 | 结论 |
|---|---|
| **Skyline 下 `boundingClientRect` 可用吗** | ✅ **完全可用 —— 结论 A**（本环境实测：不再复现社区「全为 0」） |
| 可用条件 | ① 选择器用 **id / class**；② 组件内查询用**实例句柄**（`scope.createSelectorQuery()` 或 `wx.createSelectorQuery().in(inst)`）；③ 时机不敏感（`attached`/`ready`/`onReady`/延迟 全有值） |
| 受影响形态 | **属性选择器 `[data-*]` 与 tag 选择器恒返 `null`**（不是 0——是"查不到"，与选择器不匹配语义一致）。这正是「全为 0」类反馈最可能的根因之一 |
| 探针可注入性 | ✅ **允许**：页面/组件 JS 直接写 `globalThis.__VC0_INJECTED__`，`automation_evaluate` 同上下文可回读——**查询 API 与产出式探针两条路都通** |
| VC4-c 怎么设计 | **不必**被迫走产出式探针；但两者都用（查询 API 做对账、产出式探针做持续采集），见 §5 |

**诚实边界（本报告未覆盖）**：真机（Android / iOS / 鸿蒙 OS 版）未实测——需用户微信扫码预览/真机调试；
本结论仅覆盖**开发者工具模拟器**。卡片要求的真机矩阵项保留为待验（见 §6）。

---

## 1. 实测矩阵（与卡片要求逐项对应）

| 维度 | 取值 | 结果 |
|---|---|---|
| 渲染模式 | Skyline / WebView | **两者都可用**（几何值正确） |
| 组件类型 | `view` / `text` / `image` / `scroll-view` | **4 类全可取**（含 `scroll-view` 的 `scrollOffset`：`scrollWidth/scrollHeight` 也返回） |
| 生命周期 | `attached` / `ready` / `onReady` / 延迟 500ms | **全时机有值**（连 `attached` 都有——见 §3 证据） |
| 基础库版本 | 3.0.0 / 3.4.6 / 3.6.6 | **三个版本行为一致**（无版本区间问题 → 非结论 B） |
| 查询形态 | `exec()` 数组 / `boundingClientRect(cb)` 回调 | **两者等价**（都返回全字段） |
| 作用域 | 页面级 / 组件级（`scope.createSelectorQuery()` / `.in(inst)`） | **全部可用** |
| 选择器 | `#id` / `.class` / `[data-]` / `tag` | id ✅ · class ✅ · **attr ✗ · tag ✗**（返回 `null`） |
| 工具 | 开发者工具 | ✅（真机待验） |

---

## 2. 关键读数（Skyline · 3.6.6 · 设计尺寸 → 实测）

页面级（`wx.createSelectorQuery()`，`onReady` 与延迟 500ms 两次一致）：

| 选择器 | 设计 | 实测 | 判定 |
|---|---|---|---|
| `#g-view` | 200×60 | `200×60` | ✅ |
| `#g-text` | 160×40 | `160×40` | ✅ |
| `#g-image` | 48×48 | `48×48` | ✅ |
| `#g-scroll` | 240×80 | `240×80` + `scrollOffset {240×400}` | ✅ |
| `[data-role="box"]` | — | `null` | ✗（不支持） |
| `view`（tag） | — | `null` | ✗（不支持） |

组件级（`scope.createSelectorQuery()`，`attached`/`ready`/延迟 全时机）：

| 选择器 | 设计 | 实测 | 判定 |
|---|---|---|---|
| `#c-p1-view` | 120×40 | `120×40` | ✅ |
| `#c-p1-text` | 100×24 | `100×24` | ✅ |
| `#c-p1-image` | 32×32 | `32×32` | ✅ |
| `#c-p1-scroll` | 180×60 | `180×60` + `scrollOffset {180×300}` | ✅ |

同类通过 **`wx.createSelectorQuery().in(inst)`**（官方标准形态）复核——同样全有值。

---

## 3. 证据链

1. **原始回执**（完整 JSON，含全部时机与形态）：
   - `results/skyline-3.6.6.txt`（冷启动全量 15 条记录 · **含 attached**）
   - `results/skyline-3.0.0.txt` / `results/skyline-3.4.6.txt`（版本跨度）
   - `results/webview-3.6.6.txt`（WebView 对照组）
2. **探针可注入性证据**：`globalThis.__VC0_INJECTED__` 写入后由 `automation_evaluate` 回读到
   `{"by":"page-skyline","marker":"inject-ok"}`（同一逻辑层上下文）。
3. **★破坏性验证**（读数必须跟随真实布局，防"硬编码假绿"）：
   把 `#g-view` 宽度从 `200px` 改为 `310px` → 重编译重开 → 读数变为 **`310`**；
   恢复 `200px`。⇒ 读数确系真实布局测量，非装置噪声。
4. **装置缺陷自证**（诚实记录）：
   - 首版页面级查询误用 `#view`（漏 `g-` 前缀）→ 全 `null`；由 id 自校验暴露后修正。
   - 首版 `onLoad` 清空账本会误删**先于页面写入**的组件 `attached` 记录 → 改为 session 标记。

---

## 4. 与社区反馈「全为 0」的关系（为什么本测不复现）

社区形态的复现条件未在本环境出现。给出**可解释的差异假设**（按可能性排序，均与本测现象一致）：

1. **属性选择器/`data-*`**：Skyline 不认属性选择器（本测已证恒 `null`）；
   若查询写法依赖属性选择器 → 表现就是"取不到"（部分实现把 null 归一成 0）。
2. **组件内忘加作用域**：`wx.createSelectorQuery()` 在**页面作用域**查组件内节点 ⇒ 查不到；
   正解是 `scope.createSelectorQuery()` 或 `.in(inst)`（本测两种均通过）。
3. **旧版本或不同工具通道**：本测 3.0.0 起已全绿；更早版本未覆盖（不在当前支持区间）。
4. 社区反馈可能混入了 `.selectAll()` / `fields()` 等其它形态的失败案例（本测未覆盖该二形态）。

> **取数纪律**：本报告只声明"本环境 + 本矩阵"的读数；对手册未覆盖的形态（`selectAll`/`fields`）不推断。

---

## 5. 对 VC4-c（Skyline 探针）的设计结论

- **可以走查询式探针**（不必强制产出式），且已明确写法：
  - 组件内：`scope.createSelectorQuery()`（首选）或 `wx.createSelectorQuery().in(inst)`；
  - 选择器：**id / class 二选一**（用 id 更稳；class 注意 scoped 后缀问题——build 产物上的
    `.p-xxx` 实际带 `-data-v-*` 后缀，建议**静态 id**，与 p-popover 修复同一先例）；
  - 属性/tag 选择器**禁用**（`null`）。
- **建议两法并用**（与既有 `packages/runtime/src/probe.ts` 的"从组件内部发起"方案对齐）：
  - 查询式：一次性/对账用（本报告证明其可用）；
  - 产出式探针（`globalThis` 账本）：持续采集/工具不可达时用（本报告证明沙箱允许写全局）。
- **节奏**：每次测量前不必等固定时长——`attached` 即有值；但**跨版本/跨端留 1 帧以上的重测**
  仍是廉价保险（本装置 delayed500 与 onReady 读数一致，无差异）。

---

## 6. 未完成 / 后续

- [ ] **真机矩阵**（Android / iOS；鸿蒙 OS 版）：需扫码真机调试/预览——**待有设备条件的会话**；
- [ ] `selectAll()` / `fields()` 两个形态补测（卡片未要求，属完备性）；
- [ ] 鸿蒙 OS 版小程序几何行为（官方称支持）。
- 上述缺失**不阻塞** VC4-c 开工：查询式/产出式两条路均已在工具侧验证可用；
  真机如有差异，产出式探针兜底（本报告 §5 设计已内置该兜底）。

---

## 7. 复现步骤（一条命令级）

```bash
# 前置：微信开发者工具已登录（登录过期时 wechatide -c <client> login 扫码）
WXIDE=/Volumes/data1/applications/wechatwebdevtools.app/Contents/MacOS/wechatide
PROJ=<repo>/spike/vc0-skyline-geom
"$WXIDE" -c vc0 open_project_window --project "$PROJ" --window-mode fullMode
"$WXIDE" -c vc0 simulator_open_page  --project "$PROJ" --page pages/skyline-geom/index
# 读账本（注意 evaluate 必须传无参函数）
"$WXIDE" -c vc0 automation_evaluate --project "$PROJ" \
  --fn-source "function() { var v = getApp().globalData.__VC0__; return JSON.stringify({ runs: v.runs }); }"
```

切版本：改 `project.config.json` 的 `libVersion` → `debug_clear_cache --action cleanCompileCache`
→ 重开项目窗口 → 重开页面（缓存不清会跑旧编译产物）。
