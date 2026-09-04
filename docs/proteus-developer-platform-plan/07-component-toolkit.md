# 07 组件与能力脚手架（A4）

> 接续 `06-debug-protocol.md`。定义 `ToolchainAPI.generateCapability()`——
> **基于 G-48 Capability IR 自动生成 Adapter 模板**，让接入新平台能力 = 实现一个接口。

---

## 1. 核心命令

```
proteus generate capability <name> --adapter <adapter>   # 生成能力 Adapter 模板
proteus generate component <name>                        # 生成组件骨架
proteus generate adapter <platform>                      # 生成平台 Adapter 骨架
```

**产物**：`src/capabilities/<name>.<adapter>.ts` + 对应测试桩 + manifest 条目。

---

## 2. 能力生成：Capability IR → Adapter

G-48 已定义 `Capability` 语义（login/pay/share/location/ble...）。本份将其**代码化**：

```typescript
// 生成前：capability-manifest.yaml 声明
capabilities:
  - name: login
    adapter: wechat

// 执行：proteus generate capability login --adapter wechat
// 生成后：src/capabilities/login.wechat.ts
export const loginWechat: CapabilityAdapter = {
  name: 'login',
  platform: 'wechat',
  // ★ 只需实现统一的 Capability IR 接口
  async invoke(input: LoginInput): Promise<LoginResult> {
    // TODO: 调用 wx.login（生成注释标注映射关系）
    return { token: '...' };
  },
  // 兼容性声明（对齐 G-48 兼容矩阵）
  compatibility: { level: 'L1', notes: 'wx.login → Capability IR' },
};
```

**关键**：生成的是**模板 + 映射注释**，开发者只需填充平台原生调用——
**Capability IR 的统一接口已定，无需设计 API 形态**。

---

## 3. 兼容矩阵生成（对接 G-48）

```
proteus audit --matrix   # 生成 compatibility-matrix.json
```

```json
{
  "capability": "login",
  "adapters": {
    "wechat":  { "level": "L1", "api": "wx.login" },
    "alipay":  { "level": "L1", "api": "my.getAuthCode" },
    "harmony": { "level": "L2", "api: "@ohos.account" }
  }
}
```

**这是 G-48 `05-adapter-pattern.md` 的"兼容矩阵"的自动化版本**——`audit --matrix` 把它从文档变成**可机器校验的产物**。

---

## 4. 组件骨架

```
proteus generate component map
→ src/components/map/
    index.vue          # SFC 骨架
    map.backend.ts     # ★ 渲染 Backend 接口（对接 G-27 Backend SPI）
    tests/             # G-44 测试桩
```

**组件 = 业务 SFC + 渲染 Backend**——复用 G-27 的 Backend SPI（`<map>` 等特殊节点由 Backend 渲染）。

---

## 5. 插件市场接口（Phase 3 预留）

```typescript
interface PluginMarketplace {
  search(query: string): Promise<Plugin[]>;
  install(pluginId: string): Promise<void>;
  publishPlugin(plugin: Plugin): Promise<PluginRef>;  // 开发者发布插件
}
```

**Phase 1 不实现**，仅定义接口（原则 #0 不绑定插件市场）。

---

## 6. conformance 断言

- `GEN-01`：生成的 Adapter 实现可通过 G-48 CapabilityRegistry 校验
- `GEN-02`：生成的 manifest 条目与源码调用一致（对齐 SCAFF-03）
- `GEN-03`：`audit --matrix` 输出覆盖所有声明的 capability×adapter 组合

---

*下一份：`08-publish-runtime.md`（A5：发布与运行，A→B 桥接点）。*
