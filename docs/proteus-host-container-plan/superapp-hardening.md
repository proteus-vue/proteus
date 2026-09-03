# 超级应用加固：多业务沙箱与崩溃隔离

> **定位**: G-42 核心文档之一
> **核心论点**: 容器形态硬编码是传统框架的死穴；Proteus 把它变成可插拔策略

---

## 1. 为什么超级应用难做

### 1.1 传统方案的做法

uni-app / RN 做超级应用，通常是在业务代码里**手写**一套隔离逻辑：

```js
// 传统：业务自己实现隔离（每个团队各写一套）
class MiniProgramManager {
  constructor() {
    this.programs = new Map()
    // 手搓沙箱、手搓配额、手搓崩溃捕获
  }
}
```

**问题**：
- 每个超级 App 重复造轮子
- 隔离强度取决于团队水平
- 框架升级时自己写的隔离层要跟着改

### 1.2 Proteus 的做法：容器是 SPI

```typescript
// 选一个容器策略即可
const container = createContainer('superapp', {
  sandbox: { enabled: true },
  quota: { memory: 128 * 1024 * 1024 },
  crashIsolation: true,
})
```

**同一份业务代码，换容器策略 = 换应用形态。** 这就是"不绑容器形态"。

---

## 2. SuperAppContainer 四大能力

```
┌─────────────────────────────────────────────┐
│           SuperAppContainer                 │
├─────────────────────────────────────────────┤
│  ① 业务沙箱     独立上下文，互不干扰         │
│  ② 崩溃隔离     A 崩溃不影响宿主和 B         │
│  ③ 资源配额     内存/CPU/存储上限 + 回收     │
│  ④ 安全网关     签名/API白名单/权限           │
└─────────────────────────────────────────────┘
```

---

## 3. ① 业务沙箱

### 3.1 隔离维度

| 维度 | 隔离方式 |
|------|---------|
| **全局对象** | 每个业务独立 `globalThis` 代理 |
| **存储** | 独立命名空间（`/data/proteus/{bizId}/`） |
| **网络** | 独立拦截器 + 域名白名单 |
| **组件注册表** | 独立组件作用域，避免命名冲突 |
| **路由** | 独立路由栈（多栈并行） |
| **样式** | 作用域隔离（CSS Modules / 命名空间） |

### 3.2 沙箱接口

```typescript
interface BusinessSandbox {
  readonly bizId: string
  readonly scope: SandboxScope      // 独立作用域
  readonly storage: NamespacedStorage
  readonly router: IsolatedRouter
  readonly quota: QuotaHandle

  load(entry: string): Promise<void>
  unload(): Promise<DestroyReport>
  isAlive(): boolean
}
```

**关键**：业务之间**不共享任何可变全局状态**——这是崩溃隔离的前提。

---

## 4. ② 崩溃隔离（G-42.5）

### 4.1 崩溃捕获边界

```
业务 A 执行
   ↓ 抛异常
容器捕获（try/catch + 全局 error handler）
   ↓
标记 A 为 crashed，卸载 A 的挂载点
   ↓
★ 宿主存活，业务 B 不受影响
```

### 4.2 三级隔离强度

| 强度 | 机制 | 适用场景 |
|------|------|---------|
| **L1 逻辑隔离** | try/catch + error boundary | 同进程业务 |
| **L2 上下文隔离** | 独立沙箱 + 资源配额 | 第三方业务 |
| **L3 进程隔离** | 独立进程 / Worker | 不可信业务 |

**铁律 G-42.5**：超级应用容器必须提供 ≥L1 崩溃隔离，且崩溃后宿主必须存活。

### 4.3 崩溃恢复

```typescript
interface CrashPolicy {
  isolationLevel: 1 | 2 | 3
  autoRestart: boolean       // 崩溃后自动重启业务
  maxRestartCount: number    // 默认 3，超过则永久禁用
  reportToHost: boolean      // 上报宿主
}
```

---

## 5. ③ 资源配额

### 5.1 配额维度

| 资源 | 默认值 | 超限行为 |
|------|--------|---------|
| **内存** | 128 MB / 业务 | 触发 LRU 回收，再超限则卸载 |
| **页面栈深度** | 10 / 业务 | 销毁最旧页面 |
| **CPU 时间片** | 后台业务降频 | 节流 |
| **存储** | 50 MB / 业务 | 拒绝写入 |
| **网络并发** | 6 / 业务 | 排队 |

### 5.2 配额接口

```typescript
interface QuotaHandle {
  request(bytes: number): boolean   // 申请内存
  release(handle: number): void     // 归还
  get usage(): QuotaUsage           // 当前用量
  onPressure(cb: (level: PressureLevel) => void): void
}
```

**内存压力分级**：`normal` → `warning`（触发 LRU）→ `critical`（卸载最旧业务）

---

## 6. ④ 安全网关

### 6.1 三层防护

```
① 代码签名      业务包必须 signed，未签名拒绝加载
② API 白名单     业务只能调用声明过的原生能力
③ 权限网关       敏感能力（定位/相机/通讯录）需宿主授权
```

### 6.2 能力声明（与 G-28 协同）

```typescript
// 业务包 manifest
{
  "bizId": "shop",
  "version": "1.0.0",
  "capabilities": ["camera", "location"],   // 声明需要的能力
  "signature": "sha256:..."
}
```

宿主在加载时校验：
- 签名有效？
- 声明的能力是否在白名单内？
- 敏感能力是否已被宿主授权？

**任何一项不通过 → 拒绝加载**（不是运行时报错）。

---

## 7. 与竞品对比

| 维度 | uni-app 小程序容器 | **Proteus SuperAppContainer** |
|------|------------------|------------------------------|
| 容器形态 | 硬编码 | **可插拔 SPI（6 种）** |
| 崩溃隔离 | 弱（同进程共享） | **三级可选，宿主必存活** |
| 资源配额 | 无 | **内存/CPU/存储/并发** |
| 安全网关 | 宿主自己写 | **框架内置三层** |
| 业务热更新 | 有 | **有 + 签名校验** |

---

## 8. 小结

> **超级应用加固不是"加功能"，而是"把容器形态从硬编码变成可插拔策略"。**
> **同一份业务代码，换容器 = 换应用形态——这是方法论第六次泛化的直接产物。**
