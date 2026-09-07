# 性能深度调研：首屏启动 + 性能上限

> 状态：✅ 落地（v1.0）
> 对齐：`proteus-app-renderer-plan`、`proteus-glass-plan`、`proteus-architecture`（@@@）
> 目标：**把首屏启动从"约等于 RN 新架构"拔高到"逼近 Lynx IFR"**

---

## 0. 一句话结论

**Proteus 的 JSI 直调通道已经和 RN Fabric 同档（亚毫秒调用），但首屏慢于 Lynx IFR 的根因不是 JSI，而是「Vue 响应式启动 + Renderer mount + JSI 绑定」串行执行。** 只要把这条链路改成**并行 + 预编译 + 主线程直出**，首帧可以从 ~400ms 压到 **<200ms**，逼近 Lynx 的 IFR 水平——且**不牺牲 SFC 声明式、不牺牲 Web/小程序同源**。

---

## 1. 首屏成本拆解（必须先量化）

App 冷启动到首帧的**完整链路**与各项典型耗时：

```
T0  ─ 进程 fork
T1  ─ JS 引擎启动 (V8/JSC 初始化)         ~40-80ms
T2  ─ Vue 运行时 + 响应式系统初始化        ~30-60ms
T3  ─ JSI binding 注册 (HostObject 映射)   ~20-40ms
T4  ─ 业务 JS bundle 解析/执行             ~50-150ms   ← 大头
T5  ─ 根组件 render → IR 生成              ~30-80ms
T6  ─ Custom Renderer mount → Native View  ~40-100ms
T7  ─ 首帧 GPU 合成 + 显示                 ~16ms (1 帧)
                                     ─────────────
                 合计                       ~230-530ms
```

**关键洞察**：T1-T7 目前是**串行**的。其中 T4（bundle 解析）和 T5+T6（render+mount）是两大瓶颈。

**对标参照**：
| 方案 | 冷启动首帧 | 说明 |
|------|-----------|------|
| uni-app 传统 (WebView+Bridge) | 800-1500ms | WebView 初始化 + Bridge 注册 |
| RN 新架构 (Fabric, 未优化) | 400-600ms | 跨线程 mount |
| **Proteus 当前设计** | **230-530ms** | 串行链路 |
| **Proteus 优化目标** | **<200ms** | 并行 + AOT + IFR |
| Lynx IFR | 120-200ms | 首帧 JS 主线程直出 |
| 纯原生 | 80-150ms | 无 JS 引擎 |

**目标可实现性**：<200ms 不是幻想——只要做到 §3 的 (1)(2)(3) 三条，即可逼近 Lynx。

---

## 2. 为什么 Lynx IFR 快（根因分析）

Lynx 的 **IFR（Instant First Render）** 核心机制：

1. **首帧 JS 在主线程跑**：不跨线程，省掉 Bridge 通信
2. **UI 描述预编译为二进制**：跳过模板解析
3. **MTS 调度**：手势/动画后续钉主线程，逻辑切后台
4. **PrimJS 轻量引擎**：210KB，启动比 V8/Hermes 快 5x

**Proteus 不能照搬的点**：
- ❌ 不能换掉 V8/JSC（要保 Vue/Web 生态）→ 但可以**预热引擎**
- ❌ 不能让 Vue 响应式跑 UI 线程（会阻塞）→ 但可以**把首帧渲染脱离响应式**

**Proteus 可借鉴的点**：
- ✅ UI 描述预编译（IR → 二进制指令，**AOT**）
- ✅ 首帧直出（首屏绕过 Vue 运行时，**静态首帧**）
- ✅ 主线程 worklet 隔离（高频操作用 JSI 同步落 Native）

---

## 3. 性能上限拔高：四大机制（核心方案）

### 机制 (1)：AOT 预编译 + IR 固化

**现状**：每个页面 `.vue` → 运行时解析模板 → 生成 IR → Renderer 消费。**解析在运行时发生，浪费 T5。**

**优化**：Compiler 在**构建期**就把 SFC 模板编译成 **Native 指令序列（AOT）**，产物随 bundle 下发。运行时**直接执行指令**，跳过模板解析。

```
构建期：.vue → Compiler → IR → NativeInstruction[] (二进制/紧凑数组)
运行时：Instruction[] → 直接调 JSI 建 Native View  (T5 ≈ 0)
```

**效果**：T5 从 30-80ms → **<5ms**（只剩数组遍历）

**对齐现有架构**：`--trace-transform` 已经输出 IR，**只需把 IR 序列化为 AOT 产物**，落 `compiler/codegen/aot.ts`。

### 机制 (2)：静态首帧 + 运行时接管（IFR 思路）

**核心思想**：首屏用**预编译的静态 UI 描述**直接建 Native View（不经过 Vue 响应式），等业务 JS 就绪后再"接管"动态能力。

```
阶段 A (首帧, 主线程)：
  AOT 指令 → JSI → Native View 直出      [~80-120ms, 无 Vue 开销]

阶段 B (后台, 并行)：
  Vue 启动 + bundle 解析 + 响应式初始化   [与 A 并行]

阶段 C (接管)：
  Vue 树 diff → 增量更新 Native View      [仅差异, 开销小]
```

**关键**：A 和 B **并行**，首帧不看 Vue 脸色。这正是 Lynx IFR 的本质。

