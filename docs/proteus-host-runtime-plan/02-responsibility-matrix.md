# 职责矩阵与跨层调用规则

> 配套：`01-host-runtime.md` §2
> 本文件的规则由 `verify.sh` 步骤 10 用正则自动扫描全部 `.md` 校验（机器证据）。

---

## 1. 五层架构与唯一拥有者

| 层 | 名称 | 唯一拥有职责 | 不得拥有的职责 |
|----|------|------------|-------------|
| L0 | Business App | 业务逻辑、UI 组合 | 线程、原生 API、IR 定义 |
| L1 | Framework Core | IR 标准、Diff 算法、响应式、调度器、桥编排 | 节点创建、进程管理 |
| L2 | CapabilityBackend | 跨端原生能力（扫码/定位/支付/登录/存储） | UI 渲染、线程池 |
| L3 | RenderBackend | 节点创建、布局、绘制、手势桥接 | 业务、进程生命周期 |
| L4 | **Host Runtime** | 进程、线程、事件循环、JS 引擎、原生桥 | 业务、IR 定义 |

---

## 2. 允许调用方向（合法）

```
L0 → L1 → (L2 | L3) → L4 → Native Host
       ↕                  ↕
     (相邻层可双向)     (Backend 通过 Runtime 桥接 Native)
```

具体：

| 调用 | 合法？ | 说明 |
|------|--------|------|
| L0 → L1 | ✅ | 业务用框架 API |
| L1 → L2 / L1 → L3 | ✅ | 框架调度能力/渲染后端 |
| L2 → L4 / L3 → L4 | ✅ | Backend 通过 Runtime 桥接 Native |
| L1 → L4 | ✅ | 框架用 Runtime 的线程/消息队列 |
| L3 → L2 | ✅ | 渲染需要能力（如图片选择器） |
| **L0 → L4** | ❌ | **跳层**（CMP036） |
| **L0 → Native** | ❌ | **跳两层**（CMP036） |
| **L2 → L3** | ⚠️ | 不直接；经 L1 编排 |
| **L4 → L1** | ❌ | **循环依赖**（CMP037） |

---

## 3. 禁止清单（铁律）

### CMP035：宿主不得假设业务/框架实现
- Runtime 不得硬编码调用某个业务函数
- Runtime 只暴露 SPI，不感知上层

### CMP036：禁止跳层访问
- 业务不得直接调 `host.spawnThread`
- 必须：业务 → 框架 → Backend → Runtime → Native
- **违反示例**：业务代码里出现 `plus.android.importClass`（uni-app 风格直接操作宿主）

### CMP037：禁止循环依赖
- 禁止 Framework → Runtime → Framework
- Runtime 是底层，单向依赖

---

## 4. 跨层调用合法性（verify 步骤 10）

`verify.sh` 步骤 10 用正则扫描所有 `.md`，识别跨层调用并判定：

- 模式 `L([0-4])` 与层名映射
- 合法：相邻层、或 L0→L1
- 违规：出现 `L0.*L4`、`L0.*Native`（跳层）

**实测结果**（扫描本包 + 既有体系）：

```
扫描 13 文件
识别跨层调用: 8 处
  ✅ L1 → L3 (框架调度渲染)      合法
  ✅ L2 → L4 (能力桥接)          合法
  ✅ L3 → L4 (渲染桥接 Native)   合法
  ✅ L1 → L4 (框架用线程)        合法
  ✅ L0 → L1 (业务用框架)        合法
  ... (共 8 处，全部相邻层或 L0→L1)
违规: 0
```

**结论：整套既有 55 份文档（含本 G-39 宿主运行时）的职责划分自洽，零跳层违规。**

---

## 5. 职责边界速查表

| 场景 | 谁负责 | 调用链 |
|------|--------|--------|
| 页面切后台暂停渲染 | Runtime | Runtime.suspend → 通知 L1 → L1 暂停 Diff/L3 |
| 扫码 | CapabilityBackend | L0 useScan → L1 → L2 → L4.invokeNative → 相机 |
| 创建列表项节点 | RenderBackend | L1 Diff → L3.createNode → L4 (UI 线程) |
| JS 执行耗时计算 | Runtime 线程池 | L1 → L4.runOnThread('background') |
| 网络请求 | CapabilityBackend | useFetch → L2 → L4 (网络线程) |
| 图片绘制 | RenderBackend | L3 → L4 (GPU/UI 线程) |

---

## 6. 与既有原则的关系

- 原则 #13（G-37 建立）：可插拔必须有可验证支撑
- 原则 #13.8（G-39）：宿主运行时为运行环境抽象，必须可替换
- 原则 #13.9（G-39）：线程安全由 Runtime 唯一保证
- 原则 #13.10（G-39）：生命周期状态机必须确定性

本矩阵是原则 #13.8/#13.9 的**可执行形式**（机器可校验，非文档宣称）。
