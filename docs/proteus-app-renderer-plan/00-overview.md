# Proteus App 渲染器落地方案（proteus-app-renderer-plan）

> **归属**：App 层 / 原生渲染后端
> **执行位**：G-22（组件体系 G-06 之后、Testing G-07 之前）
> **scope**：`@proteus-vue/app-renderer`
> **版本**：v1.0（对齐 proteus-architecture G-01~G-28）

---

## 0. 一句话定位

Proteus 的 **App 端渲染后端**：把同一份 SFC，经 Compiler → IR，通过 **Vue 3 Custom Renderer + JSI 同步绑定**，直接驱动 iOS / Android / 鸿蒙 ArkUI 的原生视图树，让 App 端获得 **系统级能力（Glass L3、原生手势、原生动画）** 与 **同步调用的性能天花板**。

设计哲学借鉴 **NativeScript 的架构思想**（Native API 100% 可达、同步直调、类型映射），但**不照搬其全栈**——SFC 模板、`p-*` 组件、Web 优先战略全部保留，App 只是"多一个渲染后端"。

---

## 1. 为什么需要独立的 App 渲染器

| 端 | 渲染后端 | 能力上限 |
|----|---------|---------|
| Web | DOM / CSSOM | 浏览器上限 |
| 小程序 Skyline | WXML + worklet | Skyline 上限 |
| **App** | **原生视图树（需本方案）** | **系统级 API 上限** |

Web / Skyline 后端**根本调不到** `UIGlassEffect`、ArkUI fractal 这类系统级玻璃 API，只能 CSS 模拟。只有 App 原生端能解锁 **Glass L3**——这正是 Proteus 相对 uni-app 的差异化杀招（uni-app 的 App 端玻璃也停在 CSS / 原生组件封装层）。

---

## 2. 核心架构决策

### 2.1 借鉴 NativeScript，但不照搬

| NativeScript 值得借鉴 | Proteus 采纳方式 |
|----------------------|----------------|
| Native API 100% 可达 | ✅ `assertPlatform('app')` + JSI 直调任意 Native API |
| 同步调用、零序列化 | ✅ JSI（JavaScript Interface）同步通道 |
| TypeScript 映射 Native 类型 | ✅ 从 SDK 头文件自动生成 `.d.ts` |
| UI 声明用 JS 创建 View | ❌ 保留 SFC 模板 + `p-*` |
| 放弃 Web 优先 | ❌ App 是补充，Web+小程序是核心 |

### 2.2 技术选型

```
SFC → Compiler IR → Custom Renderer → Native View 指令 → JSI → Native API
                                                    ↑
                                          借鉴 NativeScript binding
```

- **渲染层**：Vue 3 `createRenderer`（nodeOps + patchProp）
- **通信层**：JSI 同步绑定（非 React Native 异步 Bridge）
- **类型层**：SDK 头文件 → `.d.ts` 自动生成

---

## 3. 与现有 20 份 plan 的对齐

| 层 | 对接点 |
|----|--------|
| Component | `p-*` → Native View 映射表 |
| Platform | `assertPlatform('app')` + 判别联合 |
| Glass | L3：iOS `UIGlassEffect` / 鸿蒙 fractal 经 JSI 直调 |
| Types | Native SDK 类型自动生成（对齐 miniprogram-api-typings 思路） |
| Compiler | IR → Native 指令序列 + `--trace-app` |
| DevTools | TraceBus 可视化 JSI 调用链 |

---

## 4. 文档清单（14 份）

```
00-overview.md              本文件：定位/决策/对齐
01-architecture.md          分层架构 / JSI 双引擎 / 渲染管线
02-native-binding.md        JSI binding 规范 / 线程模型
03-renderer-pipeline.md     Custom Renderer 实现 / diff / commit
04-component-mapping.md     p-* → Native View 映射表
05-thread-model.md          UI 线程 / JS 线程 / 跨线程边界
06-gesture-animation.md     原生手势 / 动画 / 转场
07-glass-l3-integration.md  Glass L3 对接（UIGlassEffect / fractal）
08-type-generation.md       SDK → .d.ts 自动生成
09-compiler-ir-integration.md  IR → Native 指令 + --trace-app
10-audit-performance.md    审计 / 帧率 / 内存预算
11-degradation-bridge.md    降级策略 / 旧端 Bridge 兜底
12-batches.md               M1-M6 分批 + Prompt 模板
13-migration-boundary.md    明确不做项 + Roadmap
```

---

## 5. 铁律（对齐全局 9 条）

- **A-01**：App 端不得破坏 Web / 小程序双端一致性，业务层零平台分支
- **A-02**：所有 Native 调用走 JSI 同步通道，禁止自行造 Bridge
- **A-03**：Native 类型自动生成，禁止手写 SDK 类型
- **A-04**：Glass L3 仅在 App + 高版本系统解锁，低版本降级 L1
- **A-05**：跨线程访问必须显式标注，禁止隐式跨线程

---

## 6. 边界（明确不做）

- ✅ 做：Custom Renderer、JSI binding、Glass L3、类型生成、手势/动画
- ⏸ 搁置：CI 环境策略（与 Testing plan 一致）、热更新、多进程架构
- ❌ 不做：放弃 SFC 模板、放弃 Web 优先、国内 ROM 私有 API 主干

---

## 7. 验收门槛（G-22 完成定义）

- [ ] JSI 骨架跑通：能从 JS 同步创建首个 Native View
- [ ] `p-view` / `p-text` / `p-image` 映射可用
- [ ] Glass `regular` preset 在 iOS 真机走 `UIGlassEffect`
- [ ] 长列表 1000 条 ≥ 55fps
- [ ] `proteus audit app` 通过
- [ ] 三端（Web / Skyline / App）同一 SFC 渲染一致
