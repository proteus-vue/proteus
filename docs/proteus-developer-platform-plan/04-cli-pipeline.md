# 04 CLI 流水线（A1）

> 接续 `03-spi.md`。定义 `ToolchainAPI` 的 CLI 实现：**create / dev / build / audit / publish**。
> **升级 cli-plus（G-33，CLI & 工程化）**：cli-plus 有 `proteus create/dev/build/check`，本份新增 `audit/publish/submit`。

---

## 1. 命令总览

```
proteus create <name>      # 脚手架（→ 05-project-scaffold）
proteus dev                # 开发模式（HMR + DevTools，复用 devtools-plus（G-34））
proteus build [--target]   # 构建（→ 08-publish-runtime）
proteus audit              # 静态审计（权限/签名/兼容矩阵）
proteus publish            # 发布（→ B 提审，桥接点）
proteus submit             # publish + 提交审核（一键）
proteus --explain <cmd>    # 执行计划解释（对齐 cli-plus（G-33））
```

**新增 vs cli-plus（G-33）**：`audit`（G-48 兼容矩阵 + G-49 权限校验）、`publish/submit`（A→B 桥接）。

---

## 2. 流水线（build 内部）

```
源码 ─▶ ① parse       (SFC → AST)
     ─▶ ② transform   (G-48 Adapter 映射：wx.* → Capability IR)
     ─▶ ③ optimize    (分包/懒加载/Tree shaking)
     ─▶ ④ bundle      (主包 + 分包，对齐 G-48 代码包规范)
     ─▶ ⑤ audit       (静态扫描 → AuditReport)
     ─▶ ⑥ sign        (开发者签名，G-45)
     ─▶ ⑦ package     (打包为 AppPackage)
     ─▶ ⑧ publish     (上传 + 触发提审)
```

**每步可独立跑**（`proteus build --to step=audit` 停在审计）。

---

## 3. 审计规则（audit 命令）

| 规则 | 来源 | 严重度 |
|------|------|--------|
| `AUD-01` capability 未声明却使用 | G-48 Capability IR | error |
| `AUD-02` 使用了平台特有 API 未在 adapter 映射 | G-48 兼容矩阵 L0/L1 | warn |
| `AUD-03` permissions 超出 SDK 范围 | G-49 CapabilityBridge | error |
| `AUD-04` 包体积超配额 | G-49 ResourceQuota | error |
| `AUD-05` 未签名 / 签名无效 | G-45 | error |
| `AUD-06` sdkVersion 不兼容当前运行时 | G-48 L0–L3 | error |

**审计失败 → 阻断 publish**（G-50.4 铁律：未过审计的产物不得进入分发）。

---

## 4. 配置：proteus.config.ts

```typescript
export default defineProteus({
  app: { packageId: 'com.example.demo', version: '1.0.0' },
  sdk: { version: '>=1.2.0 <2.0' },
  capabilities: [
    { name: 'login', adapter: 'wechat' },
    { name: 'payment', required: true },
  ],
  build: {
    targets: ['web', 'wechat', 'harmony'],  // 多 target 并行（复用 cli-plus（G-33））
    splitChunks: true,
  },
  publish: {
    endpoint: 'https://platform.example.com',  // DeveloperAPI 地址
    autoSubmit: false,                         // true → publish 后自动提审
  },
});
```

---

## 5. 与 cli-plus（G-33）的边界

| 能力 | cli-plus（G-33） | G-50 A1（本份） |
|------|------|----------------|
| create / dev / build / check | ✅ | 复用 |
| `defineProteus` 类型配置 | ✅ | 扩展（新增 publish/capabilities） |
| 多 target 并行 | ✅ | 复用 |
| **audit（兼容矩阵 + 权限）** | ❌ | ✅ 新增 |
| **publish / submit** | ❌ | ✅ 新增（A→B 桥接） |

> G-50 **不重写 cli-plus（G-33）**，只在 `defineProteus` 与命令集上**扩展**。

---

## 6. conformance 断言（文档化，见 conformance.md）

- `CLI-01`：`proteus create` 生成的项目可通过 `proteus build` 产出有效 AppPackage
- `CLI-02`：未声明 capability 的使用被 `audit` 拦截（AUD-01）
- `CLI-03`：审计失败的产物被 `publish` 拒绝
- `CLI-04`：`proteus publish` 产物可被 G-48 Runtime 加载（桥接验证）

---

*下一份：`05-project-scaffold.md`（A2：项目脚手架与 capability-manifest 规范）。*
