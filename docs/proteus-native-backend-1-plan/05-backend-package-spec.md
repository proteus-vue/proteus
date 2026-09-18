# G-28 Backend 包规范

## 1. 目录结构

```
@proteus/backend-camera/
├── package.json          # 声明 proteus-native-backend: true + 三端实现
├── src/
│   ├── ios/              # Swift/ObjC 实现
│   ├── android/          # Kotlin 实现
│   ├── harmony/          # ArkTS 实现
│   └── web/              # mock/Web API 实现
├── capability.ts         # 语义接口实现（导出 scanQR 等）
└── manifest.json         # 声明能力 + 权限 + 版本
```

## 2. package.json 契约

```json
{
  "name": "@proteus/backend-camera",
  "version": "1.0.0",
  "proteus-native-backend": true,
  "proteus": {
    "capabilities": ["camera", "qr-scan"],
    "platforms": ["ios", "android", "harmony", "web"],
    "permissions": {
      "ios": ["NSCameraUsageDescription"],
      "android": ["android.permission.CAMERA"],
      "harmony": ["ohos.permission.CAMERA"]
    }
  }
}
```

**任一端缺失 → CI 红**（铁律 G-28.2）。

## 3. 注册契约

每个 Backend 默认导出实现 `ProteusNativeBackend` 的对象：

```ts
// capability.ts
export default {
  name: 'camera',
  scanQR(options) { /* ... */ },
  pickPhoto(options) { /* ... */ }
} satisfies ProteusNativeBackend
```

Compiler 按 `manifest.json` 的 `platforms` 自动选择对应端实现。

## 4. 版本化

- 语义版本 `major.minor.patch`
- `app.config` 可锁定版本区间：`"@proteus/backend-camera": "^1.0.0"`
- Breaking change（major）→ 需提供 codemod

## 5. 签名审计（社区包）

- L3 社区包须 GPG 签名 + 发布者身份
- 框架内置可信发布者白名单
- 未签名包 → 安装时警告，运行时需显式 `--allow-unsafe`

## 6. 单测约定

每个 Backend 必须提供：

- **Mock 测试**：`MockBackend` 跑通语义逻辑
- **契约测试**：实现是否符合 `ProteusNativeBackend` 接口（G-27 conformance test 复用）
- **真机测试**：CI 矩阵（详见 `07-integration-batches.md`）

详见 `06-ecosystem-governance.md`（生态治理）、`02-native-backend-spi.md`（接口定义）。
