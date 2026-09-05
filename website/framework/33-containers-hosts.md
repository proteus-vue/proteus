---
title: 容器与宿主
order: 15
group: 宿主与内存
---

# 容器与宿主

容器、宿主运行时、执行载体是运行期的三层「唯一拥有者」：**容器（G-42）**管页面生命周期与资源回收，**宿主运行时（G-39）**管进程、线程与原生桥，**执行载体（G-40）**管 JS 代码在哪条路径上跑。三层都是可插拔 SPI——业务只依赖页面语义，不感知实现。

> **容器管「页面怎么销毁」，所有权（G-43）管「资源归谁」**——两者合并才是完整的运行期内存治理（见[所有权工程](/docs/framework/34-ownership)）。

## 六容器形态

容器形态不绑定：六种策略覆盖从单页应用到超级应用的全部宿主场景，基于同一份页面生命周期契约：

| 容器 | 场景 | 关键能力声明 | 状态 |
|---|---|---|---|
| `singlepage` | 单页应用 / 落地页 | 单槽 replace，无页面栈 | ✅ |
| `stack` | 常规多页应用 | pageStack + keepAlive（LRU）+ 配额 | ✅ |
| `superapp` | 超级应用多业务 | multiBusiness + 崩溃隔离 L2 + 沙箱 / 安全网关 | ✅ |
| `miniprogram` | 小程序宿主语义 | 10 层导航栈 + tab 保活 + 崩溃隔离 L1 + 沙箱 | ✅ |
| `window` | 桌面多窗口 | windowManagement，每窗口各持独立栈 | ✅ |
| `embedded` | 嵌入已有宿主的挂载点 | 单槽嵌入，随宿主生命周期 | ✅ |

```ts
import { createStackContainer } from '@proteus-vue/render-backend'

const container = createStackContainer({ quotaLimitBytes: 512 * 1024 * 1024 })
await container.initialize()
const page = await container.push({ irId: 'home' }) // 页面栈 / keepAlive / 配额按能力声明生效
```

六容器均提供可运行实现（stack / superapp / 四基础容器，conformance 零 FAIL）；真实宿主 App 的规模化验证 🟡 持续进行。

## 页面生命周期：状态机 + 五原子销毁

页面状态由状态机唯一约束，非法迁移直接拒绝：

- `created → mounted ⇄ hidden → destroyed → recycled`
- `mounted → crashed → destroyed`（崩溃页只能销毁，由容器重启策略接管）

销毁固定为**五原子步序**，步数与顺序由 `assertAtomicDestroy` 机器校验，违反即抛错：

1. `unmount` —— 卸载组件树
2. `unbindEvents` —— 解绑全部事件（含强制失效借用）
3. `releaseResources` —— ResourcePool 全清，委托所有权 Drop 协议 forceDrop
4. `destroyIR` —— 销毁 IR 实例（IR 单一 Owner）
5. `releaseQuota` —— 归还全部配额

`PageHandle` 携带的 `resourcePool` 让业务无需手写清理：登记进池的资源随销毁一次性释放；conformance 用「销毁后资源池总量 = 0」做泄漏检测的机器证据。

## Conformance：能力门控

容器 conformance 共 38 项（C-01 ~ C-08），核心机制是**能力门控**——容器如实声明 `capabilities`（CMP065），未声明的能力组诚实 SKIP，声明了就必须全过：

| 组 | 覆盖 | 项数 | 门控条件 |
|---|---|---|---|
| C-01 | 容器身份与能力声明 | 4 | 必测 |
| C-02 | 页面生命周期状态机 | 5 | 必测 |
| C-03 | 五原子销毁 | 6 | 必测（核心） |
| C-04 | 页面栈治理 | 4 | `pageStack` |
| C-05 | 泄漏检测（销毁后资源池 = 0） | 5 | 必测（核心） |
| C-06 | 配额管理 | 4 | `resourceQuota` |
| C-07 | 沙箱与崩溃隔离 | 6 | `multiBusiness` |
| C-08 | 安全网关 + 严禁 fork 仓库扫描 | 4 | 网关按 `_security` 声明 |

C-08 的 fork 扫描（`proteus conformance --repo <dir>`）机器检测宿主仓库是否 fork 框架内部实现（G-42.6 严禁 fork——命中即 FAIL，CI 阻断）。

## 宿主运行时（G-39）

宿主运行时是 L4 层唯一拥有者，SPI 与渲染 / 编译后端同形（15 + 3 可选方法）：

- **生命周期**：`bootstrap` / `suspend` / `resume` / `destroy`——四状态机（bootstrapping / running / suspended / destroyed）由 Runtime 唯一拥有，后端只订阅事件，不得自行判断前后台
- **线程模型**：`createWorker` / `postMessage` / `runOnThread`——线程池与任务优先级唯一归属
- **JS 引擎**：`createEngine` / `evalInEngine`——执行载体插槽（见下节）
- **原生桥**：`invokeNative` / `registerNativeHandler`——统一序列化 + 线程切换
- **事件循环**：`enqueue` / `nextTick` / `setInterval` 等——任务优先级唯一归属

状态：📋 SPI 已定形（conformance 42 项），Web / Terminal 参考实现已入库，iOS / Android / Harmony 真实宿主工程分批接入。

## 执行载体（G-40）

编译器 emit 产物决定执行路径，载体切换对业务透明：

| 载体 | 产物 | 特点 |
|---|---|---|
| JSI（默认） | JS bundle / bytecode | 完整 JS 生态 + 热更新；bytecode 优化启动 |
| AOT | 原生代码 | 无 JS 边界 + 真并发，实时能力的终点；失去动态性 |
| WASM | wasm 模块 | 沙箱隔离路径 |

配套铁律：**业务禁止假设 JS 运行时存在**（G-40.1：禁 `eval`、禁依赖 `setTimeout` 精确时序、禁 `Proxy` 运行时拦截等）；同一份源码在三路径下语义等价（G-40.2）；超过 4KB 的大块数据强制走 ArrayBuffer 零拷贝、目标端不支持时显式降级（G-40.4）。

状态：📋 规划已入库——JSI / AOT 双参考实现与实时逃逸闭环可运行，生产 AOT 路径随编译器后端落地。

## Tier 组合声明

宿主 × 引擎的每个组合按 **Tier** 声明并机器验证（Tier 1 = 承诺验证 / Tier 3 = 混入可行不承诺 / Tier 0 = 跨生态不合法），详见[一致性验证](/docs/framework/29-conformance)。

## 下一步

- [一致性验证](/docs/framework/29-conformance)：Tier 矩阵与 conformance 套件
- [路由](/docs/16-router)：页面栈之上的导航语义
- [所有权工程](/docs/framework/34-ownership)：页面销毁如何做到不可泄漏