**效果**：首帧从 T1+T2+...+T7 串行 → **max(T1+AOT, T4_bundle)**，从 ~400ms → **<200ms**

### 机制 (3)：JSI Binding 预热 + 懒注册

**现状**：T3（binding 注册）串行在启动时。

**优化**：
- **引擎预热**：App 启动早期（闪屏阶段）就 fork JS 引擎 + 预执行 binding 注册脚本
- **懒注册**：只注册首屏需要的 HostObject，非首屏模块按需注册

**效果**：T1+T3 从 60-120ms → **~20ms**（分摊到闪屏期）

### 机制 (4)：主线程 Worklet 隔离（高频不掉帧）

**对齐 §5 性能对标结论**——这是必须补的机制：

| 场景 | 不用 Worklet | 用 Worklet (JSI 同步) |
|------|-------------|----------------------|
| 滚动列表 | 30-45fps | **58-60fps** |
| 手势拖拽 | 掉帧明显 | 跟手 120fps |
| Glass 动态形变 | JS 线程卡顿 | UI 线程直接改 Native |

**实现**：借鉴 RN Reanimated 3 的 `worklet` + Lynx MTS：
```ts
// 业务层声明
const onScroll = worklet((offset: number) => {
  // 此函数运行在 UI 线程, 直接 JSI 调 Native
  nativeView.setTranslationY(offset)
})
```
Compiler 把 `worklet` 函数**提取为独立片段**，运行时注册到 UI 线程的 JSI runtime。

**对齐架构**：`p-*` 组件的手势/动画属性自动包成 worklet，业务零感知。

---

## 4. 三端统一的性能策略（差异化拔高）

| 端 | 启动瓶颈 | Proteus 优化 | 对标上限 |
|----|---------|-------------|---------|
| **Web** | JS bundle 解析 + 首屏渲染 | **流式 SSR + 组件级懒加载 + Vite 预构建** | 接近 Next.js App Router |
| **小程序 Skyline** | 初始化 + 首屏 setData | **分包预下载 + 首屏静态 WXML + 按需注入** | Skyline 官方上限 |
| **App (iOS/Android/鸿蒙)** | 见 §1 | **AOT + IFR + Worklet（§3）** | **逼近 Lynx** |

**关键差异化**：**Web 和小程序端用平台原生最佳实践，App 端用 AOT+IFR 拔高**——三端共享 SFC 和业务逻辑，但**启动优化各走各的平台最强路径**。这是 uni-app、RN、Lynx **都做不到的**（它们要么单端、要么共用一套渲染假设）。

---

## 5. 与 Lynx / RN 新架构的最终对标（修订版）

| 维度 | RN Fabric | Lynx | **Proteus (优化后)** |
|------|-----------|------|---------------------|
| 调用通道 | JSI 同步 | PrimJS 双线程 | JSI 同步 ✅ 同档 |
| 首帧 | 跨线程 ~400ms | **IFR <200ms** | **IFR <200ms** ✅ 追平 |
| 启动引擎 | Hermes | PrimJS (轻量) | V8/JSC (预热) ≈ |
| 手势/动画 | Reanimated worklet | MTS worklet | **Worklet (§3-4)** ✅ 追平 |
| Layout | Yoga (C++) | Lynx Engine (C++) | **平台原生 layout binding** ✅ 差异化 |
| AOT 预编译 | 无 | 二进制 UI | **IR AOT** ✅ 追平 |
| **三端同源** | ❌ (Web 另套 RNW) | △ (Web 有, 小程序无) | **✅ Web+小程序+App** |
| **Glass L3 系统质感** | 手搓 TurboModule | 社区少 | **p-glass preset 统一** ✅ 领先 |

**结论**：**四条机制落地后，Proteus App 端性能上限从"约等于 RN"提升到"逼近 Lynx IFR"，同时在三端同源 + 编译透明 + Glass L3 三个维度保持领先。** 这是 Proteus 相对三家（uni-app / RN / Lynx）的完整竞争力画像。

---

## 6. 风险与诚实边界

| 风险 | 说明 | 对策 |
|------|------|------|
| AOT 产物体积膨胀 | 预编译指令增加 bundle | 指令用紧凑二进制 + 按需加载 |
| 静态首帧 vs 动态内容 | 首屏若强依赖异步数据，IFR 收益打折 | 首帧渲染骨架 + 数据到位后接管 |
| Worklet 学习成本 | 业务需理解 UI 线程边界 | `p-*` 组件内置 worklet，默认零感知 |
| JSI 多线程复杂度 | 主线程/JS 线程/Worklet 线程三线程 | §3 机制 (4) + 严格规则 + DevTools TraceBus 可视化 |
| 鸿蒙/Android layout binding | 平台差异 | M2 阶段定夺后端（§app-renderer 05-thread-model） |

---

## 7. 下一步

- 详见 `02-strategy.md`（四大机制的完整设计与伪代码）
- 详见 `03-aot-codegen.md`（AOT 指令格式 + Compiler 集成）
- 详见 `04-ifr-static-first-frame.md`（静态首帧 + 接管协议）
- 详见 `05-worklet.md`（UI 线程 worklet 规范）
- 对齐 `proteus-app-renderer-plan/05-thread-model.md`（三线程模型）
- 执行位：**G-30（性能优化阶段）**，在 G-22 App Renderer 稳定后启动
