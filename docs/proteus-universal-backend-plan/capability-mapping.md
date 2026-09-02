# Capability Mapping: 端 × 能力矩阵

> 用于 Tier-aware 编译：Compiler 据此做编译期裁剪。

---

## 1. 能力分类（L1/L2/L3）

沿用 G-28，映射到"端"维度：

| 分级 | 含义 | Tier 1 覆盖要求 |
|------|------|----------------|
| L1 内置 | 99% 端都有 | **必须全实现** |
| L2 条件 | 部分端有 | capabilities 声明 + 编译期裁剪 |
| L3 扩展 | 长尾/特定生态 | 独立 Backend 包 |

---

## 2. L1 内置能力（Tier 1 端必须实现）

> 任一 Tier 1 端都必须支持；若某 Tier 1 端不支持，需 RFC 降级为 L2。

| 能力 | 语义接口 | 说明 |
|------|----------|------|
| `navigate` | 页面路由 | 所有端都有"页面"概念 |
| `storage` | 本地存储 | KV 即可 |
| `network` | 网络请求 | fetch 等价 |
| `ui.render` | 渲染 | 渲染宿主存在即满足 |
| `lifecycle` | 应用/页面生命周期 | onShow/onHide 等 |
| `platform.info` | 平台信息 | OS/版本/屏幕 |

---

## 3. 端 × 能力矩阵（示例，持续补全）

| 能力 | iOS | Android | Harmony | Web | 小程序 | 车机 | VR |
|------|-----|---------|---------|-----|--------|------|-----|
| navigate | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | △ |
| scanQR | ✓ | ✓ | ✓ | △(WebRTC) | ✓ | ✗ | ✗ |
| camera | ✓ | ✓ | ✓ | △ | ✓ | ✗ | △ |
| bluetooth | ✓ | ✓ | ✓ | △ | ✗ | ✓ | ✓ |
| nfc | ✓(13+) | ✓ | ✓ | ✗ | ✗ | △ | ✗ |
| share | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| ar | ✓ | ✓ | ✓ | △(WebXR) | ✗ | ✗ | ✓ |
| spatial-audio | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ |

`✓` 支持 / `△` 受限 / `✗` 不支持

**Compiler 读此表 → 自动裁剪 + 报错。** 矩阵本身存于 `backend.config.ts` 的 `capabilities` 字段。

---

## 4. Tier 2/3 降级策略

| Tier | 缺失维度 | 降级行为 |
|------|----------|----------|
| 2 | 缺 J（无 JS） | 仅 SSR/预渲染输出，交互受限 |
| 2 | 缺 C（无原生能力） | L2 能力编译期报错，用 `@conditional` 降级 |
| 3 | 仅 R | 纯 UI，无逻辑、无原生；适合嵌入游戏引擎 |
| 4 | 仅 J | 无 UI；逻辑可跑（SSR/测试/Agent） |

---

## 5. 冷启动新端流程（B3 演练用）

```
1. pnpm create proteus-backend my-platform
2. 编辑 backend.config.ts → 填 capabilities（参考 §3 矩阵）
3. 实现 nodeOps（~15 方法）→ defineRenderBackend
4. pnpm test:backend → conformance test
5. 缺失能力 → 用 @conditional 提供降级 UI（在示例 App 里验证）
6. 发布 @proteus/backend-my-platform
```

**目标**：框架团队之外的人，**3 天内**接入一个**没人预研过的端**。
