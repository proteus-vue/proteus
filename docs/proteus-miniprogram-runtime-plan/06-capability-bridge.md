# G-48 能力桥接：Capability IR

> 把各平台的**设备/账号能力**收敛为**框架统一的语义 IR**（Capability IR），Platform Adapter 负责映射。复用 G-28 NativeBackend + G-46 凭证池。

---

## 1. 为什么需要 Capability IR

微信 `wx.login`、支付宝 `my.getAuthCode`、鸿蒙 `@ohos.account.getAccountManager`——**同一语义（登录），三个 API**。

**若不收敛**：业务代码 `if (platform === 'wechat') wx.login() else my.login()` → 回到 PRIM001（手动平台判断）。

**收敛后**：业务只调 `runtime.capability.login()`，Adapter 自动映射 → **业务逻辑零平台分支**。

---

## 2. 能力分类目录

| 类别 | 统一能力 | 平台映射（示例） |
|------|---------|----------------|
| **账号** | `login` / `checkSession` / `logout` | wx.login / my.getAuthCode / @ohos.account |
| **支付** | `requestPayment` | wx.requestPayment / my.tradePay |
| **分享** | `shareAppMessage` / `shareTimeline` | wx.shareAppMessage / my.shareToContacts |
| **位置** | `getLocation` / `chooseLocation` | wx.getLocation / @ohos.geoLocation |
| **设备** | `getNetworkType` / `getSystemInfo` | 各平台高度一致（L0） |
| **蓝牙** | `openBluetoothAdapter` / `connect` | wx.* / @ohos.bluetooth |
| **NFC** | `getNfcAdapter` | wx.* / @ohos.nfc |
| **媒体** | `chooseImage` / `camera` | wx.* / @ohos.multimedia |
| **直播** | `livePlayer` / `livePusher` | wx.* / 组件后端（G-27） |
| **数据** | `storage` / `file` / `database` | 各平台 + G-46 L3 缓存 |
| **UI** | `showToast` / `showModal` / `loading` | 各平台（L0 为主） |
| **导航** | `navigateTo` / `switchTab` / `redirectTo` | 页面栈操作（Runtime SPI） |

---

## 3. Capability IR 结构

```typescript
interface Capability<TParams, TResult> {
  readonly name: string;            // 'login' | 'pay' | ...
  readonly level: CapabilityLevel;   // L0/L1/L2/L3
  readonly requiresAuth: boolean;    // 是否需要登录态
  readonly requiresPermission?: string[]; // 系统权限（蓝牙/NFC/相机）
  invoke(params: TParams, ctx: InvokeContext): Promise<TResult>;
}
```

**InvokeContext**：

```typescript
interface InvokeContext {
  appId: string;            // 小程序 AppID（隔离用）
  scopedToken?: string;     // G-46 派生的受限凭证
  resourcePool: ResourcePool; // G-46
  channel: SetDataChannel;  // 异步结果回传
}
```

---

## 4. 凭证派生（★ 安全核心，复用 G-46）

业务调 `login` 时，**不返回宿主原始登录态**（HttpOnly 隔离，RSC-01），而是：

```
宿主登录态 (G-46 L1, sid/appToken)
       ↓ 按 appId + userId 派生（HMAC）
scopedToken (小程序专属，受限)
       ↓
Adapter 用 scopedToken 调平台 API
```

**好处**：

1. **宿主登录后小程序免登**（超级应用体验）
2. **凭证隔离**：小程序拿不到原始 token，即使泄漏也**仅限该 AppID 范围**
3. **可吊销**：登出时 G-46 清池，所有 scopedToken 级联失效

详见 `07-sandbox-isolation.md`。

---

## 5. 导航能力的特殊处理

`navigateTo` / `switchTab` 等**不是平台 API，而是运行时内部操作**（页面栈管理）——直接由 Runtime SPI 处理，**不走 Platform Adapter**。

**区分原则**：

- **跨小程序/跨平台的导航** → Capability（需 Adapter，如 scheme 跳转）
- **小程序内部页面跳转** → Runtime SPI 内置

---

## 6. 组件 vs API（分工明确）

| 类型 | 归属 | SPI |
|------|------|-----|
| **API 能力**（login/pay/ble） | Capability IR | PlatformAdapter SPI（G-28） |
| **组件**（map/camera/live-player） | 渲染节点 | **G-27 Backend SPI** |

**例**：`<live-player>` 是**组件** → G-27 渲染后端（原生 View / ArkUI 组件）；`wx.createLivePlayerContext` 是 **API** → Capability IR。

**这种分工让 G-48 几乎不发明新 SPI**——全部复用既有体系。

---

## 7. conformance 用例

| 编号 | 场景 | 期望 |
|------|------|------|
| CAP-01 | 同一语义跨 Adapter（微信↔鸿蒙） | **结果 shape 一致** |
| CAP-02 | L3 能力调用 | **明确 reject + 降级提示** |
| CAP-03 | login 返回 | **scopedToken（非原始登录态）** |
| CAP-04 | 未登录调 requiresAuth 能力 | **拒绝 + 引导登录** |
| CAP-05 | 缺系统权限（蓝牙/NFC） | **拒绝 + 权限说明** |
| CAP-06 | 宿主登出后调需登录能力 | **RESOURCE_POOL_CLEARED** |
| CAP-07 | 跨 AppID 用他人 scopedToken | **SANDBOX_VIOLATION** |
| CAP-08 | 组件走 G-27，API 走 Capability | **分工正确，无交叉** |

---

## 8. 与 G-44 Test IR 的集成

Capability 的 conformance 用例**序列化为 Test IR**（G-44），跑在统一 runner 上——**同一份测试，多平台 Adapter 共用**。

这是 **G-47 组合一致**的落地：Capability（能力）× Runtime（运行时）× ResourcePool（凭证）三者组合，由 TestBackend（G-44）统一验证。
