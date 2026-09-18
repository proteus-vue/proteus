# G-28 协同与分批落地

## 1. 跨 plan 协同矩阵

| 关联 | 关系 |
|------|------|
| G-16 Style Safety | 原生能力调用也需过校验（权限/敏感 API） |
| G-21 Compiler Plugin | 扫描 capabilities → 生成权限清单 + Backend 注册 |
| G-22/G-22.5 柔性布局 | 能力调用后 UI 自适应（如扫码结果页 reflow） |
| G-23 AI Agent | Agent 自动组装 Backend、`app.config` 自动补 capabilities |
| G-24 语义原语 | 系统集成家族（`p-notify`/`p-permission`）的底层支撑 |
| G-25 全终端 | 车机/手表的能力降级（如手表无相机 → mock） |
| G-26 开发效率 | 99% 不写原生 = 量化结论 |
| G-27 渲染后端 | **同构方法论**：渲染 Backend + 原生 Backend = 原则 #10 泛化 |

```
G-27 渲染后端可插拔  ─┐
G-28 原生能力可插拔  ─┤── 原则 #10 泛化 ── 业务零原生代码
G-24 语义原语        ─┘
                         ↓
                   G-23 AI Agent 自动组装
                         ↓
                   G-26 开发效率（99%）
```

## 2. 落地分批

| 批次 | 内容 | 特点 |
|------|------|------|
| **B1** | `ProteusNativeBackend` 接口 + MockBackend + 契约测试 | **纯逻辑零依赖，可单测，推荐首发** |
| B2 | L1 Top 10 能力（相机/相册/扫码/定位/分享/通知/权限/剪贴板/网络/存储） | 覆盖 80% 场景 |
| B3 | Compiler 自动生成权限清单 + Backend 自动注册 | G-21 联动 |
| B4 | L2 官方 Backend 包（蓝牙/NFC/地图/支付） | SDK 作者参与 |
| B5 | G-23 Agent 自动组装 + `app.config` 推断 | AI 闭环 |
| B6 | L3 社区治理 + 签名审计 + registry | 生态 |

## 3. 单测用例

- **权限生成**：`app.config` 声明 camera → 比对生成的 Info.plist / Manifest / module.json5
- **降级行为**：Web 调蓝牙 → 抛 `CAPABILITY_UNSUPPORTED`，业务兜底 UI 正常
- **版本协商**：Backend major 不兼容 → Compiler 报错而非静默
- **动态加载**：`proteus capability add` 后无需改业务代码即可调用
- **Tree-shaking**：未声明 bluetooth → bundle 不含 bluetooth 代码
- **契约测试**：每个 Backend `satisfies ProteusNativeBackend`（复用 G-27 conformance）

## 4. 体积预算

| 范围 | 预算 |
|------|------|
| L1 内置（Top 10） | ≤ 60KB（gzip） |
| 单个 L2 Backend | ≤ 30KB（gzip） |
| 全量 L1+L2 | ≤ 200KB（gzip） |

## 5. 真机验收矩阵

| 能力 | iOS | Android | Harmony | Web |
|------|-----|---------|---------|-----|
| scanQR | ✅ | ✅ | ✅ | ✅（jsQR） |
| location | ✅ | ✅ | ✅ | ⚠️（需 HTTPS） |
| bluetooth | ✅ | ✅ | ✅ | ⚠️（WebBluetooth 有限） |

详见 `01-native-backend-architecture.md`、`02-native-backend-spi.md`、`architecture-update.md`。
