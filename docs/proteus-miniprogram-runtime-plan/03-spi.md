# G-48 SPI 定义：Runtime SPI + PlatformAdapter SPI

> 两份契约，职责正交：**Runtime SPI** 管"怎么跑"，**PlatformAdapter SPI** 管"怎么调原生"。

---

## 1. Runtime SPI（标准运行时内核）

### 1.1 AppService（逻辑层）

```typescript
interface AppService {
  /** 小程序入口：执行 App() 定义 + onLaunch */
  bootstrap(entry: AppEntry, context: RuntimeContext): Promise<void>;
  /** 注册页面（Page() 调用时收集） */
  registerPage(pagePath: string, pageDef: PageDefinition): void;
  /** 获取当前页面栈 */
  getPageStack(): PageFrame[];
  /** 销毁（级联释放所有权，G-43 Drop） */
  destroy(): void;
}
```

### 1.2 PageFrame（视图层）

```typescript
interface PageFrame {
  readonly pageId: string;
  readonly route: string;
  /** 初始渲染（WXML → 节点树） */
  render(initialData: Record<string, unknown>): void;
  /** 接收逻辑层 setData 更新 */
  applyDataChange(change: DataChange): void;
  /** 触发事件回传逻辑层 */
  emit(eventName: string, payload: unknown): void;
  /** 生命周期 */
  onShow(): void;
  onHide(): void;
  onUnload(): void;
}
```

### 1.3 SetDataChannel（通信）

```typescript
interface SetDataChannel {
  // 逻辑层 → 视图层：数据更新。change: DataChange 定义见 04-standard-runtime.md §4.1；
  // 签名以 reference-impl.cjs 为准（早期稿的 (dataPath, value) 双参形式已废弃）
  setData(pageId: string, change: DataChange): void;
  postEvent(pageId: string, eventName: string, payload: Serializable): void;
}
type Serializable = JSON-safe value; // 禁止函数 / 循环引用
```

### 1.4 RuntimeContext（运行时上下文）

```typescript
interface RuntimeContext {
  platform: 'wechat' | 'alipay' | 'douyin' | 'harmonyos';
  adapter: PlatformAdapter;       // 能力桥接
  resourcePool: ResourcePool;     // G-46：凭证/存储（按 AppID 隔离）
  channel: SetDataChannel;        // 通信通道
  sandbox: SandboxPolicy;         // 07-sandbox-isolation
}
```

### 1.5 LifecycleHooks

```typescript
interface LifecycleHooks {
  onLaunch(options: LaunchOptions): void | Promise<void>;
  onShow(options?: LaunchOptions): void;
  onHide(): void;
  onError(error: Error): void;
  onPageNotFound?(route: string): void;
}
```

---

## 2. PlatformAdapter SPI（能力桥接，G-28 特化）

### 2.1 顶层结构

```typescript
interface PlatformAdapter {
  readonly platform: string;        // 'wechat' | 'alipay' | ...
  readonly capabilities: CapabilityCatalog; // 06-capability-bridge
  /** 标准符合性声明（用于兼容矩阵） */
  readonly conformance: ConformanceReport;
  /** 工厂（G-28 NativeBackend 模式） */
  create(context: AdapterContext): BackendInstance;
  /** 装载即验证（G-45 conformance 快检） */
  conformanceCheck(): CheckResult;
}
```

### 2.2 能力接口（示例：login）

```typescript
interface LoginCapability {
  /** 统一语义：发起登录，返回受限凭证 */
  login(scope?: string): Promise<AuthResult>;
  /** 检查登录态（不触发 UI） */
  checkSession(): Promise<boolean>;
  /** 登出（级联清理 G-46） */
  logout(): Promise<void>;
}

interface AuthResult {
  scopedToken: string;   // 按 AppID 派生，非原始登录态
  userId: string;
  expiresAt: number;
}
```

### 2.3 其他能力分类（详见 `06-capability-bridge.md`）

| 类别 | 能力举例 |
|------|---------|
| 账号 | login / checkSession / logout |
| 支付 | requestPayment |
| 分享 | shareAppMessage / shareTimeline |
| 设备 | getLocation / getNetworkType / bluetooth / nfc |
| 媒体 | chooseImage / camera / livePlayer |
| 数据 | storage / file / database |
| UI | showToast / modal / loading |
| 导航 | navigateTo / switchTab / redirectTo |

---

## 3. 兼容性分级（★ 关键）

每个能力在 `conformance` 里声明级别：

| 级别 | 含义 | 示例 |
|------|------|------|
| **L0 完全一致** | API 形态 + 语义完全对齐 | `getSystemInfo` |
| **L1 语义一致，形态适配** | 参数/回调需映射 | `login`（wx → my 前缀差异） |
| **L2 部分支持** | 子集可用，需降级 | `shareTimeline`（仅微信） |
| **L3 不支持** | 该平台无此能力 | `livePlayer`（部分平台） |

**G-48 承诺**：**L0 + L1 ≥ 90%**（标准 API）；**L2 显式降级（不崩溃）**；**L3 明确列入"不支持清单" + 运行时给出兼容矩阵警告。**

---

## 4. conformance 快检（装载即验证，G-45）

Adapter 装载时跑 `conformanceCheck()`，校验：

- **ADAPT-01**：所有声明的 L0/L1 能力**必须有实现**（缺 → 拒绝装载）
- **ADAPT-02**：同能力**跨 Adapter 产出同 shape 结果**（NAT-C 套件）
- **ADAPT-03**：L3 能力调用 → **明确 reject（含降级提示）**，不静默失败
- **ADAPT-04**：凭证**必须为 scopedToken**，不得返回原始登录态（RSC-01）
- **ADAPT-05**：异步能力**必须走 setData 通道**，不得直连视图层
- **ADAPT-06**：声明的能力级别与实际行为**一致**（兼容矩阵可信）

> 编号口径：快检用例统一用 **ADAPT-xx**（与 `05-adapter-pattern.md` §6 / `conformance.md` §2 / reference-impl.cjs 一致）；早期稿的 CMP-Adapt 命名已废弃，不再使用。

不过门禁 → **拒绝装载 + 降级后端兜底**（降级不崩溃，原则 #4）。

---

## 5. 错误分类

```typescript
type RuntimeError =
  | 'ADAPTER_NOT_FOUND'      // 平台无对应 Adapter
  | 'CAPABILITY_UNSUPPORTED' // L3，能力不支持
  | 'CAPABILITY_NEED_ADAPT'  // L2，需显式适配
  | 'SETDATA_SERIALIZE_FAIL' // 数据不可序列化
  | 'SANDBOX_VIOLATION'     // 跨 AppID 访问
  | 'RESOURCE_POOL_CLEARED' // G-46 已登出清理
  | 'CONFORMANCE_FAILED';   // Adapter 装载校验失败
```

**业务处理原则**：所有错误**必须可被业务捕获 + 有降级路径**（原则 #4），**禁止静默吞错**（G-40 执行载体 CMP 纪律，显式降级）。
