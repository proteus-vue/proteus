# G-28 编译期自动化

## 1. app.config.ts 声明能力

```ts
export default defineAppConfig({
  capabilities: {
    camera: { reason: '扫码登录' },
    location: 'when-in-use',
    notification: true,
    bluetooth: { reason: '连接硬件', permissions: ['scan', 'connect'] }
  }
})
```

## 2. Compiler 扫描生成

G-21 Compiler Plugin 扫描 SFC 与 `app.config`，自动生成：

| 产物 | 内容 |
|------|------|
| iOS `Info.plist` | `NSCameraUsageDescription`、`NSLocationWhenInUseUsageDescription`… |
| Android `AndroidManifest.xml` | `<uses-permission android:name="android.permission.CAMERA" />` |
| 鸿蒙 `module.json5` | `requestPermissions: [{ name: 'ohos.permission.CAMERA' }]` |
| 各端原生模块注册 | Bridge/MethodChannel 注册代码 |
| Tree-shaking 清单 | 未声明的能力 → 对应 Backend 代码不打包 |

**杜绝运行时才发现漏配权限。**

## 3. 权限生成规则

- `reason` 字段必填（铁律 G-28.2）→ 缺省编译报错
- 敏感权限（位置/相机/麦克风）必须显式声明 → 否则 CI 红
- 生成前后对比：Compiler 输出 diff，便于 code review

## 4. Backend 自动注册

```
node_modules/@proteus/backend-camera
    ↓  package.json 声明 "proteus-native-backend": true
Compiler 自动发现 → 生成注册代码 → 注入原生工程
```

开发者 `npm install` 即可，无需手动 `registerBackend`。

## 5. Tree-shaking

未声明的能力 → 对应 Backend 实现不进入最终包：

```
声明 { camera }  →  仅 camera Backend 打包（~12KB）
未声明 bluetooth  →  bluetooth Backend 整个剔除
```

保证包体积可控（详见 `07-integration-batches.md` 体积预算）。

## 6. 降级策略

| 场景 | 行为 |
|------|------|
| Backend 未安装 | 编译期报错 `BACKEND_NOT_INSTALLED`（fail fast） |
| 能力不支持（如 Web 无蓝牙） | 运行时 `CAPABILITY_UNSUPPORTED`，业务兜底 UI |
| 权限被拒 | `PERMISSION_DENIED`，业务引导去设置页 |

详见 `02-native-backend-spi.md`（错误码）、`05-backend-package-spec.md`（注册契约）。
