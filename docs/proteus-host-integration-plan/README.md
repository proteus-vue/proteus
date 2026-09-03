# G-41 宿主接入契约与 Vue 绑定架构

> **回答三个问题：宿主怎么接进来？Vue 凭什么始终不变？框架和宿主各自该干什么？**

---

## 快速开始

```bash
node host-reference.cjs
# → PASS=32  FAIL=0  SKIP=0
# → 演示：同一份 SFC 在两个引擎下渲染，业务代码零改动
```

---

## 文件清单

| 文件 | 内容 |
|------|------|
| **`G-41-host-integration.md`** | ★ 主文档：三方关系 / Vue 不变机制 / 职责边界 / 接入流程 / conformance |
| **`vue-binding-architecture.md`** | ★ Vue 绑定：`createRenderer` 机制、Dispatcher、方案 A/B 选型、热切换 |
| **`host-guide.md`** | 五平台接入指南（iOS / Android / Flutter / Harmony / Web）+ 对照表 |
| **`responsibility-contract.md`** | 职责边界契约：三方职责表 + 6 铁律 + 禁止清单 |
| **`host-conformance.md`** | H-01~H-08 共 32 项验证套件 |
| **`host-reference.cjs`** | ★ 可运行参考实现（零依赖） |
| **`rules.md`** | 铁律 G-41.1-6 + CMP051-058 |
| **`batches.md`** | B1-B6 分批 + DoD + 协同矩阵 |
| **`architecture-update.md`** | 规约增量：原则 #13.15-11.17 + 六层全景图 |
| `README.md` | 本文件 |
| `MANIFEST` | 打包白名单 |
| `CHECKSUM.md` | SHA256 校验 |
| `pack.sh` / `verify.sh` / `run-all-verify.sh` | 打包与校验脚本 |

---

## 核心结论

### 1. Vue 凭什么始终不变

```
业务 SFC        （永远不变）
Vue 编译器      （永远不变）
VNode 树        （永远不变）
   ↓
★ nodeOps       （唯一的变量）
   ↓
RenderBackend   （可插拔）
```

**切换引擎 = 换 nodeOps 转发目标，其余全部恒定。**

### 2. 方案 B（全局 Dispatcher）

Vue 的 `createRenderer(nodeOps)` 构造时绑定，不能事后更换。因此：

- **方案 A**（每页面一个 renderer）：同页面混合渲染无解
- **方案 B**（全局 renderer + `currentBackend` 转发）：✅ 采用，支持热切换 + 混合渲染

### 3. 职责边界（6 铁律）

| 编号 | 禁令 |
|------|------|
| G-41.1 | 框架不得碰线程 / 原生 View / 平台 SDK |
| G-41.2 | 宿主不得解析 IR / 干预 Diff |
| G-41.3 | 引擎不得感知 Vue |
| G-41.4 | 业务不得有平台判断 |
| G-41.5 | 业务不得假设 JS 运行时 |
| G-41.6 | 注册必须先于 bootstrap |

---

## 验证

### 本地

```bash
bash verify.sh
# → 10/10 步骤全过 → VERIFY: PASS
```

### 三场景（模拟下载解压）

```bash
bash run-all-verify.sh
# 场景 1（工作区）/ 场景 2（包内）/ 场景 3（隔离目录仅有 zip）
# → PASS=3  FAIL=0
```

### 参考实现输出示例

```
[引擎 A: vue-dom] 结构快照:
[{ "semantic": "layout.box", "children": [ { "semantic": "layout.grid", … } ] }]

[引擎 B: terminal] ASCII 渲染:
<layout.box>
  <p-box class=page>
    <p-grid min-col-width=160>
      <p-text>
        "商品 A"
      <p-button variant=primary>
        "加入购物车"

[验证] 同一份 SFC 在两个引擎下渲染，业务代码零改动 ✓
```

**H-03-04 断言两引擎 IR 快照完全一致**——这是"一套代码多引擎"的机器证据。

---

## 依赖

- Node.js ≥ 16（参考实现零第三方依赖）
- 生产实现需：Vue 3.x、`@vue/runtime-core`

---

## 编号避让

`G-41.1`–`G-41.6`、`CMP051`–`CMP058`，与 G-40（`CMP044`–`CMP050`）零冲突。
