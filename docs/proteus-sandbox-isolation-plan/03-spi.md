# G-49 接口定义（SPI）

> 依赖 G-48 §03（Runtime SPI / PlatformAdapter SPI）、G-42（安全网关/容器）、G-43（所有权）
> 本份新增：**隔离层 SPI**——对上层（Runtime / 宿主）屏蔽平台差异，对下层（各平台 Backend）定义契约

---

## 1. 核心抽象：`IsolationLevel`

```ts
type IsolationLevel = 'L1' | 'L2' | 'L3' | 'L4';
// L1 逻辑隔离（同进程，独立 Context）
// L2 存储/权限隔离（+ 独立数据目录 + 权限清单）
// L3 进程隔离（+ 独立进程/Ability，崩溃隔离）
// L4 运行时隔离（V8 Isolate / microVM）—— 不在 G-49 范围
```

**关键设计**：`IsolationLevel` 是**能力声明**，不是实现细节。Runtime 只依赖接口，不关心当前是 L1 还是 L3——**后端按平台/配置返回对应级别**。

---

## 2. `SandboxBackend`（G-48 PlatformAdapter 的特化）

```ts
interface SandboxBackend {
  readonly platform: 'android' | 'ios' | 'harmonyos' | 'web';

  /** 该平台可达的最高隔离级别 */
  maxIsolationLevel(): IsolationLevel; // android/harmonyos → L3, ios → L2(+系统WebContent), web → L1

  /** 为指定小程序创建隔离上下文 */
  createContext(req: CreateContextRequest): Promise<SandboxContext>;

  /** 销毁上下文（Drop 级联：存储 + 权限 + 配额全部释放） */
  destroyContext(appId: string): Promise<void>;

  /** 进程/Ability 归属查询（L3） */
  getProcessInfo(appId: string): ProcessInfo | null;

  /** 资源配额查询与设置 */
  getQuota(appId: string): ResourceQuota;
  setQuota(appId: string, quota: Partial<ResourceQuota>): void;
}
```

### `CreateContextRequest`

```ts
interface CreateContextRequest {
  appId: string;            // 唯一标识（规范化：^[a-z0-9_]{1,64}$）
  manifest: MiniProgramManifest;  // 权限清单
  level: IsolationLevel;     // 请求级别（不得高于 maxIsolationLevel）
  dataRoot: string;          // 宿主数据根目录
}
```

### `SandboxContext`

```ts
interface SandboxContext {
  appId: string;
  level: IsolationLevel;
  dataDirectory: string;     // 隔离后的绝对路径（含 appId 后缀）
  permissions: ReadonlySet<string>;
  callApi<TReq, TRes>(api: string, req: TReq, token: ScopedToken): Promise<TRes>;
  // ↑ 经 CapabilityBridge 校验后转发
  onCrash(handler: (err: SandboxError) => void): void;
}
```

---

## 3. `CapabilityBridge`（★ 替代 addJavascriptInterface）

```ts
interface CapabilityBridge {
  /** 声明式调用：先查 manifest，再转发原生实现 */
  invoke(appId: string, api: string, params: unknown, token: ScopedToken): Promise<BridgeResult>;

  /** 动态授权（运行时弹窗，如首次定位） */
  requestPermission(appId: string, perm: string, reason: string): Promise<PermissionGrant>;

  /** 撤销（登出 / 被封禁） */
  revoke(appId: string, perm?: string): void; // 不传则撤销全部
}
```

**诚实缺口（B 落地项）**：`requestPermission`（动态授权弹窗）暂无机器参考实现（参考实现仅覆盖静态 manifest 权限校验 + revoke）——见 rules.md 编号避让登记 / architecture-update.md §4。

### 调用流程

```
小程序 JS ──callApi──> CapabilityBridge.invoke
                          │
                          ├─ 1. 校验 ScopedToken 未过期、归属 appId
                          ├─ 2. 查 manifest.permissions 是否含 api
                          │      ├─ 无 → PERMISSION_DENIED（审计日志）
                          │      └─ 有 → 3
                          ├─ 3. 检查 ResourceQuota（网络/QPS 是否超限）
                          │      ├─ 超限 → QUOTA_EXCEEDED
                          │      └─ 未超限 → 4
                          └─ 4. 转发至原生实现，返回结果
```

**关键**：bridge **不暴露任何原生对象引用**，只走序列化消息——**XSS 无法拿到 bridge 句柄**（这是反模式的核心修复点）。

---

## 4. `ResourceQuota`（资源配额，L3 强化）

