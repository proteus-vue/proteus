# G-28 Backend SPI 规范

## 1. 核心接口

```ts
interface ProteusNativeBackend {
  // 设备能力
  scanQR(options?: ScanOptions): Promise<ScanResult>
  getLocation(options: LocationOptions): Promise<Location>
  pickPhoto(options: PhotoOptions): Promise<PhotoResult>

  // 系统能力
  share(data: ShareData): Promise<void>
  notify(config: NotificationConfig): Promise<void>
  requestPermission(permission: string): Promise<PermissionStatus>

  // 硬件能力
  vibrate(pattern: VibratePattern): void
  getBatteryInfo(): Promise<BatteryInfo>
  getNetworkType(): Promise<NetworkType>

  // 生命周期
  onAppStateChange(cb: (state: AppState) => void): () => void
}
```

接口刻意对齐 G-27 的 `ProteusRenderBackend` 模式：能力声明 + 版本协商 + 错误统一。

## 2. BackendCapabilities（能力声明）

```ts
interface BackendCapabilities {
  name: string                    // 'ios' | 'android' | 'harmony' | 'mock'
  version: string
  capabilities: {
    camera?: 'full' | 'limited' | 'none'
    location?: 'full' | 'when-in-use' | 'none'
    bluetooth?: 'full' | 'none'
    nfc?: 'full' | 'none'
    biometric?: 'full' | 'none'
    // ...按需扩展
  }
}
```

未声明的能力调用时 → 自动降级到 `mock` 或抛 `CapabilityNotSupported`（由业务决定）。

## 3. 语义接口契约

每个能力方法统一规则：

- **输入**：纯 POJO / 字面量（无平台类型泄漏）
- **输出**：`Promise<T>`，T 为框架定义的语义类型
- **错误**：统一 `ProteusNativeError { code, message, platform }`
- **权限**：方法内部自动触发 `requestPermission`，无需业务显式调

```ts
try {
  const { text } = await native.scanQR()
} catch (e) {
  if (e.code === 'PERMISSION_DENIED') { /* ... */ }
}
```

## 4. 版本协商

Backend 接口语义版本化（`major.minor.patch`）：

- `major`：破坏性变更（方法签名/语义改变）
- `minor`：新增能力（新增可选方法）
- `patch`：后端实现修复

Compiler 检查 `app.config` 声明的版本区间与已安装 Backend 版本兼容，否则报错。

## 5. 统一错误处理码（部分）

| code | 含义 |
|------|------|
| `PERMISSION_DENIED` | 权限被拒绝 |
| `CAPABILITY_UNSUPPORTED` | 当前端/设备不支持 |
| `BACKEND_NOT_INSTALLED` | 未安装对应 Backend |
| `VERSION_MISMATCH` | 版本不兼容 |

详见 `05-backend-package-spec.md`、`07-integration-batches.md`（版本协商单测）。
