# 生命周期与线程模型

> 配套：`01-host-runtime.md` §4 §5

---

## 1. 生命周期状态机（L4 唯一拥有）

### 1.1 状态

| 状态 | 含义 | 可执行操作 |
|------|------|----------|
| `bootstrapping` | 初始化中 | 创建引擎、注册能力 |
| `running` | 前台运行中 | 全量（渲染/JS/能力） |
| `suspended` | 后台挂起 | 仅保留最小状态，暂停渲染/JS |
| `destroyed` | 已销毁 | 无 |

### 1.2 转换

```
bootstrap()         suspend()          resume()
init → bootstrapping ──▶ running ──▶ suspended ──▶ running
                          │                │
                    destroy()         destroy()
                          ▼                ▼
                       destroyed ◄─────── (resume 前 destroy 则忽略)
```

- `bootstrap()` 返回 `Promise<AppInstance>`，完成后入 `running`
- `suspend()`：暂停渲染 + 暂停 JS 事件循环 + 释放后台线程
- `resume()`：恢复渲染 + 重启事件循环
- `destroy()`：销毁引擎、Worker、原生桥，释放资源

### 1.3 Backend 只订阅，不判断

```typescript
// ✅ 正确：Backend 订阅生命周期事件
runtime.on('suspend', () => renderBackend.pause());
runtime.on('resume',  () => renderBackend.resume());

// ❌ 错误：Backend 自己监听平台前后台
document.addEventListener('visibilitychange', ...)  // CMP035
```

---

## 2. 线程模型（L4 唯一拥有）

### 2.1 线程角色

| 线程 | 职责 | 宿主映射 |
|------|------|---------|
| Main / UI 线程 | UI 操作、事件循环 | iOS Main / Android Main Looper / Web Main |
| Background 线程 | 耗时计算、网络、文件 | GCD / ThreadPool / Web Worker |
| Native 线程 | 原生能力回调 | 各平台 |

### 2.2 API

```typescript
interface ProteusHostRuntime {
  runOnThread(thread: 'main' | 'background', task: () => void): void;
  createWorker(script: string): WorkerHandle;
  postMessage(target: WorkerHandle | 'main', msg: any): void;
  enqueue(task: () => void, priority?: number): void;  // 主线程任务队列
  nextTick(fn: () => void): void;
}
```

### 2.3 规则

| 规则 | 说明 |
|------|------|
| **G-39.2** 线程唯一拥有 | Backend 不得 `pthread_create` / `new Thread` |
| 主线程不阻塞 | UI 操作 + 微任务，耗时 → background |
| 线程安全 | 跨线程数据通过 `postMessage`（结构化克隆），禁止共享内存 |
| UI 操作回主线程 | Native 回调 → Runtime → 切主线程 → JS |

### 2.4 宿主映射

| 宿主 | 主线程 | 后台 | 消息队列 |
|------|--------|------|---------|
| iOS | Main (UIKit) | GCD `dispatch_async` | CFRunLoop |
| Android | Main Looper | ThreadPoolExecutor | Handler/Looper |
| Web | Main | Web Worker | Event Loop |
| Flutter | UI Isolate | Compute Isolate | Dart EventQueue |
| Harmony | Main | TaskPool | EventHandler |
| Terminal | 单线程 | ❌ (capabilities.threads.background=false) | libuv |

**Terminal 特例**：单线程，`runOnThread('background', ...)` 降级为 `nextTick`（任务排队在主线程）。这是"能力诚实声明 + 降级"的体现。

---

## 3. 任务优先级

```
enqueue(task, priority)
  priority: 0 (最高, UI 更新) > 1 (交互) > 2 (默认) > 3 (空闲)
```

- 渲染帧相关任务：priority 0
- 用户交互响应：priority 1
- 普通逻辑：priority 2
- 预加载/埋点：priority 3（idle 执行）

---

## 4. 事件循环

```
loop:
  while running:
    task = dequeue()        // 按优先级
    run(task)               // 在对应线程
    drainMicrotasks()        // Promise/nextTick
    if hasRAF: runRAF()     // 渲染帧
```

`nextTick(fn)` → 当前帧末尾的微任务队列。
`setInterval(fn, ms)` → 返回 TimerHandle，可被 `clearInterval` 取消（销毁时 Runtime 自动清理，防泄漏）。
