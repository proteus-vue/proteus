# Proteus Vapor 三端能力对照表

> 生成：2026-10-03 ｜ 回答「Vapor（编译产物驱动）在三端各自能跑到哪一步」——**差距可查、可勾销**。
> ★纪律：只列有**真机产物 / 判据**证据的项；「缺」= 该端无对应实现（不是"没找到"）。

## 一、Vapor 是什么（一句话）

`examples/pages/consistency-stress.vue` 等 SFC → **构建期编译**（`LayoutTemplate` + 订阅表）
→ **设备端实例化**（`instantiateTemplate`）→ 宿主建树（Rust 算几何）→ **订阅驱动增量**
（数据变 → 槽位求值 → **二进制指令** → 内核重排）——**JS 只产语义，几何一律内核算**。

## 二、能力矩阵（7 项）

| # | 能力 | Android | iOS | 鸿蒙 | 判据/产物 |
|---|---|---|---|---|---|
| 0 | **Vapor 设备端链全判据 ①–⑬**（实例化/增量/交互/事件修饰符 `.stop`/混合文本/once·memo 门禁/表达式能力/**绘制通道**） | ✅ **13/13** | ✅ **13/13**（⑦ 已打通） | ✅ **13/13** | **三端同一份 `bundle-vapor.js` + 同一份 `check-vapor-device.py`**（零移植）；★★**零跳过**（2026-10-03 第三轮：三端 ⑦ 绘制通道全部打通） |
| 1 | **设备端实例化**（编译产物 → 节点树） | ✅ `runShort` | ✅ `V3_vapor_slot_pipeline` + `--vapor` | ✅ `vaporProbe` | 三端均：模板 **22 节点** → 实例化 **36 节点**（含运行时分配 id）；同一份产物 |
| 2 | **订阅驱动增量**（二进制指令 → 内核几何变） | ✅ | ✅ | ✅ | Android/iOS：V3 单节点更新分位；鸿蒙：3 轮 / 183B / 探针宽 52→80 |
| 3 | **六端 SFC 压力夹具**（同一份 .vue） | ✅ `runStress` | ✅ `--stress` | ✅ `PROTEUS_SFCSTRESS` | 六端像素报告（44 节点） |
| 4 | **A/B 等价对照**（Vapor vs Vue 运行时） | ✅（7 组） | ✅ **已补** | ✅ **已补** | **三端同一份判据、同一份 bundle**（零移植）；iOS（2026-10-03）：mount 9 样本 0px · 更新 27 样本 0px · **绘制通道 5/5 逐项等价** · **事件路径 ⑦a–g 全过（含冒泡链逐跳 [30,5]）**——iOS 比鸿蒙更完整（无分档跳过）；Android 原有：**鸿蒙（2026-10-03）**：同一份判据——**mount 几何 9 样本 max_delta 0px** · **更新后 27 样本 max_delta 0px** · 两路 moved 一致 `[20,28,36]` · 文本双消费 `3/3` · 宿主补丁 3 次；④绘制通道/⑦事件路径按能力面**如实分档** |
| 5 | **虚拟化列表**（vapor 路 · 大列表） | ✅（1000 行） | ◐ V4/V5（滚动补刷 + 像素） | ✅ **已补** | **三端同判据 6/6**：1000 行 · 整树 2002 节点在内核 · **首帧物化 13 行（≤120）· 13 条指令** · 回顶签名差异 **0%** · 增量有界（下滚 +36 / 上滚 +25）· 复用池 61 释放 / 74 物化 |
| 6 | **事件路径**（tap → handler → 几何变） | ✅ 判据 ⑦（含冒泡链逐跳） | ✅ **已补** | ✅ **已补** | **三端同判据 ⑦a–g 全绿**：两路链 [11>10>0] / [39>38>3>2>1]，逐跳位移 [30,5] 一致；鸿蒙经 `tapAt` → 核心 hitTest → **JSVM 反向调 JS**（`onGesture` 注册名）真验；iOS 经 shim 归一签名（tapAt/scrollRows 的 JSON vs 双参） |
| 7 | **绘制通道**（圆角/渐变/发光/裁剪/描边） | ✅ `probeChannels` 5 通道 | ✅ **已打通（2026-10-03）**：`channelProbe` 读 layer 真源 5 通道 | ✅ **已打通（2026-10-03）**：渲染层真画 + 探针回读 5 通道 | **三端判据 ⑦ 全过、零跳过**：Android `18·1:2·26:0.9·1·512.023` · iOS `18·1:2·5:0.900·1·512.07` · 鸿蒙 `63·1:2·12:0.900·1·512.023` |

**统计**：Android **6.5/7** · iOS **6/7** · 鸿蒙 **6.5/7**（A/B + 事件路径 + 虚拟化列表与 Android 同强度；④绘制通道按渲染层能力分档）。

★★**2026-10-03 续 · Vapor 设备端链三端全接（本日新增）**：`check-vapor-device.py` 的判据面从
**①–⑧ 扩到 ①–⑫**（新增 ⑨ 事件修饰符 `.stop` 真终止冒泡 / ⑩+⑩b 混合文本首帧与更新完整 /
⑪ v-once 冻结与 v-memo 组门逐节点核对 / ⑫ 表达式能力：v-text·白名单纯函数·`Math.PI` 内联·纯方法·可选链），
**三端现已同跑这一套**（同一份 bundle + 同一份判据，零移植）：

| 端 | 结果 | 本轮为接线补的东西 |
|---|---|---|
| Android | **13/13** | （判据本就在此端实现——基准端） |
| 鸿蒙 | **13/13** | 宿主 `applyOps` 回执补 `text_probe`（判据 ⑩b 依赖）；★并修两处**装置缺陷**：① 等待信号命中陈旧日志（不清 hilog 缓冲）② `recv` 失败被吞 + 本地旧报告让 `-s` 假通过（症状=判据跑上一轮数据） |
| iOS | **12/13**（⑦ 如实跳过） | 新增 `--vapor` 模式（跑 `runShort` 路径）；`applyOps` 回执补 `text_probe`；新增**离屏像素自检**（`paintedPixelProbe`：`CALayer.render(in:)` 真渲染一遍数像素 ⇒ 判据 ④ 的 iOS 腿）；脚本接入同一判据（`--vapor` ⇒ `check-vapor-device.py`） |

★**三端真机读数（同一份 22 节点模板 / 11 源 / L1 15）**：
- 实例化 36 节点（含运行时分配 14）· 文本回填 17 处 · 宽度 13 处；
- 增量 3 轮 · 204 字节指令 · 探针节点宽度 52→80；
- 交互 4 次 tap 全部：handler 命中 + 数据变 + **内核几何变**；⑨ `.stop` 命中内层 13、祖先源未变；
- ⑩/⑩b 混合文本：`row-1·row 1` → 更新后 `row-1·upd 0`（完整拼接，三端一致）；
- ⑪ 逐节点：once 节点未写 / 对照节点照常写 / memo 净跳过 0B / memo 脏放行且写新值；
- ⑫ 表达式：`vt-3 · pi-3.14 · mx-7 · jn-a|b · oc-ok`（三端一致）。

★**诚实边界（2026-10-03 第三轮已全部收敛）**：**三端 13/13、判据 ⑦ 零跳过**——五通道
（圆角/渐变/发光/裁剪/描边）三端都真建真判（见 §七）。

★★**iOS 腿顺带抓出并修的真缺陷**：`applyOps` 回执缺 `text_probe`（判据 ⑩b 无读数 ⇒ 三端对齐排查时
直接暴露"iOS 少一个回执字段"）；同时定位了一次"主 App 白屏"误报——那是**基准 App（`dev.proteus.layoutcore`
= ProteusBench，界面本就空白）**被调试命令启动到前台所致（**不是**主 App 缺陷；主 App = `dev.proteus.experiments`，
截图核验 showcase 正常）。★教训：**两个 App 的 bundle id 混用**会让"白屏"看起来像渲染缺陷。

## 三、缺口归因

- **A/B（#4）是最高价值的缺口**：它回答的不是"Vapor 能跑"，而是"**Vapor 跑出来的东西与
  Vue 运行时是否逐位等价**"——这是"Vapor 能替换 Vue 运行时"的**唯一量化证据**。
  · Android 已有完整 7 组判据（`hosts/android/check-vapor-ab.py`）。
  · iOS / 鸿蒙**各自都有 Vue 运行时能力**（iOS：`createAppRenderer` + selfdraw 适配器；
    鸿蒙：JSVM 可跑同一份 `bundle-vapor.js` 含 `abRender`）⇒ **材料齐备，缺的是接线与判据**。
- **虚拟化列表（#5）**：Android 有 vapor 路（`mountVirtual` + `scrollRows`）；iOS 的 V4/V5 是
  滚动补刷（等价能力但形态不同）；鸿蒙两份宿主方法都没实现。
- **事件路径（#6）**：Android 判据 ⑦ 最强（含**冒泡链逐跳**）；iOS 的 V16/V17 走 Vue 路
  （验的是适配器 + 手势分流，不是 Vapor 的动作表路径）；鸿蒙 `tapAt`/`onGesture` 未实现
  （`runShort` 的 tap 段按 `typeof` 自动跳过——不造假）。

## 四、补齐优先级（按「价值 × 成本」）

| 优先级 | 缺口 | 端 | 理由 | 成本 |
|---|---|---|---|---|
| ~~P0~~ | ~~A/B 对照~~ | ~~鸿蒙~~ | ✅ **已完成（2026-10-03）**：宿主桥补 `updatePatches`（含**文本先度量再注入**的闭环）+ 判据分档——mount/更新两路几何**逐位一致（0px）** | ✔ |
| ~~P1~~ | ~~A/B 对照~~ | ~~iOS~~ | ✅ **已完成（2026-10-03）**：宿主补 `readRects`/`probeChannels`/`onGesture` + `tapAt` 同形 + 手势按名派发；JS 侧 shim 归一签名差异；**真机全绿（含④⑦无分档）**。★顺带修出 **3 个 iOS 真实缺陷**（见下节） | ✔ |
| ~~P1~~ | ~~（原估）~~ | iOS | **成本回顾**：iOS 宿主缺 **`readRects`** / **`probeChannels`** 两个方法（A/B 判据的几何/通道读数依赖它们）——虽 `rects()` 功能等同但**命名与返回形状不同**（`proteus_layout_rects` 原样透传 vs Android 的 `{rects:{...}}` 包装）；且 iOS 的 `vapor-artifacts.json` 是**简化版**（5 节点模板 / 单 list 源，与 Android 的 12 节点/3 源/events/handlers **不同源**）⇒ 需先统一产物再接线。**估 1.5–2 天**（非 0.5） | 1.5–2 天 |
| ~~P2~~ | ~~事件路径~~ | ~~鸿蒙~~ | ✅ **已完成（2026-10-03）**：`tapAt`+`onGesture` 两方法（JSVM 反向调 JS）+ **修一个静默截断**（`char out[512]` — 见下节）——⑦a–g 全绿 | ✔ |
| ~~P3~~ | ~~虚拟化列表~~ | ~~鸿蒙~~ | ✅ **已完成（2026-10-03）**：`mountVirtual`/`scrollRows` 两方法 + 修两个装置缺陷（**CAPI 未初始化 ⇒ CreateNode 全 null** 与**签名口径**）——6/6 全绿 | ✔ |

## 四·补 · 鸿蒙 A/B 的实测细节（2026-10-03）

**链路**：`bundle-vapor.js`（与 Android 同一份，含 `mode:'ab'`）→ JSVM eval →
A 路（Vapor 编译产物）+ B 路（Vue 运行时 `abRender`）各自 mount → 逐节点比几何 → 三轮更新对照。

**读数**：A 26 节点 / B 39 节点（树形天然不同：Vapor 折文本进元素，Vue 是标准 vnode 树）·
**按语义文本节点对齐后 9 样本 max_delta=0px** · 更新后 **27 样本 max_delta=0px** ·
两路 moved `[20,28,36]` 完全一致 · 文本双消费 3/3 · 宿主补丁 3 次（`host_update_patch_calls`）。

**★本轮抓出的两个"分档写了但没生效"缺陷**（都在判据侧）：
`ok = False` 写在分档 `if/else` **之外** ⇒ 鸿蒙"如实跳过"仍判红，且**汇总行只报"有失败项"
而无具体 fail 消息**（极难定位）。⇒ 纪律：**分档的分支里必须连 `ok` 一起分支**
（判据的"跳过"路径与"失败"路径要一起设计，否则跳过等于没跳）。

## 四·补二 · iOS A/B 实测细节 + **顺带修出的 3 个真实缺陷**（2026-10-03）

**链路**：`bundle-vapor.js`（与 Android 同一份，经 `run-selfdraw.sh` 构建期复制）+ JS 侧宿主桥 shim
（签名差异归一：共享 bundle 吃 `tapAt("<json>")`，iOS 宿主是 `tapAt(x:y:)`——**两边零改动**）。

**读数（与 Android 逐项同形）**：A 26 / B 39 节点 · mount 9 样本 **0px** · 更新 27 样本 **0px** ·
**绘制通道 5/5 逐项等价**（radius/grad/glow/clip/stroke_len 签名多重集相同）·
**事件路径 ⑦a–g 全过**（两路链 [11>10>0] / [39>38>3>2>1]，逐跳位移 [30,5] 一致）。

**★★顺带修出的 3 个 iOS 真实缺陷（都不是测试装置问题，是产品缺陷）**

| # | 缺陷 | 症状 | 根因 | 影响面 |
|---|---|---|---|---|
| 1 | **`styleOf` 白名单漏 `glow`/`mask`** | 声明了发光/遮罩的节点**静默不渲染**（层上根本没建） | 建层必经之路的键白名单没跟上内核新增静态样式（clipPath/fillGradient 曾有同款缺陷——此处又漏两项） | 一切用 glow/mask 的真实页面 |
| 2 | **clipPath `params` 类型转换失败** | 裁剪**静默不生效** | JSON `[0,0,0.45,0]` → Swift `[Any]`（混合 Int/Double），`as? [Double]` **不做元素级转换** ⇒ 直接丢 | 一切用 clip-path 的页面 |
| 3 | **`clearLayers` 漏清 `layerClipShape`** | 重建树后**旧树的裁剪登记残留**（A/B 探到 2 个 clip 的假差异） | 新增层簿记未同步加进清理清单（描边/渐变/发光/遮罩同类教训的**第四次复现**） | 任何触发全量重建的场景 |

★**抓出方式**：A/B 的**通道签名对照**（iOS 4/5 vs Android 5/5）——**跨端对照就是这类"静默不渲染"的探针**
（单端自测看不出来：层不建，几何断言全绿、无报错）。

## 四·补三 · 鸿蒙 A/B ⑦ 事件路径实测（2026-10-03）

**链路**：`tapAt({x,y})`（JS 发起）→ 核心 hitTest 取 target/chain → **JSVM 直接 CallFunction**
（同一调用栈，env 在手 —— Android 用 JNI 反向调用、鸿蒙在回调内直调，**同一语义两种机制**）
→ JS 侧 `__proteusVaporGesture` → 两路各自跑 handler。

**读数**：⑦a–g **全绿**——两路链 [11>10>0] / [39>38>3>2>1] · 逐跳位移 [30,5] 一致 ·
A Δ=30px（指令 56B）/ B Δ=30px（补丁 2 条）。

**★★本轮抓出的第 4 个"症状与根因相距极远"的缺陷**：

| 步骤 | 读数 | 推论 |
|---|---|---|
| 1 | A 路 tap 失败、B 路成功（`fired=1`） | 差异不在桥（同一份 C++）⇒ A 的 JS 回调内部抛错 |
| 2 | `GetAndClearLastException` 取消息 ⇒ **空** | ★异常挂起时**同 env 的后续 eval 也被阻塞**（V8 语义）——「读不到」≠「没异常」 |
| 3 | 先清异常、再 eval + JS try/catch | 拿到真错：`Unterminated string in JSON at position 511` |
| 4 | 定位到 `char out[512]` + 内嵌完整 `rects` | **宿主回执被 `snprintf` 截断** ⇒ JS 侧 `JSON.parse` 失败 |

★症状是"A 路 tap 回调失败"，真因在**宿主输出缓冲区大小**——四轮排查全部记入代码注释。
★修法：回执拼接一律 `std::string`（无长度上限）。

## 四·补四 · 鸿蒙 #5 虚拟化列表实测（2026-10-03）

**链路**：`mode:'list'` → 实例化 1000 行 → 宿主 `mountVirtual`（**整树进核** + 首帧物化）→
30 帧下滚 + 30 帧上滚 → `scrollRows`（核心给决策、宿主执行层复用）。

**读数（6/6 全绿）**：模板 4 节点 · L1 3 · **实例树 2002 节点 / 1000 行全在内核** ·
首帧物化 **13 行 / 13 指令**（物化有界 = 虚拟化的唯一意义）· 滚动真的动（轨迹 max scroll_y=3000）·
**回顶签名差异 0%**（无累积漂移）· 增量有界（+36 / +25）· 复用池 61 释放 / 74 物化。

**★本轮抓出的两个装置缺陷**

| # | 缺陷 | 症状 | 根因 |
|---|---|---|---|
| 1 | **CAPI 未初始化** | `rows_live=0`（看起来像"核心没给行"） | bench 模块没有 render 模块 attach 里的 `OH_ArkUI_GetModuleInterface` ⇒ **`CreateNode` 全返回 null** ⇒ `continue` 掉所有 acquire（本仓已知坑第 N 次复现） |
| 2 | **签名口径不一致** | 回顶差异 **8.33%**（把正确的虚拟化判成"累积漂移"） | 首帧记的是**实际存活行**（含核心额外预载），对比时却用**我算的可见窗口** ⇒ 苹果比橘子 |

★**缺陷 2 的修法与本仓判据纪律同款**：**两侧都取"实际存活集合"**（`g_vlLive` 的键 = 物化真源）。

## 五、诚实边界

- 本表「缺」= **该端未实现**（与矩阵 #14 的"Vapor 指令流"不同层级——那是"链能不能跑"，
  本表是"链上各项能力跑到哪一步"）。
- iOS 的 V4/V5（滚动补刷 + 像素验证）与 Android 判据 ④（绘制通道逐项等价）**形态不同**：
  前者验"滚动后屏幕与几何一致"，后者验"两条路通道签名相等"——**不可互相替代**。
- 鸿蒙 `probeChannels` 当前只返回 `radius`（渲染层其余通道待补，判据如实分档）。

## 五 · Vapor 设备端链三端接线（2026-10-03 · 判据 ①–⑫）

**背景**：P2-2~P2-9 这批能力（混合文本 / 事件修饰符 / v-model 修饰符 / v-once·v-memo /
v-text·动态属性 / 白名单纯函数·可选链）全部落在**平台无关的共享包**（编译器 + `slot-runtime`）——
构造上三端共享；**但验证只有 Android**（判据 ①–⑫ 全在 `check-vapor-device.py`）。
本次把鸿蒙与 iOS 都接到同一条链上，让"构造对齐"变成"有证据对齐"。

### 5.1 鸿蒙（完成 ✅ 13/13）

材料本就同源（`gen-fixtures.mjs` 从 Android 逐字节复制 bundle/artifacts），宿主方法齐全
（tapAt/onGesture/readRects/probeChannels/updatePatches/mountVirtual/scrollRows）。本轮补：

1. **宿主 `applyOps` 回执补 `text_probe`**（判据 ⑩b 依赖）：解析 `text_updates` 时记 `lastProbeId/Text`，
   回执追加 `"text_probe":{"id":…,"text":…}`——与 Android `VaporRenderHost.lastTextProbe` **同形**。
   ★缺它的症状：鸿蒙在混合文本更新上**无读数**、判据 ⑩b 判红（三端对齐排查时抓到）。
   诊断日志 `PROTEUS_VAPOR_TEXTPROBE id=… tlen=… attached=…`（区分"so 未更新"与"JS 未读到"）。
2. **★装置缺陷①：等待信号命中陈旧日志**。原写法只 `grep PROTEUS_VAPOR_DONE`，而 hilog 缓冲可保留
   上一次运行的 DONE 行 ⇒ 等待**立刻返回**（"看起来跑完了"）。修：清场时 `hilog -r`（与 Android
   `logcat -c` 同义）+ 改等**报告落盘**（探针成功与失败路径都写盘，文件存在即完成信号；
   失败诊断交判据读报告里的 ok/error）。
3. **★装置缺陷②：`recv` 失败被吞 + 本地旧报告让检查假通过**。原写法 `recv >/dev/null 2>&1` 只看
   `-s`（非空）⇒ `recv` 失败时**上一轮的报告**让检查通过 ⇒ **判据跑在旧数据上**（实测症状：设备端
   text_probe 已就绪，判据却一直红）。修：先 `rm` 本地旧件 + 查 `recv` 结果 + 断言本地文件非空。
4. **★`hdc shell` 不回传远端退出码**（第二次实测才定位）：`test -f /nonexistent` 仍返回 0 ⇒
   按退出码等待会"waited 0s 立刻通过"（随后 `recv` 报 ENOENT，症状离根因极远）。
   修：等待用**字符串回显**（`test -f X && echo PROTEUS_REPORT_READY` + grep）。

### 5.2 iOS（完成 ✅ 12/13，⑦ 如实跳过）

iOS 此前只有 `--vapor-ab`（跑 `mode:'ab'`，判据集 = A/B ④⑦），**没有**跑 `runShort` 的模式
（判据 ①–⑫ 所在路径）。本轮补：

1. **宿主 `applyOps` 回执补 `text_probe`**（同上，与 Android/鸿蒙同形——`textUpdates` 字典取一条）。
2. **新增离屏像素自检 `paintedPixelProbe`**（判据 ④ 的 iOS 腿）：`view.layer.render(in:)` 走 Core
   Animation 真实绘制路径，数"与背景色（#14141c）差超容差"的像素 ⇒ 层上真画了内容才计数
   （空层/没建层 ⇒ 恒 0 ⇒ 判据能红）。实测 **242446 采样 / 804 色**。
3. **新增 `--vapor` 模式**（`driveVapor`）：宿主桥 shim（与 A/B 同一套签名归一）+ **调用计数**
   （`__hostMountCalls` 等 ⇒ 判据 ④ 的宿主读数）+ eval 同一份 bundle + 报告落盘（`vapor.json`）。
4. **脚本接线**：`--vapor` ⇒ `check-vapor-device.py`（与 Android/鸿蒙**同一份**）；报告名与三端同名
   （`vapor.json`）；`build_id` 断言按分档跳过（该 bundle 不注入 build_id，与 vapor-ab 同况）。
5. **⑦ 绘制通道如实跳过**：探针已接（A/B 路径已验 5/5），但本判据的期望值是**夹具节点固定 id**——
   先如实跳过、等一轮实测读数再收紧（本仓纪律：不自造未实测的判据口径）。

### 5.3 ★排查过程中定位的一次"主 App 白屏"误报（记录以免再踩）

现象：用户报"App 打开是白屏"。取证后发现设备前台跑的是 **`ProteusBench`**
（bundle id = `dev.proteus.layoutcore`，**基准 App，界面本来就空白**——只写 JSON 报告）；
而主 App 是 **`dev.proteus.experiments`**（Morpheus 炫技场）。
根因：调试命令用了 `dev.proteus.layoutcore`（以为是主 App），把它启动到前台并留着。
⇒ 终止误启进程 + 用正确 bundle id 启动，截图核验 MORPHEUS 动画正常（**主 App 无缺陷**）。
★教训：**同名/近名 App 的 bundle id 必须写死用途**（"哪个是面板、哪个是基准"），
否则"白屏"会被误读成渲染缺陷。

## 六 · ★★★三端同步已成为**机器门禁**（2026-10-03 · 用户指令）

**用户原话立此**：「后面的 vapor 推进就**三端同步走**」。

**门禁**：`pnpm check:vapor-three-end`（已接 `verify` 链 + CI 的 `Vapor 三端同步` 步骤）：

| 判据 | 抓什么 | 破坏性验证 |
|---|---|---|
| ① **证据齐**（三端 `results/vapor.json` 都在） | "只跑了一端就收工" | 移走 ios 报告 ⇒ **rc=1**（实测） |
| ② **同一份判据三端全过**（`check-vapor-device.py`；◐ 如实跳过会**列出**而不静默当"过"） | 某端判据红（宿主回执缺字段/读数不达标…） | 注入 `host_painted_samples=0` ⇒ **rc=1**（实测） |
| ③ **指纹逐项一致**（17 项：模板/源/槽位/实例化/增量/事件/混合文本/门禁轮/表达式探针） | "有一端没重跑"（旧证据冒充新证据） | 改 ios 的 `tpl_nodes=17` ⇒ **rc=1 且报出 `tpl_nodes: android=22 vs ios=17`**（实测） |

**为什么必须工具化**：Vapor 能力全在**平台无关共享包**（构造上三端共享），
而验证只跑一端时另一端是**推断**不是**证据**——与「提交 ≠ 交付」同族：
没有任何机制会提醒"另外两端还没重跑"。

**改 Vapor 面代码时的义务**（编译器 `vapor/*` · `slot-runtime/*` · `entry-vapor.ts` ·
`gen-vapor-fixture.mjs`）：**三端重跑并提交结果**——
```bash
bash hosts/android/run-vapor.sh      # Android（USB）
bash hosts/harmony/run-vapor.sh      # 鸿蒙（hdc）——含 gen-fixtures 同源复制
bash hosts/ios/run-selfdraw.sh --vapor  # iOS（真机）
```

## 七 · ★★★绘制通道三端打通（2026-10-03 · 用户指令「继续打通绘制通道」）

**结果**：**三端判据 ⑦ 全过、零跳过** —— 五通道（圆角/渐变/发光/裁剪/描边）在三个平台都真的建出来。

| 端 | 读数（radius · grad · glow · clip · stroke_len） | 本轮做的事 |
|---|---|---|
| Android | `18 · 1:2 · 26:0.9 · 1 · 512.023` | （基准端，无需改） |
| iOS | `18 · 1:2 · **5**:0.900 · 1 · 512.07` | **⑦ 判据收紧**：上一轮"如实跳过"的理由是"期望 id 未标定"；本轮有真机读数 ⇒ 转真判（`channelProbe` 读 CALayer 真源）。★语义差异收宽：`glow` 首段 iOS 是**层数**、Android 是**半径**，判据口径"≥3"两者皆满足 |
| 鸿蒙 | `63 · 1:2 · **12**:0.900 · 1 · 512.023` | **三层补齐**（下方详述） |

### 7.1 鸿蒙缺口的根因（三层都没接）

| 层 | 此前 | 现已补 |
|---|---|---|
| ① **样式表解析** | `SfcStyle` 只解析 `backgroundColor` / `borderRadius` / 文本 | 新增 `fillGradient` / `glow` / `clipPath` / `svgPath` 解析（`parseGradInto` / `parseGlowInto` / `parseClipInto` / `parseStrokeInto`） |
| ② **渲染层** | `probeChannels` 只回 radius；四通道**无处可画**（RenderNode 无渐变/裁剪/路径属性 API） | content modifier 画布路径扩成 `drawChannelsAndText`（顺序：**裁剪 → 渐变 → 发光 → 描边 → 文本**；`gradEndpoints` 把 CSS 角度换算成画布端点；发光=分层同心描边） |
| ③ **探针回读** | 读 `g_vaporStyles.radius`（**解析结果**，不是渲染结果） | 读 `g_channelStates`（**建什么记什么**）：渲染层导出 `proteus_channel_state_of`（C 符号，跨 .so），bench 侧调用 |

### 7.2 ★本轮抓出的真缺陷（3 个，全有实测证据）

1. **vapor 夹具的指令从未送进渲染层**（最根本的一条）：`g_vaporCmdsJson` 只进报告，
   `renderCommands` 是 **napi 入口**（跨 .so 不可直调）⇒ 渲染层只跑过 stress 夹具。
   ⇒ 抽出 `renderCommandsImpl`（纯 C++，不依赖 napi）+ `extern "C" proteus_render_commands_cstr`
   ⇒ vapor 探针在 mount 后即调它建树（真机日志 `PROTEUS_VAPOR_LAYERS rendered=36`）。
2. **指令不带节点 id**：探针要按 id 回读通道，而指令只有几何/颜色
   ⇒ 无法知道"这条通道是哪号节点的" ⇒ 指令头补 `"id":N`。
3. **`DrawTextCallback` 早退条件过窄**：只判 `text.empty()` ⇒ **纯通道节点**（无文本）永远不进回调
   ⇒ 四通道全丢。⇒ 放宽为"有文本**或**有任一通道"。

### 7.3 破坏性验证

抹掉鸿蒙节点 3 的 `grad` 读数 ⇒ 判据 ⑦ 当场红并精确报出
`★绘制通道未建出来：渐变（fill-gradient → shader，kind1=linear 且 ≥2 色标）（节点 3 的 grad=None）
—— 模板声明到了但宿主没建（静默丢通道）`；还原后三端全绿。

### 7.4 顺带修复：`run-vapor-list.sh` 的同类陈旧信号缺陷

长列表脚本仍有 `test -f` 式等待（**hdc 不回传远端退出码** ⇒ 恒真）+ `recv` 失败被吞 +
本地旧件让 `-s` 假通过——与 `run-vapor.sh` 上已修的两处**同源**。已同步修成字符串回显 + 查 recv 结果。
★教训：**同类缺陷要在所有同族脚本上一次扫完**（本轮是"修了一个脚本、另一个还在"）。

## 八 · P3 逻辑容器透传 + 生成器语法护栏（2026-10-03）

**逻辑容器透传**（`KeepAlive` / `Teleport` / `Suspense`，`Transition` 已于 P3-3 完成）：
Vue 里它们**不渲染包裹元素**——此前当普通容器建节点 ⇒ **多一层盒** ⇒ 几何与 Vue 不等价。
本轮统一透传（`template.ts` + `deps.ts` 同一判据），并**精确化诊断**（能力边界 + 当前行为 + 替代路径）。

★**修正一处不实表述**：早先诊断写「KeepAlive 可复用 app-stack 的 keep-alive 档」——
那是**页面级**保活（`meta.branch.keepAlive` 三档），与**组件级** `<KeepAlive>` 不是同一件事 ⇒ 已分开说。

★**Vue 官方约束（实测被编译器拦下）**：`<KeepAlive>` 要求**恰好一个子组件**
（`SyntaxError: KeepAlive expects exactly one child component.`）——原生标签不行。

**生成器语法护栏**（新增，挂在 `check:script-compile`）：
生成器把 SFC 夹具写成 JS 模板串，注释里的**未转义**反引号/美元花括号会破坏它（本仓踩 5 次）
⇒ 用 **`node --check`** 全量检查 `hosts/*/gen-*.mjs`。
★**顺带补上真实覆盖盲区**：这些生成器此前**从未被任何门禁编译过**。
★口径演进诚实记录：首版自写词法扫描**漏报**（正则字面量里的引号让扫描器错位）⇒ 改用权威判据。

**三端读数**（本轮夹具 27 模板节点 / L1 16 / 12 源 / 实例化 41）：三端 **14/14 零跳过**、指纹一致；
**A/B 几何等价 17 样本 0px**（透传的直接验证）；全量单测 367 文件 / 4652 用例全绿。

## 九 · P1-3 组件内部渲染（2026-10-03 · 三端同步）

**能力**：组件从"只有边界标记 + props 空通道"到**内部真的渲染**。链路：
SFC → 编译期产**组件注册表**（`components: { KidPanel: {template, table, data} }`）→ 实例化期
**偏移展开**（`idOffset`：子模板节点 id 整体搬到父 id 空间，`componentMounts` 记录边界与节点集）
→ 桥装配**子运行时**（`nodeIdOffset` 让子指令打在搬移后的节点上）→ **props 双向**：
下行 = 父 `component-prop` 槽位 → `onComponentProp` → 子运行时 `writeSlotsOfSource`；
上行 = 子槽位写值 → 同一回调 → 父源。

**判据 ⑭ 的三层证据**（缺一即红——★判据自缺陷修正）：首版只核"子节点文本 + 宽度指令值"，
且 `width_after is None` **放行** ⇒ "读不到"与"没变"判成同一结果 ⇒ 假绿（实测抓到：
三端都曾显示"宽度 40→None 全过"）。现核：
① 文本下行（子节点文本 `child-*`）② **指令上行**（子 flush payload 内真有 `layout.width` 指令）
③ **内核真值上行**（applyOps 后内核矩形真变 `40→99`——指令发错节点时 ② 仍可能成立）。

★**排查中修出的两个真缺陷**：
1. **探针查错键表**：`decodeOps` 返回**payload 内联**的键表（首现顺序由各运行时自己的 intern
   顺序决定），首版查**桥的全局** `keys` ⇒ `keyId=0` 被读成 `text.content`（在子 payload 里实为
   `layout.width`）⇒ 判据永远读不到宽度。**读指令必须用它自带的键表**。
2. **`captured` 只取最后一条**：父 relink 与子运行时各自 flush ⇒ 本轮有**多条** payload；
   首版 `captured[length-1]` ⇒ 子指令恰在前一条时漏发/漏读。

**三端读数**（本轮夹具 28 模板节点 / L1 18 / 14 源 / 实例化 44）：三端 **15/15 零跳过**、
指纹 18 项逐值一致（含 `kid_probe`：文本 / 宽度 40 / 指令值 99 / 内核 40→99）；
`check:vapor-three-end` 绿。单测 `tests/vapor-component-render.test.ts` 3 组。

**诚实边界**：生命周期（setup/mounted/unmounted）、具名/作用域插槽分发、emits 子→父**未做**；
`<KeepAlive>` 组件级缓存仍被此批**部分解除**（实例系统已在，但缓存策略未做）。

## 十 · P1-3 插槽分发 + 事件 id 漂移修复（2026-10-03 · 三端同步）

**能力：组件插槽从"空盒 + 诊断"到真分发**
- **编译期**：`<slot>` 打 `slotOutlet` 标记；父侧内容根打 `slotFor`（默认/具名）；
  **`<template #x>` 不产节点**（Vue 语义：模板/片段不渲染元素——此前会多一层盒 ⇒ 几何不等价）。