```ts
interface ResourceQuota {
  memoryMB: number;      // 内存上限（L3：进程级 RSS 监控；L1/L2：软计数）
  cpuPercent: number;    // CPU 百分比上限（100 = 单核满负荷）
  networkRps: number;    // 每秒请求数（per-appId，防 DDoS 自己）
  storageMB: number;     // 持久存储上限
  maxConcurrent: number; // 同时活跃页面数
}
```

**配额执行点**：
- `CapabilityBridge.invoke` 前计数（网络）
- `SandboxContext.callApi` 前后计数（并发）
- 超限 → `QUOTA_EXCEEDED`，**不抛异常到宿主**（降级不崩溃，原则 #4）

---

## 5. `MiniProgramManifest`（权限清单契约）

```json
{
  "appId": "com.example.shop",
  "version": "1.0.0",
  "permissions": [
    "storage.read",
    "storage.write",
    "network.fetch",
    "location.get"
  ],
  "capabilities": {
    "payment": { "provider": "wechat", "merchantId": "wx_xxx" },
    "share":   { "channels": ["wechat", "timeline"] }
  },
  "quota": {
    "memoryMB": 128,
    "networkRps": 50
  },
  "signature": "sha256:...",
  "signingCert": "..."
}
```

**校验铁律（CMP-110 / G-45 复用）**：
- `signature` 须由宿主信任的证书签发（G-45 签名同源）
- `manifest.json` 内容哈希须与包内 `CHECKSUM` 一致（防 MITM 篡改权限）

---

## 6. 错误分类（G-44 Test IR 复用）

```ts
type SandboxError =
  | { code: 'MANIFEST_INVALID';   reason: string }    // CMP-110
  | { code: 'PERMISSION_DENIED';  api: string }      // CMP-111
  | { code: 'QUOTA_EXCEEDED';     resource: string }  // CMP-112
  | { code: 'INVALID_APP_ID';     appId: string }     // CMP-113
  | { code: 'ISOLATION_BREACH';   detail: string }    // CMP-114（★ 最严重）
  | { code: 'TOKEN_EXPIRED';      tokenId: string }   // CMP-115
  | { code: 'SANDBOX_CRASHED';    appId: string };    // CMP-116
```

**`ISOLATION_BREACH`** 是 G-49 独有的最高级错误：**任何跨小程序/宿主的数据访问尝试**——一旦检测即记录 + 终止该小程序 + 上报审计。**这是"机制强制"的体现。**

---

## 7. 后端实现矩阵

| Backend | L1 | L2 | L3 | 关键实现 |
|---------|:--:|:--:|:--:|---------|
| **AndroidBackend** | ✅ | ✅ | ✅ | `android:process` + `setDataDirectorySuffix` + Seccomp（L4 预留） |
| **IOSBackend** | ✅ | ✅ | ⚠️ 系统级 | `WKProcessPool` 单例 + `WKWebsiteDataStore` 分桶（**进程隔离靠 WebContent，不由应用控制**） |
| **HarmonyOSBackend** | ✅ | ✅ | ✅ | 独立 UIAbility / ServiceExtensionAbility + `EcmaVM` 独立堆 |
| **WebBackend**（测试） | ✅ | ⚠️ 模拟 | ❌ | 单进程模拟 L1/L2，用于 conformance（**不承诺真实隔离**） |

**诚实边界（CMP-117）**：`WebBackend` 仅用于测试，其"隔离"是逻辑模拟，**不能用于生产环境运行不可信代码**。这与 G-44 TestBackend 的定位一致。

---

## 8. conformance 契约（详见 conformance.md）

每个 Backend **必须**通过同一份测试（G-44 Test IR 精神）：

| 编号 | 不变量 |
|------|--------|
| SBX-01 | 跨小程序读取对方存储 → 拒绝 |
| SBX-02 | 未声明权限的 API 调用 → PERMISSION_DENIED |
| SBX-03 | 伪造/篡改 manifest 权限 → MANIFEST_INVALID |
| SBX-04 | 一个小程序崩溃 → 宿主与其他小程序不受影响 |
| SBX-05 | `destroyContext` → 存储 + 权限 + 配额全部释放（Drop 级联，G-43） |
| SBX-06 | 资源配额超限 → QUOTA_EXCEEDED，宿主不抛异常 |
| SBX-07 | appId 路径无碰撞（规范化校验） |
| SBX-08 | `ISOLATION_BREACH` 检测 → 终止 + 审计日志 |

> 诚实缺口（B 落地项）：**SBX-03**（篡改/伪造 manifest 权限 → MANIFEST_INVALID）参考实现暂不注入 manifest 篡改场景——诚实缺口，见 rules/architecture-update。
