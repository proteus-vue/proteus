# 指令集规格（生成物 —— 勿手改）

> **生成**：`node scripts/gen-instruction-spec.mjs`（`--check` 纳入 CI，漂移即红）
> **卡**：I1「指令集规格化与版本化」· **依赖**：无 · **性质**：跨端契约（多团队并行开发的前提）

## 0. 为什么有这份文档

指令集是**端与内核之间的唯一契约**：TS 编码、Rust 解码、各平台执行器都必须对同一批
opcode/字节布局/语义达成一致。此前这些事实散在 4 处实现里（`buffer.ts` 编解码 ·
`ops.rs` 解码 · `ops_apply.rs` 应用 · `render-cmd.ts` 绘制），**没有一份公开规格**——
⇒ 多端协作时无法对齐、无法协商版本。

★**本表由代码生成**（不手抄）：opcode 与尺寸来自**求值真实函数**，`--check` 在 CI 比对，
⇒ **表与代码不可能漂移**（手写规格 = 第 5 份副本，漂移是静默的——本仓纪律 #22）。

## 1. 两大类指令

| 类别 | 载体 | 方向 | 何时用 |
|---|---|---|---|
| **Draw（绘制）** | `RenderCmd` 线性指令流 | 内核 → 平台（单向） | **全量**渲染：布局完成后一次性生成，平台顺序消费 |
| **Update（更新）** | `UpdateOp` 二进制指令流 | JS → 内核 → 平台 | **增量**更新：Vapor 槽位变化（不重建 VDOM、不 diff） |

两者的共同设计：**定长字段 + 顺序读**（无字符扫描、无 f32 文本解析）——因为都是热路径。

## 2. Update 指令集（12 条 opcode）

### 2.1 线上格式

```
Header（20B）: magic u32 = 0x504f5650("PVOP") · version u32 = 2
                · opCount u32 · keyCount u32 · strCount u32
KeyPool:        keyCount ×（u16 len, utf8 bytes）
StringPool:     strCount ×（u16 len, utf8 bytes）
Ops:            opCount 条（判别字节 + 定长字段）
```

★**V2 起「池按需」**：编码时只把**本消息实际引用的**键/字符串放进池，并**重映射 ref 下标**
（V1 是每条消息携带全量池 ⇒ 列表场景单条更新膨胀 ~78×、编码成本 42×）。
解码端语义不变（池是自包含声明，按池内下标解析）——Rust 侧仅版本号需跟随。

### 2.2 opcode 清单（全部小端）

| opcode | 名称 | 字节 | 参数与语义 |
|---|---|---|---|
| `0x01` | **SET_PROP** | 11 | `"op":1,"nodeId":1,"keyId":2,"value":3` |
| `0x02` | **SET_STYLE** | 11 | `"op":2,"nodeId":1,"keyId":2,"value":3` |
| `0x03` | **SET_TEXT** | 9 | `"op":3,"nodeId":1,"textRef":2` |
| `0x04` | **SET_ATTRS** | 13 | `"op":4,"nodeId":1,"attrs":[{"keyId":2,"value":3}]` |
| `0x05` | **TOGGLE_VIS** | 6 | `"op":5,"nodeId":1,"visible":true` |
| `0x10` | **INSERT_BLOCK** | 10 | `"op":16,"blockId":1,"refNodeId":2` |
| `0x11` | **REMOVE_NODE** | 5 | `"op":17,"nodeId":1` |
| `0x12` | **MOVE_NODE** | 10 | `"op":18,"nodeId":1,"refNodeId":2` |
| `0x20` | **LIST_SET** | 9 | `"op":32,"listId":1,"dataRef":2` |
| `0x21` | **LIST_SPLICE** | 23 | `"op":33,"listId":1,"start":0,"delCount":1,"itemKeyRefs":[2,3]` |
| `0x22` | **LIST_UPDATE** | 17 | `"op":34,"listId":1,"itemKeyRef":2,"slotId":3,"value":4` |
| `0x30` | **CALL_COMPONENT_UPDATE** | 13 | `"op":48,"componentId":1,"slotId":2,"value":3` |

**变长指令的尺寸随成员数增长**（已实测）：
· `SET_ATTRS`：1 项 13B → 3 项 **25B**（`7 + 6n`）
· `LIST_SPLICE`：2 项 23B → 3 项 **27B**（`15 + 4n`）

### 2.3 实现状态（★诚实标注：不是所有 opcode 都已支持）

| opcode | 实现状态 |
|---|---|
| SET_PROP / SET_STYLE / SET_TEXT / SET_ATTRS / TOGGLE_VIS | ✅ 已实现并真机验证 |
| LIST_UPDATE / LIST_SPLICE / REMOVE_NODE | ✅ 已实现（含跨语言 golden） |
| **INSERT_BLOCK** | ❌ **unsupported**（需编译期块实例）——**如实上报不静默** |
| **MOVE_NODE** | ❌ **unsupported**（需宿主先解析目标父与位次）——如实上报 |
| **CALL_COMPONENT_UPDATE** | ❌ **unsupported**（需组件边界调度）——如实上报 |
| LIST_SET | ⚪ 语义保留（结构性换源属独立课题，当前显式跳过） |

## 3. Draw 指令集（RenderCmd）