- **实例化期分发**（三端共享同一份代码，宿主零改动）：
  · 出口**溶解**——内容件挂到出口原来的位置（出口自身消失）；
  · **后备三态**：元素后备整体顶位 / 裸文本后备改造成 `p-text` 承载 / 空出口直接摘除；
  · 父级提供但**无出口接住**的内容整棵摘除（Vue 同——不静默留盒）；
  · 丢弃节点的 id 进 `stats.droppedNodeIds` ⇒ 运行时 `skipNodeIds` **不发死指令**（丢弃有记录，不静默）。
- **判据 ⑮ 四条证据**（缺一即红）：① 内容文本在内核树 ② 后备/孤儿文本**不在**（防叠影/幽灵）
  ③ 内容节点在**内核**里有几何（防"树里有、内核没有"）④ 分发标记零残留（中间态不泄漏）。

**★顺带修出的一个真缺陷：`events.ts` 的正则平扫 id 漂移**
正则版按"每个 `<tag` 出现"数元素 ⇒ **把 `<KeepAlive>`/`<template #x>` 也算进去**，
而 template.ts 把它们**透传**（不占 id）⇒ 其后所有事件的 nodeId 整体偏移。
实测：`<KeepAlive>` 之后的 `@click` 标到 5，模板里该元素是 4——**handler 挂在邻居节点上、零报错**。
★为什么既有夹具一直没暴露：所有事件都写在逻辑容器**之前**（顺序巧合）。
⇒ `compileEvents` 重写为 **AST 遍历**（与 template.ts/deps.ts 同一份判据），并把
"被跳过子树里藏事件"（Suspense #fallback / `<template #x>` 本身上的 `@click`）改为**显式诊断**。

**排查中修出的装置缺陷**：分发首版把被消费的内容根留在父数组里（同一对象进数组两次 ⇒ 内核
拒收"id 重复"）；`dissolveOutlets` 会摘 `slotFor` 标记、第二个循环再读就崩（改遍历 fills map）。

**单元判据**：`tests/vapor-slot-distribution.test.ts` 8 组（编译标记/id 同源/KeepAlive 回归/
落位/后备/孤儿/反向不误伤/命名对齐）。
