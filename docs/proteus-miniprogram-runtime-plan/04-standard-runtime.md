# G-48 标准运行时内核

> 定义"小程序怎么跑"：AppService（逻辑层）+ PageFrame（视图层）+ setData 通信 + 生命周期 + 代码包加载。寄宿于 G-39 HostRuntime。

---

## 1. 核心模型：双线程（语义优先，MVP 单进程模拟）

### 1.1 为什么必须双线程

微信/支付宝小程序**强制分离**：逻辑层（AppService）**不可操作 DOM**，视图层（WebView）**不可执行业务逻辑**，两者**只能通过 setData 通信**。

**若运行时用单线程直通（逻辑层直接改 DOM），则标准小程序代码无法运行**——因为它们假设 `AppService` 与 `WebView` 是隔离的（如逻辑层拿不到 `document`）。

### 1.2 MVP：单进程模拟双线程

**策略**：同一进程内，**严格隔离**逻辑层与视图层——

- 各自拥有**独立的 JS 上下文**（逻辑层 context ≠ 视图层 context）
- 通信**只走消息队列**（setDataChannel），**禁止直接引用**
- **语义与真双线程完全一致**；进程/线程级隔离 → **G-49**

**好处**：先验证**架构正确性**（双线程语义、setData 协议、生命周期），再投入真隔离的工程量。**这是 G-40（执行载体）的教训：先跑通再优化。**

---

## 2. AppService（逻辑层）

### 2.1 职责

- 执行 `App()` / `Page()` 定义（收集配置，**不立即执行渲染**）
- 持有**全局状态**（`getApp().globalData`）
- 处理**业务逻辑 + 网络请求 + 调用 PlatformAdapter 能力**
- **不可操作 DOM**（运行时约束，conformance 校验）

### 2.2 生命周期

```
bootstrap()
   ↓
onLaunch(options)         ← 小程序初始化
   ↓
onShow(options)           ← 前台
   ↓
  [ 页面栈变化 ]
   ↓
onHide()                  ← 后台
   ↓
onError(err)              ← 全局异常
   ↓
destroy()                 ← 销毁（G-43 Drop 所有权级联释放）
```

### 2.3 页面栈管理

```typescript
interface PageStack {
  push(route: string, params?: object): PageFrame;
  pop(): PageFrame;
  getCurrent(): PageFrame | null;
  getAll(): PageFrame[];
}
```

页面栈变更触发 `setData`（视图层同步）。

---

## 3. PageFrame（视图层）

### 3.1 职责

- 将 **WXML 模板 + setData 数据** 渲染为节点树（走 G-27 渲染 Backend）
- 接收 `applyDataChange` 更新（**diff + patch**）
- 用户交互 → `emit` 事件 → 逻辑层
- **不可执行业务逻辑**（只做渲染 + 事件转发）

### 3.2 渲染后端对接（复用 G-27）

PageFrame 的渲染**走 G-27 Backend SPI**：

- H5：`VueDomBackend`（DOM）
- App：`NativeBackend`（原生 UI）
- 数据大屏：`SkiaBackend`（Canvas）
- **同一小程序在不同宿主，页面可自动选最优后端**（G-27.7）

---

## 4. setData 通信通道

### 4.1 协议

```typescript
type DataChange =
  | { op: 'set', path: string, value: Serializable }   // 路径赋值
  | { op: 'merge', data: Record<string, Serializable> } // 批量合并
  | { op: 'replace', root: Serializable };              // 根替换

interface SetDataChannel {
  setData(pageId: string, change: DataChange): void;
  postEvent(pageId: string, eventName: string, payload: Serializable): void;
}
```

### 4.2 约束（conformance 校验）

- **可序列化**：禁止函数、循环引用、undefined（JSON-safe）
- **路径合法**：`set('list[0].name', v)` 路径须可解析
- **单向数据流**：视图层**不得反向修改**逻辑层状态（只能通过 `postEvent`）
- **批处理**：同一 tick 多次 setData → **合并为一次**（性能，G-40 执行载体批处理通道）

### 4.3 MVP 消息队列实现

```typescript
class InProcessChannel implements SetDataChannel {
  private queue: Message[] = [];
  setData(pageId, change) {
    this.queue.push({ type: 'data', pageId, change });
    this.flush(); // 微任务末尾
  }
  private flush() {
    queueMicrotask(() => {
      while (this.queue.length) {
        const msg = this.queue.shift()!;
        if (msg.type === 'data') this.page(msg.pageId).applyDataChange(msg.change);
        else this.appService.handleEvent(msg.pageId, msg.eventName, msg.payload);
      }
    });
  }
}
```

**注意**：即使单进程，也通过 `queueMicrotask` **模拟异步边界**——保证与真双线程语义一致。

---

## 5. 代码包加载（复用 G-45 DynamicBackendModule）

### 5.1 流程

```
下载代码包 → 校验签名+manifest(G-45.7/8) → 解析 app.json(路由+分包) →
装载主包 → 装载可见分包 → 执行 App() bootstrap → pending 调用回放(G-45 转发桩)
```

### 5.2 分包（subPackages）

- 主包：启动时加载（限制 2MB，微信标准）
- 分包：访问对应页面/组件时**按需下载**
- **装载即验证**：每个分包走 conformance 快检（同能力 shape 一致）

### 5.3 装载失败处理

- **网络失败**：重试（指数退避）→ 仍失败 → 降级提示
- **校验失败**：拒绝装载 + 降级后端兜底（**不崩溃**）
- **兼容失败**：ABI 不匹配 → 提示更新宿主

---

## 6. 生命周期调度

| 小程序 | 运行时触发 | 对应 G-43（所有权） |
|--------|----------|----------|
| `onLaunch` | 首次 bootstrap | 所有权创建 |
| `onShow` / `onHide` | 前台/后台切换 | 资源暂停/恢复 |
| `onError` | 全局异常 | 错误所有权归属 |
| `onUnload`(page) | 页面出栈 | **页面级资源释放** |
| `destroy`（整体） | 小程序关闭 | **级联释放所有权**（G-43 Drop） |

**关键**：小程序销毁时，**必须级联释放所有资源**（定时器、事件监听、网络请求、文件句柄）——这是 G-43 所有权/Drop 模型的直接应用，详见 `07-sandbox-isolation.md`。

---

## 7. conformance 用例（标准符合性）

| 编号 | 场景 | 期望 |
|------|------|------|
| RT-01 | AppService 逻辑层访问 DOM | **拒绝**（抛 `DOM_ACCESS_DENIED`） |
| RT-02 | setData 传函数 | **拒绝**（序列化失败） |
| RT-03 | setData 循环引用 | **拒绝**（序列化失败） |
| RT-04 | 视图层直接改逻辑层状态 | **无效**（只能 postEvent） |
| RT-05 | 同一 tick 多次 setData | **合并为一次** apply |
| RT-06 | 页面 onUnload | **资源级联释放**（无泄漏） |
| RT-07 | 小程序 destroy | **所有页面 + 全局资源释放** |
| RT-08 | 分包按需加载 | **访问时才下载 + 装载即验证** |
| RT-09 | 跨 Runtime 实现（WebView↔ArkUI） | **setData 语义一致** |
| RT-10 | 缺 Adapter 能力调用 | **降级不崩溃**（reject + 提示） |