| kind | 语义 |
|---|---|
| `background` | 纯色/渐变背景（isPureBackground → 平台走 backgroundColor 通道，**不分配 backing store**） |
| `text` | 文本绘制（平台文本栈光栅化） |
| `image` | 图片（shareableContent → 走 contents 共享内存） |
| `border` | 描边 |
| `pushClip` | 裁剪区开始（overflow: hidden/scroll） |
| `popClip` | 裁剪区结束 |

**关键设计（三条，均为架构不变量）**：

1. **绝对坐标 + 整数逻辑像素**：每条指令自带绝对位置（父链偏移已累加）⇒ 平台层**零换算**；
   让裁剪（overdraw culling）成为一次坐标比较，无需维护变换栈；
2. **坐标在内核吸附为整数**（卡 I2）：策略 = **边缘吸附** `snap(v) = floor(v + 0.5)`；
   盒 → `L=snap(x), T=snap(y), R=snap(x+w), B=snap(y+h)`；宽度取边缘差 `max(0, R-L)`。
   ★**平台层不得再舍入**（静态门禁 `pnpm check:host-rounding`）；
   边缘吸附（而非逐字段 round）保证**相邻元素共用边吸到同一整数** —— flex 均分不丢 1px。
   跨语言一致性由 golden 锁定：`packages/layout-core-rust/tests/golden/pixel-snap.json`（TS ⇄ Rust）。
3. **拍平不产生独立指令**：被拍平节点的绘制**并入父级指令**（`mergedFrom` 记录可验证），
   **不新建合成位图**——一旦破坏，iOS 上曾出现的 +78% 内存会以更难查的形式复发；
4. **同色相邻背景可合并**（卡 I5-3，`EmitOptions.mergeSameColorBg` 显式开启）：
   相邻（指令流中紧挨着）+ 同色 + **严丝合缝拼成矩形**的纯背景合并为一条（`mergedBgFrom` 记并入清单）；
   任一条件不满足即不合并——错位/有缝/异色/圆角/渐变/夹其它绘制都会多画或少画（画家算法下不等价）。
   ★收益实测：等色长列表 1000 行 **1001 → 2 条**（↓99.8%）；斑马纹对照 **0 合并**（正确拒绝）。
5. **paint-hint 编译期推导**：`isMonochrome` / `isPureBackground` / `shareableContent`
   随指令携带，平台据此决定 backing store 策略（**禁止运行时猜**）。

## 4. 版本化与协商

### 4.1 版本常量（实现）

| 常量 | 值 | 位置 | 语义 |
|---|---|---|---|
| `OPS_VERSION` | **2** | `slot-runtime/src/buffer.ts` · `layout-core-rust/src/ops.rs` | Update 指令流线格式版本（**双端必须一致**，不符即报错） |
| `OPS_MAGIC` | `0x504f5650` | 同上 | "PVOP" 魔数（防串流） |

### 4.2 协商结构（Host ABI §6，沿用不重设计）

```c
typedef struct {
  uint32_t abi_version;      // Host ABI 版本
  uint32_t ir_version;       // IR 版本
  uint32_t min_shell_version;// 最低宿主版本
} ProteusVersionInfo;
```

**强制要求**：① 版本号语义化（**禁止 commit hash 等不可比标识**）；
② 校验不通过 ⇒ **明确提示升级，不得静默崩溃**；③ 能力清单版本也纳入协商。

### 4.3 变更流程（major / minor）

| 变更类型 | 版本动作 | 兼容性 |
|---|---|---|
| **新增 opcode**（未用旧值） | `OPS_VERSION` **minor** 递增 | 向后兼容：旧端忽略未知 opcode 即可 |
| **改字段语义 / 改字节布局** | **major** 递增 | **不兼容**：双端必须同步升级 |
| **移除 opcode** | **major** 递增 | 不兼容 |
| 新增**可选**头部字段（尾部追加） | minor 递增 | 兼容（旧端按 `opCount` 停止读取） |

★**本仓实测的两次版本变更**（作为流程实例）：

| 版本 | 变更 | 兼容性 |
|---|---|---|
| 1 | 初版（全量池） | — |
| **2** | **池按需 + ref 重映射**（改字节语义 ⇒ major） | **不兼容**：TS 与 Rust 必须同步；`ops_conformance` golden 当场抓出未同步端 |

## 5. 门禁（可复现）

| 门禁 | 锁什么 |
|---|---|
| `node scripts/gen-instruction-spec.mjs --check` | **本表与代码一致**（表漂移即红） |
| `cargo test --test ops_conformance` | **跨语言 golden**：TS 编码 → Rust 解码，逐字节 + 语义比对 |
| `tests/update-ops-golden.test.ts` | golden 与当前编码一致（改了格式必须显式重新生成） |
| `tests/layout-core-render-cmd.test.ts` | Draw 类：绝对坐标 / 拍平 / 裁剪 三条架构不变量 |
| `node scripts/gen-pixel-snap-golden.mjs --check` · `tests/pixel-snap-golden.test.ts` | **坐标吸附跨语言 golden**（TS ⇄ Rust 逐字段；含精度边界台账）——改策略必须显式重生成 |
| `node scripts/check-host-rounding.mjs` | **平台层零舍入**（hosts/ 静态扫描；每个例外必须写 `I2-ALLOW:` 理由） |
