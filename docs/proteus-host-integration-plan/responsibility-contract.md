# 职责边界契约（G-41）

> **三方（框架 / 引擎 / 宿主）各自该干什么、绝对不能干什么。**
> 本文所有禁令均有对应的机器可检查断言。

---

## 1. 三方职责总表

| 职责 | 框架 Core | 引擎 Backend | 宿主 Host |
|------|:---------:|:------------:|:---------:|
| IR 标准定义 | ✅ **唯一** | ❌ | ❌ |
| Diff 算法 | ✅ **唯一** | ❌ | ❌ |
| 响应式 / 调度 | ✅ **唯一** | ❌ | ❌ |
| nodeOps SPI 定义 | ✅ **唯一** | ❌ | ❌ |
| 引擎选择策略 | ✅ | ❌ | 可建议 |
| Vue 绑定层 | ✅ **唯一** | ❌ | ❌ |
| IR → 原生 UI 树 | ❌ | ✅ **唯一** | ❌ |
| 布局计算 | 可（framework 模式） | 可（backend 模式） | ❌ |
| 手势桥接 | 定义协议 | ✅ **实现** | 提供原生事件 |
| 进程 / 线程 / 事件循环 | ❌ | ❌ | ✅ **唯一** |
| 执行载体（JSI/AOT） | 声明需求 | ❌ | ✅ **提供** |
| 根容器（原生 View） | ❌ | ❌ | ✅ **提供** |
| 原生能力实现 | ❌（只调 SPI） | ❌ | ✅ |
| 生命周期**契约** | ✅ 定义 | ❌ | ❌ |
| 生命周期**执行** | ❌ | ❌ | ✅ **唯一** |
| 原生桥 | ❌ | ❌ | ✅ **唯一** |

---

## 2. 六条铁律

| 编号 | 条文 |
|------|------|
| **G-41.1** | 框架**不得**直接创建线程、访问原生 View、调用平台 SDK |
| **G-41.2** | 宿主**不得**解析 IR、干预 Diff、决定渲染方式 |
| **G-41.3** | 引擎**不得**感知 Vue、响应式、SFC 的存在 |
| **G-41.4** | 业务代码**不得**出现平台判断或原生 SDK 直接调用 |
| **G-41.5** | 业务代码**不得**假设 JS 运行时存在（复用 G-40.1） |
| **G-41.6** | 宿主**必须**在 bootstrap 前完成 Runtime + Carrier + Backend 注册，且通过 host-conformance |

---

## 3. 禁止清单（含违规示例）

### 3.1 框架侧禁令（G-41.1）

```ts
// ❌ 违规：框架直接开线程
class FrameworkCore {
  schedule() { new Thread(() => this.doSomething()) }   // 违反 G-41.1
}

// ✅ 正确：委托给宿主运行时
class FrameworkCore {
  schedule() { this.runtime.createWorker(task) }        // 走 G-39 SPI
}
```

```ts
// ❌ 违规：框架直接访问原生 View
framework.setRootView(uiView)      // 违反 G-41.1

// ✅ 正确：走引擎的 attachToHost
backend.attachToHost(uiView)       // 引擎是唯一接触原生 View 的一方
```

### 3.2 宿主侧禁令（G-41.2）

```ts
// ❌ 违规：宿主解析 IR
class MyHost {
  onIR(ir) { if (ir.semantic === 'layout.grid') buildCollectionView() }  // 违反 G-41.2
}

// ✅ 正确：宿主只提供容器，IR 交给引擎
class MyHost {
  onIR(ir) { this.backend.consume(ir) }   // 转发，不解析
}
```

```ts
// ❌ 违规：宿主决定渲染方式
host.forceUseUIKit()      // 违反 G-41.2

// ✅ 正确：宿主可"建议"，框架决策
host.suggestBackend('ios-uikit')    // 建议，非强制
```

### 3.3 引擎侧禁令（G-41.3）

```js
// ❌ 违规：引擎 import vue
import { createRenderer } from 'vue'      // 违反 G-41.3

// ✅ 正确：引擎只认 IR
function createNode(ir /* ComponentIRNode */) { /* … */ }
```

### 3.4 业务侧禁令（G-41.4 / G-41.5）

```vue
<!-- ❌ 违规：平台判断 -->
<script setup>
if (isIOS) { … }              // 违反 G-41.4
</script>

<!-- ✅ 正确：语义降级 -->
<script setup>
import { useNative } from 'proteus'
const r = await useNative().scanQR()   // 不支持的端编译期拦截
</script>
```

```ts
// ❌ 违规：假设 JS 运行时
const g = globalThis; g.__myHack = 1      // 违反 G-41.5（AOT 下无 globalThis）

// ✅ 正确：不假设执行环境
```

---

## 4. 跨层调用规则

**允许**（相邻层单向）：

```
业务 → 框架 → 引擎 → 宿主 → 原生
业务 → 框架 → 宿主（框架转交，非直接）
框架 → 宿主（Runtime / Carrier SPI）
```

**禁止**：

```
业务 ⇢ 引擎        （跳层，CMP052）
业务 ⇢ 宿主        （跳层，CMP053）
业务 ⇢ 原生        （跳三层）
框架 ⇢ 原生        （跳层，违反 G-41.1）
引擎 ⇢ 业务        （反向）
宿主 ⇢ 框架 IR 内部 （违反 G-41.2）
```

---

## 5. 补充规则

| 编号 | 条文 |
|------|------|
| **CMP051** | 宿主必须在 `bootstrap()` 之前完成全部注册（Runtime/Carrier/Backend/Capability） |
| **CMP052** | 业务代码禁止直接引用 RenderBackend 或 nodeOps |
| **CMP053** | 业务代码禁止直接调用 HostRuntime 的 `createWorker` / `invokeNative` |
| **CMP054** | 引擎实现中禁止出现 `vue` / `@vue/*` 的 import |
| **CMP055** | 框架代码中禁止出现平台 SDK import（`UIKit` / `android.*` / `@ohos.*`） |
| **CMP056** | 宿主代码中禁止出现 IR 字段名（`semantic` / `ComponentIRNode`）的分支判断 |
| **CMP057** | 引擎切换后必须触发 conformance H-05 热切换验证 |
| **CMP058** | 宿主上线前必须 `HostConformance.run(app).failed === 0` |

---

## 6. 机器可检查性

上述 CMP052–CMP056 是**静态可扫描**的（正则匹配 import / 标识符），已纳入 `host-conformance.md` 的 H-04 组：

```
H-04-01  扫描业务代码：无 RenderBackend / nodeOps 直接引用
H-04-02  扫描业务代码：无 HostRuntime.createWorker / invokeNative 直接调用
H-04-03  扫描引擎代码：无 vue / @vue/* import
H-04-04  扫描框架代码：无平台 SDK import
H-04-05  扫描宿主代码：无 IR 字段分支判断
```

**这五条断言让"职责边界"从文档条文变成 CI 门禁。**
